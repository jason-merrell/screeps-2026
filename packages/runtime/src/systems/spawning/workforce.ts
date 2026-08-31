export const GENERALIST_UNIT_COST = 200;
export const MAX_CREEP_BODY_PARTS = 50;
export const SOURCE_REGEN_CYCLE_TICKS = 300;
export const SOURCE_REGEN_CYCLE_ENERGY = 3_000;
export const CREEP_SERVICE_LIFETIME_TICKS = 1_500;
export const SOURCE_SUSTAINABLE_ENERGY_PER_TICK = 10;
export const GENERALIST_REPLACEMENT_BUDGET_FRACTION = 0.3;
export const COMPLETE_WORKFORCE_REPLACEMENT_BUDGET_FRACTION = 0.4;

const ENERGY_PER_CARRY_PART = 50;
export const ENERGY_PER_WORK_HARVEST = 2;
const MAX_SOURCE_PRODUCER_WORK_PARTS = 6;
const MAX_SOURCE_PRODUCER_CARRY_PARTS = 2;

export interface SourceProducerCycleResult {
  readonly bufferedEnergy: number;
  readonly carriedEnergy: number;
  readonly harvestIntents: number;
  readonly harvestedEnergy: number;
  readonly idleTicks: number;
  readonly remainingSourceEnergy: number;
  readonly transferIntents: number;
  readonly wastedHarvestCapacity: number;
}

export interface GeneralistBodyBudget {
  readonly availableGeneralistReplacementEnergy: number;
  readonly body: BodyPartConstant[];
  readonly completeWorkforceReplacementBudget: number;
  readonly recurringReplacementEnergy: number;
  readonly status: "minimum-survival-exception" | "within-budget";
}

interface SourceProducerCandidate {
  readonly body: readonly BodyPartConstant[];
  readonly cost: number;
  readonly cycle: SourceProducerCycleResult;
}

let cachedSourceProducerCandidates: readonly SourceProducerCandidate[] | null =
  null;

function countParts(
  body: readonly BodyPartConstant[],
  part: BodyPartConstant,
): number {
  return body.filter((candidate) => candidate === part).length;
}

function normalizedEnergyCapacity(capacity: number): number {
  if (capacity === Number.POSITIVE_INFINITY) return capacity;
  return Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 0;
}

export function activeCreepParts(creep: Creep, part: BodyPartConstant): number {
  if (creep.spawning) {
    return creep.body.filter((bodyPart) => bodyPart.type === part).length;
  }
  return creep.getActiveBodyparts(part);
}

export function creepRoadBaggageParts(creep: Creep): number {
  return creep.body.filter((part) => part.type !== MOVE && part.type !== CARRY)
    .length;
}

export function creepRoadCarryCapacity(creep: Creep): number {
  return Math.min(
    activeCreepParts(creep, CARRY),
    Math.max(
      0,
      activeCreepParts(creep, MOVE) * 2 - creepRoadBaggageParts(creep),
    ),
  );
}

export function creepHasLoadedRoadMobility(creep: Creep): boolean {
  return creepRoadCarryCapacity(creep) >= activeCreepParts(creep, CARRY);
}

export function creepMeetsSourceProducerBody(
  creep: Creep,
  targetBody: readonly BodyPartConstant[],
): boolean {
  return (
    activeCreepParts(creep, WORK) >= countParts(targetBody, "work") &&
    activeCreepParts(creep, CARRY) >= countParts(targetBody, "carry") &&
    activeCreepParts(creep, MOVE) >= countParts(targetBody, "move") &&
    creepHasLoadedRoadMobility(creep)
  );
}

export function creepSourceProducerSurplus(
  creep: Creep,
  targetBody: readonly BodyPartConstant[],
): number {
  return (
    activeCreepParts(creep, WORK) -
    countParts(targetBody, "work") +
    (activeCreepParts(creep, CARRY) - countParts(targetBody, "carry")) +
    (activeCreepParts(creep, MOVE) - countParts(targetBody, "move"))
  );
}

/**
 * MOVE capacity for one-tile-per-tick travel on roads while every non-MOVE
 * part is fatigue-bearing. Mature colony routes are planned roads; callers
 * that require off-road speed need a different composition policy.
 */
export function roadMoveParts(nonMoveParts: number): number {
  return Math.ceil(Math.max(0, nonMoveParts) / 2);
}

export function desiredBootstrapWorkforce(
  controllerLevel: number,
  sourceCount: number,
  constructionSiteCount: number,
): number {
  const level = Math.max(1, Math.min(8, Math.floor(controllerLevel)));
  const sourceDemand = Math.max(0, Math.floor(sourceCount));
  const constructionDemand = Math.max(0, Math.floor(constructionSiteCount));
  const capabilityMargin =
    level === 1 ? 1 : level === 2 ? 2 : level >= 7 ? 5 : level >= 5 ? 4 : 3;
  const minimum = level === 1 ? 3 : level === 2 ? 4 : 5;
  const base = Math.max(minimum, sourceDemand + capabilityMargin);
  const constructionPressure =
    constructionDemand === 0
      ? 0
      : level <= 2
        ? 1
        : Math.min(3, Math.ceil(constructionDemand / 10));

  return Math.min(10, base + constructionPressure);
}

