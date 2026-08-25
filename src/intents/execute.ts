import type { Intent } from "./types";

const MOVEMENT_PATH_REUSE_TICKS = 20;

function moveIfNeeded(creep: Creep, target: RoomObject, result: number): void {
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: MOVEMENT_PATH_REUSE_TICKS });
  }
}

export function execute(intents: Intent[]): void {
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
        moveIfNeeded(creep, source, creep.harvest(source));
        break;
      }
      case "transfer": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        moveIfNeeded(creep, target, creep.transfer(target, intent.resource));
        break;
      }
      case "build": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        moveIfNeeded(creep, target, creep.build(target));
        break;
      }
      case "repair": {
        const target = Game.getObjectById(intent.targetId);
        if (!target) break;
        moveIfNeeded(creep, target, creep.repair(target));
        break;
      }
      case "upgrade": {
        const controller = Game.getObjectById(intent.controllerId);
        if (!controller) break;
        moveIfNeeded(creep, controller, creep.upgradeController(controller));
        break;
      }
    }
  }
}
