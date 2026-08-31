import type { WorldSnapshot } from "../runtime/context";
import { PREPARED_CREEP_COMBAT_AUTHORITY_DEBT } from "../systems/defense/active-defense-readiness";
import { defensiveRampartTargetHits } from "../systems/defense/readiness";
import { assessMatureCapabilityReadiness } from "../systems/maturity/capability-readiness";
import {
  assessWorkforceReadiness,
  type WorkforceCapabilityCoverage,
  type WorkforceReadinessAssessment,
} from "../systems/spawning/plan";
import { reconcilePortfolioEqvm } from "./eqvm";
import type {
  ColonyFspmPortfolio,
  FspmDomain,
  FspmOperationalHealth,
  FspmOperationalHealthSample,
  FspmOperationalHealthTrend,
} from "./fspm";
import { evaluateRoomDevelopmentForRoom } from "./room-development";
import { usableRoomPlanProjection } from "./room-plan-projection";

const HISTORY_INTERVAL_TICKS = 25;
const HISTORY_LIMIT = 12;
const TREND_DELTA = 5;

const clampScore = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

const operationalHealthState = (
  score: number,
): FspmOperationalHealth["state"] =>
  score >= 85 ? "healthy" : score >= 60 ? "watch" : "degraded";

export function operationalHealthTrendFromSamples(
  samples: FspmOperationalHealthSample[],
): FspmOperationalHealthTrend {
  if (samples.length < 2) return "new";
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || last.tick - first.tick < HISTORY_INTERVAL_TICKS)
    return "new";

  const delta = last.score - first.score;
  if (delta > TREND_DELTA) return "improving";
  if (delta < -TREND_DELTA) return "declining";
  return "stable";
}

function sameOperationalHealth(
  left: FspmOperationalHealth | undefined,
  right: FspmOperationalHealth,
): boolean {
  return (
    left?.score === right.score &&
    left.state === right.state &&
    left.trend === right.trend &&
    left.evidence.length === right.evidence.length &&
    left.evidence.every((value, index) => value === right.evidence[index])
  );
}

type OperationalHealthMeasurement = Omit<FspmOperationalHealth, "trend">;

export interface OperationalActivityRiskInput {
  inProgressTicks: number;
  productiveTicks: number;
  blockedTicks: number;
  targetRetargets: number;
}

/**
 * Operational-only alert cap for causally stuck current execution. This never
 * assigns an Activity KPI rating and therefore never enters Task QI/DQI/PQI.
 */
export function operationalActivityRiskCap(
  input: OperationalActivityRiskInput,
): number | null {
  if (input.blockedTicks > 0) return 25;
  if (input.targetRetargets >= 3) return 40;
  if (input.inProgressTicks >= 25 && input.productiveTicks === 0) return 50;
  return null;
}

function applyCurrentExecutionRisk(
  portfolio: ColonyFspmPortfolio,
  domain: FspmDomain,
  measurement: OperationalHealthMeasurement,
): OperationalHealthMeasurement {
  const taskIds = new Set(
    Object.values(portfolio.tasks)
      .filter((task) => task?.status === "active" && task.domain === domain)
      .map((task) => task.id),
  );
  const alerts = Object.values(portfolio.activities ?? {})
    .filter(
      (activity) =>
        activity.status === "in_progress" && taskIds.has(activity.taskId),
    )
    .flatMap((activity) => {
      const metrics = activity.metrics as typeof activity.metrics & {
        blockedTicks?: number;
        targetRetargets?: number;
      };
      const input: OperationalActivityRiskInput = {
        inProgressTicks: metrics.inProgressTicks,
        productiveTicks: metrics.productiveTicks,
        blockedTicks: metrics.blockedTicks ?? 0,
        targetRetargets: metrics.targetRetargets ?? 0,
      };
      const cap = operationalActivityRiskCap(input);
      return cap === null ? [] : [{ activity, input, cap }];
    })
    .sort((left, right) => left.activity.id.localeCompare(right.activity.id));
  if (alerts.length === 0) return measurement;

  const score = Math.min(measurement.score, ...alerts.map(({ cap }) => cap));
  return {
    ...measurement,
    score,
    state: operationalHealthState(score),
    evidence: [
      ...measurement.evidence,
      "current execution alert is operational telemetry only; no terminal Activity KPI was fabricated",
      ...alerts.map(
        ({ activity, input }) =>
          `${activity.id} stuck · in-progress ${input.inProgressTicks} · productive ${input.productiveTicks} · blocked ${input.blockedTicks} · retargets ${input.targetRetargets}`,
      ),
    ],
  };
}

