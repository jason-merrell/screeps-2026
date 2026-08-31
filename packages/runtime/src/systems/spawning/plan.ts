import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { ColonyMemory } from "../../memory/schema";
import { usableRoomPlanProjection } from "../../planning/room-plan-projection";
import type { WorldSnapshot } from "../../runtime/context";
import {
  plannedSourceRouteLength,
  requiredCarryParts,
  reserveTransportCapacity,
} from "../economy/logistics";
import { matureSourceLinkRouting } from "../economy/mature-energy";
import {
  activeCreepParts,
  bodyCost,
  creepHasLoadedRoadMobility,
  creepMeetsSourceProducerBody,
  creepRoadCarryCapacity,
  creepSourceProducerSurplus,
  desiredBootstrapWorkforce,
  ENERGY_PER_WORK_HARVEST,
  GENERALIST_UNIT_COST,
  generalistBodyBudgetForDemand,
  generalistBodyForCapacity,
  replacementLeadTicks,
  sourceProducerBodyForCapacity,
  transporterBodyForCapacity,
  transporterFleetForCarryDemand,
} from "./workforce";

interface LogisticsSpawnNeed {
  body: BodyPartConstant[];
  procedure: "staff-source-production" | "staff-transport-capacity";
  namePrefix: string;
  priority: number;
  reason: string;
}

interface ProjectedCreep {
  readonly name: string;
  readonly body: readonly BodyPartConstant[];
}

interface LogisticsCandidate {
  readonly id: string;
  readonly surplusParts: number;
  readonly work: number;
}

interface TransportCandidate {
  readonly baggage: number;
  readonly carry: number;
  readonly id: string;
  readonly rangeByNode: Record<string, number>;
}

interface LogisticsTransportNode {
  readonly id: string;
  readonly requiredCarry: number;
  readonly x: number;
  readonly y: number;
}

export interface WorkforceCapabilityCoverage {
  readonly available: number;
  readonly required: number;
}

export interface WorkforceReadinessAssessment {
  readonly desiredGeneralists: number;
  readonly generalistCarryCoverage: WorkforceCapabilityCoverage;
  readonly generalistMoveCoverage: WorkforceCapabilityCoverage;
  readonly generalistWorkCoverage: WorkforceCapabilityCoverage;
  readonly logisticsStatus:
    | "not-required"
    | "projection-unavailable"
    | "required";
  readonly producerCoverage: WorkforceCapabilityCoverage | null;
  readonly recurringReplacementEnergy: number;
  readonly replacementBudgetEnergy: number;
  readonly replacementBudgetStatus:
    | "minimum-survival-exception"
    | "within-budget";
  readonly transportCarryCoverage: WorkforceCapabilityCoverage | null;
  readonly viableGeneralists: number;
  readonly viablePopulation: number;
}

interface LogisticsCoverage {
  readonly logisticsStatus: WorkforceReadinessAssessment["logisticsStatus"];
  readonly need: LogisticsSpawnNeed | null;
  readonly producerCoverage: WorkforceCapabilityCoverage | null;
  readonly reservedCreepNames: ReadonlySet<string>;
  readonly transportCarryCoverage: WorkforceCapabilityCoverage | null;
}

interface LogisticsRequirement {
  readonly logisticsStatus: WorkforceReadinessAssessment["logisticsStatus"];
  readonly maxSourceRouteLength: number;
  readonly producerBody: BodyPartConstant[];
  readonly producerCount: number;
  readonly requiredCarry: number;
  readonly specializedReplacementEnergy: number;
  readonly transportNodes: readonly LogisticsTransportNode[];
}

interface GeneralistCapacity {
  actors: number;
  carry: number;
  move: number;
  work: number;
}

function workforceTrace(roomName: string, procedure: string) {
  return createIntentTrace({
    roomName,
    domain: "spawning",
    task: "maintain-workforce-capacity",
    procedure,
  });
}

