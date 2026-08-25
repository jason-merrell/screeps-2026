import type { TickSpatialIndex } from "../world/spatial-index";
import {
  BLOCKED_COST,
  buildFlowField,
  chooseFlowStep,
  type GridPoint,
  ROOM_SIZE,
} from "./flow-field";

export interface MovementMetrics {
  moveRequests: number;
  flowMoves: number;
  fallbackMoveTo: number;
  reservationRelaxations: number;
  costGridBuilds: number;
  costGridCacheHits: number;
  flowFieldBuilds: number;
  flowFieldCacheHits: number;
  topologyInvalidations: number;
}

interface CachedFlowField {
  distances: Uint32Array;
  lastUsed: number;
}

interface CachedRoomRouting {
  topologyKey: string;
  costs: Uint8Array;
  fields: Map<string, CachedFlowField>;
}

const roomRoutingCache = new Map<string, CachedRoomRouting>();
const MAX_FIELDS_PER_ROOM = 64;
const PLAIN_COST = 2;
const SWAMP_COST = 10;

const cellIndex = (x: number, y: number): number => y * ROOM_SIZE + x;

const targetKey = (target: RoomObject): string => {
  if ("id" in target && typeof target.id === "string") return target.id;
  return `${target.pos.roomName}:${target.pos.x}:${target.pos.y}`;
};

function structureIsWalkable(structure: AnyStructure): boolean {
  if (structure.structureType === STRUCTURE_ROAD) return true;
  if (structure.structureType === STRUCTURE_CONTAINER) return true;
  if (structure.structureType === STRUCTURE_RAMPART) {
    return structure.my || structure.isPublic;
  }
  return !(OBSTACLE_OBJECT_TYPES as readonly StructureConstant[]).includes(structure.structureType);
}

function buildRoomCosts(room: Room, spatial: TickSpatialIndex): Uint8Array {
  const costs = new Uint8Array(ROOM_SIZE * ROOM_SIZE);
  const terrain = room.getTerrain();

  for (let x = 0; x < ROOM_SIZE; x += 1) {
    for (let y = 0; y < ROOM_SIZE; y += 1) {
      const terrainValue = terrain.get(x, y);
      costs[cellIndex(x, y)] =
        terrainValue === TERRAIN_MASK_WALL
          ? BLOCKED_COST
          : terrainValue === TERRAIN_MASK_SWAMP
            ? SWAMP_COST
            : PLAIN_COST;
    }
  }

  const facts = spatial.byRoom[room.name];
  if (!facts) return costs;

  for (const structure of facts.structures) {
    const index = cellIndex(structure.pos.x, structure.pos.y);
    if (structure.structureType === STRUCTURE_ROAD) {
      costs[index] = 1;
      continue;
    }
    if (!structureIsWalkable(structure)) costs[index] = BLOCKED_COST;
  }

  for (const source of facts.sources) {
    costs[cellIndex(source.pos.x, source.pos.y)] = BLOCKED_COST;
  }
  for (const mineral of facts.minerals) {
    costs[cellIndex(mineral.pos.x, mineral.pos.y)] = BLOCKED_COST;
  }
  if (room.controller) {
    costs[cellIndex(room.controller.pos.x, room.controller.pos.y)] = BLOCKED_COST;
  }

  return costs;
}

function roomRouting(
  roomName: string,
  spatial: TickSpatialIndex,
  metrics: MovementMetrics,
): CachedRoomRouting | null {
  const room = Game.rooms[roomName];
  const facts = spatial.byRoom[roomName];
  if (!room || !facts) return null;

  const existing = roomRoutingCache.get(roomName);
  if (existing?.topologyKey === facts.movementTopologyKey) {
    metrics.costGridCacheHits += 1;
    return existing;
  }

  if (existing) metrics.topologyInvalidations += 1;
  const next: CachedRoomRouting = {
    topologyKey: facts.movementTopologyKey,
    costs: buildRoomCosts(room, spatial),
    fields: new Map<string, CachedFlowField>(),
  };
  roomRoutingCache.set(roomName, next);
  metrics.costGridBuilds += 1;
  return next;
}

function goalsForTarget(target: RoomObject, range: number, costs: Uint8Array): GridPoint[] {
  const goals: GridPoint[] = [];

  for (let x = Math.max(0, target.pos.x - range); x <= Math.min(49, target.pos.x + range); x += 1) {
    for (let y = Math.max(0, target.pos.y - range); y <= Math.min(49, target.pos.y + range); y += 1) {
      if (Math.max(Math.abs(x - target.pos.x), Math.abs(y - target.pos.y)) > range) continue;
      if (costs[cellIndex(x, y)] === BLOCKED_COST) continue;
      goals.push({ x, y });
    }
  }

  return goals;
}

function pruneOldFields(fields: Map<string, CachedFlowField>): void {
  if (fields.size <= MAX_FIELDS_PER_ROOM) return;
  const oldest = [...fields.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
  if (oldest) fields.delete(oldest[0]);
}

export class TickMovementRouter {
  readonly metrics: MovementMetrics = {
    moveRequests: 0,
    flowMoves: 0,
    fallbackMoveTo: 0,
    reservationRelaxations: 0,
    costGridBuilds: 0,
    costGridCacheHits: 0,
    flowFieldBuilds: 0,
    flowFieldCacheHits: 0,
    topologyInvalidations: 0,
  };

  private readonly reservedDestinations = new Set<string>();

  constructor(private readonly spatial: TickSpatialIndex) {}

  moveToward(creep: Creep, target: RoomObject, range: number): ScreepsReturnCode {
    this.metrics.moveRequests += 1;

    if (creep.pos.roomName !== target.pos.roomName) {
      return this.fallback(creep, target);
    }

    const routing = roomRouting(creep.pos.roomName, this.spatial, this.metrics);
    if (!routing) return this.fallback(creep, target);

    const fieldKey = `${targetKey(target)}:${range}`;
    let field = routing.fields.get(fieldKey);
    if (field) {
      field.lastUsed = Game.time;
      this.metrics.flowFieldCacheHits += 1;
    } else {
      const goals = goalsForTarget(target, range, routing.costs);
      if (goals.length === 0) return this.fallback(creep, target);
      field = {
        distances: buildFlowField(routing.costs, goals),
        lastUsed: Game.time,
      };
      routing.fields.set(fieldKey, field);
      pruneOldFields(routing.fields);
      this.metrics.flowFieldBuilds += 1;
    }

    const origin = { x: creep.pos.x, y: creep.pos.y };
    let step = chooseFlowStep(
      field.distances,
      routing.costs,
      origin,
      this.reservedDestinations,
    );

    if (!step && this.reservedDestinations.size > 0) {
      step = chooseFlowStep(field.distances, routing.costs, origin);
      if (step) this.metrics.reservationRelaxations += 1;
    }

    if (!step) return this.fallback(creep, target);

    const direction = creep.pos.getDirectionTo(step.x, step.y);
    const result = creep.move(direction);
    if (result === OK) {
      this.reservedDestinations.add(`${step.x}:${step.y}`);
      this.metrics.flowMoves += 1;
    }
    return result;
  }

  private fallback(creep: Creep, target: RoomObject): ScreepsReturnCode {
    this.metrics.fallbackMoveTo += 1;
    return creep.moveTo(target, { reusePath: 50 });
  }
}
