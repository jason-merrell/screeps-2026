import {
  type PlannedPoint,
  ROOM_PLAN_PLANNER_REVISION,
  type RoomPlan,
  type RoomPlanReservation,
  type RoomPlanRoad,
  type RoomPlanRoadEdge,
  type RoomPlanRoadNode,
  type RoomPlanStructure,
} from "../../planning/room-plan";
import {
  advanceRoomPlanProjection,
  recordSettlementProjectionFault,
  settlementRetryDue,
  supersedeSettlementProjectionFault,
  usableRoomPlanProjection,
} from "../../planning/room-plan-projection";
import type { WorldSnapshot } from "../../runtime/context";
import { deriveRoomDefenseEnvelope } from "./defense-envelope";
import { extendRoomPlanToRcl8 } from "./mature-layout";
import { normalizeRoomPlanProjection } from "./normalize";
import {
  RAPID_FILL_EXTENSION_OFFSETS,
  RAPID_FILL_ROAD_OFFSETS,
  translateStampPoint,
} from "./stamps";

const LEGACY_BOOTSTRAP_PLAN_VERSION = 3;
const LEGACY_BOOTSTRAP_HORIZON_RCL = 3;

const pointKey = (point: PlannedPoint): string => `${point.x}:${point.y}`;

const compareStableText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function compareSpawnAnchor(
  left: StructureSpawn,
  right: StructureSpawn,
): number {
  return (
    compareStableText(left.name, right.name) ||
    compareStableText(String(left.id), String(right.id)) ||
    left.pos.x - right.pos.x ||
    left.pos.y - right.pos.y
  );
}

function compareSourceAnchor(left: Source, right: Source): number {
  return (
    compareStableText(String(left.id), String(right.id)) ||
    left.pos.x - right.pos.x ||
    left.pos.y - right.pos.y
  );
}

function parsePointKey(key: string): PlannedPoint {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator >= key.length - 1) {
    throw new Error(`Invalid room-plan point key '${key}'`);
  }
  const x = Number(key.slice(0, separator));
  const y = Number(key.slice(separator + 1));
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`Invalid room-plan point key '${key}'`);
  }
  return { x, y };
}

const inPlanningBounds = (point: PlannedPoint): boolean =>
  point.x >= 2 && point.x <= 47 && point.y >= 2 && point.y <= 47;

function terrainPenalty(room: Room, point: PlannedPoint): number {
  return room.getTerrain().get(point.x, point.y) === TERRAIN_MASK_SWAMP ? 5 : 0;
}

function blocksPlannedStructure(room: Room, point: PlannedPoint): boolean {
  return room
    .lookForAt(LOOK_STRUCTURES, point.x, point.y)
    .some(
      (structure) =>
        structure.structureType !== STRUCTURE_ROAD &&
        structure.structureType !== STRUCTURE_RAMPART,
    );
}

function openPlanTile(room: Room, point: PlannedPoint): boolean {
  if (!inPlanningBounds(point)) return false;
  if (room.getTerrain().get(point.x, point.y) === TERRAIN_MASK_WALL)
    return false;
  if (blocksPlannedStructure(room, point)) return false;
  if (room.lookForAt(LOOK_CONSTRUCTION_SITES, point.x, point.y).length > 0)
    return false;
  if (room.controller?.pos.x === point.x && room.controller.pos.y === point.y)
    return false;
  return !room
    .find(FIND_SOURCES)
    .some((source) => source.pos.x === point.x && source.pos.y === point.y);
}

function existingStructurePoints(
  room: Room,
  structureType: BuildableStructureConstant,
): PlannedPoint[] {
  const points = new Map<string, PlannedPoint>();
  for (const object of [
    ...room.find(FIND_STRUCTURES),
    ...room.find(FIND_CONSTRUCTION_SITES),
  ]) {
    if (object.structureType !== structureType) continue;
    points.set(pointKey(object.pos), { x: object.pos.x, y: object.pos.y });
  }
  return [...points.values()];
}

