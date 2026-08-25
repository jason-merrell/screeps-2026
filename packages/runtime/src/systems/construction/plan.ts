import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { RoomPlan, RoomPlanRoad, RoomPlanStructure } from "../../planning/room-plan";
import type { WorldSnapshot } from "../../runtime/context";

const MAX_NEW_SITES_PER_ROOM = 3;
const MAX_ACTIVE_SITES_PER_ROOM = 6;
const MAX_ACTIVE_ROAD_SITES_PER_ROOM = 3;

export function eligiblePlannedStructures(plan: RoomPlan, controllerLevel: number): RoomPlanStructure[] {
  return plan.structures
    .filter(
      (structure) =>
        structure.activation === "automatic" && structure.minRcl <= controllerLevel,
    )
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function shouldActivateStrategicRoads(
  controllerLevel: number,
  workforceCount: number,
): boolean {
  return controllerLevel >= 2 && workforceCount >= 3;
}

function roadPriority(plan: RoomPlan, road: RoomPlanRoad): number {
  let priority = 300;

  for (const edge of plan.roadGraph.edges) {
    if (!edge.tiles.some((tile) => tile.x === road.x && tile.y === road.y)) continue;

    if (edge.from === "spawn" && edge.to === "hub") {
      priority = Math.max(priority, 360);
    } else if (edge.to.startsWith("source-")) {
      priority = Math.max(priority, 340);
    } else if (edge.to === "controller") {
      priority = Math.max(priority, 220);
    }
  }

  return priority;
}

function eligiblePlannedRoads(plan: RoomPlan, controllerLevel: number): RoomPlanRoad[] {
  return plan.roads
    .filter((road) => road.minRcl <= controllerLevel)
    .sort((a, b) => roadPriority(plan, b) - roadPriority(plan, a) || a.id.localeCompare(b.id));
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

function hasRoad(room: Room, road: RoomPlanRoad): boolean {
  return room
    .lookForAt(LOOK_STRUCTURES, road.x, road.y)
    .some((structure) => structure.structureType === STRUCTURE_ROAD);
}

function hasAnySite(room: Room, road: RoomPlanRoad): boolean {
  return room.lookForAt(LOOK_CONSTRUCTION_SITES, road.x, road.y).length > 0;
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

  for (const planned of eligiblePlannedStructures(roomPlan, level)) {
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

  const workforceCount = room.find(FIND_MY_CREEPS).length;
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
        priority: roadPriority(roomPlan, road),
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
  }

  return intents;
}

export function planConstruction(world: WorldSnapshot): Intent[] {
  return world.rooms.flatMap(planRoomConstruction);
}
