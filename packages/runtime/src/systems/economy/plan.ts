import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";
import { capabilitiesOf } from "../../workforce/capabilities";

const PEACETIME_TOWER_RESERVE = 400;

export type EnergyMode = "collect" | "deliver";

interface BufferedSource {
  source: Source;
  container: StructureContainer;
}

declare global {
  interface CreepMemory {
    energyMode?: EnergyMode;
  }
}

export function resolveEnergyMode(
  previous: EnergyMode | undefined,
  energy: number,
  capacity: number,
): EnergyMode {
  if (energy <= 0) return "collect";
  if (capacity > 0 && energy >= capacity) return "deliver";
  return previous ?? "collect";
}

function trace(roomName: string, creepName: string, task: string, activity: string) {
  return createIntentTrace({
    roomName,
    domain: "economy",
    task,
    activity: `${creepName}:${activity}`,
  });
}

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

function bufferedSources(room: Room): BufferedSource[] {
  const plan = Memory.colonies[room.name]?.roomPlan;
  if (!plan) return [];

  const buffered: BufferedSource[] = [];
  for (const anchor of plan.anchors.sources) {
    const source = Game.getObjectById(anchor.sourceId as Id<Source>);
    if (!source) continue;

    const container = room
      .lookForAt(LOOK_STRUCTURES, anchor.container.x, anchor.container.y)
      .find(
        (structure): structure is StructureContainer =>
          structure.structureType === STRUCTURE_CONTAINER,
      );
    if (container) buffered.push({ source, container });
  }
  return buffered;
}

function producerAssignments(
  world: WorldSnapshot,
  bufferedByRoom: Map<string, BufferedSource[]>,
): Map<string, BufferedSource> {
  const assignments = new Map<string, BufferedSource>();

  for (const room of world.rooms) {
    const buffered = bufferedByRoom.get(room.name) ?? [];
    if (buffered.length === 0) continue;

    const candidates = world.creeps.filter((creep) => {
      if (creep.spawning || creep.room.name !== room.name) return false;
      const capabilities = capabilitiesOf(creep);
      return capabilities.has("harvest") && capabilities.has("haul");
    });

    for (const node of buffered) {
      const available = candidates
        .filter((candidate) => !assignments.has(candidate.name))
        .sort((a, b) => {
          const workDifference = b.getActiveBodyparts(WORK) - a.getActiveBodyparts(WORK);
          if (workDifference !== 0) return workDifference;
          const rangeDifference = a.pos.getRangeTo(node.source) - b.pos.getRangeTo(node.source);
          return rangeDifference || a.name.localeCompare(b.name);
        });
      const producer = available[0];
      if (producer) assignments.set(producer.name, node);
    }
  }

  return assignments;
}