function canAdoptExistingStructure(
  room: Room,
  point: PlannedPoint,
  structureType: BuildableStructureConstant,
): boolean {
  if (!inPlanningBounds(point)) return false;
  if (room.getTerrain().get(point.x, point.y) === TERRAIN_MASK_WALL)
    return false;
  if (room.controller?.pos.x === point.x && room.controller.pos.y === point.y)
    return false;
  if (
    room
      .find(FIND_SOURCES)
      .some((source) => source.pos.x === point.x && source.pos.y === point.y)
  )
    return false;

  const structures = room.lookForAt(LOOK_STRUCTURES, point.x, point.y);
  const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, point.x, point.y);
  const hasDesired =
    structures.some((structure) => structure.structureType === structureType) ||
    sites.some((site) => site.structureType === structureType);
  return (
    hasDesired &&
    structures.every(
      (structure) =>
        structure.structureType === structureType ||
        structure.structureType === STRUCTURE_RAMPART ||
        ((structure.structureType === STRUCTURE_ROAD ||
          structureType === STRUCTURE_ROAD) &&
          (structure.structureType === STRUCTURE_CONTAINER ||
            structureType === STRUCTURE_CONTAINER)),
    ) &&
    sites.every((site) => site.structureType === structureType)
  );
}

function buildableDensity(room: Room, point: PlannedPoint, radius = 2): number {
  let buildable = 0;
  let total = 0;
  for (let x = point.x - radius; x <= point.x + radius; x += 1) {
    for (let y = point.y - radius; y <= point.y + radius; y += 1) {
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      total += 1;
      if (room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL) buildable += 1;
    }
  }
  return total === 0 ? 0 : buildable / total;
}

function edgeDistance(point: PlannedPoint): number {
  return Math.min(point.x, point.y, 49 - point.x, 49 - point.y);
}

function chooseHub(room: Room, spawn: StructureSpawn): PlannedPoint {
  const sources = room.find(FIND_SOURCES);
  const controller = room.controller;
  const candidates: Array<PlannedPoint & { score: number }> = [];
  const existingStorage = existingStructurePoints(room, STRUCTURE_STORAGE)
    .filter((point) =>
      canAdoptExistingStructure(room, point, STRUCTURE_STORAGE),
    )
    .sort(
      (left, right) =>
        spawn.pos.getRangeTo(left.x, left.y) -
          spawn.pos.getRangeTo(right.x, right.y) ||
        left.x - right.x ||
        left.y - right.y,
    )[0];
  if (existingStorage) return existingStorage;

  for (
    let x = Math.max(4, spawn.pos.x - 6);
    x <= Math.min(45, spawn.pos.x + 6);
    x += 1
  ) {
    for (
      let y = Math.max(4, spawn.pos.y - 6);
      y <= Math.min(45, spawn.pos.y + 6);
      y += 1
    ) {
      const point = { x, y };
      if (!openPlanTile(room, point)) continue;
      const spawnRange = spawn.pos.getRangeTo(x, y);
      if (spawnRange < 2 || spawnRange > 6) continue;

      const position = new RoomPosition(x, y, room.name);
      if (sources.some((source) => position.getRangeTo(source) <= 2)) continue;
      if (controller && position.getRangeTo(controller) <= 2) continue;

      const sourceRange =
        sources.length === 0
          ? 0
          : sources.reduce(
              (total, source) => total + position.getRangeTo(source),
              0,
            ) / sources.length;
      const controllerRange = controller ? position.getRangeTo(controller) : 0;
      const density = buildableDensity(room, point);
      const edgePenalty = Math.max(0, 8 - edgeDistance(point)) * 3;
      const score =
        spawnRange * 2 +
        sourceRange * 1.5 +
        controllerRange +
        terrainPenalty(room, point) +
        (1 - density) * 40 +
        edgePenalty +
        x / 1000 +
        y / 100000;
      candidates.push({ ...point, score });
    }
  }

  return (
    candidates.sort((a, b) => a.score - b.score)[0] ?? {
      x: Math.max(2, Math.min(47, spawn.pos.x + 2)),
      y: spawn.pos.y,
    }
  );
}

function chooseSourceContainer(
  room: Room,
  source: Source,
  hub: PlannedPoint,
): PlannedPoint {
  const candidates: Array<PlannedPoint & { score: number }> = [];
  const hubPos = new RoomPosition(hub.x, hub.y, room.name);

  for (let x = source.pos.x - 1; x <= source.pos.x + 1; x += 1) {
    for (let y = source.pos.y - 1; y <= source.pos.y + 1; y += 1) {
      if (x === source.pos.x && y === source.pos.y) continue;
      const point = { x, y };
      const adoptsExisting = canAdoptExistingStructure(
        room,
        point,
        STRUCTURE_CONTAINER,
      );
      if (!adoptsExisting && !openPlanTile(room, point)) continue;
      candidates.push({
        ...point,
        score:
          (adoptsExisting ? -10_000 : 0) +
          hubPos.getRangeTo(x, y) * 10 +
          terrainPenalty(room, point) +
          x / 1000 +
          y / 100000,
      });
    }
  }

  return (
    candidates.sort((a, b) => a.score - b.score)[0] ?? {
      x: Math.max(2, Math.min(47, source.pos.x + 1)),
      y: source.pos.y,
    }
  );
}

