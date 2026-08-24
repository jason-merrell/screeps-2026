import type { Intent } from "./types";

function moveIfNeeded(creep: Creep, target: RoomObject, result: number): void {
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5 });
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
      case "upgrade": {
        const controller = Game.getObjectById(intent.controllerId);
        if (!controller) break;
        moveIfNeeded(creep, controller, creep.upgradeController(controller));
        break;
      }
    }
  }
}
