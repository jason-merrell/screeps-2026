import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import { compareConstructionTargets } from "../../planning/construction-priority";
import type { FspmActivityRecord } from "../../planning/fspm";
import { isDevelopmentEvidenceStructure } from "../../planning/room-development";
import { usableRoomPlanProjection } from "../../planning/room-plan-projection";
import type { WorldSnapshot } from "../../runtime/context";
import { capabilitiesOf } from "../../workforce/capabilities";
import {
  creepMeetsSourceProducerBody,
  creepRoadBaggageParts,
  creepRoadCarryCapacity,
  creepSourceProducerSurplus,
  sourceProducerBodyForCapacity,
} from "../spawning/workforce";
import {
  plannedSourceRouteLength,
  requiredCarryParts,
  reserveTransportCapacity,
  shouldActivateSourceBuffers,
} from "./logistics";
import {
  assessMatureLinkTopology,
  matureSourceLinkRouting,
} from "./mature-energy";
import { infrastructureRepairThreshold } from "./repair-policy";
import {
  assignRecoveryHarvesters,
  assignSourceProducers,
} from "./source-allocation";

const PEACETIME_TOWER_RESERVE = 400;
const STRATEGIC_REPAIR_TYPES: ReadonlySet<StructureConstant> = new Set([
  "spawn",
  "extension",
  "tower",
  "storage",
  "terminal",
  "link",
  "lab",
  "factory",
  "observer",
  "powerSpawn",
  "nuker",
  "extractor",
]);

function operationalRoomPlan(roomName: string) {
  const projection = usableRoomPlanProjection(
    Memory.colonies[roomName],
    roomName,
  );
  return projection.usable ? projection.plan : undefined;
}

export type EnergyMode = "collect" | "deliver";
export type EnergyDeliveryService = "reproduction" | "tower";
export type InfrastructureWorkService = "build" | "repair";

interface BufferedSource {
  source: Source;
  container: StructureContainer;
  link?: StructureLink;
  sourceIndex: number;
}

interface ActivityWithTarget extends FspmActivityRecord {
  currentTargetKey?: string;
}

