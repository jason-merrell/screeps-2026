import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";

export function planDefense(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];

  for (const room of world.rooms) {
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length === 0) continue;

    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];

    for (const tower of towers) {
      const target = tower.pos.findClosestByRange(hostiles);
      if (!target) continue;

      intents.push({
        type: "towerAttack",
        towerId: tower.id,
        targetId: target.id,
        priority: 3000,
        reason: `hostile creep in ${room.name}`,
        trace: createIntentTrace({
          roomName: room.name,
          domain: "defense",
          task: "repel-hostiles",
          activity: `${tower.id}:attack:${target.id}`,
        }),
      });
    }
  }

  return intents;
}
