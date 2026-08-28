import {
  resolveMovementRequests,
  type MovementMetrics,
  type MovementRequest,
} from "../movement/traffic";
import type { CreepIntent, Intent } from "./types";

export interface ActivityExecutionObservation {
  intent: Intent;
  result: number;
  movementRequired: boolean;
  evidence: string;
  outcome?: { metric: string; actual: number; target: number; unit: string };
}

export interface ExecutionResult {
  movement: MovementMetrics;
  activities: ActivityExecutionObservation[];
}

export function intentActorKey(intent: Intent): string {
  switch (intent.type) {
    case "spawn":
      return `spawn:${intent.spawnName}`;
    case "createConstructionSite":
      return `construction:${intent.roomName}:${intent.trace?.workKey ?? `${intent.x}:${intent.y}:${intent.structureType}`}`;
    case "towerAttack":
      return `tower:${intent.towerId}`;
    default:
      return intent.creepName;
  }
}

function requestMovement(
  requests: MovementRequest[],
  creep: Creep,
  target: RoomObject,
  range: number,
  result: number,
  priority: number,
  reason: string,
): boolean {
  if (result !== ERR_NOT_IN_RANGE) return false;
  requests.push({ creep, target, range, priority, reason });
  return true;
}

function observe(
  activities: ActivityExecutionObservation[],
  intent: Intent,
  result: number,
  movementRequired: boolean,
  outcome?: ActivityExecutionObservation["outcome"],
): void {
  activities.push({
    intent,
    result,
    movementRequired,
    ...(result === OK && outcome ? { outcome } : {}),
    evidence:
      result === OK
        ? `${intent.type} governed action executed successfully`
        : movementRequired
          ? `${intent.type} governed action required travel toward target`
          : `${intent.type} governed action returned Screeps code ${result}`,
  });
}

function energyOutcome(
  metric: string,
  actual: number,
  target: number,
): ActivityExecutionObservation["outcome"] {
  return { metric, actual: Math.max(0, actual), target: Math.max(1, target), unit: "energy" };
}

function executeCreepIntent(
  intent: CreepIntent,
  movementRequests: MovementRequest[],
  activities: ActivityExecutionObservation[],
): void {
  const creep = Game.creeps[intent.creepName];
  if (!creep || creep.spawning) {
    observe(activities, intent, ERR_INVALID_TARGET, false);
    return;
  }

  if (intent.type === "move") {
    const target = Game.getObjectById(intent.targetId) as
      | StructureContainer
      | StructureSpawn
      | null;
    if (!target) {
      observe(activities, intent, ERR_INVALID_TARGET, false);
      return;
    }
    if (creep.pos.inRangeTo(target, intent.range)) {
      observe(activities, intent, OK, false);
      return;
    }
    movementRequests.push({
      creep,
      target,
      range: intent.range,
      priority: intent.priority,
      reason: intent.reason,
    });
    observe(activities, intent, ERR_NOT_IN_RANGE, true);
    return;
  }

  let result: number = ERR_INVALID_TARGET;
  let target: RoomObject | null = null;
  let range = 1;
  let outcome: ActivityExecutionObservation["outcome"];

  switch (intent.type) {
    case "harvest": {
      target = Game.getObjectById(intent.sourceId);
      if (target) {
        const source = target as Source;
        const capacity = creep.getActiveBodyparts(WORK) * HARVEST_POWER;
        outcome = energyOutcome(
          "energy harvested",
          Math.min(capacity, creep.store.getFreeCapacity(RESOURCE_ENERGY), source.energy),
          capacity,
        );
        result = creep.harvest(source);
      }
      break;
    }
    case "withdraw": {
      target = Game.getObjectById(intent.targetId);
      if (target) {
        const storeTarget = target as StructureContainer | Tombstone | Ruin;
        outcome = energyOutcome(
          "energy collected",
          Math.min(
            creep.store.getFreeCapacity(intent.resource) ?? 0,
            storeTarget.store.getUsedCapacity(intent.resource),
          ),
          creep.store.getCapacity(intent.resource) ?? 0,
        );
        result = creep.withdraw(storeTarget, intent.resource);
      }
      break;
    }
    case "transfer": {
      target = Game.getObjectById(intent.targetId);
      if (target) {
        const storeTarget = target as AnyStoreStructure;
        outcome = energyOutcome(
          "energy delivered",
          Math.min(
            creep.store.getUsedCapacity(intent.resource),
            storeTarget.store.getFreeCapacity(intent.resource) ?? 0,
          ),
          creep.store.getCapacity(intent.resource) ?? 0,
        );
        result = creep.transfer(storeTarget, intent.resource);
      }
      break;
    }
    case "build": {
      target = Game.getObjectById(intent.targetId);
      range = 3;
      if (target) result = creep.build(target as ConstructionSite);
      break;
    }
    case "repair": {
      target = Game.getObjectById(intent.targetId);
      range = 3;
      if (target) result = creep.repair(target as Structure);
      break;
    }
    case "upgrade": {
      target = Game.getObjectById(intent.controllerId);
      range = 3;
      if (target) result = creep.upgradeController(target as StructureController);
      break;
    }
  }

  const movementRequired = target
    ? requestMovement(
        movementRequests,
        creep,
        target,
        range,
        result,
        intent.priority,
        intent.reason,
      )
    : false;
  observe(activities, intent, result, movementRequired, outcome);
}

export function execute(intents: Intent[]): ExecutionResult {
  const movementRequests: MovementRequest[] = [];
  const activities: ActivityExecutionObservation[] = [];

  for (const intent of intents) {
    if (intent.type === "spawn") {
      const spawn = Game.spawns[intent.spawnName];
      const result = !spawn
        ? ERR_INVALID_TARGET
        : spawn.spawning
          ? ERR_BUSY
          : spawn.spawnCreep(intent.body, intent.name);
      observe(activities, intent, result, false);
      continue;
    }

    if (intent.type === "createConstructionSite") {
      const room = Game.rooms[intent.roomName];
      const result = room
        ? room.createConstructionSite(intent.x, intent.y, intent.structureType)
        : ERR_INVALID_TARGET;
      observe(activities, intent, result, false);
      continue;
    }

    if (intent.type === "towerAttack") {
      const tower = Game.getObjectById(intent.towerId);
      const target = Game.getObjectById(intent.targetId);
      const result = tower && target ? tower.attack(target) : ERR_INVALID_TARGET;
      observe(activities, intent, result, false);
      continue;
    }

    executeCreepIntent(intent, movementRequests, activities);
  }

  return {
    movement: resolveMovementRequests(movementRequests),
    activities,
  };
}