function chooseControllerService(
  room: Room,
  hub: PlannedPoint,
): PlannedPoint | null {
  const controller = room.controller;
  if (!controller) return null;
  const hubPos = new RoomPosition(hub.x, hub.y, room.name);
  const candidates: Array<PlannedPoint & { score: number }> = [];

  for (let x = controller.pos.x - 3; x <= controller.pos.x + 3; x += 1) {
    for (let y = controller.pos.y - 3; y <= controller.pos.y + 3; y += 1) {
      if (
        Math.max(
          Math.abs(x - controller.pos.x),
          Math.abs(y - controller.pos.y),
        ) !== 3
      )
        continue;
      const point = { x, y };
      const adoptsExisting = canAdoptExistingStructure(
        room,
        point,
        STRUCTURE_CONTAINER,
      );
      if (!adoptsExisting && !openPlanTile(room, point)) continue;
      candidates.push({
        ...point,
        score:
          (adoptsExisting ? -10_000 : 0) +
          hubPos.getRangeTo(x, y) * 10 +
          terrainPenalty(room, point) +
          x / 1000 +
          y / 100000,
      });
    }
  }

  return candidates.sort((a, b) => a.score - b.score)[0] ?? null;
}

function chooseRapidFillExtensions(
  room: Room,
  spawn: StructureSpawn,
  unavailable: Set<string>,
): PlannedPoint[] {
  const selected: PlannedPoint[] = [];
  const selectedKeys = new Set<string>();
  const sources = room.find(FIND_SOURCES);

  const accept = (point: PlannedPoint, adoptsExisting = false): boolean => {
    const key = pointKey(point);
    if (
      unavailable.has(key) ||
      selectedKeys.has(key) ||
      (adoptsExisting
        ? !canAdoptExistingStructure(room, point, STRUCTURE_EXTENSION)
        : !openPlanTile(room, point))
    )
      return false;
    if (!adoptsExisting) {
      const position = new RoomPosition(point.x, point.y, room.name);
      if (sources.some((source) => position.getRangeTo(source) <= 2))
        return false;
      if (room.controller && position.getRangeTo(room.controller) <= 2)
        return false;
    }
    selected.push(point);
    selectedKeys.add(key);
    return true;
  };

  for (const point of existingStructurePoints(room, STRUCTURE_EXTENSION).sort(
    (left, right) =>
      spawn.pos.getRangeTo(left.x, left.y) -
        spawn.pos.getRangeTo(right.x, right.y) ||
      left.x - right.x ||
      left.y - right.y,
  )) {
    if (selected.length >= 10) break;
    accept(point, true);
  }

  for (const offset of RAPID_FILL_EXTENSION_OFFSETS) {
    accept(translateStampPoint(spawn.pos, offset));
  }

  if (selected.length >= 10) return selected.slice(0, 10);

  const fallback: Array<PlannedPoint & { score: number }> = [];
  for (
    let x = Math.max(2, spawn.pos.x - 6);
    x <= Math.min(47, spawn.pos.x + 6);
    x += 1
  ) {
    for (
      let y = Math.max(2, spawn.pos.y - 6);
      y <= Math.min(47, spawn.pos.y + 6);
      y += 1
    ) {
      const point = { x, y };
      const range = spawn.pos.getRangeTo(x, y);
      if (range < 2 || range > 6) continue;
      if (
        unavailable.has(pointKey(point)) ||
        selectedKeys.has(pointKey(point)) ||
        !openPlanTile(room, point)
      ) {
        continue;
      }
      const position = new RoomPosition(x, y, room.name);
      if (sources.some((source) => position.getRangeTo(source) <= 2)) continue;
      if (room.controller && position.getRangeTo(room.controller) <= 2)
        continue;
      fallback.push({
        ...point,
        score: range * 10 + terrainPenalty(room, point) + x / 1000 + y / 100000,
      });
    }
  }

  for (const candidate of fallback.sort((a, b) => a.score - b.score)) {
    if (selected.length >= 10) break;
    accept(candidate);
  }
  return selected;
}

