import { TickMovementRouter, type MovementMetrics } from "../movement/router";
import type { TickSpatialIndex } from "../world/spatial-index";
import type { Intent } from "./types";

function moveIfNeeded(
  router: TickMovementRouter,
  creep: Creep,
  target: RoomObject,
  range: number,
  result: number,
): void {
  if (result === ERR_NOT_IN_RANGE) {
    router.moveToward(creep, target, range);
  }
}

export function execute(intents: Intent[], spatial: TickSpatialIndex): MovementMetrics {
  const router = new TickMovementRouter(spatial);

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
      case "harvest": {
        const source = Game.getObjectById(intent.sourceId);
        if (!source) break;
        moveIfNeeded(router, creep, source, 1, creep.harvest(source));
        break;
      }
      case "transfer": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        moveIfNeeded(router, creep, target, 1, creep.transfer(target, intent.resource));
        break;
      }
      case "build": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        moveIfNeeded(router, creep, target, 3, creep.build(target));
        break;
      }
      case "repair": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        moveIfNeeded(router, creep, target, 3, creep.repair(target));
        break;
      }
      case "upgrade": {
        const controller = Game.getObjectById(intent.controllerId);
        if (!controller) break;
        moveIfNeeded(router, creep, controller, 3, creep.upgradeController(controller));
        break;
      }
    }
  }

  return router.metrics;
}
