import {
  CANONICAL_MATURE_STRUCTURE_COUNTS,
  type CanonicalMatureStructureType,
  isDevelopmentEvidenceStructure,
  validateCanonicalRoomPlanInventory,
} from "../../planning/room-development";
import {
  type PlannedPoint,
  type PlanPhase,
  ROOM_DEVELOPMENT_STAGES,
  ROOM_PLAN_HORIZON_RCL,
  ROOM_PLAN_VERSION,
  type RoadNodeKind,
  type RoomDevelopmentStageId,
  type RoomPlan,
  type RoomPlanRoad,
  type RoomPlanRoadEdge,
  type RoomPlanRoadNode,
  type RoomPlanStructure,
} from "../../planning/room-plan";
import { assessMatureLinkTopology } from "../economy/mature-energy";

type PlannedStructureType = CanonicalMatureStructureType;

interface MatureStructureSpec {
  id: string;
  structureType: PlannedStructureType;
  minRcl: number;
  priority: number;
  phase: PlanPhase;
  stage: RoomDevelopmentStageId;
  strategicWeight: number;
  reason: string;
}

interface PositionedStructure {
  structureType: StructureConstant;
  x: number;
  y: number;
  adoptable: boolean;
}

interface VisiblePositionedOccupant
  extends Omit<PositionedStructure, "adoptable"> {
  source: RoomObject;
}

interface MatureServiceTarget extends PlannedPoint {
  id: string;
  kind: RoadNodeKind;
  minRcl: number;
  stage: RoomDevelopmentStageId;
  reason: string;
  arrivalRange: 0 | 1;
}

interface PathCandidate extends PlannedPoint {
  cost: number;
  estimate: number;
}

interface MatureServiceTopology {
  nodes: RoomPlanRoadNode[];
  edges: RoomPlanRoadEdge[];
  roads: RoomPlanRoad[];
}

const LAB_OFFSETS: readonly PlannedPoint[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -2 },
  { x: 0, y: -1 },
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: 2 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
];

/**
 * The only unoccupied tile adjacent to the stamp's central output lab. A
 * service creep cannot reach that lab if this transformed tile is blocked.
 */
const LAB_SERVICE_GAP: PlannedPoint = { x: 1, y: -1 };

interface MatureLabOrientation {
  offsets: readonly PlannedPoint[];
  serviceGap: PlannedPoint;
}

function transformLabOffset(
  point: PlannedPoint,
  orientation: number,
): PlannedPoint {
  const reflected = orientation >= 4 ? { x: -point.x, y: point.y } : point;
  const rotations = orientation % 4;
  let transformed = reflected;
  for (let index = 0; index < rotations; index += 1) {
    transformed = { x: -transformed.y, y: transformed.x };
  }
  return transformed;
}

const LAB_ORIENTATIONS: readonly MatureLabOrientation[] = Array.from(
  { length: 8 },
  (_, orientation) => ({
    offsets: LAB_OFFSETS.map((point) => transformLabOffset(point, orientation)),
    serviceGap: transformLabOffset(LAB_SERVICE_GAP, orientation),
  }),
).filter(
  (orientation, index, all) =>
    all.findIndex(
      (candidate) =>
        candidate.offsets
          .map((point) => `${point.x}:${point.y}`)
          .sort()
          .join("|") ===
        orientation.offsets
          .map((point) => `${point.x}:${point.y}`)
          .sort()
          .join("|"),
    ) === index,
);

const keyOf = (point: PlannedPoint): string => `${point.x}:${point.y}`;

const isRoomInterior = (point: PlannedPoint): boolean =>
  point.x >= 2 && point.x <= 47 && point.y >= 2 && point.y <= 47;

const isMatureServiceLane = (point: PlannedPoint, hub: PlannedPoint): boolean =>
  (point.x + point.y) % 2 !== (hub.x + hub.y) % 2;

const isOverlayCompatible = (
  existing: StructureConstant,
  desired: StructureConstant,
): boolean =>
  existing === desired ||
  existing === "rampart" ||
  desired === "rampart" ||
  ((existing === "road" || desired === "road") &&
    (existing === "container" || desired === "container"));

function annotateBaseStructure(
  structure: RoomPlanStructure,
): RoomPlanStructure {
  const stage: RoomDevelopmentStageId =
    structure.stage ??
    (structure.phase === "source-logistics" ||
    structure.phase === "controller-logistics"
      ? "logistics"
      : structure.minRcl >= 8
        ? "mature-rcl8"
        : structure.minRcl >= 6
          ? "advanced-operations"
          : structure.minRcl >= 4
            ? "core-economy"
            : "bootstrap");
  const strategicWeight =
    structure.strategicWeight ??
    (structure.structureType === "tower"
      ? 8
      : structure.structureType === "extension"
        ? 2
        : structure.structureType === "container"
          ? 6
          : 2);
  const requiredForStage =
    structure.requiredForStage ??
    (structure.activation === "automatic" ||
      structure.phase === "source-logistics");
  return { ...structure, stage, strategicWeight, requiredForStage };
}

function annotateBaseRoad(road: RoomPlanRoad): RoomPlanRoad {
  return {
    ...road,
    stage: road.stage ?? "logistics",
    strategicWeight: road.strategicWeight ?? 1,
    requiredForStage: road.requiredForStage ?? true,
  };
}