export function generalistBodyForCapacity(
  capacity: number,
): BodyPartConstant[] {
  const energyCapacity = normalizedEnergyCapacity(capacity);
  const units = Math.min(
    Math.floor(MAX_CREEP_BODY_PARTS / 3),
    Math.floor(energyCapacity / GENERALIST_UNIT_COST),
  );
  const body: BodyPartConstant[] = [];

  for (let index = 0; index < units; index += 1) {
    body.push("work", "carry", "move");
  }

  return body;
}

/**
 * Right-sizes each generalist against sustainable source income. The fleet's
 * aggregate replacement energy is limited to 30% of lifetime source income
 * and shrinks further whenever producer plus route-sized transport replacement
 * would push the complete recurring workforce above 40%.
 * Construction pressure increases parallel actors without multiplying the
 * replacement budget by the room's maximum spawn capacity.
 */
export function generalistBodyBudgetForDemand(
  energyCapacity: number,
  sourceCount: number,
  desiredGeneralists: number,
  specializedReplacementEnergy = 0,
): GeneralistBodyBudget {
  const workforce = Math.max(0, Math.floor(desiredGeneralists));
  const sustainableIncome =
    Math.max(0, Math.floor(sourceCount)) * SOURCE_SUSTAINABLE_ENERGY_PER_TICK;
  const fleetLifetimeBudget =
    sustainableIncome *
    CREEP_SERVICE_LIFETIME_TICKS *
    GENERALIST_REPLACEMENT_BUDGET_FRACTION;
  const completeWorkforceReplacementBudget =
    sustainableIncome *
    CREEP_SERVICE_LIFETIME_TICKS *
    COMPLETE_WORKFORCE_REPLACEMENT_BUDGET_FRACTION;
  const generalistBudgetAfterSpecialists =
    completeWorkforceReplacementBudget -
    Math.max(0, specializedReplacementEnergy);
  const availableGeneralistBudget = Math.max(
    0,
    Math.min(fleetLifetimeBudget, generalistBudgetAfterSpecialists),
  );
  if (workforce === 0) {
    return {
      availableGeneralistReplacementEnergy: availableGeneralistBudget,
      body: [],
      completeWorkforceReplacementBudget,
      recurringReplacementEnergy: Math.max(0, specializedReplacementEnergy),
      status:
        specializedReplacementEnergy <= completeWorkforceReplacementBudget
          ? "within-budget"
          : "minimum-survival-exception",
    };
  }
  const perCreepBudget =
    Math.floor(availableGeneralistBudget / workforce / GENERALIST_UNIT_COST) *
    GENERALIST_UNIT_COST;
  const body = generalistBodyForCapacity(
    Math.min(
      normalizedEnergyCapacity(energyCapacity),
      Math.max(GENERALIST_UNIT_COST, perCreepBudget),
    ),
  );
  const recurringReplacementEnergy =
    Math.max(0, specializedReplacementEnergy) + workforce * bodyCost(body);
  return {
    availableGeneralistReplacementEnergy: availableGeneralistBudget,
    body,
    completeWorkforceReplacementBudget,
    recurringReplacementEnergy,
    status:
      recurringReplacementEnergy <= completeWorkforceReplacementBudget
        ? "within-budget"
        : "minimum-survival-exception",
  };
}

export function generalistBodyForDemand(
  energyCapacity: number,
  sourceCount: number,
  desiredGeneralists: number,
  specializedReplacementEnergy = 0,
): BodyPartConstant[] {
  return generalistBodyBudgetForDemand(
    energyCapacity,
    sourceCount,
    desiredGeneralists,
    specializedReplacementEnergy,
  ).body;
}

/**
 * Pure model of the source-producer policy in economy/plan: harvest while the
 * creep has free CARRY capacity, then spend one exclusive creep intent to
 * transfer its load. Harvest power that cannot fit in the final partial load
 * is deliberately counted as wasted capacity rather than fabricated energy.
 */
export function simulateSourceProducerCycle(
  body: readonly BodyPartConstant[],
  ticks = SOURCE_REGEN_CYCLE_TICKS,
  initialSourceEnergy = SOURCE_REGEN_CYCLE_ENERGY,
): SourceProducerCycleResult {
  const workParts = countParts(body, "work");
  const carryCapacity = countParts(body, "carry") * ENERGY_PER_CARRY_PART;
  const harvestCapacity = workParts * ENERGY_PER_WORK_HARVEST;
  let bufferedEnergy = 0;
  let carriedEnergy = 0;
  let harvestedEnergy = 0;
  let remainingSourceEnergy = Math.max(0, initialSourceEnergy);
  let harvestIntents = 0;
  let transferIntents = 0;
  let idleTicks = 0;
  let wastedHarvestCapacity = 0;

  for (let tick = 0; tick < Math.max(0, Math.floor(ticks)); tick += 1) {
    if (
      harvestCapacity > 0 &&
      carryCapacity > carriedEnergy &&
      remainingSourceEnergy > 0
    ) {
      const harvested = Math.min(
        harvestCapacity,
        carryCapacity - carriedEnergy,
        remainingSourceEnergy,
      );
      carriedEnergy += harvested;
      harvestedEnergy += harvested;
      remainingSourceEnergy -= harvested;
      harvestIntents += 1;
      wastedHarvestCapacity += harvestCapacity - harvested;
      continue;
    }

    if (carriedEnergy > 0) {
      bufferedEnergy += carriedEnergy;
      carriedEnergy = 0;
      transferIntents += 1;
      continue;
    }

    idleTicks += 1;
  }

  return {
    bufferedEnergy,
    carriedEnergy,
    harvestIntents,
    harvestedEnergy,
    idleTicks,
    remainingSourceEnergy,
    transferIntents,
    wastedHarvestCapacity,
  };
}