function applyOperationalHealth(
  portfolio: ColonyFspmPortfolio,
  record: {
    id: string;
    operationalHealth?: FspmOperationalHealth;
    quality?: FspmOperationalHealth;
  },
  measurement: OperationalHealthMeasurement,
): void {
  portfolio.operationalHealthHistory ??= {};
  const history = portfolio.operationalHealthHistory[record.id] ?? [];
  const last = history[history.length - 1];
  const shouldSample =
    !last ||
    Game.time - last.tick >= HISTORY_INTERVAL_TICKS ||
    last.state !== measurement.state;

  if (shouldSample) {
    history.push({
      tick: Game.time,
      score: measurement.score,
      state: measurement.state,
    });
    if (history.length > HISTORY_LIMIT)
      history.splice(0, history.length - HISTORY_LIMIT);
    portfolio.operationalHealthHistory[record.id] = history;
  }

  const trendSamples = shouldSample
    ? history
    : [
        ...history,
        { tick: Game.time, score: measurement.score, state: measurement.state },
      ];
  const operationalHealth: FspmOperationalHealth = {
    ...measurement,
    trend: operationalHealthTrendFromSamples(trendSamples),
  };

  if (!sameOperationalHealth(record.operationalHealth, operationalHealth)) {
    record.operationalHealth = operationalHealth;
  }
  // v9 and earlier mislabeled room-readiness heuristics as FSPM quality.
  delete record.quality;
}

const capabilityCoverageRatio = (
  coverage: WorkforceCapabilityCoverage | null,
): number => {
  if (!coverage) return 0;
  if (coverage.required <= 0) return 1;
  return Math.max(0, Math.min(1, coverage.available / coverage.required));
};

/**
 * Operational readiness is bounded by the weakest simultaneously required
 * workforce lane. Specialized producer/hauler capacity never double-counts as
 * free WORK+CARRY labor, and an unverifiable projection cannot report healthy.
 */
export function scoreWorkforceReadiness(
  readiness: WorkforceReadinessAssessment,
): number {
  const ratios = [
    readiness.desiredGeneralists <= 0
      ? 1
      : Math.max(
          0,
          Math.min(
            1,
            readiness.viableGeneralists / readiness.desiredGeneralists,
          ),
        ),
    capabilityCoverageRatio(readiness.generalistWorkCoverage),
    capabilityCoverageRatio(readiness.generalistCarryCoverage),
    capabilityCoverageRatio(readiness.generalistMoveCoverage),
  ];
  if (readiness.logisticsStatus === "required") {
    ratios.push(
      capabilityCoverageRatio(readiness.producerCoverage),
      capabilityCoverageRatio(readiness.transportCarryCoverage),
    );
  }
  const score = clampScore(Math.min(...ratios) * 100);
  const projectionBounded =
    readiness.logisticsStatus === "projection-unavailable"
      ? Math.min(score, 59)
      : score;
  return readiness.replacementBudgetStatus === "minimum-survival-exception"
    ? Math.min(projectionBounded, 40)
    : projectionBounded;
}