function matureStructureSpecs(): MatureStructureSpec[] {
  const specs: MatureStructureSpec[] = [];
  for (let index = 11; index <= 60; index += 1) {
    const minRcl =
      index <= 20 ? 4 : index <= 30 ? 5 : index <= 40 ? 6 : index <= 50 ? 7 : 8;
    specs.push({
      id: `capacity-extension-${index}`,
      structureType: "extension",
      minRcl,
      priority: 900 - index,
      phase: "capacity-expansion",
      stage:
        minRcl <= 5
          ? "core-economy"
          : minRcl <= 7
            ? "advanced-operations"
            : "mature-rcl8",
      strategicWeight: 2,
      reason: `controller-capacity extension ${index}/60`,
    });
  }

  specs.push(
    {
      id: "spawn-1",
      structureType: "spawn",
      minRcl: 1,
      priority: 2_000,
      phase: "bootstrap-capacity",
      stage: "bootstrap",
      strategicWeight: 20,
      reason:
        "preserve the founding spawn as part of the governed mature footprint",
    },
    {
      id: "spawn-2",
      structureType: "spawn",
      minRcl: 7,
      priority: 1_500,
      phase: "advanced-operations",
      stage: "advanced-operations",
      strategicWeight: 16,
      reason: "redundant RCL7 workforce production",
    },
    {
      id: "spawn-3",
      structureType: "spawn",
      minRcl: 8,
      priority: 1_450,
      phase: "mature-operations",
      stage: "mature-rcl8",
      strategicWeight: 16,
      reason: "full mature-room workforce production capacity",
    },
    {
      id: "storage-1",
      structureType: "storage",
      minRcl: 4,
      priority: 1_400,
      phase: "core-economy",
      stage: "core-economy",
      strategicWeight: 20,
      reason: "storage-centered colony logistics core",
    },
    {
      id: "terminal-1",
      structureType: "terminal",
      minRcl: 6,
      priority: 1_050,
      phase: "advanced-operations",
      stage: "advanced-operations",
      strategicWeight: 12,
      reason: "inter-room resource logistics and trade capability",
    },
    {
      id: "extractor-1",
      structureType: "extractor",
      minRcl: 6,
      priority: 800,
      phase: "advanced-operations",
      stage: "advanced-operations",
      strategicWeight: 6,
      reason: "owned-room mineral extraction capability",
    },
    {
      id: "factory-1",
      structureType: "factory",
      minRcl: 7,
      priority: 760,
      phase: "advanced-operations",
      stage: "advanced-operations",
      strategicWeight: 8,
      reason: "commodity production capability",
    },
    {
      id: "observer-1",
      structureType: "observer",
      minRcl: 8,
      priority: 650,
      phase: "mature-operations",
      stage: "mature-rcl8",
      strategicWeight: 5,
      reason: "mature-room strategic vision capability",
    },
    {
      id: "power-spawn-1",
      structureType: "powerSpawn",
      minRcl: 8,
      priority: 720,
      phase: "mature-operations",
      stage: "mature-rcl8",
      strategicWeight: 8,
      reason: "mature-room power processing capability",
    },
    {
      id: "nuker-1",
      structureType: "nuker",
      minRcl: 8,
      priority: 500,
      phase: "mature-operations",
      stage: "mature-rcl8",
      strategicWeight: 4,
      reason: "reserved mature-room strategic strike capability",
    },
  );

  for (let index = 2; index <= 6; index += 1) {
    const minRcl = index === 2 ? 5 : index === 3 ? 7 : 8;
    specs.push({
      id: `tower-${index}`,
      structureType: "tower",
      minRcl,
      priority: 1_300 - index,
      phase: "defense-envelope",
      stage:
        minRcl === 5
          ? "core-economy"
          : minRcl === 7
            ? "advanced-operations"
            : "mature-rcl8",
      strategicWeight: 9,
      reason: `controller-authorized defensive tower ${index}/6`,
    });
  }

  for (let index = 1; index <= 6; index += 1) {
    const minRcl = index <= 2 ? 5 : index === 3 ? 6 : index === 4 ? 7 : 8;
    specs.push({
      id: `link-${index}`,
      structureType: "link",
      minRcl,
      priority: 1_000 - index,
      phase: "energy-distribution",
      stage:
        minRcl <= 5
          ? "core-economy"
          : minRcl <= 7
            ? "advanced-operations"
            : "mature-rcl8",
      strategicWeight: 5,
      reason: `controller-authorized energy link ${index}/6`,
    });
  }
  return specs;
}

function labSpecs(): MatureStructureSpec[] {
  return LAB_OFFSETS.map((_, index) => {
    const ordinal = index + 1;
    const minRcl = ordinal <= 3 ? 6 : ordinal <= 6 ? 7 : 8;
    return {
      id: ordinal <= 2 ? `lab-input-${ordinal}` : `lab-output-${ordinal - 2}`,
      structureType: "lab",
      minRcl,
      priority: 850 - ordinal,
      phase: "advanced-operations",
      stage: minRcl < 8 ? "advanced-operations" : "mature-rcl8",
      strategicWeight: 4,
      reason:
        ordinal <= 2
          ? "reaction input laboratory"
          : "reaction output laboratory within range of both inputs",
    };
  });
}

function entryFrom(
  spec: MatureStructureSpec,
  point: PlannedPoint,
): RoomPlanStructure {
  return {
    id: spec.id,
    ...point,
    structureType: spec.structureType,
    minRcl: spec.minRcl,
    priority: spec.priority,
    activation: "automatic",
    reservation: "hard",
    phase: spec.phase,
    reason: spec.reason,
    stage: spec.stage,
    strategicWeight: spec.strategicWeight,
    requiredForStage: true,
  };
}