function chooseTowerTile(
  room: Room,
  hub: PlannedPoint,
  unavailable: Set<string>,
): PlannedPoint | null {
  const hubPos = new RoomPosition(hub.x, hub.y, room.name);
  const candidates: Array<PlannedPoint & { score: number }> = [];
  const existingTower = existingStructurePoints(room, STRUCTURE_TOWER)
    .filter(
      (point) =>
        !unavailable.has(pointKey(point)) &&
        canAdoptExistingStructure(room, point, STRUCTURE_TOWER),
    )
    .sort(
      (left, right) =>
        hubPos.getRangeTo(left.x, left.y) -
          hubPos.getRangeTo(right.x, right.y) ||
        left.x - right.x ||
        left.y - right.y,
    )[0];
  if (existingTower) return existingTower;

  for (let x = Math.max(2, hub.x - 5); x <= Math.min(47, hub.x + 5); x += 1) {
    for (let y = Math.max(2, hub.y - 5); y <= Math.min(47, hub.y + 5); y += 1) {
      const point = { x, y };
      if (unavailable.has(pointKey(point)) || !openPlanTile(room, point))
        continue;
      const range = hubPos.getRangeTo(x, y);
      if (range < 2 || range > 5) continue;
      candidates.push({
        ...point,
        score: range * 10 + terrainPenalty(room, point) + x / 1000 + y / 100000,
      });
    }
  }

  return candidates.sort((a, b) => a.score - b.score)[0] ?? null;
}

function buildRoadGraph(
  room: Room,
  spawn: StructureSpawn,
  hub: PlannedPoint,
  sourceAnchors: Array<{
    sourceId: string;
    x: number;
    y: number;
    container: PlannedPoint;
  }>,
  controllerService: PlannedPoint | null,
  hardBlocked: Set<string>,
): {
  nodes: RoomPlanRoadNode[];
  edges: RoomPlanRoadEdge[];
  roads: RoomPlanRoad[];
} {
  const nodes: RoomPlanRoadNode[] = [
    { id: "spawn", kind: "spawn", x: spawn.pos.x, y: spawn.pos.y },
    { id: "hub", kind: "hub", x: hub.x, y: hub.y },
    ...sourceAnchors.map((source, index) => ({
      id: `source-${index}`,
      kind: "source" as const,
      x: source.container.x,
      y: source.container.y,
    })),
    ...(controllerService
      ? [
          {
            id: "controller",
            kind: "controller" as const,
            ...controllerService,
          },
        ]
      : []),
  ];

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const desiredEdges: Array<[string, string]> = [
    ["spawn", "hub"],
    ...sourceAnchors.map(
      (_, index) => ["hub", `source-${index}`] as [string, string],
    ),
    ...(controllerService ? [["hub", "controller"] as [string, string]] : []),
  ];

  const roadKeys = new Set<string>();
  for (const offset of RAPID_FILL_ROAD_OFFSETS) {
    const point = translateStampPoint(spawn.pos, offset);
    if (
      inPlanningBounds(point) &&
      !hardBlocked.has(pointKey(point)) &&
      room.getTerrain().get(point.x, point.y) !== TERRAIN_MASK_WALL
    ) {
      roadKeys.add(pointKey(point));
    }
  }

  const edges: RoomPlanRoadEdge[] = [];
  for (const [fromId, toId] of desiredEdges) {
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    if (!from || !to) continue;

    const result = PathFinder.search(
      new RoomPosition(from.x, from.y, room.name),
      { pos: new RoomPosition(to.x, to.y, room.name), range: 1 },
      {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 10,
        roomCallback: (roomName) => {
          if (roomName !== room.name) return false;
          const matrix = new PathFinder.CostMatrix();
          for (const structure of room.find(FIND_STRUCTURES)) {
            if (structure.structureType === STRUCTURE_ROAD) {
              matrix.set(structure.pos.x, structure.pos.y, 1);
            } else if (
              structure.structureType !== STRUCTURE_CONTAINER &&
              structure.structureType !== STRUCTURE_RAMPART
            ) {
              matrix.set(structure.pos.x, structure.pos.y, 255);
            }
          }
          for (const key of hardBlocked) {
            const point = parsePointKey(key);
            matrix.set(point.x, point.y, 255);
          }
          for (const key of roadKeys) {
            const point = parsePointKey(key);
            if (matrix.get(point.x, point.y) < 255)
              matrix.set(point.x, point.y, 1);
          }
          return matrix;
        },
      },
    );

    if (result.incomplete) continue;
    const tiles = result.path
      .map((position) => ({ x: position.x, y: position.y }))
      .filter((point) => !hardBlocked.has(pointKey(point)));
    for (const tile of tiles) roadKeys.add(pointKey(tile));
    edges.push({ id: `${fromId}->${toId}`, from: fromId, to: toId, tiles });
  }

  const roads: RoomPlanRoad[] = [...roadKeys]
    .map((key) => {
      const point = parsePointKey(key);
      return {
        id: `road-${point.x}-${point.y}`,
        ...point,
        minRcl: 2,
        activation: "demand" as const,
        phase: "strategic-roads" as const,
        reason:
          "strategic corridor; activate when traffic ROI justifies construction",
      };
    })
    .sort((a, b) => a.x - b.x || a.y - b.y);

  return { nodes, edges, roads };
}