function workforceReadinessEvidence(
  readiness: WorkforceReadinessAssessment,
): string[] {
  return [
    `viable generalists ${readiness.viableGeneralists}/${readiness.desiredGeneralists}`,
    `generalist WORK ${readiness.generalistWorkCoverage.available}/${readiness.generalistWorkCoverage.required}`,
    `generalist CARRY ${readiness.generalistCarryCoverage.available}/${readiness.generalistCarryCoverage.required}`,
    `generalist MOVE ${readiness.generalistMoveCoverage.available}/${readiness.generalistMoveCoverage.required}`,
    `replacement energy ${readiness.recurringReplacementEnergy}/${readiness.replacementBudgetEnergy} per generation (${readiness.replacementBudgetStatus})`,
    `viable population ${readiness.viablePopulation}`,
    `logistics ${readiness.logisticsStatus}`,
    ...(readiness.producerCoverage
      ? [
          `source producers ${readiness.producerCoverage.available}/${readiness.producerCoverage.required}`,
        ]
      : []),
    ...(readiness.transportCarryCoverage
      ? [
          `transport CARRY ${readiness.transportCarryCoverage.available}/${readiness.transportCarryCoverage.required}`,
        ]
      : []),
  ];
}

function measureEconomy(
  room: Room,
  creeps: Creep[],
): OperationalHealthMeasurement {
  const readiness = assessWorkforceReadiness(room, creeps);
  const workforceCoverage = scoreWorkforceReadiness(readiness) / 100;
  const reserveRatio =
    room.energyCapacityAvailable > 0
      ? room.energyAvailable / room.energyCapacityAvailable
      : 0;
  const score = clampScore(
    workforceCoverage * 75 + Math.min(1, reserveRatio * 2) * 25,
  );

  return {
    score,
    state: operationalHealthState(score),
    measuredAt: Game.time,
    evidence: [
      ...workforceReadinessEvidence(readiness),
      `room energy ${room.energyAvailable}/${room.energyCapacityAvailable}`,
    ],
  };
}

function measureSpawning(
  room: Room,
  creeps: Creep[],
): OperationalHealthMeasurement {
  const readiness = assessWorkforceReadiness(room, creeps);
  const score = scoreWorkforceReadiness(readiness);

  return {
    score,
    state: operationalHealthState(score),
    measuredAt: Game.time,
    evidence: workforceReadinessEvidence(readiness),
  };
}

function measureConstruction(room: Room): OperationalHealthMeasurement {
  const projection = usableRoomPlanProjection(
    Memory.colonies[room.name],
    room.name,
  );
  if (!projection.usable) {
    return {
      score: 0,
      state: "degraded",
      measuredAt: Game.time,
      evidence: [
        `room-plan projection unusable · ${projection.status}`,
        projection.reason,
        "development realization unavailable",
      ],
    };
  }
  const plan = projection.plan;
  const linked = Boolean(plan?.planId && plan?.deliverableId);

  const development = evaluateRoomDevelopmentForRoom(room, plan);
  const realization = development.overallEligibleRealizationPercentage;
  const score = !linked || realization === null ? 0 : clampScore(realization);
  const activeStage = development.stages.find(
    (stage) => stage.id === development.activeStageId,
  );

  return {
    score,
    state: operationalHealthState(score),
    measuredAt: Game.time,
    evidence: [
      `room plan v${plan.version} · RCL${plan.horizonRcl} horizon`,
      linked
        ? "operational projection linked to governed construction deliverable"
        : "operational projection governance link missing",
      "projection gate current · fingerprint and schema verified",
      realization === null
        ? `development realization withheld · ${development.horizonStatus}`
        : `development realization ${realization}%`,
      activeStage
        ? `active stage ${activeStage.title} · ${activeStage.realizationPercentage ?? 0}%`
        : development.nextStageId
          ? `next stage ${development.nextStageId}`
          : "all controller-eligible stages realized",
      development.nextMilestone.reason,
    ],
  };
}

export interface DefenseReadinessScoreInput {
  towerCount: number;
  expectedTowerCount: number;
  towerReserveRatio: number;
  perimeterBuilt: number;
  perimeterRequired: number;
  perimeterAtTarget: number;
}

