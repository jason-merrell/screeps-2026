import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import { hotTrafficTiles } from "../../movement/traffic-heatmap";
import { plannedRoadPriority } from "../../planning/construction-priority";
import type { RoomPlan, RoomPlanRoad, RoomPlanStructure } from "../../planning/room-plan";
import type { WorldSnapshot } from "../../runtime/context";
import { shouldActivateSourceBuffers } from "../economy/logistics";

const MAX_NEW_SITES_PER_ROOM = 3;
const MAX_ACTIVE_SITES_PER_ROOM = 6;
const MAX_ACTIVE_ROAD_SITES_PER_ROOM = 3;

export function eligiblePlannedStructures(
  plan: RoomPlan,
  controllerLevel: number,
  workforceCount = 0,
): RoomPlanStructure[] {
  const sourceBuffersActive = shouldActivateSourceBuffers(
    controllerLevel,
    workforceCount,
    plan.anchors.sources.length,
  );

  return plan.structures
    .filter(
      (structure) =>
        structure.minRcl <= controllerLevel &&
        (structure.activation === "automatic" ||
          (sourceBuffersActive && structure.phase === "source-logistics")),
    )
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function shouldActivateStrategicRoads(
  controllerLevel: number,
  workforceCount: number,
): boolean {
  return controllerLevel >= 2 && workforceCount >= 3;
}

function eligiblePlannedRoads(plan: RoomPlan, controllerLevel: number): RoomPlanRoad[] {
  return plan.roads
    .filter((road) => road.minRcl <= controllerLevel)
    .sort(
      (a, b) =>
        plannedRoadPriority(plan, b) - plannedRoadPriority(plan, a) || a.id.localeCompare(b.id),
    );
}

function hasPlannedStructure(room: Room, planned: RoomPlanStructure): boolean {
  return room
    .lookForAt(LOOK_STRUCTURES, planned.x, planned.y)
    .some((structure) => structure.structureType === planned.structureType);
}

function hasPlannedSite(room: Room, planned: RoomPlanStructure): boolean {
  return room
    .lookForAt(LOOK_CONSTRUCTION_SITES, planned.x, planned.y)
    .some((site) => site.structureType === planned.structureType);
}

function hasRoadAt(room: Room, x: number, y: number): boolean {
  return room
    .lookForAt(LOOK_STRUCTURES, x, y)
    .some((structure) => structure.structureType === STRUCTURE_ROAD);
}

function hasRoad(room: Room, road: RoomPlanRoad): boolean {
  return hasRoadAt(room, road.x, road.y);
}

function hasAnySiteAt(room: Room, x: number, y: number): boolean {
  return room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0;
}

function hasAnySite(room: Room, road: RoomPlanRoad): boolean {
  return hasAnySiteAt(room, road.x, road.y);
}

function adaptiveRoadBuildable(room: Room, x: number, y: number): boolean {
  if (x <= 1 || x >= 48 || y <= 1 || y >= 48) return false;
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
  if (hasRoadAt(room, x, y) || hasAnySiteAt(room, x, y)) return false;
  if (room.controller?.pos.x === x && room.controller.pos.y === y) return false;
  if (room.find(FIND_SOURCES).some((source) => source.pos.x === x && source.pos.y === y)) {
    return false;
  }

  return room.lookForAt(LOOK_STRUCTURES, x, y).every(
    (structure) =>
      structure.structureType === STRUCTURE_CONTAINER ||
      structure.structureType === STRUCTURE_RAMPART,
  );
}

function structureLimit(structureType: BuildableStructureConstant, level: number): number {
  const limits = CONTROLLER_STRUCTURES[structureType] as Record<number, number> | undefined;
  return limits?.[level] ?? 0;
}

function planRoomConstruction(room: Room): Intent[] {
  const level = room.controller?.level ?? 0;
  const roomPlan = Memory.colonies[room.name]?.roomPlan;
  if (!roomPlan || level < 2) return [];

  const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  if (existingSites.length >= MAX_ACTIVE_SITES_PER_ROOM) return [];

  const existingByType = new Map<BuildableStructureConstant, number>();
  for (const structure of room.find(FIND_MY_STRUCTURES)) {
    const type = structure.structureType as BuildableStructureConstant;
    existingByType.set(type, (existingByType.get(type) ?? 0) + 1);
  }
  const sitesByType = new Map<BuildableStructureConstant, number>();
  for (const site of existingSites) {
    sitesByType.set(site.structureType, (sitesByType.get(site.structureType) ?? 0) + 1);
  }

  const intents: Intent[] = [];
  const proposedByType = new Map<BuildableStructureConstant, number>();
  const workforceCount = room.find(FIND_MY_CREEPS).length;

  for (const planned of eligiblePlannedStructures(roomPlan, level, workforceCount)) {
    if (intents.length >= MAX_NEW_SITES_PER_ROOM) break;
    if (hasPlannedStructure(room, planned) || hasPlannedSite(room, planned)) continue;

    const limit = structureLimit(planned.structureType, level);
    const committed =
      (existingByType.get(planned.structureType) ?? 0) +
      (sitesByType.get(planned.structureType) ?? 0) +
      (proposedByType.get(planned.structureType) ?? 0);
    if (committed >= limit) continue;

    intents.push({
      type: "createConstructionSite",
      roomName: room.name,
      x: planned.x,
      y: planned.y,
      structureType: planned.structureType,
      priority: planned.priority,
      reason: `${planned.phase}: ${planned.reason}`,
      trace: createIntentTrace({
        roomName: room.name,
        domain: "construction",
        task: `execute-room-plan-v${roomPlan.version}`,
        activity: `site:${planned.id}`,
      }),
    });
    proposedByType.set(
      planned.structureType,
      (proposedByType.get(planned.structureType) ?? 0) + 1,
    );
  }

  const existingRoadSites = sitesByType.get(STRUCTURE_ROAD) ?? 0;
  let proposedRoadSites = 0;

  if (
    intents.length < MAX_NEW_SITES_PER_ROOM &&
    existingRoadSites < MAX_ACTIVE_ROAD_SITES_PER_ROOM &&
    shouldActivateStrategicRoads(level, workforceCount)
  ) {
    for (const road of eligiblePlannedRoads(roomPlan, level)) {
      if (intents.length >= MAX_NEW_SITES_PER_ROOM) break;
      if (existingRoadSites + proposedRoadSites >= MAX_ACTIVE_ROAD_SITES_PER_ROOM) break;
      if (hasRoad(room, road) || hasAnySite(room, road)) continue;

      intents.push({
        type: "createConstructionSite",
        roomName: room.name,
        x: road.x,
        y: road.y,
        structureType: STRUCTURE_ROAD,
        priority: plannedRoadPriority(roomPlan, road),
        reason: `${road.phase}: logistics demand activated planned corridor`,
        trace: createIntentTrace({
          roomName: room.name,
          domain: "construction",
          task: `execute-room-plan-v${roomPlan.version}`,
          activity: `road:${road.id}`,
        }),
      });
      proposedRoadSites += 1;
    }

    for (const tile of hotTrafficTiles(room.name)) {
      if (intents.length >= MAX_NEW_SITES_PER_ROOM) break;
      if (existingRoadSites + proposedRoadSites >= MAX_ACTIVE_ROAD_SITES_PER_ROOM) break;
      if (!adaptiveRoadBuildable(room, tile.x, tile.y)) continue;

      intents.push({
        type: "createConstructionSite",
        roomName: room.name,
        x: tile.x,
        y: tile.y,
        structureType: STRUCTURE_ROAD,
        priority: 200 + Math.min(120, Math.floor(tile.score)),
        reason: `adaptive traffic: sustained movement heat ${tile.score.toFixed(1)}`,
        trace: createIntentTrace({
          roomName: room.name,
          domain: "construction",
          task: `optimize-observed-traffic-v${roomPlan.version}`,
          activity: `adaptive-road:${tile.x}:${tile.y}`,
        }),
      });
      proposedRoadSites += 1;
    }
  }

  return intents;
}

export function planConstruction(world: WorldSnapshot): Intent[] {
  return world.rooms.flatMap(planRoomConstruction);
}