function generateBootstrapRoomPlan(
  room: Room,
  reason: string,
): RoomPlan | null {
  const spawn = [...room.find(FIND_MY_SPAWNS)].sort(compareSpawnAnchor)[0];
  if (!spawn) return null;

  const hub = chooseHub(room, spawn);
  const sourceAnchors = [...room.find(FIND_SOURCES)]
    .sort(compareSourceAnchor)
    .map((source) => ({
      sourceId: source.id as string,
      x: source.pos.x,
      y: source.pos.y,
      container: chooseSourceContainer(room, source, hub),
    }));
  const controllerService = chooseControllerService(room, hub);

  const unavailable = new Set<string>([pointKey(hub)]);
  for (const source of sourceAnchors)
    unavailable.add(pointKey(source.container));
  if (controllerService) unavailable.add(pointKey(controllerService));

  const extensions = chooseRapidFillExtensions(room, spawn, unavailable);
  for (const extension of extensions) unavailable.add(pointKey(extension));
  const tower = chooseTowerTile(room, hub, unavailable);
  if (tower) unavailable.add(pointKey(tower));

  const structures: RoomPlanStructure[] = extensions.map((point, index) => ({
    id: `rapid-fill-extension-${index + 1}`,
    ...point,
    structureType: STRUCTURE_EXTENSION,
    minRcl: index < 5 ? 2 : 3,
    priority: index < 5 ? 1000 - index : 850 - index,
    activation: "automatic",
    reservation: "hard",
    phase: "bootstrap-capacity",
    reason:
      index < 5
        ? "RCL2 spawn-capacity expansion"
        : "RCL3 spawn-capacity expansion",
  }));

  for (const [index, source] of sourceAnchors.entries()) {
    structures.push({
      id: `source-container-${index + 1}`,
      ...source.container,
      structureType: STRUCTURE_CONTAINER,
      minRcl: 2,
      priority: 700,
      activation: "demand",
      reservation: "hard",
      phase: "source-logistics",
      reason:
        "reserved source logistics tile; build when mining/hauling demand justifies 5000 energy capital cost",
    });
  }

  if (controllerService) {
    structures.push({
      id: "controller-container",
      ...controllerService,
      structureType: STRUCTURE_CONTAINER,
      minRcl: 2,
      priority: 550,
      activation: "demand",
      reservation: "hard",
      phase: "controller-logistics",
      reason:
        "reserved controller logistics tile; activate with dedicated upgrade hauling",
    });
  }

  if (tower) {
    structures.push(
      {
        id: "tower-1",
        ...tower,
        structureType: STRUCTURE_TOWER,
        minRcl: 3,
        priority: 1200,
        activation: "automatic",
        reservation: "hard",
        phase: "bootstrap-defense",
        reason: "first defensive tower at RCL3",
      },
      {
        id: "tower-1-rampart",
        ...tower,
        structureType: STRUCTURE_RAMPART,
        minRcl: 3,
        priority: 500,
        activation: "demand",
        reservation: "hard",
        phase: "bootstrap-defense",
        reason:
          "protect defensive tower when defense policy requests fortification",
      },
    );
  }

  structures.push({
    id: "spawn-rampart",
    x: spawn.pos.x,
    y: spawn.pos.y,
    structureType: STRUCTURE_RAMPART,
    minRcl: 2,
    priority: 500,
    activation: "demand",
    reservation: "hard",
    phase: "bootstrap-defense",
    reason: "protect primary spawn when defense policy requests fortification",
  });

  const hardBlocked = new Set(
    structures
      .filter(
        (structure) =>
          structure.reservation === "hard" &&
          structure.structureType !== STRUCTURE_RAMPART,
      )
      .map(pointKey),
  );
  hardBlocked.add(pointKey(hub));
  hardBlocked.delete(pointKey(spawn.pos));

  const roadGraph = buildRoadGraph(
    room,
    spawn,
    hub,
    sourceAnchors,
    controllerService,
    hardBlocked,
  );

  const reservations: RoomPlanReservation[] = [
    {
      id: "future-hub",
      ...hub,
      kind: "hard",
      reason: "reserve mature logistics hub for future storage-centered core",
    },
    ...structures.map((structure) => ({
      id: `structure-${structure.id}`,
      x: structure.x,
      y: structure.y,
      kind: structure.reservation,
      reason: structure.reason,
    })),
    ...roadGraph.roads.map((road) => ({
      id: `reservation-${road.id}`,
      x: road.x,
      y: road.y,
      kind: "soft" as const,
      reason: road.reason,
    })),
  ];

  const protectedTiles = [
    { x: spawn.pos.x, y: spawn.pos.y },
    hub,
    ...extensions,
    ...(tower ? [tower] : []),
  ];

  return {
    plannerRevision: ROOM_PLAN_PLANNER_REVISION,
    version: LEGACY_BOOTSTRAP_PLAN_VERSION,
    horizonRcl: LEGACY_BOOTSTRAP_HORIZON_RCL,
    roomName: room.name,
    generatedAt: Game.time,
    generatedReason: reason,
    anchors: {
      spawn: { name: spawn.name, x: spawn.pos.x, y: spawn.pos.y },
      hub,
      controller: room.controller
        ? {
            x: room.controller.pos.x,
            y: room.controller.pos.y,
            service: controllerService ?? hub,
          }
        : null,
      sources: sourceAnchors,
    },
    reservations,
    structures,
    roads: roadGraph.roads,
    roadGraph: { nodes: roadGraph.nodes, edges: roadGraph.edges },
    defense: {
      strategy: "pending-mincut",
      protectedTiles,
      perimeter: [],
    },
  };
}

