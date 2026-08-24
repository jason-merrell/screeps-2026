import type { WorldSnapshot } from "../../runtime/context";
import type { Intent } from "../../intents/types";
import { capabilitiesOf } from "../../workforce/capabilities";

export function planEconomy(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];

  for (const creep of world.creeps) {
    if (creep.spawning) continue;

    const capabilities = capabilitiesOf(creep);
    const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);

    if (energy === 0 && capabilities.has("harvest")) {
      const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source) {
        intents.push({
          type: "harvest",
          creepName: creep.name,
          sourceId: source.id,
          priority: 100,
          reason: "workforce needs energy",
        });
      }
      continue;
    }

    if (energy > 0 && capabilities.has("haul")) {
      const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (structure) =>
          (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      }) as StructureSpawn | StructureExtension | null;

      if (target) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: target.id,
          resource: RESOURCE_ENERGY,
          priority: 90,
          reason: "restore spawn energy",
        });
        continue;
      }
    }

    if (energy > 0 && capabilities.has("upgrade") && creep.room.controller?.my) {
      intents.push({
        type: "upgrade",
        creepName: creep.name,
        controllerId: creep.room.controller.id,
        priority: 10,
        reason: "use surplus workforce energy",
      });
    }
  }

  return intents;
}