/** Capture occupancy without applying ownership/adoption policy. */
function positioned(
  values: readonly RoomObject[],
): VisiblePositionedOccupant[] {
  return values.flatMap((value) => {
    const structureType = (value as { structureType?: unknown }).structureType;
    return typeof structureType === "string"
      ? [
          {
            source: value,
            structureType: structureType as StructureConstant,
            x: value.pos.x,
            y: value.pos.y,
          },
        ]
      : [];
  });
}

const SERVICE_NEIGHBORS: readonly PlannedPoint[] = [
  { x: -1, y: -1 },
  { x: -1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
];

function rangeBetween(left: PlannedPoint, right: PlannedPoint): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function comparePathCandidate(
  left: PathCandidate,
  right: PathCandidate,
): number {
  return (
    left.estimate - right.estimate ||
    left.cost - right.cost ||
    left.x - right.x ||
    left.y - right.y
  );
}

class PathFrontier {
  readonly #values: PathCandidate[] = [];

  get size(): number {
    return this.#values.length;
  }

  push(value: PathCandidate): void {
    this.#values.push(value);
    let index = this.#values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentValue = this.#values[parent];
      if (!parentValue || comparePathCandidate(parentValue, value) <= 0) break;
      this.#values[index] = parentValue;
      index = parent;
    }
    this.#values[index] = value;
  }

  pop(): PathCandidate | undefined {
    const first = this.#values[0];
    const last = this.#values.pop();
    if (!first || !last || this.#values.length === 0) return first;

    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      const left = this.#values[leftIndex];
      const right = this.#values[rightIndex];
      if (!left) break;
      const childIndex =
        right && comparePathCandidate(right, left) < 0 ? rightIndex : leftIndex;
      const child = this.#values[childIndex];
      if (!child || comparePathCandidate(last, child) <= 0) break;
      this.#values[index] = child;
      index = childIndex;
    }
    this.#values[index] = last;
    return first;
  }
}

function reconstructPath(
  destination: PlannedPoint,
  origin: PlannedPoint,
  previous: ReadonlyMap<string, string>,
): PlannedPoint[] {
  const reversed: PlannedPoint[] = [];
  let cursor = keyOf(destination);
  const originKey = keyOf(origin);
  while (cursor !== originKey) {
    const [xRaw, yRaw] = cursor.split(":");
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return [];
    reversed.push({ x, y });
    const parent = previous.get(cursor);
    if (!parent) return [];
    cursor = parent;
  }
  return reversed.reverse();
}

function findMatureServicePath(
  room: Room,
  origin: PlannedPoint,
  destination: PlannedPoint,
  roadAllowed: (point: PlannedPoint) => boolean,
  networkRoadKeys: ReadonlySet<string>,
  arrivalRange: 0 | 1,
): PlannedPoint[] | null {
  if (rangeBetween(origin, destination) <= arrivalRange) return [];

  const originKey = keyOf(origin);
  const frontier = new PathFrontier();
  const bestCost = new Map<string, number>([[originKey, 0]]);
  const previous = new Map<string, string>();
  frontier.push({
    ...origin,
    cost: 0,
    estimate: Math.max(0, rangeBetween(origin, destination) - arrivalRange),
  });

  while (frontier.size > 0) {
    const current = frontier.pop();
    if (!current) break;
    const currentKey = keyOf(current);
    if (current.cost !== bestCost.get(currentKey)) continue;
    if (rangeBetween(current, destination) <= arrivalRange) {
      return reconstructPath(current, origin, previous);
    }

    for (const offset of SERVICE_NEIGHBORS) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      if (!roadAllowed(next)) continue;
      const nextKey = keyOf(next);
      const terrainCost =
        room.getTerrain().get(next.x, next.y) === TERRAIN_MASK_SWAMP ? 10 : 2;
      const nextCost =
        current.cost + (networkRoadKeys.has(nextKey) ? 1 : terrainCost);
      if (nextCost >= (bestCost.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }
      bestCost.set(nextKey, nextCost);
      previous.set(nextKey, currentKey);
      frontier.push({
        ...next,
        cost: nextCost,
        estimate:
          nextCost +
          Math.max(0, rangeBetween(next, destination) - arrivalRange),
      });
    }
  }

  return null;
}

function serviceKind(structureType: BuildableStructureConstant): RoadNodeKind {
  if (structureType === "spawn") return "spawn";
  if (structureType === "tower") return "tower";
  if (structureType === "storage") return "storage";
  if (structureType === "terminal") return "terminal";
  return "advanced";
}

function matureServiceTargets(
  structures: readonly RoomPlanStructure[],
  labServiceGap: PlannedPoint,
): MatureServiceTarget[] {
  const targets: MatureServiceTarget[] = structures
    .filter(
      (structure) =>
        (structure.structureType === "spawn" && structure.id !== "spawn-1") ||
        structure.structureType === "tower" ||
        structure.structureType === "storage" ||
        structure.structureType === "terminal" ||
        structure.structureType === "link" ||
        structure.structureType === "extractor" ||
        structure.structureType === "factory" ||
        structure.structureType === "observer" ||
        structure.structureType === "powerSpawn" ||
        structure.structureType === "nuker",
    )
    .map((structure) => ({
      id: structure.id,
      kind: serviceKind(structure.structureType),
      x: structure.x,
      y: structure.y,
      minRcl: structure.minRcl,
      stage: structure.stage ?? "mature-rcl8",
      reason: `${structure.structureType} service access`,
      arrivalRange: 1,
    }));

  if (structures.some((structure) => structure.structureType === "lab")) {
    targets.push({
      id: "lab-cluster",
      kind: "lab",
      x: labServiceGap.x,
      y: labServiceGap.y,
      minRcl: 6,
      stage: "advanced-operations",
      reason: "reserved reaction-laboratory service gap",
      arrivalRange: 0,
    });
  }

  return targets.sort(
    (left, right) =>
      left.minRcl - right.minRcl || left.id.localeCompare(right.id),
  );
}