function completeRoomPlan(
  room: Room,
  bootstrapPlan: RoomPlan,
  reason: string,
): RoomPlan {
  const maturePlan = extendRoomPlanToRcl8(room, bootstrapPlan);
  const envelope = deriveRoomDefenseEnvelope(room, maturePlan);
  const perimeter = envelope.perimeter;
  const gateKeys = new Set(envelope.gateTiles.map(pointKey));

  const perimeterKeys = new Set(perimeter.map(pointKey));
  const existingIds = new Set([
    ...maturePlan.structures.map((structure) => structure.id),
    ...maturePlan.roads.map((road) => road.id),
  ]);
  const existingRampartKeys = new Set(
    maturePlan.structures
      .filter((structure) => structure.structureType === STRUCTURE_RAMPART)
      .map(pointKey),
  );
  const structures = maturePlan.structures.map((structure) => {
    if (structure.structureType !== STRUCTURE_RAMPART) return structure;
    const onPerimeter = perimeterKeys.has(pointKey(structure));
    return {
      ...structure,
      activation: "defense" as const,
      ...(onPerimeter
        ? {
            phase: "defense-envelope" as const,
            stage: "mature-rcl8" as const,
            reason: gateKeys.has(pointKey(structure))
              ? "serviceable own-creep gate on the defensive envelope"
              : "padded terrain minimum-cut defensive perimeter",
          }
        : {}),
      strategicWeight: structure.strategicWeight ?? 4,
      requiredForStage: onPerimeter,
    };
  });
  const perimeterRamparts: RoomPlanStructure[] = [];
  for (const point of perimeter) {
    if (existingRampartKeys.has(pointKey(point))) continue;
    const id = `defensive-perimeter-rampart-${point.x}-${point.y}`;
    if (existingIds.has(id)) {
      throw new Error(`Duplicate defensive room-plan identity ${id}`);
    }
    existingIds.add(id);
    perimeterRamparts.push({
      id,
      ...point,
      structureType: STRUCTURE_RAMPART,
      minRcl: 4,
      priority: 600,
      activation: "defense",
      reservation: "hard",
      phase: "defense-envelope",
      reason: gateKeys.has(pointKey(point))
        ? "serviceable own-creep gate on the defensive envelope"
        : "padded terrain minimum-cut defensive perimeter",
      stage: "mature-rcl8",
      strategicWeight: 4,
      requiredForStage: true,
    });
  }

  const next: RoomPlan = {
    ...maturePlan,
    generatedAt: Game.time,
    generatedReason: reason,
    reservations: [
      ...maturePlan.reservations,
      ...perimeterRamparts.map((rampart) => ({
        id: `structure-${rampart.id}`,
        x: rampart.x,
        y: rampart.y,
        kind: "hard" as const,
        reason: rampart.reason,
      })),
    ],
    structures: [...structures, ...perimeterRamparts],
    defense: {
      strategy: "terrain-mincut-v1",
      protectedTiles: envelope.protectedTiles.map((point) => ({ ...point })),
      perimeter: perimeter.map((point) => ({ ...point })),
    },
  };
  delete next.invalidatedAt;
  delete next.invalidationReason;
  return next;
}

