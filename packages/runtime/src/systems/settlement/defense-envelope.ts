import type {
  PlannedPoint,
  RoomPlan,
  RoomPlanStructure,
} from "../../planning/room-plan";
import {
  type DefensivePerimeterDiagnostics,
  deriveDefensivePerimeterResult,
} from "./mincut";

const ROOM_MIN = 1;
const ROOM_MAX = 48;
const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** Minimum walkable depth retained between a critical asset and the cut. */
export const DEFENDED_CORE_PADDING = 3;
/** 96 RCL8 ramparts cap the steady-state repair liability at 480M hits. */
export const MAX_DEFENSIVE_PERIMETER_TILES = 96;
/** Source/controller links beyond this range are treated as service outposts. */
export const MAIN_CORE_LINK_RANGE = 10;

export interface RoomDefenseEnvelope {
  coreAssets: PlannedPoint[];
  protectedTiles: PlannedPoint[];
  perimeter: PlannedPoint[];
  /** Planned road/rampart overlays that act as explicit own-creep gates. */
  gateTiles: PlannedPoint[];
  diagnostics: DefensivePerimeterDiagnostics;
}

const keyOf = (point: PlannedPoint): string => `${point.x}:${point.y}`;

const rangeBetween = (left: PlannedPoint, right: PlannedPoint): number =>
  Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));

function isMainCoreAsset(
  structure: RoomPlanStructure,
  hub: PlannedPoint,
): boolean {
  if (!structure.requiredForStage) return false;
  if (
    structure.structureType === "extractor" ||
    structure.structureType === "rampart" ||
    structure.structureType === "container" ||
    structure.phase === "source-logistics" ||
    structure.phase === "controller-logistics"
  ) {
    return false;
  }
  return !(
    structure.structureType === "link" &&
    rangeBetween(structure, hub) > MAIN_CORE_LINK_RANGE
  );
}

function naturalObjects(room: Room): PlannedPoint[] {
  return [
    ...room.find(FIND_SOURCES).map(({ pos }) => ({ x: pos.x, y: pos.y })),
    ...room.find(FIND_MINERALS).map(({ pos }) => ({ x: pos.x, y: pos.y })),
    ...(room.controller
      ? [{ x: room.controller.pos.x, y: room.controller.pos.y }]
      : []),
  ];
}

function isNeutralOverlay(structureType: StructureConstant): boolean {
  return structureType === "road" || structureType === "container";
}

function unrealizableRampartTiles(room: Room): PlannedPoint[] {
  const blocked = new Map<string, PlannedPoint>();
  for (const point of naturalObjects(room)) blocked.set(keyOf(point), point);

  for (const structure of room.find(FIND_STRUCTURES)) {
    if (
      isNeutralOverlay(structure.structureType) ||
      (structure as Structure & { my?: boolean }).my === true
    ) {
      continue;
    }
    const point = { x: structure.pos.x, y: structure.pos.y };
    blocked.set(keyOf(point), point);
  }
  for (const site of room.find(FIND_CONSTRUCTION_SITES)) {
    if (site.my) continue;
    const point = { x: site.pos.x, y: site.pos.y };
    blocked.set(keyOf(point), point);
  }
  return [...blocked.values()].sort(
    (left, right) => left.x - right.x || left.y - right.y,
  );
}

function deriveCoreAssets(plan: RoomPlan): PlannedPoint[] {
  const assets = new Map<string, PlannedPoint>();
  assets.set(keyOf(plan.anchors.hub), { ...plan.anchors.hub });
  for (const structure of plan.structures) {
    if (!isMainCoreAsset(structure, plan.anchors.hub)) continue;
    assets.set(keyOf(structure), { x: structure.x, y: structure.y });
  }
  return [...assets.values()].sort(
    (left, right) => left.x - right.x || left.y - right.y,
  );
}

function paddedWalkableFootprint(
  room: Room,
  coreAssets: readonly PlannedPoint[],
  excluded: ReadonlySet<string>,
): PlannedPoint[] {
  if (coreAssets.length === 0) return [];
  const minX =
    Math.min(...coreAssets.map(({ x }) => x)) - DEFENDED_CORE_PADDING;
  const maxX =
    Math.max(...coreAssets.map(({ x }) => x)) + DEFENDED_CORE_PADDING;
  const minY =
    Math.min(...coreAssets.map(({ y }) => y)) - DEFENDED_CORE_PADDING;
  const maxY =
    Math.max(...coreAssets.map(({ y }) => y)) + DEFENDED_CORE_PADDING;
  if (
    minX < ROOM_MIN ||
    maxX > ROOM_MAX ||
    minY < ROOM_MIN ||
    maxY > ROOM_MAX
  ) {
    throw new Error(
      `Defended core in ${room.name} cannot retain ${DEFENDED_CORE_PADDING} tiles of interior depth`,
    );
  }

  const terrain = room.getTerrain();
  const footprint: PlannedPoint[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const point = { x, y };
      if (
        terrain.get(x, y) === TERRAIN_MASK_WALL ||
        excluded.has(keyOf(point))
      ) {
        continue;
      }
      footprint.push(point);
    }
  }
  return footprint;
}

function isConnectedFootprint(points: readonly PlannedPoint[]): boolean {
  if (points.length === 0) return false;
  const remaining = new Set(points.map(keyOf));
  const first = points[0];
  if (!first) return false;
  const queue = [first];
  remaining.delete(keyOf(first));

  for (let head = 0; head < queue.length; head += 1) {
    const point = queue[head];
    if (!point) continue;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const neighbor = { x: point.x + dx, y: point.y + dy };
      const key = keyOf(neighbor);
      if (!remaining.delete(key)) continue;
      queue.push(neighbor);
    }
  }
  return remaining.size === 0;
}

/**
 * Derive one padded, serviceable shell around the main colony core. Remote
 * extraction and logistics outposts deliberately remain outside this shell.
 * Every failure is fatal to room-plan publication: a partial perimeter would
 * create false defensive confidence and an unbounded repair obligation.
 */
export function deriveRoomDefenseEnvelope(
  room: Room,
  plan: RoomPlan,
): RoomDefenseEnvelope {
  const coreAssets = deriveCoreAssets(plan);
  const uncuttable = unrealizableRampartTiles(room);
  const uncuttableKeys = new Set(uncuttable.map(keyOf));
  const protectedTiles = paddedWalkableFootprint(
    room,
    coreAssets,
    uncuttableKeys,
  );
  if (!isConnectedFootprint(protectedTiles)) {
    throw new Error(`Defended core footprint in ${room.name} is not coherent`);
  }

  const result = deriveDefensivePerimeterResult(room, protectedTiles, {
    maxPerimeterTiles: MAX_DEFENSIVE_PERIMETER_TILES,
    uncuttableTiles: uncuttable,
  });
  if (result.failure) {
    throw new Error(
      `Refusing to publish ${room.name} defense envelope: ${result.failure} ` +
        `(cut=${result.diagnostics.maxFlow}, cap=${MAX_DEFENSIVE_PERIMETER_TILES})`,
    );
  }

  const roadKeys = new Set(plan.roads.map(keyOf));
  const gateTiles = result.perimeter.filter((point) =>
    roadKeys.has(keyOf(point)),
  );
  return {
    coreAssets,
    protectedTiles,
    perimeter: result.perimeter,
    gateTiles,
    diagnostics: result.diagnostics,
  };
}