function sourceProducerCandidates(): readonly SourceProducerCandidate[] {
  if (cachedSourceProducerCandidates) return cachedSourceProducerCandidates;

  const candidates: SourceProducerCandidate[] = [];
  for (
    let workParts = 1;
    workParts <= MAX_SOURCE_PRODUCER_WORK_PARTS;
    workParts += 1
  ) {
    for (
      let carryParts = 1;
      carryParts <= MAX_SOURCE_PRODUCER_CARRY_PARTS;
      carryParts += 1
    ) {
      const moveParts = roadMoveParts(workParts + carryParts);
      const body: BodyPartConstant[] = [
        ...Array.from({ length: workParts }, () => "work" as const),
        ...Array.from({ length: carryParts }, () => "carry" as const),
        ...Array.from({ length: moveParts }, () => "move" as const),
      ];
      candidates.push({
        body,
        cost: bodyCost(body),
        cycle: simulateSourceProducerCycle(body),
      });
    }
  }

  cachedSourceProducerCandidates = candidates;
  return candidates;
}

export function sourceProducerBodyForCapacity(
  capacity: number,
): BodyPartConstant[] {
  const energyCapacity = normalizedEnergyCapacity(capacity);
  let selected: SourceProducerCandidate | null = null;
  for (const candidate of sourceProducerCandidates()) {
    if (
      candidate.body.length > MAX_CREEP_BODY_PARTS ||
      candidate.cost > energyCapacity
    ) {
      continue;
    }
    if (
      !selected ||
      candidate.cycle.bufferedEnergy > selected.cycle.bufferedEnergy ||
      (candidate.cycle.bufferedEnergy === selected.cycle.bufferedEnergy &&
        candidate.cost < selected.cost) ||
      (candidate.cycle.bufferedEnergy === selected.cycle.bufferedEnergy &&
        candidate.cost === selected.cost &&
        candidate.body.length < selected.body.length)
    ) {
      selected = candidate;
    }
  }

  return selected ? [...selected.body] : [];
}

export function transporterBodyForCapacity(
  capacity: number,
  carryDemand = Number.POSITIVE_INFINITY,
): BodyPartConstant[] {
  const energyCapacity = normalizedEnergyCapacity(capacity);
  const boundedDemand =
    carryDemand === Number.POSITIVE_INFINITY
      ? carryDemand
      : Number.isFinite(carryDemand)
        ? Math.max(0, Math.ceil(carryDemand))
        : 0;
  let carryParts = 0;
  for (let candidate = 1; candidate <= MAX_CREEP_BODY_PARTS; candidate += 1) {
    const moveParts = roadMoveParts(candidate);
    const partCount = candidate + moveParts;
    const cost = (candidate + moveParts) * 50;
    if (
      candidate > boundedDemand ||
      partCount > MAX_CREEP_BODY_PARTS ||
      cost > energyCapacity
    ) {
      break;
    }
    carryParts = candidate;
  }

  const moveParts = roadMoveParts(carryParts);
  return [
    ...Array.from({ length: carryParts }, () => "carry" as const),
    ...Array.from({ length: moveParts }, () => "move" as const),
  ];
}

export function transporterFleetForCarryDemand(
  capacity: number,
  carryDemand: number,
): BodyPartConstant[][] {
  let remainingCarry = Number.isFinite(carryDemand)
    ? Math.max(0, Math.ceil(carryDemand))
    : 0;
  const bodies: BodyPartConstant[][] = [];

  while (remainingCarry > 0) {
    const body = transporterBodyForCapacity(capacity, remainingCarry);
    const carryParts = countParts(body, "carry");
    if (carryParts <= 0) break;
    bodies.push(body);
    remainingCarry -= carryParts;
  }

  return bodies;
}

export function bodyCost(body: readonly BodyPartConstant[]): number {
  const costs: Record<BodyPartConstant, number> = {
    move: 50,
    work: 100,
    carry: 50,
    attack: 80,
    ranged_attack: 150,
    heal: 250,
    claim: 600,
    tough: 10,
  };

  return body.reduce((total, part) => total + costs[part], 0);
}

export function replacementLeadTicks(
  body: readonly BodyPartConstant[],
): number {
  return body.length * CREEP_SPAWN_TIME + 25;
}