function generateRoomPlanDraft(
  room: Room,
  reason = "initial settlement plan",
): RoomPlan | null {
  const bootstrapPlan = generateBootstrapRoomPlan(room, reason);
  return bootstrapPlan ? completeRoomPlan(room, bootstrapPlan, reason) : null;
}

export function generateRoomPlan(
  room: Room,
  reason = "initial settlement plan",
): RoomPlan | null {
  const draft = generateRoomPlanDraft(room, reason);
  return draft
    ? advanceRoomPlanProjection(normalizeRoomPlanProjection(draft))
    : null;
}

export function shouldRegenerateRoomPlan(
  plan: RoomPlan | undefined,
  expectedRoomName: string,
): boolean {
  return !usableRoomPlanProjection(
    plan ? { roomPlan: plan } : undefined,
    expectedRoomName,
  ).usable;
}

export function ensureSettlementPlans(world: WorldSnapshot): void {
  for (const room of world.rooms) {
    const colony = Memory.colonies[room.name];
    if (!colony) continue;

    const existing = colony.roomPlan;
    const assessment = usableRoomPlanProjection(colony, room.name);
    if (assessment.usable) {
      if (existing) {
        const resolved = supersedeSettlementProjectionFault(
          colony.settlementProjectionFault,
          existing,
          Game.time,
        );
        if (resolved) colony.settlementProjectionFault = resolved;
        else delete colony.settlementProjectionFault;
      }
      continue;
    }
    if (!settlementRetryDue(colony.settlementProjectionFault, Game.time)) {
      continue;
    }

    const reason = assessment.reason;
    const upgradesLegacyBootstrap =
      existing?.version === LEGACY_BOOTSTRAP_PLAN_VERSION &&
      existing.horizonRcl === LEGACY_BOOTSTRAP_HORIZON_RCL &&
      existing.invalidatedAt === undefined;
    try {
      const generated = upgradesLegacyBootstrap
        ? completeRoomPlan(room, existing, reason)
        : generateRoomPlanDraft(room, reason);
      if (!generated) {
        throw new Error(
          `No viable founding spawn is visible for ${room.name}; projection generation returned no candidate`,
        );
      }
      const normalized = normalizeRoomPlanProjection(generated);
      const next = advanceRoomPlanProjection(normalized, existing);
      if (existing?.deliverableId) {
        next.deliverableId = existing.deliverableId;
      }
      colony.roomPlan = next;
      const resolved = supersedeSettlementProjectionFault(
        colony.settlementProjectionFault,
        next,
        Game.time,
      );
      if (resolved) colony.settlementProjectionFault = resolved;
      else delete colony.settlementProjectionFault;
    } catch (error) {
      colony.settlementProjectionFault = recordSettlementProjectionFault(
        colony.settlementProjectionFault,
        existing,
        Game.time,
        error,
      );
    }
  }
}

export function invalidateRoomPlan(
  roomName: string,
  reason = "manual invalidation",
): boolean {
  const colony = Memory.colonies[roomName];
  const plan = colony?.roomPlan;
  if (!colony || !plan) return false;
  colony.roomPlan = {
    ...plan,
    invalidatedAt: Game.time,
    invalidationReason: reason,
  };
  return true;
}