function buildMatureServiceTopology(
  room: Room,
  basePlan: RoomPlan,
  structures: readonly RoomPlanStructure[],
  labServiceGap: PlannedPoint,
  plannedAt: ReadonlyMap<string, readonly StructureConstant[]>,
  worldAt: ReadonlyMap<string, readonly PositionedStructure[]>,
  baseRoadKeys: ReadonlySet<string>,
): MatureServiceTopology {
  const sourceKeys = new Set(
    room.find(FIND_SOURCES).map((source) => keyOf(source.pos)),
  );
  const mineralKeys = new Set(
    room.find(FIND_MINERALS).map((mineral) => keyOf(mineral.pos)),
  );
  const controllerKey = room.controller ? keyOf(room.controller.pos) : null;
  const hardReservations = new Set(
    basePlan.reservations
      .filter((reservation) => reservation.kind === "hard")
      .map(keyOf),
  );
  const networkRoadKeys = new Set(baseRoadKeys);
  const addedRoads = new Map<string, RoomPlanRoad>();

  const roadAllowed = (point: PlannedPoint): boolean => {
    const key = keyOf(point);
    if (!isRoomInterior(point)) return false;
    if (room.getTerrain().get(point.x, point.y) === TERRAIN_MASK_WALL) {
      return false;
    }
    if (sourceKeys.has(key) || mineralKeys.has(key) || controllerKey === key) {
      return false;
    }
    const planned = plannedAt.get(key) ?? [];
    if (planned.some((type) => !isOverlayCompatible(type, "road"))) {
      return false;
    }
    if (
      hardReservations.has(key) &&
      !planned.some((type) => isOverlayCompatible(type, "road"))
    ) {
      return false;
    }
    return (worldAt.get(key) ?? []).every(
      (object) =>
        object.adoptable && isOverlayCompatible(object.structureType, "road"),
    );
  };

  const baseNodeIds = new Set(basePlan.roadGraph.nodes.map((node) => node.id));
  const nodes: RoomPlanRoadNode[] = [];
  if (!baseNodeIds.has("hub")) {
    nodes.push({ id: "hub", kind: "hub", ...basePlan.anchors.hub });
    baseNodeIds.add("hub");
  }
  const baseEdgeIds = new Set(basePlan.roadGraph.edges.map((edge) => edge.id));
  const edges: RoomPlanRoadEdge[] = [];

  for (const target of matureServiceTargets(structures, labServiceGap)) {
    const nodeId = `mature-service-${target.id}`;
    if (!baseNodeIds.has(nodeId)) {
      nodes.push({
        id: nodeId,
        kind: target.kind,
        x: target.x,
        y: target.y,
      });
      baseNodeIds.add(nodeId);
    }

    const edgeId = `mature-service-hub-to-${target.id}`;
    if (baseEdgeIds.has(edgeId)) continue;
    const tiles = findMatureServicePath(
      room,
      basePlan.anchors.hub,
      target,
      roadAllowed,
      networkRoadKeys,
      target.arrivalRange,
    );
    if (!tiles) {
      throw new Error(
        `No legal mature service corridor from hub to ${target.id} in ${room.name}`,
      );
    }
    edges.push({
      id: edgeId,
      from: "hub",
      to: nodeId,
      tiles: tiles.map((tile) => ({ ...tile })),
    });
    baseEdgeIds.add(edgeId);

    for (const tile of tiles) {
      const key = keyOf(tile);
      if (networkRoadKeys.has(key)) continue;
      const road: RoomPlanRoad = {
        id: `mature-service-road-${tile.x}-${tile.y}`,
        ...tile,
        minRcl: target.minRcl,
        activation: "demand",
        phase: "strategic-roads",
        reason: `mature service corridor: ${target.reason}`,
        stage: target.stage,
        strategicWeight: 1,
        requiredForStage: true,
      };
      addedRoads.set(key, road);
      networkRoadKeys.add(key);
    }
  }

  const labServiceKeys = new Set<string>();
  const frontier: PlannedPoint[] = [];
  if (roadAllowed(labServiceGap)) {
    frontier.push({ ...labServiceGap });
    labServiceKeys.add(keyOf(labServiceGap));
  }
  for (let index = 0; index < frontier.length; index += 1) {
    const current = frontier[index];
    if (!current) continue;
    for (const offset of SERVICE_NEIGHBORS) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      const key = keyOf(next);
      if (labServiceKeys.has(key) || !roadAllowed(next)) continue;
      labServiceKeys.add(key);
      frontier.push(next);
    }
  }
  for (const lab of structures.filter(
    (structure) => structure.structureType === "lab",
  )) {
    const serviceable = SERVICE_NEIGHBORS.some((offset) =>
      labServiceKeys.has(keyOf({ x: lab.x + offset.x, y: lab.y + offset.y })),
    );
    if (!serviceable) {
      throw new Error(
        `Mature lab serviceability fault in ${room.name}: ${lab.id} has no range-one position reachable from the reserved service gap at ${keyOf(labServiceGap)}`,
      );
    }
  }

  return {
    nodes,
    edges,
    roads: [...addedRoads.values()].sort(
      (left, right) => left.x - right.x || left.y - right.y,
    ),
  };
}

