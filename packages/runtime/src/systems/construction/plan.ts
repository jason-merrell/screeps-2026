import { createIntentTrace, infrastructureWorkKey } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import { hotTrafficTiles } from "../../movement/traffic-heatmap";
import { plannedRoadPriority } from "../../planning/construction-priority";
import {
  canShareDevelopmentTile,
  evaluateRoomDevelopmentForRoom,
  isDevelopmentEvidenceStructure,
} from "../../planning/room-development";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomDevelopmentStageId,
  type RoomPlan,
  type RoomPlanRoad,
  type RoomPlanStructure,
} from "../../planning/room-plan";
import { usableRoomPlanProjection } from "../../planning/room-plan-projection";
import type { WorldSnapshot } from "../../runtime/context";
import { shouldActivateSourceBuffers } from "../economy/logistics";

const MAX_NEW_SITES_PER_ROOM = 3;
const MAX_ACTIVE_SITES_PER_ROOM = 6;
const MAX_ACTIVE_ROAD_SITES_PER_ROOM = 3;
const FALLBACK_GLOBAL_CONSTRUCTION_SITE_LIMIT = 100;
const THREAT_ADMISSION_PRIORITY_STEP = 2_000;

interface PlannedStructureActivationContext {
  readonly towerCount?: number;
  readonly underThreat?: boolean;
}

function realizationTrace(
  roomName: string,
  procedure:
    | "site-planned-structure"
    | "site-planned-road"
    | "site-adaptive-road",
  x: number,
  y: number,
  structureType: BuildableStructureConstant,
) {
  return createIntentTrace({
    roomName,
    domain: "construction",
    task: "realize-planned-infrastructure",
    procedure,
    workKey: infrastructureWorkKey(roomName, x, y, structureType),
  });
}

export function eligiblePlannedStructures(
  plan: RoomPlan,
  controllerLevel: number,
  workforceCount = 0,
  context: PlannedStructureActivationContext = {},
): RoomPlanStructure[] {
  const sourceBuffersActive = shouldActivateSourceBuffers(
    controllerLevel,
    workforceCount,
    plan.anchors.sources.length,
  );
  const controllerBufferActive = shouldActivateStrategicRoads(
    controllerLevel,
    workforceCount,
  );
  const fortificationsActive = shouldActivateFortifications(
    controllerLevel,
    workforceCount,
    context.towerCount ?? 0,
    context.underThreat ?? false,
  );

  return plan.structures
    .filter(
      (structure) =>
        structure.minRcl <= controllerLevel &&
        (structure.activation === "automatic" ||
          (sourceBuffersActive && structure.phase === "source-logistics") ||
          (controllerBufferActive &&
            structure.phase === "controller-logistics") ||
          (fortificationsActive && structure.activation === "defense")),
    )
    .sort(
      (a, b) =>
        (b.strategicWeight ?? 0) - (a.strategicWeight ?? 0) ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    );
}

export function shouldActivateStrategicRoads(
  controllerLevel: number,
  workforceCount: number,
): boolean {
  return controllerLevel >= 2 && workforceCount >= 3;
}

/**
 * A quiet room earns proactive fortification work only after it can sustain the
 * build and already fields a tower. An active incursion bypasses those economy
 * gates, but never the RCL4 rampart unlock.
 */
export function shouldActivateFortifications(
  controllerLevel: number,
  workforceCount: number,
  towerCount: number,
  underThreat: boolean,
): boolean {
  return (
    controllerLevel >= 4 &&
    (underThreat || (workforceCount >= 4 && towerCount >= 1))
  );
}

function eligiblePlannedRoads(
  plan: RoomPlan,
  controllerLevel: number,
): RoomPlanRoad[] {
  return plan.roads
    .filter((road) => road.minRcl <= controllerLevel)
    .sort(
      (a, b) =>
        plannedRoadPriority(plan, b) - plannedRoadPriority(plan, a) ||
        a.id.localeCompare(b.id),
    );
}

function hasPlannedStructure(room: Room, planned: RoomPlanStructure): boolean {
  return room
    .lookForAt(LOOK_STRUCTURES, planned.x, planned.y)
    .some(
      (structure) =>
        structure.structureType === planned.structureType &&
        isDevelopmentEvidenceStructure(structure),
    );
}