export function scoreDefenseReadiness(
  input: DefenseReadinessScoreInput,
): number {
  const boundedRatio = (value: number): number =>
    Math.max(0, Math.min(1, value));
  const towerCoverage =
    input.expectedTowerCount > 0
      ? boundedRatio(input.towerCount / input.expectedTowerCount)
      : 1;
  const perimeterCoverage =
    input.perimeterRequired > 0
      ? boundedRatio(input.perimeterBuilt / input.perimeterRequired)
      : 1;
  const perimeterCondition =
    input.perimeterRequired > 0
      ? boundedRatio(input.perimeterAtTarget / input.perimeterRequired)
      : 1;

  return clampScore(
    towerCoverage * 35 +
      boundedRatio(input.towerReserveRatio) * 20 +
      perimeterCoverage * 25 +
      perimeterCondition * 20,
  );
}

/**
 * A complete passive shell is not complete operational defense. From the first
 * tower unlock onward, the unapproved creep-combat service keeps health below
 * the healthy threshold without pretending prepared diagnostics are live.
 */
export function capDefenseOperationalHealthForAuthority(
  score: number,
  controllerLevel: number,
): number {
  const boundedScore = clampScore(score);
  if (
    !Number.isInteger(controllerLevel) ||
    controllerLevel < 0 ||
    controllerLevel > 8
  ) {
    return Math.min(boundedScore, 40);
  }
  return controllerLevel >= 3 ? Math.min(boundedScore, 84) : boundedScore;
}

function measureDefense(room: Room): OperationalHealthMeasurement {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const structures = room.find(FIND_MY_STRUCTURES);
  const towers = structures.filter(
    (structure): structure is StructureTower =>
      structure.structureType === STRUCTURE_TOWER,
  );
  const towerReserve = towers.length
    ? towers.reduce((total, tower) => {
        const capacity = tower.store.getCapacity(RESOURCE_ENERGY) || 1;
        return total + tower.store.getUsedCapacity(RESOURCE_ENERGY) / capacity;
      }, 0) / towers.length
    : 0;
  const controllerLevel = room.controller?.level ?? 0;
  const expectedTowerCount =
    (
      CONTROLLER_STRUCTURES[STRUCTURE_TOWER] as
        | Record<number, number>
        | undefined
    )?.[controllerLevel] ?? 0;
  const projection = usableRoomPlanProjection(
    Memory.colonies[room.name],
    room.name,
  );
  if (controllerLevel >= 4 && !projection.usable) {
    return {
      score: 0,
      state: "degraded",
      measuredAt: Game.time,
      evidence: [
        `hostiles ${hostiles.length}`,
        `towers ${towers.length}/${expectedTowerCount}`,
        `tower reserve ${Math.round(towerReserve * 100)}%`,
        `defensive perimeter unavailable · ${projection.status}`,
        projection.reason,
      ],
    };
  }
  const perimeter =
    controllerLevel >= 4 && projection.usable
      ? projection.plan.defense.perimeter
      : [];
  const rampartsByPosition = new Map(
    structures
      .filter(
        (structure): structure is StructureRampart =>
          structure.structureType === STRUCTURE_RAMPART,
      )
      .map((rampart) => [`${rampart.pos.x}:${rampart.pos.y}`, rampart]),
  );
  const perimeterRamparts = perimeter.flatMap((point) => {
    const rampart = rampartsByPosition.get(`${point.x}:${point.y}`);
    return rampart ? [rampart] : [];
  });
  const targetHits = defensiveRampartTargetHits(
    controllerLevel,
    hostiles.length > 0,
  );
  const perimeterAtTarget = perimeterRamparts.filter(
    (rampart) => rampart.hits >= targetHits,
  ).length;
  const readinessScore = scoreDefenseReadiness({
    towerCount: towers.length,
    expectedTowerCount,
    towerReserveRatio: towerReserve,
    perimeterBuilt: perimeterRamparts.length,
    perimeterRequired: controllerLevel >= 4 ? Math.max(1, perimeter.length) : 0,
    perimeterAtTarget,
  });
  const score = capDefenseOperationalHealthForAuthority(
    readinessScore,
    controllerLevel,
  );

  return {
    score,
    state: operationalHealthState(score),
    measuredAt: Game.time,
    evidence: [
      `hostiles ${hostiles.length}`,
      `towers ${towers.length}/${expectedTowerCount}`,
      `tower reserve ${Math.round(towerReserve * 100)}%`,
      controllerLevel < 4
        ? "defensive perimeter unlocks at RCL4"
        : perimeter.length > 0
          ? `perimeter ${perimeterRamparts.length}/${perimeter.length} built`
          : "defensive perimeter plan missing",
      controllerLevel < 4
        ? "rampart condition not yet applicable"
        : perimeter.length > 0
          ? `perimeter at ${targetHits} hits ${perimeterAtTarget}/${perimeter.length}`
          : "rampart condition unavailable without a perimeter plan",
      ...(controllerLevel >= 3
        ? [
            `active creep defense unavailable · ${PREPARED_CREEP_COMBAT_AUTHORITY_DEBT.code}`,
            "prepared combat diagnostics are not promoted to live readiness without an approved authority-package v2 and same-tick evidence adapter",
          ]
        : []),
    ],
  };
}