/**
 * Extend the immutable bootstrap geometry into a deterministic legal RCL8
 * footprint. The function never removes or relocates a base structure/road;
 * incompatible live state therefore blocks a candidate instead of being
 * silently overwritten.
 */
export function extendRoomPlanToRcl8(room: Room, basePlan: RoomPlan): RoomPlan {
  if (basePlan.roomName !== room.name) {
    throw new Error(
      `Cannot extend room plan for ${basePlan.roomName} with room ${room.name}`,
    );
  }

  const structures = basePlan.structures.map(annotateBaseStructure);
  const roads = basePlan.roads.map(annotateBaseRoad);
  const identifiers = new Set<string>();
  for (const record of [...structures, ...roads]) {
    if (identifiers.has(record.id)) {
      throw new Error(`Duplicate base room-plan identity ${record.id}`);
    }
    identifiers.add(record.id);
  }

  const plannedAt = new Map<string, StructureConstant[]>();
  const claim = (
    point: PlannedPoint,
    structureType: StructureConstant,
  ): void => {
    const key = keyOf(point);
    const existing = plannedAt.get(key) ?? [];
    if (existing.some((type) => !isOverlayCompatible(type, structureType))) {
      throw new Error(
        `Base room plan contains incompatible structure overlap at ${key}`,
      );
    }
    plannedAt.set(key, [...existing, structureType]);
  };
  for (const structure of structures) claim(structure, structure.structureType);

  const roadKeys = new Set(roads.map(keyOf));
  const reservedKeys = new Set(basePlan.reservations.map(keyOf));
  const hardReservedKeys = new Set(
    basePlan.reservations
      .filter((reservation) => reservation.kind === "hard")
      .map(keyOf),
  );
  const protectedServiceAccessKeys = new Set<string>();
  const controllerKey = room.controller ? keyOf(room.controller.pos) : null;
  const sources = room.find(FIND_SOURCES);
  const sourceKeys = new Set(sources.map((source) => keyOf(source.pos)));
  const minerals = room.find(FIND_MINERALS);
  const mineralKeys = new Set(minerals.map((mineral) => keyOf(mineral.pos)));
  const visibleStructures = room.find(FIND_STRUCTURES);
  const visibleSites = room.find(FIND_CONSTRUCTION_SITES);
  // Every visible occupant participates in collision/service checks. Ownership
  // decides only whether matching infrastructure can be adopted into the plan.
  const worldObjects: PositionedStructure[] = [
    ...positioned(visibleStructures).map(({ source, ...object }) => ({
      ...object,
      adoptable: isDevelopmentEvidenceStructure(source as Structure),
    })),
    ...positioned(visibleSites).map(({ source, ...object }) => ({
      ...object,
      adoptable: (source as ConstructionSite).my,
    })),
  ];
  const adoptableObjects = worldObjects.filter((object) => object.adoptable);
  const worldAt = new Map<string, PositionedStructure[]>();
  for (const object of worldObjects) {
    const key = keyOf(object);
    worldAt.set(key, [...(worldAt.get(key) ?? []), object]);
  }

  const hub = basePlan.anchors.hub;

  const serviceAccessUsable = (point: PlannedPoint): boolean => {
    const key = keyOf(point);
    if (!isRoomInterior(point)) return false;
    if (room.getTerrain().get(point.x, point.y) === TERRAIN_MASK_WALL) {
      return false;
    }
    if (controllerKey === key || sourceKeys.has(key) || mineralKeys.has(key)) {
      return false;
    }
    const planned = plannedAt.get(key) ?? [];
    if (planned.some((type) => !isOverlayCompatible(type, "road"))) {
      return false;
    }
    if (
      hardReservedKeys.has(key) &&
      !roadKeys.has(key) &&
      !planned.some((type) => isOverlayCompatible(type, "road"))
    ) {
      return false;
    }
    return (worldAt.get(key) ?? []).every(
      (object) =>
        object.adoptable && isOverlayCompatible(object.structureType, "road"),
    );
  };

  const usable = (
    point: PlannedPoint,
    structureType: PlannedStructureType,
    options: {
      allowReserved?: boolean;
      allowMineral?: boolean;
      allowServiceLane?: boolean;
    } = {},
  ): boolean => {
    const key = keyOf(point);
    if (protectedServiceAccessKeys.has(key)) return false;
    if (!isRoomInterior(point)) return false;
    if (room.getTerrain().get(point.x, point.y) === TERRAIN_MASK_WALL) {
      return false;
    }
    if (controllerKey === key || sourceKeys.has(key)) return false;
    if (!options.allowMineral && mineralKeys.has(key)) return false;
    if (roadKeys.has(key)) return false;
    if (!options.allowReserved && reservedKeys.has(key)) return false;
    if (!options.allowServiceLane && isMatureServiceLane(point, hub)) {
      return false;
    }
    if (
      (plannedAt.get(key) ?? []).some(
        (type) =>
          type === structureType || !isOverlayCompatible(type, structureType),
      )
    ) {
      return false;
    }
    return (worldAt.get(key) ?? []).every(
      (object) =>
        object.adoptable &&
        isOverlayCompatible(object.structureType, structureType),
    );
  };

  const candidates: PlannedPoint[] = [];
  for (let x = 2; x <= 47; x += 1) {
    for (let y = 2; y <= 47; y += 1) candidates.push({ x, y });
  }
  candidates.sort((left, right) => {
    const leftRange = Math.max(
      Math.abs(left.x - hub.x),
      Math.abs(left.y - hub.y),
    );
    const rightRange = Math.max(
      Math.abs(right.x - hub.x),
      Math.abs(right.y - hub.y),
    );
    const leftParity = (left.x + left.y) % 2;
    const rightParity = (right.x + right.y) % 2;
    const leftSwamp =
      room.getTerrain().get(left.x, left.y) === TERRAIN_MASK_SWAMP ? 1 : 0;
    const rightSwamp =
      room.getTerrain().get(right.x, right.y) === TERRAIN_MASK_SWAMP ? 1 : 0;
    return (
      leftRange - rightRange ||
      leftParity - rightParity ||
      leftSwamp - rightSwamp ||
      left.x - right.x ||
      left.y - right.y
    );
  });

  const add = (
    spec: MatureStructureSpec,
    preferred?: PlannedPoint,
    preferPreferred = false,
  ): RoomPlanStructure => {
    if (identifiers.has(spec.id)) {
      const existing = structures.find((structure) => structure.id === spec.id);
      if (!existing) {
        throw new Error(`Mature structure identity ${spec.id} is not unique`);
      }
      return existing;
    }
    const compatibleLive = adoptableObjects
      .filter((object) => object.structureType === spec.structureType)
      .map(({ x, y }) => ({ x, y }))
      .filter(
        (point) =>
          !(plannedAt.get(keyOf(point)) ?? []).includes(spec.structureType) &&
          usable(point, spec.structureType, {
            allowReserved:
              preferred !== undefined && keyOf(point) === keyOf(preferred),
            allowServiceLane: true,
          }),
      )
      .sort(
        (left, right) =>
          (preferred
            ? rangeBetween(left, preferred) - rangeBetween(right, preferred)
            : 0) ||
          left.x - right.x ||
          left.y - right.y,
      );
    const serviceableLive = preferred
      ? compatibleLive.find((point) => keyOf(point) === keyOf(preferred))
      : compatibleLive[0];
    const point =
      serviceableLive ??
      (!preferPreferred ? compatibleLive[0] : undefined) ??
      (preferred &&
      usable(preferred, spec.structureType, {
        allowReserved: true,
        allowServiceLane: true,
      })
        ? preferred
        : undefined) ??
      compatibleLive[0] ??
      candidates.find((candidate) => usable(candidate, spec.structureType));
    if (!point) {
      throw new Error(
        `No valid ${spec.structureType} position remains while extending ${room.name} to RCL8`,
      );
    }
    const entry = entryFrom(spec, point);
    structures.push(entry);
    identifiers.add(entry.id);
    claim(entry, entry.structureType);
    return entry;
  };

  const matureSpecs = matureStructureSpecs().sort(
    (left, right) =>
      right.priority - left.priority || left.id.localeCompare(right.id),
  );
  const primarySpawnSpec = matureSpecs.find((spec) => spec.id === "spawn-1");
  const storageSpec = matureSpecs.find((spec) => spec.id === "storage-1");
  if (!primarySpawnSpec || !storageSpec) {
    throw new Error("Mature room-plan catalog is incomplete");
  }
  add(primarySpawnSpec, basePlan.anchors.spawn);
  add(storageSpec, hub);

  const nearestUsableLinkTile = (
    anchor: PlannedPoint,
  ): PlannedPoint | undefined =>
    SERVICE_NEIGHBORS.map((offset) => ({
      x: anchor.x + offset.x,
      y: anchor.y + offset.y,
    }))
      .filter((point) =>
        usable(point, "link", {
          allowReserved: true,
          allowServiceLane: true,
        }),
      )
      .sort((left, right) => {
        const leftLive = (worldAt.get(keyOf(left)) ?? []).some(
          (object) => object.adoptable && object.structureType === "link",
        );
        const rightLive = (worldAt.get(keyOf(right)) ?? []).some(
          (object) => object.adoptable && object.structureType === "link",
        );
        const leftTerrain =
          room.getTerrain().get(left.x, left.y) === TERRAIN_MASK_SWAMP ? 1 : 0;
        const rightTerrain =
          room.getTerrain().get(right.x, right.y) === TERRAIN_MASK_SWAMP
            ? 1
            : 0;
        return (
          Number(rightLive) - Number(leftLive) ||
          leftTerrain - rightTerrain ||
          rangeBetween(left, hub) - rangeBetween(right, hub) ||
          left.x - right.x ||
          left.y - right.y
        );
      })[0];

  const storage = structures.find(
    (structure) => structure.structureType === "storage",
  );
  if (!storage) throw new Error("Mature room plan has no storage energy core");
  const sourceRoleAnchors: Array<{
    anchor: PlannedPoint;
    reason: string;
  }> = basePlan.anchors.sources
    .map((source, sourceIndex) => {
      const preferred = nearestUsableLinkTile(source.container);
      const adoptsLiveLink =
        preferred !== undefined &&
        (worldAt.get(keyOf(preferred)) ?? []).some(
          (object) => object.adoptable && object.structureType === "link",
        );
      const plannedRouteLength =
        basePlan.roadGraph.edges.find(
          (edge) => edge.from === "hub" && edge.to === `source-${sourceIndex}`,
        )?.tiles.length ?? rangeBetween(hub, source.container);
      return { source, adoptsLiveLink, plannedRouteLength };
    })
    .sort(
      (left, right) =>
        Number(right.adoptsLiveLink) - Number(left.adoptsLiveLink) ||
        right.plannedRouteLength - left.plannedRouteLength ||
        left.source.sourceId.localeCompare(right.source.sourceId),
    )
    .map(({ source }) => ({
      anchor: source.container,
      reason: `source-link service for ${source.sourceId}`,
    }));
  const firstSource = sourceRoleAnchors[0];
  const roleAnchors: Array<{
    anchor: PlannedPoint;
    reason: string;
  }> = [
    ...(firstSource ? [firstSource] : []),
    { anchor: storage, reason: "storage-core energy link service" },
    ...sourceRoleAnchors.slice(1),
    ...(basePlan.anchors.controller
      ? [
          {
            anchor: basePlan.anchors.controller.service,
            reason: "controller-link upgrade service",
          },
        ]
      : []),
  ];
  const linkSpecs = matureSpecs.filter((spec) => spec.structureType === "link");
  for (const [index, role] of roleAnchors.entries()) {
    const spec = linkSpecs[index];
    if (!spec) {
      throw new Error(
        `Mature energy topology fault in ${room.name}: no link specification remains for ${role.reason}`,
      );
    }
    const preferred = nearestUsableLinkTile(role.anchor);
    const existing = structures.find((structure) => structure.id === spec.id);
    if (!preferred && (!existing || rangeBetween(existing, role.anchor) > 1)) {
      throw new Error(
        `Mature energy topology fault in ${room.name}: no legal adjacent link tile for ${role.reason}`,
      );
    }
    const placed = add({ ...spec, reason: role.reason }, preferred, true);
    if (rangeBetween(placed, role.anchor) > 1) {
      throw new Error(
        `Mature energy topology fault in ${room.name}: preserved ${spec.id} at ${keyOf(placed)} is outside range one of ${role.reason}`,
      );
    }
  }

  const extractorSpec = matureStructureSpecs().find(
    (spec) => spec.id === "extractor-1",
  );
  const mineral = [...minerals].sort(
    (left, right) => left.pos.x - right.pos.x || left.pos.y - right.pos.y,
  )[0];
  if (!extractorSpec || !mineral) {
    throw new Error(
      `Cannot extend ${room.name} to RCL8 without a visible mineral`,
    );
  }
  if (
    !usable(mineral.pos, "extractor", {
      allowMineral: true,
      allowReserved: true,
      allowServiceLane: true,
    })
  ) {
    throw new Error(
      `Mineral tile ${keyOf(mineral.pos)} cannot host the governed extractor`,
    );
  }
  const extractor = entryFrom(extractorSpec, mineral.pos);
  structures.push(extractor);
  identifiers.add(extractor.id);
  claim(extractor, extractor.structureType);

  for (const spec of matureSpecs) {
    if (
      spec.id === "spawn-1" ||
      spec.id === "storage-1" ||
      spec.id === "extractor-1" ||
      spec.structureType === "link"
    ) {
      continue;
    }
    add(spec);
  }

  const auxiliaryAnchors = [
    structures.find((structure) => structure.structureType === "terminal"),
    structures.find((structure) => structure.id === "spawn-2"),
    structures.find((structure) => structure.id === "spawn-3"),
    ...structures.filter((structure) => structure.structureType === "tower"),
  ].filter((anchor): anchor is RoomPlanStructure => anchor !== undefined);
  for (const [index, spec] of linkSpecs.slice(roleAnchors.length).entries()) {
    const auxiliary = auxiliaryAnchors[index];
    add(
      {
        ...spec,
        reason: auxiliary
          ? `auxiliary energy sink for ${auxiliary.id}`
          : spec.reason,
      },
      auxiliary ? nearestUsableLinkTile(auxiliary) : undefined,
    );
  }

  const labCatalog = labSpecs();
  const existingLabKeys = new Set(
    adoptableObjects
      .filter((object) => object.structureType === "lab")
      .map(keyOf),
  );
  const labStampServiceable = (
    points: readonly PlannedPoint[],
    serviceGap: PlannedPoint,
  ): boolean => {
    const labKeys = new Set(points.map(keyOf));
    const reachable = new Set<string>();
    const frontier: PlannedPoint[] = [];
    if (serviceAccessUsable(serviceGap) && !labKeys.has(keyOf(serviceGap))) {
      reachable.add(keyOf(serviceGap));
      frontier.push({ ...serviceGap });
    }
    for (let index = 0; index < frontier.length; index += 1) {
      const current = frontier[index];
      if (!current) continue;
      for (const offset of SERVICE_NEIGHBORS) {
        const next = { x: current.x + offset.x, y: current.y + offset.y };
        const key = keyOf(next);
        if (
          reachable.has(key) ||
          labKeys.has(key) ||
          !serviceAccessUsable(next)
        ) {
          continue;
        }
        reachable.add(key);
        frontier.push(next);
      }
    }
    return points.every((lab) =>
      SERVICE_NEIGHBORS.some((offset) =>
        reachable.has(keyOf({ x: lab.x + offset.x, y: lab.y + offset.y })),
      ),
    );
  };
  let labPlacement:
    | { points: PlannedPoint[]; serviceGap: PlannedPoint }
    | undefined;
  for (const center of candidates) {
    if (rangeBetween(center, hub) < 4) continue;
    for (const orientation of LAB_ORIENTATIONS) {
      const points = orientation.offsets.map((offset) => ({
        x: center.x + offset.x,
        y: center.y + offset.y,
      }));
      const serviceGap = {
        x: center.x + orientation.serviceGap.x,
        y: center.y + orientation.serviceGap.y,
      };
      const keys = new Set(points.map(keyOf));
      if (
        points.every((point) =>
          usable(point, "lab", { allowServiceLane: true }),
        ) &&
        serviceAccessUsable(serviceGap) &&
        [...existingLabKeys].every((key) => keys.has(key)) &&
        labStampServiceable(points, serviceGap)
      ) {
        labPlacement = { points, serviceGap };
        break;
      }
    }
    if (labPlacement) break;
  }
  if (!labPlacement) {
    throw new Error(
      `No serviceable ten-lab reaction cluster remains while extending ${room.name} to RCL8`,
    );
  }
  protectedServiceAccessKeys.add(keyOf(labPlacement.serviceGap));
  reservedKeys.add(keyOf(labPlacement.serviceGap));
  for (const [index, spec] of labCatalog.entries()) {
    const point = labPlacement.points[index];
    if (!point) throw new Error("Mature lab stamp is incomplete");
    const entry = entryFrom(spec, point);
    structures.push(entry);
    identifiers.add(entry.id);
    claim(entry, entry.structureType);
  }

  const energyTopology = assessMatureLinkTopology({
    ...basePlan,
    structures,
  });
  if (energyTopology.status !== "ready") {
    throw new Error(
      `Mature energy topology fault in ${room.name}: ${energyTopology.reason}`,
    );
  }

  for (const object of adoptableObjects) {
    if (!Object.hasOwn(CANONICAL_MATURE_STRUCTURE_COUNTS, object.structureType))
      continue;
    const represented = structures.some(
      (structure) =>
        structure.structureType === object.structureType &&
        structure.x === object.x &&
        structure.y === object.y,
    );
    if (!represented) {
      throw new Error(
        `Existing ${object.structureType} at ${keyOf(object)} cannot be preserved in the mature room plan`,
      );
    }
  }

  const inventoryIssues = validateCanonicalRoomPlanInventory({ structures });
  if (inventoryIssues.length > 0) {
    throw new Error(
      `Mature room-plan inventory fault in ${room.name}: ${inventoryIssues[0]}`,
    );
  }

  const serviceTopology = buildMatureServiceTopology(
    room,
    basePlan,
    structures,
    labPlacement.serviceGap,
    plannedAt,
    worldAt,
    roadKeys,
  );
  for (const road of serviceTopology.roads) {
    if (identifiers.has(road.id)) {
      throw new Error(`Duplicate mature service-road identity ${road.id}`);
    }
    identifiers.add(road.id);
    roads.push(road);
  }

  const reservations = [
    ...basePlan.reservations.map((reservation) => ({ ...reservation })),
    {
      id: "mature-lab-service-gap",
      x: labPlacement.serviceGap.x,
      y: labPlacement.serviceGap.y,
      kind: "soft" as const,
      reason:
        "walkable reaction-laboratory service gap reserved from structure placement",
    },
    ...structures
      .filter(
        (structure) =>
          !basePlan.structures.some((base) => base.id === structure.id),
      )
      .map((structure) => ({
        id: `structure-${structure.id}`,
        x: structure.x,
        y: structure.y,
        kind: "hard" as const,
        reason: structure.reason,
      })),
    ...serviceTopology.roads.map((road) => ({
      id: `reservation-${road.id}`,
      x: road.x,
      y: road.y,
      kind: "soft" as const,
      reason: road.reason,
    })),
  ];
  const protectedTiles = new Map<string, PlannedPoint>();
  for (const point of [
    ...basePlan.defense.protectedTiles,
    ...structures
      .filter((structure) => structure.requiredForStage)
      .map(({ x, y }) => ({ x, y })),
  ]) {
    protectedTiles.set(keyOf(point), { ...point });
  }

  return {
    ...basePlan,
    version: ROOM_PLAN_VERSION,
    horizonRcl: ROOM_PLAN_HORIZON_RCL,
    stages: ROOM_DEVELOPMENT_STAGES.map((stage) => ({
      ...stage,
      prerequisiteStageIds: [...stage.prerequisiteStageIds],
    })),
    anchors: {
      spawn: { ...basePlan.anchors.spawn },
      hub: { ...basePlan.anchors.hub },
      controller: basePlan.anchors.controller
        ? {
            ...basePlan.anchors.controller,
            service: { ...basePlan.anchors.controller.service },
          }
        : null,
      sources: basePlan.anchors.sources.map((source) => ({
        ...source,
        container: { ...source.container },
      })),
    },
    reservations,
    structures,
    roads,
    roadGraph: {
      nodes: [
        ...basePlan.roadGraph.nodes.map((node) => ({ ...node })),
        ...serviceTopology.nodes,
      ],
      edges: [
        ...basePlan.roadGraph.edges.map((edge) => ({
          ...edge,
          tiles: edge.tiles.map((tile) => ({ ...tile })),
        })),
        ...serviceTopology.edges,
      ],
    },
    defense: {
      ...basePlan.defense,
      protectedTiles: [...protectedTiles.values()],
      perimeter: basePlan.defense.perimeter.map((point) => ({ ...point })),
    },
  };
}