function hasPlannedSite(room: Room, planned: RoomPlanStructure): boolean {
  return room
    .lookForAt(LOOK_CONSTRUCTION_SITES, planned.x, planned.y)
    .some((site) => site.my && site.structureType === planned.structureType);
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

function plannedStructureTileBuildable(
  room: Room,
  planned: RoomPlanStructure,
): boolean {
  if (
    room
      .lookForAt(LOOK_CONSTRUCTION_SITES, planned.x, planned.y)
      .some((site) => !site.my || site.structureType !== planned.structureType)
  ) {
    return false;
  }

  return room
    .lookForAt(LOOK_STRUCTURES, planned.x, planned.y)
    .every(
      (structure) =>
        isDevelopmentEvidenceStructure(structure) &&
        canShareDevelopmentTile(structure.structureType, planned.structureType),
    );
}

function adaptiveRoadBuildable(room: Room, x: number, y: number): boolean {
  if (x <= 1 || x >= 48 || y <= 1 || y >= 48) return false;
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
  if (hasRoadAt(room, x, y) || hasAnySiteAt(room, x, y)) return false;
  if (room.controller?.pos.x === x && room.controller.pos.y === y) return false;
  if (
    room
      .find(FIND_SOURCES)
      .some((source) => source.pos.x === x && source.pos.y === y)
  ) {
    return false;
  }

  return room
    .lookForAt(LOOK_STRUCTURES, x, y)
    .every(
      (structure) =>
        structure.structureType === STRUCTURE_CONTAINER ||
        structure.structureType === STRUCTURE_RAMPART,
    );
}

function structureLimit(
  structureType: BuildableStructureConstant,
  level: number,
): number {
  const limits = CONTROLLER_STRUCTURES[structureType] as
    | Record<number, number>
    | undefined;
  return limits?.[level] ?? 0;
}

function developmentStageIndex(
  stageId: RoomDevelopmentStageId | undefined,
): number {
  if (!stageId) return -1;
  return ROOM_DEVELOPMENT_STAGES.findIndex((stage) => stage.id === stageId);
}

function stageAllowsConstruction(
  planned: RoomPlanStructure,
  activeStageId: RoomDevelopmentStageId | null,
  underThreat: boolean,
): boolean {
  if (planned.activation === "defense") return true;
  if (
    underThreat &&
    (planned.structureType === STRUCTURE_SPAWN ||
      planned.structureType === STRUCTURE_TOWER)
  ) {
    return true;
  }

  if (planned.requiredForStage === true) {
    return activeStageId !== null && planned.stage === activeStageId;
  }

  const plannedStageIndex = developmentStageIndex(planned.stage);
  const activeStageIndex = developmentStageIndex(activeStageId ?? undefined);
  return (
    plannedStageIndex < 0 ||
    activeStageIndex < 0 ||
    plannedStageIndex <= activeStageIndex
  );
}

/**
 * During a visible incursion, reserve the first admissible perimeter closure,
 * then restore missing spawns/towers, then admit remaining defense before
 * ordinary growth. This prevents a wide bootstrap deficit from consuming the
 * entire bounded site budget while the minimum-cut remains open.
 */
function threatAdmissionClass(
  planned: RoomPlanStructure,
  underThreat: boolean,
  primaryThreatPerimeterId: string | undefined,
): number {
  if (!underThreat) return 0;
  if (planned.id === primaryThreatPerimeterId) return 3;
  if (
    planned.structureType === "spawn" ||
    planned.structureType === STRUCTURE_TOWER
  ) {
    return 2;
  }
  return planned.activation === "defense" ? 1 : 0;
}

function plannedSiteIntentPriority(
  planned: RoomPlanStructure,
  underThreat: boolean,
  primaryThreatPerimeterId: string | undefined,
): number {
  return (
    planned.priority +
    threatAdmissionClass(planned, underThreat, primaryThreatPerimeterId) *
      THREAT_ADMISSION_PRIORITY_STEP
  );
}

function planRoomConstruction(room: Room): Intent[] {
  const level = room.controller?.level ?? 0;
  if (level < 2) return [];
  const projection = usableRoomPlanProjection(
    Memory.colonies[room.name],
    room.name,
  );
  if (!projection.usable) return [];
  const roomPlan = projection.plan;

  const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  if (existingSites.length >= MAX_ACTIVE_SITES_PER_ROOM) return [];
  const newSiteBudget = Math.min(
    MAX_NEW_SITES_PER_ROOM,
    MAX_ACTIVE_SITES_PER_ROOM - existingSites.length,
  );

  const existingByType = new Map<BuildableStructureConstant, number>();
  for (const structure of room.find(FIND_MY_STRUCTURES)) {
    const type = structure.structureType as BuildableStructureConstant;
    existingByType.set(type, (existingByType.get(type) ?? 0) + 1);
  }
  const sitesByType = new Map<BuildableStructureConstant, number>();
  for (const site of existingSites) {
    sitesByType.set(
      site.structureType,
      (sitesByType.get(site.structureType) ?? 0) + 1,
    );
  }

  const intents: Intent[] = [];
  const proposedByType = new Map<BuildableStructureConstant, number>();
  const workforceCount = room.find(FIND_MY_CREEPS).length;
  const towerCount = existingByType.get(STRUCTURE_TOWER) ?? 0;
  const underThreat = room.find(FIND_HOSTILE_CREEPS).length > 0;
  const development = evaluateRoomDevelopmentForRoom(room, roomPlan);
  if (development.horizonStatus === "invalid_v4_plan") return [];

  const milestoneStructureId = development.nextMilestone.plannedStructureId;
  const stageAware = development.horizonStatus === "v4_rcl8";
  const eligibleStructures = eligiblePlannedStructures(
    roomPlan,
    level,
    workforceCount,
    { towerCount, underThreat },
  ).filter(
    (planned) =>
      !stageAware ||
      stageAllowsConstruction(
        planned,
        development.activeStageId,
        underThreat,
      ),
  );
  const primaryThreatPerimeterId = underThreat
    ? [...eligibleStructures]
        .filter(
          (planned) =>
            planned.activation === "defense" &&
            planned.phase === "defense-envelope" &&
            planned.structureType === STRUCTURE_RAMPART &&
            !hasPlannedStructure(room, planned) &&
            !hasPlannedSite(room, planned) &&
            plannedStructureTileBuildable(room, planned) &&
            (existingByType.get(planned.structureType) ?? 0) +
              (sitesByType.get(planned.structureType) ?? 0) <
              structureLimit(planned.structureType, level),
        )
        .sort(
          (a, b) =>
            (b.strategicWeight ?? 0) - (a.strategicWeight ?? 0) ||
            b.priority - a.priority ||
            a.id.localeCompare(b.id),
        )[0]?.id
    : undefined;
  const plannedStructures = eligibleStructures.sort(
    (a, b) =>
      threatAdmissionClass(b, underThreat, primaryThreatPerimeterId) -
        threatAdmissionClass(a, underThreat, primaryThreatPerimeterId) ||
      Number(b.id === milestoneStructureId) -
        Number(a.id === milestoneStructureId) ||
      (b.strategicWeight ?? 0) - (a.strategicWeight ?? 0) ||
      b.priority - a.priority ||
      a.id.localeCompare(b.id),
  );

  for (const planned of plannedStructures) {
    if (intents.length >= newSiteBudget) break;
    if (hasPlannedStructure(room, planned) || hasPlannedSite(room, planned))
      continue;
    if (!plannedStructureTileBuildable(room, planned)) continue;

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
      priority: plannedSiteIntentPriority(
        planned,
        underThreat,
        primaryThreatPerimeterId,
      ),
      reason: `${planned.phase}: ${planned.reason}`,
      trace: realizationTrace(
        room.name,
        "site-planned-structure",
        planned.x,
        planned.y,
        planned.structureType,
      ),
    });
    proposedByType.set(
      planned.structureType,
      (proposedByType.get(planned.structureType) ?? 0) + 1,
    );
  }

  const existingRoadSites = sitesByType.get(STRUCTURE_ROAD) ?? 0;
  let proposedRoadSites = 0;

  if (
    intents.length < newSiteBudget &&
    existingRoadSites < MAX_ACTIVE_ROAD_SITES_PER_ROOM &&
    shouldActivateStrategicRoads(level, workforceCount)
  ) {
    for (const road of eligiblePlannedRoads(roomPlan, level)) {
      if (intents.length >= newSiteBudget) break;
      if (
        existingRoadSites + proposedRoadSites >=
        MAX_ACTIVE_ROAD_SITES_PER_ROOM
      )
        break;
      if (hasRoad(room, road) || hasAnySite(room, road)) continue;

      intents.push({
        type: "createConstructionSite",
        roomName: room.name,
        x: road.x,
        y: road.y,
        structureType: STRUCTURE_ROAD,
        priority: plannedRoadPriority(roomPlan, road),
        reason: `${road.phase}: logistics demand activated planned corridor`,
        trace: realizationTrace(
          room.name,
          "site-planned-road",
          road.x,
          road.y,
          STRUCTURE_ROAD,
        ),
      });
      proposedRoadSites += 1;
    }

    for (const tile of hotTrafficTiles(room.name)) {
      if (intents.length >= newSiteBudget) break;
      if (
        existingRoadSites + proposedRoadSites >=
        MAX_ACTIVE_ROAD_SITES_PER_ROOM
      )
        break;
      if (!adaptiveRoadBuildable(room, tile.x, tile.y)) continue;

      intents.push({
        type: "createConstructionSite",
        roomName: room.name,
        x: tile.x,
        y: tile.y,
        structureType: STRUCTURE_ROAD,
        priority: 200 + Math.min(120, Math.floor(tile.score)),
        reason: `adaptive traffic: sustained movement heat ${tile.score.toFixed(1)}`,
        trace: realizationTrace(
          room.name,
          "site-adaptive-road",
          tile.x,
          tile.y,
          STRUCTURE_ROAD,
        ),
      });
      proposedRoadSites += 1;
    }
  }

  return intents;
}

function globalConstructionSiteCapacity(): number {
  const limit =
    typeof MAX_CONSTRUCTION_SITES === "number"
      ? MAX_CONSTRUCTION_SITES
      : FALLBACK_GLOBAL_CONSTRUCTION_SITE_LIMIT;
  const active =
    typeof Game === "undefined" || !Game.constructionSites
      ? 0
      : Object.keys(Game.constructionSites).length;
  return Math.max(0, limit - active);
}

export function planConstruction(world: WorldSnapshot): Intent[] {
  const capacity = globalConstructionSiteCapacity();
  if (capacity <= 0) return [];

  return world.rooms
    .flatMap(planRoomConstruction)
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.type === "createConstructionSite" &&
        b.type === "createConstructionSite"
          ? a.roomName.localeCompare(b.roomName) ||
            a.x - b.x ||
            a.y - b.y ||
            a.structureType.localeCompare(b.structureType)
          : 0),
    )
    .slice(0, capacity);
}
