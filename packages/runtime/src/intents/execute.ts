import {
  resolveMovementRequests,
  type MovementMetrics,
  type MovementRequest,
} from "../movement/traffic";
import type { CreepIntent, Intent } from "./types";

export interface ActivityExecutionObservation {
  intent: CreepIntent;
  result: number;
  movementRequired: boolean;
  evidence: string;
}

export interface ExecutionResult {
  movement: MovementMetrics;
  activities: ActivityExecutionObservation[];
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
  intent: CreepIntent,
  result: number,
  movementRequired: boolean,
): void {
  activities.push({
    intent,
    result,
    movementRequired,
    evidence:
      result === OK
        ? "task action executed at target"
        : movementRequired
          ? "task action required travel toward target"
          : `task action returned Screeps code ${result}`,
  });
}

export function execute(intents: Intent[]): ExecutionResult {
  const movementRequests: MovementRequest[] = [];
  const activities: ActivityExecutionObservation[] = [];

  for (const intent of intents) {
    if (intent.type === "spawn") {
      const spawn = Game.spawns[intent.spawnName];
      if (spawn && !spawn.spawning) spawn.spawnCreep(intent.body, intent.name);
      continue;
    }

    if (intent.type === "createConstructionSite") {
      const room = Game.rooms[intent.roomName];
      if (room) room.createConstructionSite(intent.x, intent.y, intent.structureType);
      continue;
    }

    if (intent.type === "towerAttack") {
      const tower = Game.getObjectById(intent.towerId);
      const target = Game.getObjectById(intent.targetId);
      if (tower && target) tower.attack(target);
      continue;
    }

    const creep = Game.creeps[intent.creepName];
    if (!creep || creep.spawning) continue;

    if (intent.type === "move") {
      const target = Game.getObjectById(intent.targetId);
      if (!target) {
        observe(activities, intent, ERR_INVALID_TARGET, false);
        continue;
      }
      if (creep.pos.inRangeTo(target, intent.range)) {
        observe(activities, intent, OK, false);
        continue;
      }
      movementRequests.push({
        creep,
        target,
        range: intent.range,
        priority: intent.priority,
        reason: intent.reason,
      });
      observe(activities, intent, ERR_NOT_IN_RANGE, true);
      continue;
    }

    let result: number = ERR_INVALID_TARGET;
    let target: RoomObject | null = null;
    let range = 1;

    switch (intent.type) {
      case "harvest": {
        target = Game.getObjectById(intent.sourceId);
        if (target) result = creep.harvest(target as Source);
        break;
      }
      case "withdraw": {
        target = Game.getObjectById(intent.targetId);
        if (target) result = creep.withdraw(target as StructureContainer, intent.resource);
        break;
      }
      case "transfer": {
        target = Game.getObjectById(intent.targetId);
        if (target) result = creep.transfer(target as AnyStoreStructure, intent.resource);
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
    observe(activities, intent, result, movementRequired);
  }

  return {
    movement: resolveMovementRequests(movementRequests),
    activities,
  };
}
