import type { WorldSnapshot } from "../../runtime/context";
import type { Intent } from "../../intents/types";
import { capabilitiesOf } from "../../workforce/capabilities";

function needsBootstrapRepair(structure: AnyStructure): boolean {
  if (!("hits" in structure) || !("hitsMax" in structure)) return false;

  if (structure.structureType === STRUCTURE_RAMPART) {
    return structure.hits < Math.min(10_000, structure.hitsMax);
  }

  return (
    [
      STRUCTURE_SPAWN,
      STRUCTURE_EXTENSION,
      STRUCTURE_TOWER,
      STRUCTURE_CONTAINER,
      STRUCTURE_ROAD,
    ] as StructureConstant[]
  ).includes(structure.structureType) && structure.hits < structure.hitsMax * 0.5;
}

export function planEconomy(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];

  for (const creep of world.creeps) {
    if (creep.spawning) continue;

    const capabilities = capabilitiesOf(creep);
    const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const freeEnergy = creep.store.getFreeCapacity(RESOURCE_ENERGY);

    if (freeEnergy > 0 && capabilities.has("harvest")) {
      const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source) {
        intents.push({
          type: "harvest",
          creepName: creep.name,
          sourceId: source.id,
          priority: 1000,
          reason: "fill worker energy before delivery or discretionary work",
        });
        continue;
      }
    }

    if (energy > 0 && capabilities.has("haul")) {
      const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (structure) =>
          (structure.structureType === STRUCTURE_SPAWN ||
            structure.structureType === STRUCTURE_EXTENSION ||
            structure.structureType === STRUCTURE_TOWER) &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      }) as StructureSpawn | StructureExtension | StructureTower | null;

      if (target) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: target.id,
          resource: RESOURCE_ENERGY,
          priority: 900,
          reason: "fund spawn capacity and defense before discretionary work",
        });
        continue;
      }
    }

    if (energy > 0 && capabilities.has("build")) {
      const site = creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES);
      if (site) {
        intents.push({
          type: "build",
          creepName: creep.name,
          targetId: site.id,
          priority: 700,
          reason: "bootstrap infrastructure demand",
        });
        continue;
      }
    }

    if (energy > 0 && capabilities.has("repair")) {
      const repairTarget = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: needsBootstrapRepair,
      });
      if (repairTarget) {
        intents.push({
          type: "repair",
          creepName: creep.name,
          targetId: repairTarget.id,
          priority: 500,
          reason: "restore critical bootstrap infrastructure",
        });
        continue;
      }
    }

    if (energy > 0 && capabilities.has("upgrade") && creep.room.controller?.my) {
      intents.push({
        type: "upgrade",
        creepName: creep.name,
        controllerId: creep.room.controller.id,
        priority: 100,
        reason: "invest surplus energy in controller progression",
      });
    }
  }

  return intents;
}
