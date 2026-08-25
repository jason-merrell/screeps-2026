import {
  resolveMovementRequests,
  type MovementMetrics,
  type MovementRequest,
} from "../movement/traffic";
import type { Intent } from "./types";

function requestMovement(
  requests: MovementRequest[],
  creep: Creep,
  target: RoomObject,
  range: number,
  result: number,
  priority: number,
  reason: string,
): void {
  if (result !== ERR_NOT_IN_RANGE) return;
  requests.push({ creep, target, range, priority, reason });
}

export function execute(intents: Intent[]): MovementMetrics {
  const movementRequests: MovementRequest[] = [];

  for (const intent of intents) {
    if (intent.type === "spawn") {
      const spawn = Game.spawns[intent.spawnName];
      if (spawn && !spawn.spawning) {
        spawn.spawnCreep(intent.body, intent.name);
      }
      continue;
    }

    if (intent.type === "createConstructionSite") {
      const room = Game.rooms[intent.roomName];
      if (room) {
        room.createConstructionSite(intent.x, intent.y, intent.structureType);
      }
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

    switch (intent.type) {
      case "move": {
        const target = Game.getObjectById(intent.targetId);
        if (!target || creep.pos.inRangeTo(target, intent.range)) break;
        movementRequests.push({
          creep,
          target,
          range: intent.range,
          priority: intent.priority,
          reason: intent.reason,
        });
        break;
      }
      case "harvest": {
        const source = Game.getObjectById(intent.sourceId);
        if (!source) break;
        requestMovement(
          movementRequests,
          creep,
          source,
          1,
          creep.harvest(source),
          intent.priority,
          intent.reason,
        );
        break;
      }
      case "withdraw": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        requestMovement(
          movementRequests,
          creep,
          target,
          1,
          creep.withdraw(target, intent.resource),
          intent.priority,
          intent.reason,
        );
        break;
      }
      case "transfer": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        requestMovement(
          movementRequests,
          creep,
          target,
          1,
          creep.transfer(target, intent.resource),
          intent.priority,
          intent.reason,
        );
        break;
      }
      case "build": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        requestMovement(
          movementRequests,
          creep,
          target,
          3,
          creep.build(target),
          intent.priority,
          intent.reason,
        );
        break;
      }
      case "repair": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        requestMovement(
          movementRequests,
          creep,
          target,
          3,
          creep.repair(target),
          intent.priority,
          intent.reason,
        );
        break;
      }
      case "upgrade": {
        const controller = Game.getObjectById(intent.controllerId);
        if (!controller) break;
        requestMovement(
          movementRequests,
          creep,
          controller,
          3,
          creep.upgradeController(controller),
          intent.priority,
          intent.reason,
        );
        break;
      }
    }
  }

  return resolveMovementRequests(movementRequests);
}
