import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { RoomPlan, RoomPlanStructure } from "../../planning/room-plan";
import type { WorldSnapshot } from "../../runtime/context";

const MAX_NEW_SITES_PER_ROOM = 3;
const MAX_ACTIVE_SITES_PER_ROOM = 6;

export function eligiblePlannedStructures(plan: RoomPlan, controllerLevel: number): RoomPlanStructure[] {
  return plan.structures
    .filter(
      (structure) =>
        structure.activation === "automatic" && structure.minRcl <= controllerLevel,
    )
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
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

  return intents;
}

export function planConstruction(world: WorldSnapshot): Intent[] {
  return world.rooms.flatMap(planRoomConstruction);
}