declare global {
  interface CreepMemory {
    energyMode?: EnergyMode;
    matureEnergyPurpose?: "controller-link";
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
  return shouldActivateSourceBuffers(
    controllerLevel,
    workforceCount,
    sourceCount,
  );
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

/** Defensive continuity outranks reproduction only while a visible threat exists. */
export function energyDeliveryServiceOrder(
  underAttack: boolean,
): readonly EnergyDeliveryService[] {
  return underAttack ? ["tower", "reproduction"] : ["reproduction", "tower"];
}

/** Active defense repairs outrank new construction; peacetime preserves growth. */
export function infrastructureWorkServiceOrder(
  underAttack: boolean,
): readonly InfrastructureWorkService[] {
  return underAttack ? ["repair", "build"] : ["build", "repair"];
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

function needsInfrastructureRepair(
  structure: AnyStructure,
  controllerLevel: number | undefined,
  underAttack: boolean,
): boolean {
  if (!("hits" in structure) || !("hitsMax" in structure)) return false;
  if (
    shouldDeferRoutineBootstrapRepair(controllerLevel, structure.structureType)
  )
    return false;
  return (
    structure.hits <
    infrastructureRepairThreshold(
      structure.structureType,
      structure.hitsMax,
      controllerLevel,
      underAttack,
    )
  );
}

export interface InfrastructureRepairSelectionContext {
  readonly controllerLevel: number | undefined;
  readonly underAttack: boolean;
  readonly perimeter: readonly { readonly x: number; readonly y: number }[];
  readonly hostiles: readonly {
    readonly pos: { readonly x: number; readonly y: number };
  }[];
  readonly origin: { readonly x: number; readonly y: number };
}

interface ScoredRepairTarget {
  readonly structure: AnyStructure;
  readonly threatClass: number;
  readonly targetRatio: number;
  readonly hostileRange: number;
  readonly workerRange: number;
}

function chebyshevRange(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/**
 * Select owned/neutral repair evidence deterministically. During an attack the
 * planned perimeter is restored first, strategic assets second, and routine
 * roads/containers last; condition and hostile exposure break ties before
 * worker convenience.
 */
export function selectInfrastructureRepairTarget(
  structures: readonly AnyStructure[],
  context: InfrastructureRepairSelectionContext,
): AnyStructure | null {
  const perimeter = new Set(
    context.perimeter.map((point) => `${point.x}:${point.y}`),
  );
  const scored = structures.flatMap((structure): ScoredRepairTarget[] => {
    if (
      !isDevelopmentEvidenceStructure(structure) ||
      !needsInfrastructureRepair(
        structure,
        context.controllerLevel,
        context.underAttack,
      ) ||
      !("hits" in structure) ||
      !("hitsMax" in structure)
    ) {
      return [];
    }
    const target = infrastructureRepairThreshold(
      structure.structureType,
      structure.hitsMax,
      context.controllerLevel,
      context.underAttack,
    );
    if (target <= 0) return [];
    const onPerimeter =
      structure.structureType === "rampart" &&
      perimeter.has(`${structure.pos.x}:${structure.pos.y}`);
    const routine =
      structure.structureType === "road" ||
      structure.structureType === "container";
    const strategic = STRATEGIC_REPAIR_TYPES.has(structure.structureType);
    const threatClass = onPerimeter ? 0 : strategic ? 1 : routine ? 3 : 2;
    const hostileRange = context.hostiles.reduce(
      (nearest, hostile) =>
        Math.min(nearest, chebyshevRange(structure.pos, hostile.pos)),
      Number.POSITIVE_INFINITY,
    );
    return [
      {
        structure,
        threatClass,
        targetRatio: structure.hits / target,
        hostileRange,
        workerRange: chebyshevRange(context.origin, structure.pos),
      },
    ];
  });

  scored.sort((left, right) => {
    if (context.underAttack) {
      const threatPriority = left.threatClass - right.threatClass;
      if (threatPriority !== 0) return threatPriority;
    }
    return (
      left.targetRatio - right.targetRatio ||
      left.threatClass - right.threatClass ||
      left.hostileRange - right.hostileRange ||
      left.workerRange - right.workerRange ||
      left.structure.id.localeCompare(right.structure.id)
    );
  });
  return scored[0]?.structure ?? null;
}

function towerNeedsReserve(
  tower: StructureTower,
  underAttack: boolean,
): boolean {
  const capacity = tower.store.getCapacity(RESOURCE_ENERGY);
  if (capacity === null) return false;

  const target = underAttack
    ? capacity
    : Math.min(PEACETIME_TOWER_RESERVE, capacity);
  return tower.store.getUsedCapacity(RESOURCE_ENERGY) < target;
}

function bufferedSources(room: Room): BufferedSource[] {
  const plan = operationalRoomPlan(room.name);
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

  const sourceLinkBySource = new Map(
    matureSourceLinkRouting(room, plan)
      .filter((status) => status.operational)
      .map((status) => [status.sourceId, status.link] as const),
  );

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
    if (container) {
      const link = sourceLinkBySource.get(anchor.sourceId);
      buffered.push({
        source,
        container,
        sourceIndex,
        ...(link ? { link } : {}),
      });
    }
  }
  return buffered;
}

function builtControllerLink(room: Room): StructureLink | undefined {
  const plan = operationalRoomPlan(room.name);
  if (!plan) return undefined;
  const role = assessMatureLinkTopology(plan).roles?.controllerPlanId;
  if (!role) return undefined;
  const planned = plan.structures.find(
    (structure) => structure.id === role && structure.structureType === "link",
  );
  if (!planned) return undefined;
  const links = room
    .lookForAt(LOOK_STRUCTURES, planned.x, planned.y)
    .filter(
      (structure): structure is StructureLink =>
        structure.structureType === STRUCTURE_LINK && structure.my,
    );
  return links.length === 1 ? links[0] : undefined;
}

function controllerLinkCollectors(
  world: WorldSnapshot,
  producers: ReadonlyMap<string, BufferedSource>,
  transporters: ReadonlyMap<string, BufferedSource>,
  recovery: ReadonlyMap<string, Source>,
): Map<string, StructureLink> {
  const assignments = new Map<string, StructureLink>();
  for (const room of world.rooms) {
    const link = builtControllerLink(room);
    if (!link || link.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) continue;
    const candidate = world.creeps
      .filter(
        (creep) =>
          !creep.spawning &&
          creep.room.name === room.name &&
          !producers.has(creep.name) &&
          !transporters.has(creep.name) &&
          !recovery.has(creep.name) &&
          creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 &&
          creep.getActiveBodyparts(WORK) > 0 &&
          creep.getActiveBodyparts(CARRY) > 0,
      )
      .sort(
        (left, right) =>
          left.pos.getRangeTo(link) - right.pos.getRangeTo(link) ||
          left.name.localeCompare(right.name),
      )[0];
    if (candidate) assignments.set(candidate.name, link);
  }
  return assignments;
}

function preferredProducerSourceId(
  roomName: string,
  creepName: string,
): string | undefined {
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
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
    )[0] as ActivityWithTarget | undefined;

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
    const producerBody = sourceProducerBodyForCapacity(
      room.energyCapacityAvailable,
    );

    const candidates = world.creeps
      .filter((creep) => {
        if (creep.spawning || creep.room.name !== room.name) return false;
        const capabilities = capabilitiesOf(creep);
        return (
          capabilities.has("harvest") &&
          capabilities.has("haul") &&
          creepMeetsSourceProducerBody(creep, producerBody)
        );
      })
      .map((creep) => ({
        name: creep.name,
        surplusParts: creepSourceProducerSurplus(creep, producerBody),
        work: creep.getActiveBodyparts(WORK),
        preferredSourceId: preferredProducerSourceId(room.name, creep.name),
        rangeBySource: Object.fromEntries(
          buffered.map((node) => [
            node.source.id,
            creep.pos.getRangeTo(node.source),
          ]),
        ),
      }));

    const nodeBySourceId = new Map(
      buffered.map((node) => [node.source.id, node]),
    );
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
    const buffered = (bufferedByRoom.get(room.name) ?? []).filter(
      (node) => !node.link,
    );
    if (buffered.length === 0) continue;

    const plan = operationalRoomPlan(room.name);
    if (!plan) continue;

    const candidates = world.creeps
      .filter((creep) => {
        if (
          creep.spawning ||
          creep.room.name !== room.name ||
          producers.has(creep.name)
        ) {
          return false;
        }
        return (
          capabilitiesOf(creep).has("haul") && creepRoadCarryCapacity(creep) > 0
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const producerByContainer = new Map(
      [...producers.entries()].map(([creepName, node]) => [
        node.container.id,
        Game.creeps[creepName],
      ]),
    );
    const reservations = reserveTransportCapacity(
      buffered.flatMap((node) => {
        const producer = producerByContainer.get(node.container.id);
        if (!producer) return [];
        return [
          {
            id: node.container.id,
            requiredCarry: requiredCarryParts(
              plannedSourceRouteLength(plan, node.sourceIndex),
              producer.getActiveBodyparts(WORK) * HARVEST_POWER,
            ),
          },
        ];
      }),
      candidates.map((creep) => ({
        baggage: creepRoadBaggageParts(creep),
        name: creep.name,
        carry: creepRoadCarryCapacity(creep),
        rangeByNode: Object.fromEntries(
          buffered.map((node) => [
            node.container.id,
            creep.pos.getRangeTo(node.container),
          ]),
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
      buffered.some(
        (node) => node.container.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      )
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
        (assignedProducerWork.get(node.source.id) ?? 0) +
          creep.getActiveBodyparts(WORK),
      );
    }

    const candidates = world.creeps
      .filter((creep) => {
        if (
          creep.spawning ||
          creep.room.name !== room.name ||
          producers.has(creep.name)
        )
          return false;
        const capabilities = capabilitiesOf(creep);
        const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
        const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? energy;
        return (
          capabilities.has("harvest") &&
          capabilities.has("haul") &&
          resolveEnergyMode(creep.memory.energyMode, energy, capacity) ===
            "collect"
        );
      })
      .map((creep) => ({
        name: creep.name,
        work: creep.getActiveBodyparts(WORK),
        rangeBySource: Object.fromEntries(
          buffered.map((node) => [
            node.source.id,
            creep.pos.getRangeTo(node.source),
          ]),
        ),
      }));

    const sourceById = new Map(
      buffered.map((node) => [node.source.id, node.source]),
    );
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
  const controllerCollectors = controllerLinkCollectors(
    world,
    producers,
    transporters,
    recovery,
  );

  for (const creep of world.creeps) {
    if (creep.spawning) continue;

    const roomName = creep.room.name;
    const spatial = world.spatial.byRoom[roomName];
    if (!spatial) continue;
    const underAttack = spatial.hostiles.length > 0;

    const capabilities = capabilitiesOf(creep);
    const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? energy;
    let energyMode = resolveEnergyMode(
      creep.memory.energyMode,
      energy,
      capacity,
    );
    creep.memory.energyMode = energyMode;
    if (creep.memory.matureEnergyPurpose === "controller-link" && energy <= 0) {
      delete creep.memory.matureEnergyPurpose;
    }

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

      const producerBuffer =
        producer.link &&
        producer.link.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          ? producer.link
          : producer.container;
      if (
        energy > 0 &&
        producerBuffer.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: producerBuffer.id,
          resource: RESOURCE_ENERGY,
          priority: 1075,
          reason:
            producerBuffer.structureType === STRUCTURE_LINK
              ? "inject completed producer load into the governed source link"
              : "buffer completed producer load at the source edge",
          trace: energyTrace(roomName, "buffer-source-energy"),
        });
        continue;
      }
    }

    const controllerCollector = controllerCollectors.get(creep.name);
    if (
      controllerCollector &&
      energyMode === "collect" &&
      energy <= 0 &&
      capacity > 0
    ) {
      const amount = Math.min(
        capacity,
        controllerCollector.store.getUsedCapacity(RESOURCE_ENERGY),
      );
      if (amount > 0) {
        creep.memory.matureEnergyPurpose = "controller-link";
        intents.push({
          type: "withdraw",
          creepName: creep.name,
          targetId: controllerCollector.id,
          resource: RESOURCE_ENERGY,
          amount,
          priority: 925,
          reason:
            "collect the governed controller-link load for local controller service",
          trace: energyTrace(roomName, "withdraw-buffered-energy"),
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
          (structure): structure is StructureSpawn =>
            structure.structureType === STRUCTURE_SPAWN,
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
          priority: 150,
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
      const reproductionTarget = world.spatial.nearest(
        creep.pos,
        reproductionTargets,
      );

      const towers = spatial.myStructures.filter(
        (structure): structure is StructureTower =>
          structure.structureType === STRUCTURE_TOWER &&
          towerNeedsReserve(structure as StructureTower, underAttack),
      );
      const tower = world.spatial.nearest(creep.pos, towers);
      const selectedService = energyDeliveryServiceOrder(underAttack).find(
        (service) =>
          service === "tower"
            ? tower !== undefined
            : reproductionTarget !== undefined,
      );

      if (selectedService === "reproduction" && reproductionTarget) {
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

      if (selectedService === "tower" && tower) {
        intents.push({
          type: "transfer",
          creepName: creep.name,
          targetId: tower.id,
          resource: RESOURCE_ENERGY,
          priority: underAttack ? 1_100 : 800,
          reason: underAttack
            ? "fill defensive tower during active threat"
            : "maintain bounded peacetime tower reserve",
          trace: defenseTrace(roomName),
        });
        continue;
      }
    }

    if (energyMode === "deliver" && energy > 0) {
      if (
        creep.memory.matureEnergyPurpose === "controller-link" &&
        capabilities.has("upgrade") &&
        creep.room.controller?.my
      ) {
        intents.push({
          type: "upgrade",
          creepName: creep.name,
          controllerId: creep.room.controller.id,
          priority: 750,
          reason:
            "convert the governed controller-link load into controller progress",
          trace: controllerTrace(roomName),
        });
        continue;
      }

      const roomPlan = operationalRoomPlan(roomName);
      const site = capabilities.has("build")
        ? spatial.constructionSites
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
            .sort((left, right) =>
              compareConstructionTargets(roomPlan, left.target, right.target, {
                underAttack,
              }),
            )[0]?.site
        : undefined;
      const controllerLevel = creep.room.controller?.level;
      const repairTarget = capabilities.has("repair")
        ? selectInfrastructureRepairTarget(spatial.structures, {
            controllerLevel,
            underAttack,
            perimeter: roomPlan?.defense.perimeter ?? [],
            hostiles: spatial.hostiles,
            origin: creep.pos,
          })
        : null;
      const selectedService = infrastructureWorkServiceOrder(underAttack).find(
        (service) =>
          service === "repair" ? repairTarget !== null : site !== undefined,
      );

      if (selectedService === "repair" && repairTarget) {
        intents.push({
          type: "repair",
          creepName: creep.name,
          targetId: repairTarget.id,
          priority: underAttack ? 900 : 500,
          reason: underAttack
            ? "restore the defensive envelope before expanding infrastructure"
            : "spend delivery-cycle surplus restoring governed colony infrastructure",
          trace: constructionTrace(
            roomName,
            "maintain-infrastructure-condition",
            "repair-infrastructure",
          ),
        });
        continue;
      }

      if (selectedService === "build" && site) {
        intents.push({
          type: "build",
          creepName: creep.name,
          targetId: site.id,
          priority: 700,
          reason:
            "spend delivery-cycle surplus on the highest-value planned infrastructure",
          trace: constructionTrace(
            roomName,
            "realize-planned-infrastructure",
            "build-planned-infrastructure",
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
        reason:
          "finish delivery cycle by investing surplus energy in controller progression",
        trace: controllerTrace(roomName),
      });
      continue;
    }

    if (surplusTransport) {
      const spawn = spatial.myStructures.find(
        (structure): structure is StructureSpawn =>
          structure.structureType === STRUCTURE_SPAWN,
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