export function planEconomy(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];
  const bufferedByRoom = new Map(
    world.rooms.map((room) => [room.name, bufferedSources(room)] as const),
  );
  const producers = producerAssignments(world, bufferedByRoom);

  for (const creep of world.creeps) {
    if (creep.spawning) continue;

    const roomName = creep.room.name;
    const spatial = world.spatial.byRoom[roomName];
    if (!spatial) continue;

    const capabilities = capabilitiesOf(creep);
    const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? energy;
    let energyMode = resolveEnergyMode(creep.memory.energyMode, energy, capacity);
    creep.memory.energyMode = energyMode;

    const producer = producers.get(creep.name);
    if (producer) {
      if (energy < capacity && producer.source.energy > 0) {
        intents.push({
          type: "harvest",
          creepName: creep.name,
          sourceId: producer.source.id,
          priority: 1100,
          reason: "produce continuously into the assigned source buffer",
          trace: trace(
            roomName,
            creep.name,
            "produce-source-energy",
            `harvest:${producer.source.id}`,
          ),
        });
        continue;
      }

      if (
        energy > 0 &&
        producer.container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: producer.container.id,
          resource: RESOURCE_ENERGY,
          priority: 1075,
          reason: "buffer completed producer load at the source edge",
          trace: trace(
            roomName,
            creep.name,
            "buffer-source-energy",
            `transfer:${producer.container.id}`,
          ),
        });
        continue;
      }
    }

    const roomBuffers = bufferedByRoom.get(roomName) ?? [];
    if (
      !producer &&
      roomBuffers.length > 0 &&
      energyMode === "collect" &&
      capabilities.has("haul")
    ) {
      const availableBuffers = roomBuffers
        .map((node) => node.container)
        .filter((container) => container.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
      const buffer = world.spatial.nearest(creep.pos, availableBuffers);

      if (buffer) {
        intents.push({
          type: "withdraw",
          creepName: creep.name,
          targetId: buffer.id,
          resource: RESOURCE_ENERGY,
          priority: 1050,
          reason: "collect buffered source energy before direct harvesting",
          trace: trace(
            roomName,
            creep.name,
            "move-buffered-energy",
            `withdraw:${buffer.id}`,
          ),
        });
        continue;
      }

      if (energy > 0) {
        energyMode = "deliver";
        creep.memory.energyMode = energyMode;
      }
    }

    if (energyMode === "collect" && capabilities.has("harvest")) {
      const activeSources = spatial.sources.filter((source) => source.energy > 0);
      const source = world.spatial.nearest(creep.pos, activeSources);
      if (source) {
        intents.push({
          type: "harvest",
          creepName: creep.name,
          sourceId: source.id,
          priority: 1000,
          reason:
            roomBuffers.length > 0
              ? "buffer network is empty; use generalist recovery harvesting"
              : "complete collection cycle before delivery",
          trace: trace(roomName, creep.name, "maintain-energy-flow", `harvest:${source.id}`),
        });
        continue;
      }

      if (energy > 0) {
        energyMode = "deliver";
        creep.memory.energyMode = energyMode;
      }
    }

    if (energyMode === "deliver" && energy > 0 && capabilities.has("haul")) {
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
          reason: "continue delivery cycle until worker is empty",
          trace: trace(
            roomName,
            creep.name,
            "fund-reproduction",
            `transfer:${reproductionTarget.id}`,
          ),
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
          trace: trace(roomName, creep.name, "maintain-defense-reserve", `transfer:${tower.id}`),
        });
        continue;
      }
    }

    if (energyMode === "deliver" && energy > 0 && capabilities.has("build")) {
      const site = world.spatial.nearest(creep.pos, spatial.constructionSites);
      if (site) {
        intents.push({
          type: "build",
          creepName: creep.name,
          targetId: site.id,
          priority: 700,
          reason: "spend delivery-cycle surplus on bootstrap infrastructure",
          trace: trace(roomName, creep.name, "build-infrastructure", `build:${site.id}`),
        });
        continue;
      }
    }

    if (energyMode === "deliver" && energy > 0 && capabilities.has("repair")) {
      const repairTargets = spatial.structures.filter(needsBootstrapRepair);
      const repairTarget = world.spatial.nearest(creep.pos, repairTargets);
      if (repairTarget) {
        intents.push({
          type: "repair",
          creepName: creep.name,
          targetId: repairTarget.id,
          priority: 500,
          reason: "spend delivery-cycle surplus restoring bootstrap infrastructure",
          trace: trace(roomName, creep.name, "restore-infrastructure", `repair:${repairTarget.id}`),
        });
        continue;
      }
    }

    if (
      energyMode === "deliver" &&
      energy > 0 &&
      capabilities.has("upgrade") &&
      creep.room.controller?.my
    ) {
      intents.push({
        type: "upgrade",
        creepName: creep.name,
        controllerId: creep.room.controller.id,
        priority: 100,
        reason: "finish delivery cycle by investing surplus energy in controller progression",
        trace: trace(
          roomName,
          creep.name,
          "advance-controller",
          `upgrade:${creep.room.controller.id}`,
        ),
      });
    }
  }

  return intents;
}
