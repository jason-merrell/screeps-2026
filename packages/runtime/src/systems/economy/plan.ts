import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import { compareConstructionTargets } from "../../planning/construction-priority";
import type { FspmActivityRecord } from "../../planning/fspm";
import type { WorldSnapshot } from "../../runtime/context";
import { capabilitiesOf } from "../../workforce/capabilities";
import {
  plannedSourceRouteLength,
  requiredCarryParts,
  reserveTransportCapacity,
  shouldActivateSourceBuffers,
} from "./logistics";
import { assignRecoveryHarvesters, assignSourceProducers } from "./source-allocation";

const PEACETIME_TOWER_RESERVE = 400;

export type EnergyMode = "collect" | "deliver";

interface BufferedSource {
  source: Source;
  container: StructureContainer;
  sourceIndex: number;
}

interface ActivityWithTarget extends FspmActivityRecord {
  currentTargetKey?: string;
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

export function sourceBufferLogisticsActive(
  controllerLevel: number,
  workforceCount: number,
  sourceCount: number,
): boolean {
  return shouldActivateSourceBuffers(controllerLevel, workforceCount, sourceCount);
}

export function shouldDeferRoutineBootstrapRepair(
  controllerLevel: number | undefined,
  structureType: StructureConstant,
): boolean {
  return (
    controllerLevel === 1 &&
    (structureType === "road" || structureType === "container")
  );
}

function energyTrace(
  roomName: string,
  procedure:
    | "extract-source-energy"
    | "buffer-source-energy"
    | "withdraw-buffered-energy"
    | "stage-source-transport"
    | "park-surplus-transport"
    | "fund-workforce-energy",
) {
  return createIntentTrace({
    roomName,
    domain: "economy",
    task: "maintain-colony-energy-service",
    procedure,
  });
}

function controllerTrace(roomName: string) {
  return createIntentTrace({
    roomName,
    domain: "economy",
    task: "advance-controller-capability",
    procedure: "upgrade-controller",
  });
}

function constructionTrace(
  roomName: string,
  task: "realize-planned-infrastructure" | "maintain-infrastructure-condition",
  procedure: "build-planned-infrastructure" | "repair-infrastructure",
) {
  return createIntentTrace({
    roomName,
    domain: "construction",
    task,
    procedure,
  });
}

function defenseTrace(roomName: string) {
  return createIntentTrace({
    roomName,
    domain: "defense",
    task: "maintain-defensive-readiness",
    procedure: "fund-tower-reserve",
  });
}

function needsBootstrapRepair(
  structure: AnyStructure,
  controllerLevel: number | undefined,
): boolean {
  if (!("hits" in structure) || !("hitsMax" in structure)) return false;
  if (shouldDeferRoutineBootstrapRepair(controllerLevel, structure.structureType)) return false;

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

  const controllerLevel = room.controller?.level ?? 0;
  const workforceCount = room.find(FIND_MY_CREEPS).length;
  if (
    !sourceBufferLogisticsActive(
      controllerLevel,
      workforceCount,
      plan.anchors.sources.length,
    )
  ) {
    return [];
  }

  const buffered: BufferedSource[] = [];
  for (const [sourceIndex, anchor] of plan.anchors.sources.entries()) {
    const source = Game.getObjectById(anchor.sourceId as Id<Source>);
    if (!source) continue;

    const container = room
      .lookForAt(LOOK_STRUCTURES, anchor.container.x, anchor.container.y)
      .find(
        (structure): structure is StructureContainer =>
          structure.structureType === STRUCTURE_CONTAINER,
      );
    if (container) buffered.push({ source, container, sourceIndex });
  }
  return buffered;
}

function preferredProducerSourceId(roomName: string, creepName: string): string | undefined {
  const portfolio = Memory.colonies[roomName]?.fspm;
  if (!portfolio?.activities) return undefined;

  const taskId = `task:${roomName}:economy:maintain-colony-energy-service`;
  const activity = Object.values(portfolio.activities)
    .filter(
      (candidate) =>
        candidate.assignee === creepName &&
        candidate.taskId === taskId &&
        candidate.status !== "completed",
    )
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)[0] as
    | ActivityWithTarget
    | undefined;

  return activity?.currentTargetKey;
}

function producerAssignments(
  world: WorldSnapshot,
  bufferedByRoom: Map<string, BufferedSource[]>,
): Map<string, BufferedSource> {
  const assignments = new Map<string, BufferedSource>();

  for (const room of world.rooms) {
    const buffered = bufferedByRoom.get(room.name) ?? [];
    if (buffered.length === 0) continue;

    const candidates = world.creeps
      .filter((creep) => {
        if (creep.spawning || creep.room.name !== room.name) return false;
        const capabilities = capabilitiesOf(creep);
        return capabilities.has("harvest") && capabilities.has("haul");
      })
      .map((creep) => ({
        name: creep.name,
        work: creep.getActiveBodyparts(WORK),
        preferredSourceId: preferredProducerSourceId(room.name, creep.name),
        rangeBySource: Object.fromEntries(
          buffered.map((node) => [node.source.id, creep.pos.getRangeTo(node.source)]),
        ),
      }));

    const nodeBySourceId = new Map(buffered.map((node) => [node.source.id, node]));
    const selected = assignSourceProducers(
      buffered.map((node) => node.source.id),
      candidates,
    );

    for (const [creepName, sourceId] of selected) {
      const node = nodeBySourceId.get(sourceId);
      if (node) assignments.set(creepName, node);
    }
  }

  return assignments;
}