function measureDomain(
  domain: FspmDomain,
  room: Room,
  creeps: Creep[],
): OperationalHealthMeasurement {
  switch (domain) {
    case "economy":
      return measureEconomy(room, creeps);
    case "spawning":
      return measureSpawning(room, creeps);
    case "construction":
      return measureConstruction(room);
    case "defense":
      return measureDefense(room);
  }
}

/**
 * Transitional name retained for callers/tests while the former contract rollup
 * becomes a P3 rollup. The calculation itself is authority-agnostic.
 */
export function rollupOperationalHealthScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return clampScore(
    scores.reduce((sum, score) => sum + score, 0) / scores.length,
  );
}

export function reconcileFspmEvidence(world: WorldSnapshot): void {
  for (const room of world.rooms) {
    const portfolio = Memory.colonies[room.name]?.fspm;
    if (!portfolio) continue;
    const creeps = world.creeps.filter(
      (creep) => creep.room.name === room.name,
    );

    const measurements: Array<{
      domain: FspmDomain;
      measurement: OperationalHealthMeasurement;
    }> = [];
    for (const domain of [
      "economy",
      "spawning",
      "construction",
      "defense",
    ] as const) {
      const measurement = applyCurrentExecutionRisk(
        portfolio,
        domain,
        measureDomain(domain, room, creeps),
      );
      measurements.push({ domain, measurement });
      const requirement = portfolio.requirements[domain];
      const deliverable = portfolio.deliverables[domain];
      if (requirement) {
        applyOperationalHealth(portfolio, requirement, measurement);
      }
      if (deliverable) {
        applyOperationalHealth(portfolio, deliverable, measurement);
      }
    }

    const rawP3Score = rollupOperationalHealthScore(
      measurements.map(({ measurement }) => measurement.score),
    );
    if (rawP3Score !== null) {
      const maturity = assessMatureCapabilityReadiness(
        room.controller?.level ?? 0,
      );
      const p3Score =
        maturity.operationalHealthCap === null
          ? rawP3Score
          : Math.min(rawP3Score, maturity.operationalHealthCap);
      applyOperationalHealth(portfolio, portfolio.p3, {
        score: p3Score,
        state: operationalHealthState(p3Score),
        measuredAt: Game.time,
        evidence: [
          ...measurements
            .sort((left, right) => left.domain.localeCompare(right.domain))
            .map(
              ({ domain, measurement }) =>
                `${domain} ${measurement.score} ${measurement.state}`,
            ),
          ...(maturity.applicable
            ? [
                `mature capability actuation ${maturity.authorizedAndImplemented}/${maturity.required} · ${maturity.coveragePercentage}%`,
                ...maturity.debt.map(
                  (gate) => `${gate.title} unavailable · ${gate.debt}`,
                ),
              ]
            : []),
        ],
      });
    }

    reconcilePortfolioEqvm(portfolio, Game.time);
  }
}