function liveSourceBufferIndices(
  room: Room,
  plan: NonNullable<ColonyMemory["roomPlan"]>,
): number[] {
  const live: number[] = [];
  for (const [index, anchor] of plan.anchors.sources.entries()) {
    const hasContainer = room
      .lookForAt(LOOK_STRUCTURES, anchor.container.x, anchor.container.y)
      .some((structure) => structure.structureType === STRUCTURE_CONTAINER);
    if (hasContainer) live.push(index);
  }
  return live;
}

function activeParts(creep: Creep, part: BodyPartConstant): number {
  return activeCreepParts(creep, part);
}

function bodyParts(
  body: readonly BodyPartConstant[],
  part: BodyPartConstant,
): number {
  return body.filter((bodyPart) => bodyPart === part).length;
}

function bodyRoadCarryCapacity(body: readonly BodyPartConstant[]): number {
  const carry = bodyParts(body, CARRY);
  const baggage = body.filter((part) => part !== MOVE && part !== CARRY).length;
  return Math.min(carry, Math.max(0, bodyParts(body, MOVE) * 2 - baggage));
}

function bodyHasRoadMobility(body: readonly BodyPartConstant[]): boolean {
  return bodyRoadCarryCapacity(body) >= bodyParts(body, CARRY);
}

export function requiredSourceTransportCarry(
  room: Room,
  plan: NonNullable<ColonyMemory["roomPlan"]>,
  sourceIndices: readonly number[],
): number {
  const producerBody = sourceProducerBodyForCapacity(
    room.energyCapacityAvailable,
  );
  const sourceEnergyPerTick =
    bodyParts(producerBody, WORK) * ENERGY_PER_WORK_HARVEST;
  const linkCoverageBySource = new Map(
    matureSourceLinkRouting(room, plan).map(
      (status) => [status.sourceId, status.transportCoverage] as const,
    ),
  );
  return sourceIndices.reduce((total, sourceIndex) => {
    const fullRequirement = requiredCarryParts(
      plannedSourceRouteLength(plan, sourceIndex),
      sourceEnergyPerTick,
    );
    const sourceId = plan.anchors.sources[sourceIndex]?.sourceId;
    const coverage = sourceId ? (linkCoverageBySource.get(sourceId) ?? 0) : 0;
    return total + Math.ceil(fullRequirement * (1 - coverage));
  }, 0);
}

function logisticsRequirement(room: Room): LogisticsRequirement {
  const projection = usableRoomPlanProjection(
    Memory.colonies[room.name],
    room.name,
  );
  if (!projection.usable) {
    return {
      logisticsStatus: "projection-unavailable",
      maxSourceRouteLength: 0,
      producerBody: [],
      producerCount: 0,
      requiredCarry: 0,
      specializedReplacementEnergy: 0,
      transportNodes: [],
    };
  }
  const plan = projection.plan;

  const bufferIndices = liveSourceBufferIndices(room, plan);
  if (bufferIndices.length === 0) {
    return {
      logisticsStatus: "not-required",
      maxSourceRouteLength: 0,
      producerBody: [],
      producerCount: 0,
      requiredCarry: 0,
      specializedReplacementEnergy: 0,
      transportNodes: [],
    };
  }

  const producerBody = sourceProducerBodyForCapacity(
    room.energyCapacityAvailable,
  );
  const sourceEnergyPerTick =
    bodyParts(producerBody, WORK) * ENERGY_PER_WORK_HARVEST;
  const linkCoverageBySource = new Map(
    matureSourceLinkRouting(room, plan).map(
      (status) => [status.sourceId, status.transportCoverage] as const,
    ),
  );
  const transportNodes = bufferIndices
    .map((sourceIndex): LogisticsTransportNode | null => {
      const anchor = plan.anchors.sources[sourceIndex];
      if (!anchor) return null;
      const fullRequirement = requiredCarryParts(
        plannedSourceRouteLength(plan, sourceIndex),
        sourceEnergyPerTick,
      );
      const requiredCarry = Math.ceil(
        fullRequirement *
          (1 - (linkCoverageBySource.get(anchor.sourceId) ?? 0)),
      );
      return {
        id: `source:${anchor.sourceId}`,
        requiredCarry,
        x: anchor.container.x,
        y: anchor.container.y,
      };
    })
    .filter(
      (node): node is LogisticsTransportNode =>
        node !== null && node.requiredCarry > 0,
    );
  const requiredCarry = transportNodes.reduce(
    (total, node) => total + node.requiredCarry,
    0,
  );
  const maxSourceRouteLength = Math.max(
    0,
    ...bufferIndices.map((sourceIndex) =>
      plannedSourceRouteLength(plan, sourceIndex),
    ),
  );
  const transportBodies = transportNodes.flatMap((node) =>
    transporterFleetForCarryDemand(
      room.energyCapacityAvailable,
      node.requiredCarry,
    ),
  );
  return {
    logisticsStatus: "required",
    maxSourceRouteLength,
    producerBody,
    producerCount: bufferIndices.length,
    requiredCarry,
    specializedReplacementEnergy:
      bufferIndices.length * bodyCost(producerBody) +
      transportBodies.reduce((total, body) => total + bodyCost(body), 0),
    transportNodes,
  };
}