function transporterAssignments(
  world: WorldSnapshot,
  bufferedByRoom: Map<string, BufferedSource[]>,
  producers: Map<string, BufferedSource>,
): Map<string, BufferedSource> {
  const assignments = new Map<string, BufferedSource>();

  for (const room of world.rooms) {
    const buffered = bufferedByRoom.get(room.name) ?? [];
    if (buffered.length === 0) continue;

    const plan = Memory.colonies[room.name]?.roomPlan;
    if (!plan) continue;

    const candidates = world.creeps
      .filter((creep) => {
        if (creep.spawning || creep.room.name !== room.name || producers.has(creep.name)) {
          return false;
        }
        return capabilitiesOf(creep).has("haul");
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const producerByContainer = new Map(
      [...producers.entries()].map(([creepName, node]) => [node.container.id, Game.creeps[creepName]]),
    );
    const reservations = reserveTransportCapacity(
      buffered.flatMap((node) => {
        const producer = producerByContainer.get(node.container.id);
        if (!producer) return [];
        return [{
          id: node.container.id,
          requiredCarry: requiredCarryParts(
            plannedSourceRouteLength(plan, node.sourceIndex),
            producer.getActiveBodyparts(WORK) * HARVEST_POWER,
          ),
        }];
      }),
      candidates.map((creep) => ({
        name: creep.name,
        carry: creep.getActiveBodyparts(CARRY),
        rangeByNode: Object.fromEntries(
          buffered.map((node) => [node.container.id, creep.pos.getRangeTo(node.container)]),
        ),
      })),
    );

    const nodeById = new Map<string, BufferedSource>(
      buffered.map((node) => [node.container.id, node]),
    );
    for (const [creepName, nodeId] of reservations) {
      const node = nodeById.get(nodeId);
      if (node) assignments.set(creepName, node);
    }
  }

  return assignments;
}

function recoveryAssignments(
  world: WorldSnapshot,
  bufferedByRoom: Map<string, BufferedSource[]>,
  producers: Map<string, BufferedSource>,
): Map<string, Source> {
  const assignments = new Map<string, Source>();

  for (const room of world.rooms) {
    const buffered = bufferedByRoom.get(room.name) ?? [];
    if (
      buffered.length === 0 ||
      buffered.some((node) => node.container.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
    ) {
      continue;
    }

    const assignedProducerWork = new Map<string, number>();
    for (const [creepName, node] of producers) {
      if (node.source.room.name !== room.name) continue;
      const creep = Game.creeps[creepName];
      if (!creep) continue;
      assignedProducerWork.set(
        node.source.id,
        (assignedProducerWork.get(node.source.id) ?? 0) + creep.getActiveBodyparts(WORK),
      );
    }

    const candidates = world.creeps
      .filter((creep) => {
        if (creep.spawning || creep.room.name !== room.name || producers.has(creep.name)) return false;
        const capabilities = capabilitiesOf(creep);
        const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
        const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? energy;
        return (
          capabilities.has("harvest") &&
          capabilities.has("haul") &&
          resolveEnergyMode(creep.memory.energyMode, energy, capacity) === "collect"
        );
      })
      .map((creep) => ({
        name: creep.name,
        work: creep.getActiveBodyparts(WORK),
        rangeBySource: Object.fromEntries(
          buffered.map((node) => [node.source.id, creep.pos.getRangeTo(node.source)]),
        ),
      }));

    const sourceById = new Map(buffered.map((node) => [node.source.id, node.source]));
    const selected = assignRecoveryHarvesters(
      buffered.map((node) => ({
        id: node.source.id,
        assignedWork: assignedProducerWork.get(node.source.id) ?? 0,
      })),
      candidates,
    );

    for (const [creepName, sourceId] of selected) {
      const source = sourceById.get(sourceId);
      if (source) assignments.set(creepName, source);
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
  const transporters = transporterAssignments(world, bufferedByRoom, producers);
  const recovery = recoveryAssignments(world, bufferedByRoom, producers);

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

    const roomBuffers = bufferedByRoom.get(roomName) ?? [];
    const producer = producers.get(creep.name);
    const surplusTransport =
      roomBuffers.length > 0 &&
      !producer &&
      !transporters.has(creep.name) &&
      capabilities.has("haul") &&
      !capabilities.has("harvest");
    if (producer) {
      if (energy < capacity && producer.source.energy > 0) {
        intents.push({
          type: "harvest",
          creepName: creep.name,
          sourceId: producer.source.id,
          priority: 1100,
          reason: "produce continuously into the assigned source buffer",
          trace: energyTrace(roomName, "extract-source-energy"),
        });
        continue;
      }

      if (energy > 0 && producer.container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: producer.container.id,
          resource: RESOURCE_ENERGY,
          priority: 1075,
          reason: "buffer completed producer load at the source edge",
          trace: energyTrace(roomName, "buffer-source-energy"),
        });
        continue;
      }
    }

    if (
      !producer &&
      roomBuffers.length > 0 &&
      energyMode === "collect" &&
      capabilities.has("haul")
    ) {
      const assigned = transporters.get(creep.name);
      if (assigned?.container.store.getUsedCapacity(RESOURCE_ENERGY)) {
        intents.push({
          type: "withdraw",
          creepName: creep.name,
          targetId: assigned.container.id,
          resource: RESOURCE_ENERGY,
          priority: 1050,
          reason: "collect from the assigned source buffer",
          trace: energyTrace(roomName, "withdraw-buffered-energy"),
        });
        continue;
      }

      const recoverySource = recovery.get(creep.name);
      if (surplusTransport) {
        const spawn = spatial.myStructures.find(
          (structure): structure is StructureSpawn => structure.structureType === STRUCTURE_SPAWN,
        );
        if (spawn) {
          intents.push({
            type: "move",
            creepName: creep.name,
            targetId: spawn.id,
            range: 2,
            priority: 200,
            reason: "park surplus transport capacity away from the source edge",
            trace: energyTrace(roomName, "park-surplus-transport"),
          });
          continue;
        }
      }

      if (!recoverySource && assigned) {
        intents.push({
          type: "move",
          creepName: creep.name,
          targetId: assigned.container.id,
          range: 1,
          priority: 1025,
          reason: "stage at assigned source buffer while awaiting production",
          trace: energyTrace(roomName, "stage-source-transport"),
        });
        continue;
      }

      if (energy > 0) {
        energyMode = "deliver";
        creep.memory.energyMode = energyMode;
      }
    }

    if (energyMode === "collect" && capabilities.has("harvest")) {
      const source =
        roomBuffers.length > 0
          ? recovery.get(creep.name)
          : world.spatial.nearest(
              creep.pos,
              spatial.sources.filter((candidate) => candidate.energy > 0),
            );

      if (source?.energy && source.energy > 0) {
        intents.push({
          type: "harvest",
          creepName: creep.name,
          sourceId: source.id,
          priority: 1000,
          reason:
            roomBuffers.length > 0
              ? "supplement under-covered source without crowding the mining edge"
              : "complete collection cycle before delivery",
          trace: energyTrace(roomName, "extract-source-energy"),
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
          trace: energyTrace(roomName, "fund-workforce-energy"),
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
          trace: defenseTrace(roomName),
        });
        continue;
      }
    }

    if (energyMode === "deliver" && energy > 0 && capabilities.has("build")) {
      const roomPlan = Memory.colonies[roomName]?.roomPlan;
      const site = spatial.constructionSites
        .map((candidate) => ({
          site: candidate,
          target: {
            id: candidate.id,
            x: candidate.pos.x,
            y: candidate.pos.y,
            structureType: candidate.structureType,
            range: creep.pos.getRangeTo(candidate),
          },
        }))
        .sort((left, right) => compareConstructionTargets(roomPlan, left.target, right.target))[0]
        ?.site;
      if (site) {
        intents.push({
          type: "build",
          creepName: creep.name,
          targetId: site.id,
          priority: 700,
          reason: "spend delivery-cycle surplus on the highest-value planned infrastructure",
          trace: constructionTrace(
            roomName,
            "realize-planned-infrastructure",
            "build-planned-infrastructure",
          ),
        });
        continue;
      }
    }

    if (energyMode === "deliver" && energy > 0 && capabilities.has("repair")) {
      const controllerLevel = creep.room.controller?.level;
      const repairTargets = spatial.structures.filter((structure) =>
        needsBootstrapRepair(structure, controllerLevel),
      );
      const repairTarget = world.spatial.nearest(creep.pos, repairTargets);
      if (repairTarget) {
        intents.push({
          type: "repair",
          creepName: creep.name,
          targetId: repairTarget.id,
          priority: 500,
          reason: "spend delivery-cycle surplus restoring bootstrap infrastructure",
          trace: constructionTrace(
            roomName,
            "maintain-infrastructure-condition",
            "repair-infrastructure",
          ),
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
        trace: controllerTrace(roomName),
      });
      continue;
    }

    if (surplusTransport) {
      const spawn = spatial.myStructures.find(
        (structure): structure is StructureSpawn => structure.structureType === STRUCTURE_SPAWN,
      );
      if (spawn) {
        intents.push({
          type: "move",
          creepName: creep.name,
          targetId: spawn.id,
          range: 2,
          priority: 200,
          reason: "park surplus transport capacity away from the source edge",
          trace: energyTrace(roomName, "park-surplus-transport"),
        });
      }
    }
  }

  return intents;
}
