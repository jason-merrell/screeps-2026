import type { WorldSnapshot } from "../../runtime/context";
import type { Intent } from "../../intents/types";
import { capabilitiesOf } from "../../workforce/capabilities";

const PEACETIME_TOWER_RESERVE = 400;

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

function towerNeedsReserve(tower: StructureTower, underAttack: boolean): boolean {
  const capacity = tower.store.getCapacity(RESOURCE_ENERGY);
  if (capacity === null) return false;

  const target = underAttack ? capacity : Math.min(PEACETIME_TOWER_RESERVE, capacity);
  return tower.store.getUsedCapacity(RESOURCE_ENERGY) < target;
}

export function planEconomy(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];

  for (const creep of world.creeps) {
    if (creep.spawning) continue;

    const spatial = world.spatial.byRoom[creep.room.name];
    if (!spatial) continue;

    const capabilities = capabilitiesOf(creep);
    const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const freeEnergy = creep.store.getFreeCapacity(RESOURCE_ENERGY);

    if (freeEnergy > 0 && capabilities.has("harvest")) {
      const activeSources = spatial.sources.filter((source) => source.energy > 0);
      const source = world.spatial.nearest(creep.pos, activeSources);
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
      const reproductionTargets = spatial.myStructures.filter(
        (structure): structure is StructureSpawn | StructureExtension =>
          (structure.structureType === STRUCTURE_SPAWN ||
            structure.structureType === STRUCTURE_EXTENSION) &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );
      const reproductionTarget = world.spatial.nearest(creep.pos, reproductionTargets);

      if (reproductionTarget) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: reproductionTarget.id,
          resource: RESOURCE_ENERGY,
          priority: 950,
          reason: "fund reproduction capacity before defensive reserves",
        });
        continue;
      }

      const underAttack = spatial.hostiles.length > 0;
      const towers = spatial.myStructures.filter(
        (structure): structure is StructureTower =>
          structure.structureType === STRUCTURE_TOWER &&
          towerNeedsReserve(structure as StructureTower, underAttack),
      );
      const tower = world.spatial.nearest(creep.pos, towers);

      if (tower) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: tower.id,
          resource: RESOURCE_ENERGY,
          priority: underAttack ? 925 : 800,
          reason: underAttack
            ? "fill defensive tower during active threat"
            : "maintain bounded peacetime tower reserve",
        });
        continue;
      }
    }

    if (energy > 0 && capabilities.has("build")) {
      const site = world.spatial.nearest(creep.pos, spatial.constructionSites);
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
      const repairTargets = spatial.structures.filter(needsBootstrapRepair);
      const repairTarget = world.spatial.nearest(creep.pos, repairTargets);
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