function logisticsCoverage(
  room: Room,
  requirement: LogisticsRequirement,
  roomCreeps: Creep[],
  projectedCreeps: readonly ProjectedCreep[],
): LogisticsCoverage {
  if (requirement.logisticsStatus !== "required") {
    const unverifiable =
      requirement.logisticsStatus === "projection-unavailable";
    return {
      logisticsStatus: requirement.logisticsStatus,
      need: null,
      producerCoverage: unverifiable ? null : { available: 0, required: 0 },
      reservedCreepNames: new Set(),
      transportCarryCoverage: unverifiable
        ? null
        : { available: 0, required: 0 },
    };
  }

  const producerBody = requirement.producerBody;
  const producerLead =
    replacementLeadTicks(producerBody) + requirement.maxSourceRouteLength;
  const targetProducerWork = producerBody.filter(
    (part) => part === WORK,
  ).length;
  const targetProducerCarry = producerBody.filter(
    (part) => part === CARRY,
  ).length;
  const targetProducerMove = producerBody.filter(
    (part) => part === MOVE,
  ).length;
  const producerCandidates: LogisticsCandidate[] = [
    ...roomCreeps
      .filter(
        (creep) =>
          (creep.spawning ||
            (creep.ticksToLive ?? CREEP_LIFE_TIME) > producerLead) &&
          creepMeetsSourceProducerBody(creep, producerBody),
      )
      .map((creep) => ({
        id: creep.name,
        surplusParts: creepSourceProducerSurplus(creep, producerBody),
        work: activeParts(creep, WORK),
      })),
    ...projectedCreeps
      .filter(
        (creep) =>
          bodyParts(creep.body, WORK) >= targetProducerWork &&
          bodyParts(creep.body, CARRY) >= targetProducerCarry &&
          bodyParts(creep.body, MOVE) >= targetProducerMove &&
          bodyHasRoadMobility(creep.body),
      )
      .map((creep) => ({
        id: creep.name,
        surplusParts:
          bodyParts(creep.body, WORK) -
          targetProducerWork +
          (bodyParts(creep.body, CARRY) - targetProducerCarry) +
          (bodyParts(creep.body, MOVE) - targetProducerMove),
        work: bodyParts(creep.body, WORK),
      })),
  ].sort(
    (a, b) =>
      a.surplusParts - b.surplusParts ||
      b.work - a.work ||
      a.id.localeCompare(b.id),
  );

  const reservedProducers = new Set(
    producerCandidates
      .slice(0, requirement.producerCount)
      .map((creep) => creep.id),
  );
  const requiredCarry = requirement.requiredCarry;
  const transporterBody =
    requirement.transportNodes
      .map((node) =>
        transporterBodyForCapacity(
          room.energyCapacityAvailable,
          node.requiredCarry,
        ),
      )
      .sort((left, right) => right.length - left.length)[0] ?? [];
  const transporterLead =
    replacementLeadTicks(transporterBody) + requirement.maxSourceRouteLength;
  const transportCandidates: TransportCandidate[] = [
    ...roomCreeps
      .filter(
        (creep) =>
          (creep.spawning ||
            (creep.ticksToLive ?? CREEP_LIFE_TIME) > transporterLead) &&
          !reservedProducers.has(creep.name),
      )
      .map((creep) => ({
        baggage: creep.body.filter(
          (part) => part.type !== CARRY && part.type !== MOVE,
        ).length,
        id: creep.name,
        carry: creepRoadCarryCapacity(creep),
        rangeByNode: Object.fromEntries(
          requirement.transportNodes.map((node) => [
            node.id,
            Math.max(
              Math.abs(creep.pos.x - node.x),
              Math.abs(creep.pos.y - node.y),
            ),
          ]),
        ),
      })),
    ...projectedCreeps
      .filter((creep) => !reservedProducers.has(creep.name))
      .map((creep) => ({
        baggage: creep.body.filter((part) => part !== CARRY && part !== MOVE)
          .length,
        id: creep.name,
        carry: bodyRoadCarryCapacity(creep.body),
        rangeByNode: Object.fromEntries(
          requirement.transportNodes.map((node) => [node.id, 0]),
        ),
      })),
  ]
    .filter((candidate) => candidate.carry > 0)
    .sort(
      (left, right) =>
        left.baggage - right.baggage ||
        right.carry - left.carry ||
        left.id.localeCompare(right.id),
    );
  const candidateById = new Map(
    transportCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const reservations = reserveTransportCapacity(
    requirement.transportNodes.map((node) => ({
      id: node.id,
      requiredCarry: node.requiredCarry,
    })),
    transportCandidates.map((candidate) => ({
      baggage: candidate.baggage,
      carry: candidate.carry,
      name: candidate.id,
      rangeByNode: candidate.rangeByNode,
    })),
  );
  const reservedCreepNames = new Set(reservedProducers);
  const assignedCarryByNode = new Map<string, number>();
  for (const [creepName, nodeId] of reservations) {
    reservedCreepNames.add(creepName);
    assignedCarryByNode.set(
      nodeId,
      (assignedCarryByNode.get(nodeId) ?? 0) +
        (candidateById.get(creepName)?.carry ?? 0),
    );
  }
  const availableCarry = requirement.transportNodes.reduce(
    (total, node) =>
      total +
      Math.min(node.requiredCarry, assignedCarryByNode.get(node.id) ?? 0),
    0,
  );
  const uncoveredTransportNode = requirement.transportNodes.find(
    (node) => (assignedCarryByNode.get(node.id) ?? 0) < node.requiredCarry,
  );
  const producerCoverage = {
    available: producerCandidates.length,
    required: requirement.producerCount,
  };
  const transportCarryCoverage = {
    available: availableCarry,
    required: requiredCarry,
  };
  const need: LogisticsSpawnNeed | null =
    producerCoverage.available < producerCoverage.required
      ? {
          body: producerBody,
          procedure: "staff-source-production",
          namePrefix: "producer",
          priority: 1500,
          reason: `source production coverage ${producerCoverage.available}/${producerCoverage.required}`,
        }
      : uncoveredTransportNode
        ? {
            body: transporterBodyForCapacity(
              room.energyCapacityAvailable,
              uncoveredTransportNode.requiredCarry -
                (assignedCarryByNode.get(uncoveredTransportNode.id) ?? 0),
            ),
            procedure: "staff-transport-capacity",
            namePrefix: "transport",
            priority: 1400,
            reason: `transport throughput ${transportCarryCoverage.available}/${transportCarryCoverage.required} CARRY parts`,
          }
        : null;
  return {
    logisticsStatus: "required",
    need,
    producerCoverage,
    reservedCreepNames,
    transportCarryCoverage,
  };
}

function generalistBodyForSharedEnergy(
  energyCapacity: number,
  remainingEnergy: number,
  remainingSpawns: number,
  workforceDeficit: number,
): BodyPartConstant[] {
  const affordableSlots = Math.floor(remainingEnergy / GENERALIST_UNIT_COST);
  if (affordableSlots <= 0) return [];
  const serviceSlots = Math.max(
    1,
    Math.min(remainingSpawns, workforceDeficit, affordableSlots),
  );
  const minimumReservedForLaterSpawns =
    GENERALIST_UNIT_COST * (serviceSlots - 1);
  const fairShare =
    Math.ceil(remainingEnergy / serviceSlots / GENERALIST_UNIT_COST) *
    GENERALIST_UNIT_COST;
  const budget = Math.min(
    energyCapacity,
    fairShare,
    remainingEnergy - minimumReservedForLaterSpawns,
  );
  return generalistBodyForCapacity(budget);
}

function viablePopulation(
  roomCreeps: readonly Creep[],
  projectedCreeps: readonly ProjectedCreep[],
  replacementLead: number,
): number {
  return (
    projectedCreeps.length +
    roomCreeps.filter(
      (creep) =>
        creep.spawning ||
        (creep.ticksToLive ?? CREEP_LIFE_TIME) > replacementLead,
    ).length
  );
}

function viableGeneralistCapacity(
  roomCreeps: readonly Creep[],
  projectedCreeps: readonly ProjectedCreep[],
  replacementLead: number,
  reservedCreepNames: ReadonlySet<string>,
): GeneralistCapacity {
  const capacity: GeneralistCapacity = {
    actors: 0,
    carry: 0,
    move: 0,
    work: 0,
  };
  const add = (
    work: number,
    carry: number,
    move: number,
    roadMobile: boolean,
  ): void => {
    if (work <= 0 || carry <= 0 || move <= 0 || !roadMobile) return;
    capacity.actors += 1;
    capacity.work += work;
    capacity.carry += carry;
    capacity.move += move;
  };

  for (const creep of projectedCreeps) {
    if (reservedCreepNames.has(creep.name)) continue;
    add(
      bodyParts(creep.body, WORK),
      bodyParts(creep.body, CARRY),
      bodyParts(creep.body, MOVE),
      bodyHasRoadMobility(creep.body),
    );
  }
  for (const creep of roomCreeps) {
    if (
      reservedCreepNames.has(creep.name) ||
      (!creep.spawning &&
        (creep.ticksToLive ?? CREEP_LIFE_TIME) <= replacementLead)
    ) {
      continue;
    }
    add(
      activeParts(creep, WORK),
      activeParts(creep, CARRY),
      activeParts(creep, MOVE),
      creepHasLoadedRoadMobility(creep),
    );
  }

  return capacity;
}

function targetGeneralistCapacity(
  body: readonly BodyPartConstant[],
  actors: number,
): GeneralistCapacity {
  return {
    actors,
    carry: bodyParts(body, CARRY) * actors,
    move: bodyParts(body, MOVE) * actors,
    work: bodyParts(body, WORK) * actors,
  };
}

function generalistCapacitySatisfied(
  available: GeneralistCapacity,
  required: GeneralistCapacity,
): boolean {
  return (
    available.actors >= required.actors &&
    available.work >= required.work &&
    available.carry >= required.carry &&
    available.move >= required.move
  );
}

function generalistBodyDeficit(
  available: GeneralistCapacity,
  required: GeneralistCapacity,
  body: readonly BodyPartConstant[],
): number {
  const workPerBody = Math.max(1, bodyParts(body, WORK));
  const carryPerBody = Math.max(1, bodyParts(body, CARRY));
  const movePerBody = Math.max(1, bodyParts(body, MOVE));
  return Math.max(
    0,
    required.actors - available.actors,
    Math.ceil(Math.max(0, required.work - available.work) / workPerBody),
    Math.ceil(Math.max(0, required.carry - available.carry) / carryPerBody),
    Math.ceil(Math.max(0, required.move - available.move) / movePerBody),
  );
}

function generalistDemandReason(
  available: GeneralistCapacity,
  required: GeneralistCapacity,
): string {
  if (available.actors < required.actors) {
    return `workforce demand ${available.actors}/${required.actors}`;
  }
  return `workforce capability demand WORK ${available.work}/${required.work}, CARRY ${available.carry}/${required.carry}, MOVE ${available.move}/${required.move}`;
}

/**
 * Read-only capability assessment shared by spawning and operational health.
 * Specialized producer and transport reservations cannot simultaneously count
 * as free WORK+CARRY generalist capacity.
 */
export function assessWorkforceReadiness(
  room: Room,
  roomCreeps: readonly Creep[],
): WorkforceReadinessAssessment {
  const projectedCreeps: readonly ProjectedCreep[] = [];
  const sourceCount = room.find(FIND_SOURCES).length;
  const desiredGeneralists = desiredBootstrapWorkforce(
    room.controller?.level ?? 1,
    sourceCount,
    room.find(FIND_MY_CONSTRUCTION_SITES).length,
  );
  const requirement = logisticsRequirement(room);
  const budget = generalistBodyBudgetForDemand(
    room.energyCapacityAvailable,
    sourceCount,
    desiredGeneralists,
    requirement.specializedReplacementEnergy,
  );
  const body = budget.body;
  const replacementLead = replacementLeadTicks(body);
  const logistics = logisticsCoverage(
    room,
    requirement,
    [...roomCreeps],
    projectedCreeps,
  );
  const generalists = viableGeneralistCapacity(
    roomCreeps,
    projectedCreeps,
    replacementLead,
    logistics.reservedCreepNames,
  );
  const target = targetGeneralistCapacity(body, desiredGeneralists);
  return {
    desiredGeneralists,
    generalistCarryCoverage: {
      available: generalists.carry,
      required: target.carry,
    },
    generalistMoveCoverage: {
      available: generalists.move,
      required: target.move,
    },
    generalistWorkCoverage: {
      available: generalists.work,
      required: target.work,
    },
    logisticsStatus: logistics.logisticsStatus,
    producerCoverage: logistics.producerCoverage,
    recurringReplacementEnergy: budget.recurringReplacementEnergy,
    replacementBudgetEnergy: budget.completeWorkforceReplacementBudget,
    replacementBudgetStatus: budget.status,
    transportCarryCoverage: logistics.transportCarryCoverage,
    viableGeneralists: generalists.actors,
    viablePopulation: viablePopulation(
      roomCreeps,
      projectedCreeps,
      replacementLead,
    ),
  };
}

function reserveUniqueCreepName(
  prefix: string,
  roomName: string,
  tick: number,
  reservedNames: Set<string>,
): string {
  const base = `${prefix}-${roomName}-${tick}`;
  let ordinal = 1;
  let candidate = `${base}-${ordinal}`;
  while (reservedNames.has(candidate)) {
    ordinal += 1;
    candidate = `${base}-${ordinal}`;
  }
  reservedNames.add(candidate);
  return candidate;
}

export function planSpawning(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];
  const reservedNames = new Set([
    ...world.creeps.map((creep) => creep.name),
    ...(typeof Game === "undefined" || !Game.creeps
      ? []
      : Object.keys(Game.creeps)),
  ]);

  for (const room of [...world.rooms].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const controllerLevel = room.controller?.level ?? 1;
    const sourceCount = room.find(FIND_SOURCES).length;
    const constructionSiteCount = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    const desired = desiredBootstrapWorkforce(
      controllerLevel,
      sourceCount,
      constructionSiteCount,
    );
    const requirement = logisticsRequirement(room);
    const targetGeneralistBody = generalistBodyBudgetForDemand(
      room.energyCapacityAvailable,
      sourceCount,
      desired,
      requirement.specializedReplacementEnergy,
    ).body;
    const targetGeneralistEnergy = bodyCost(targetGeneralistBody);
    const requiredGeneralistCapacity = targetGeneralistCapacity(
      targetGeneralistBody,
      desired,
    );

    const roomCreeps = world.creeps.filter(
      (creep) => creep.room.name === room.name,
    );
    const idleSpawns = world.spawns
      .filter((spawn) => spawn.room.name === room.name && !spawn.spawning)
      .sort((left, right) => left.name.localeCompare(right.name));
    const projectedCreeps: ProjectedCreep[] = [];
    let remainingEnergy = room.energyAvailable;

    for (const [spawnIndex, spawn] of idleSpawns.entries()) {
      const remainingSpawns = idleSpawns.length - spawnIndex;
      let body = targetGeneralistBody;
      let lead = replacementLeadTicks(body);
      const population = viablePopulation(roomCreeps, projectedCreeps, lead);

      if (population === 0) {
        body = generalistBodyForSharedEnergy(
          targetGeneralistEnergy,
          remainingEnergy,
          remainingSpawns,
          desired,
        );
        const cost = bodyCost(body);
        if (body.length === 0 || remainingEnergy < cost) continue;
        const name = reserveUniqueCreepName(
          "worker",
          room.name,
          world.tick,
          reservedNames,
        );

        intents.push({
          type: "spawn",
          spawnName: spawn.name,
          body,
          name,
          priority: 2000,
          reason: "emergency bootstrap workforce recovery",
          trace: workforceTrace(room.name, "recover-emergency-workforce"),
        });
        projectedCreeps.push({ name, body });
        remainingEnergy -= cost;
        continue;
      }

      const logistics = logisticsCoverage(
        room,
        requirement,
        roomCreeps,
        projectedCreeps,
      );
      if (logistics.need) {
        const cost = bodyCost(logistics.need.body);
        if (logistics.need.body.length === 0 || remainingEnergy < cost)
          continue;
        const name = reserveUniqueCreepName(
          logistics.need.namePrefix,
          room.name,
          world.tick,
          reservedNames,
        );
        intents.push({
          type: "spawn",
          spawnName: spawn.name,
          body: logistics.need.body,
          name,
          priority: logistics.need.priority,
          reason: logistics.need.reason,
          trace: workforceTrace(room.name, logistics.need.procedure),
        });
        projectedCreeps.push({ name, body: logistics.need.body });
        remainingEnergy -= cost;
        continue;
      }

      let generalists = viableGeneralistCapacity(
        roomCreeps,
        projectedCreeps,
        lead,
        logistics.reservedCreepNames,
      );
      if (
        generalistCapacitySatisfied(generalists, requiredGeneralistCapacity)
      ) {
        continue;
      }
      let deficit = generalistBodyDeficit(
        generalists,
        requiredGeneralistCapacity,
        targetGeneralistBody,
      );

      body = generalistBodyForSharedEnergy(
        targetGeneralistEnergy,
        remainingEnergy,
        remainingSpawns,
        deficit,
      );
      if (body.length === 0) continue;
      lead = replacementLeadTicks(body);
      generalists = viableGeneralistCapacity(
        roomCreeps,
        projectedCreeps,
        lead,
        logistics.reservedCreepNames,
      );
      if (
        generalistCapacitySatisfied(generalists, requiredGeneralistCapacity) ||
        remainingEnergy < bodyCost(body)
      ) {
        continue;
      }
      deficit = generalistBodyDeficit(
        generalists,
        requiredGeneralistCapacity,
        targetGeneralistBody,
      );
      if (deficit <= 0) continue;
      const cost = bodyCost(body);
      const name = reserveUniqueCreepName(
        "worker",
        room.name,
        world.tick,
        reservedNames,
      );

      intents.push({
        type: "spawn",
        spawnName: spawn.name,
        body,
        name,
        priority: 1200,
        reason: generalistDemandReason(generalists, requiredGeneralistCapacity),
        trace: workforceTrace(room.name, "maintain-general-workforce"),
      });
      projectedCreeps.push({ name, body });
      remainingEnergy -= cost;
    }
  }

  return intents;
}
