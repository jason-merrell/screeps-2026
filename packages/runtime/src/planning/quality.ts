import type { WorldSnapshot } from "../runtime/context";
import { desiredBootstrapWorkforce } from "../systems/spawning/workforce";
import type {
  ColonyFspmPortfolio,
  FspmDomain,
  FspmQuality,
  FspmQualitySample,
  FspmQualityTrend,
} from "./fspm";

const HISTORY_INTERVAL_TICKS = 25;
const HISTORY_LIMIT = 12;
const TREND_DELTA = 5;

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const qualityState = (score: number): FspmQuality["state"] =>
  score >= 85 ? "healthy" : score >= 60 ? "watch" : "degraded";

export function qualityTrendFromSamples(samples: FspmQualitySample[]): FspmQualityTrend {
  if (samples.length < 2) return "new";
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || last.tick - first.tick < HISTORY_INTERVAL_TICKS) return "new";

  const delta = last.score - first.score;
  if (delta > TREND_DELTA) return "improving";
  if (delta < -TREND_DELTA) return "declining";
  return "stable";
}

function sameQuality(left: FspmQuality | undefined, right: FspmQuality): boolean {
  return (
    left?.score === right.score &&
    left.state === right.state &&
    left.trend === right.trend &&
    left.evidence.length === right.evidence.length &&
    left.evidence.every((value, index) => value === right.evidence[index])
  );
}

type QualityMeasurement = Omit<FspmQuality, "trend">;

function applyQuality(
  portfolio: ColonyFspmPortfolio,
  record: { id: string; quality?: FspmQuality },
  measurement: QualityMeasurement,
): void {
  portfolio.qualityHistory ??= {};
  const history = portfolio.qualityHistory[record.id] ?? [];
  const last = history[history.length - 1];
  const shouldSample =
    !last ||
    Game.time - last.tick >= HISTORY_INTERVAL_TICKS ||
    last.state !== measurement.state;

  if (shouldSample) {
    history.push({ tick: Game.time, score: measurement.score, state: measurement.state });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    portfolio.qualityHistory[record.id] = history;
  }

  const trendSamples = shouldSample
    ? history
    : [
        ...history,
        { tick: Game.time, score: measurement.score, state: measurement.state },
      ];
  const quality: FspmQuality = {
    ...measurement,
    trend: qualityTrendFromSamples(trendSamples),
  };

  if (!sameQuality(record.quality, quality)) record.quality = quality;
}

function measureEconomy(room: Room, creeps: Creep[]): QualityMeasurement {
  const sources = room.find(FIND_SOURCES).length;
  const targetWorkers = Math.max(1, sources + 1);
  const workerCoverage = Math.min(1, creeps.length / targetWorkers);
  const reserveRatio =
    room.energyCapacityAvailable > 0 ? room.energyAvailable / room.energyCapacityAvailable : 0;
  const score = clampScore(workerCoverage * 75 + Math.min(1, reserveRatio * 2) * 25);

  return {
    score,
    state: qualityState(score),
    measuredAt: Game.time,
    evidence: [
      `workers ${creeps.length}/${targetWorkers}`,
      `room energy ${room.energyAvailable}/${room.energyCapacityAvailable}`,
    ],
  };
}

function measureSpawning(room: Room, creeps: Creep[]): QualityMeasurement {
  const desired = desiredBootstrapWorkforce(
    room.controller?.level ?? 1,
    room.find(FIND_SOURCES).length,
    room.find(FIND_MY_CONSTRUCTION_SITES).length,
  );
  const score = clampScore((Math.min(creeps.length, desired) / Math.max(1, desired)) * 100);

  return {
    score,
    state: qualityState(score),
    measuredAt: Game.time,
    evidence: [`workforce ${creeps.length}/${desired}`],
  };
}

function measureConstruction(roomName: string): QualityMeasurement {
  const plan = Memory.colonies[roomName]?.roomPlan;
  const owned = Boolean(plan?.planId && plan?.deliverableId);
  const invalidated = plan?.invalidatedAt !== undefined;
  const score = !plan ? 0 : invalidated ? 25 : owned && plan.version >= 3 ? 100 : 60;

  return {
    score,
    state: qualityState(score),
    measuredAt: Game.time,
    evidence: [
      plan ? `room plan v${plan.version}` : "room plan missing",
      owned ? "plan ownership linked" : "plan ownership missing",
      invalidated ? "plan invalidated" : "plan current",
    ],
  };
}

function measureDefense(room: Room): QualityMeasurement {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const towers = room
    .find(FIND_MY_STRUCTURES)
    .filter((structure): structure is StructureTower => structure.structureType === STRUCTURE_TOWER);
  const towerReserve = towers.length
    ? towers.reduce((total, tower) => {
        const capacity = tower.store.getCapacity(RESOURCE_ENERGY) || 1;
        return total + tower.store.getUsedCapacity(RESOURCE_ENERGY) / capacity;
      }, 0) / towers.length
    : 0;
  const score =
    hostiles.length === 0
      ? 100
      : towers.length === 0
        ? 20
        : clampScore(40 + towerReserve * 60);

  return {
    score,
    state: qualityState(score),
    measuredAt: Game.time,
    evidence: [
      `hostiles ${hostiles.length}`,
      `towers ${towers.length}`,
      `tower reserve ${Math.round(towerReserve * 100)}%`,
    ],
  };
}

function measureDomain(
  domain: FspmDomain,
  room: Room,
  creeps: Creep[],
): QualityMeasurement {
  switch (domain) {
    case "economy":
      return measureEconomy(room, creeps);
    case "spawning":
      return measureSpawning(room, creeps);
    case "construction":
      return measureConstruction(room.name);
    case "defense":
      return measureDefense(room);
  }
}

/**
 * Transitional name retained for callers/tests while the former contract rollup
 * becomes a P3 rollup. The calculation itself is authority-agnostic.
 */
export function rollupContractScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function reconcileFspmQuality(world: WorldSnapshot): void {
  for (const room of world.rooms) {
    const portfolio = Memory.colonies[room.name]?.fspm;
    if (!portfolio) continue;
    const creeps = world.creeps.filter((creep) => creep.room.name === room.name);

    for (const domain of ["economy", "spawning", "construction", "defense"] as const) {
      const requirement = portfolio.requirements[domain];
      const deliverable = portfolio.deliverables[domain];
      if (!requirement || !deliverable) continue;

      const measurement = measureDomain(domain, room, creeps);
      applyQuality(portfolio, requirement, measurement);
      applyQuality(portfolio, deliverable, measurement);
    }

    const measuredRequirements = Object.values(portfolio.requirements).flatMap((requirement) =>
      requirement?.quality ? [{ requirement, quality: requirement.quality }] : [],
    );
    const p3Score = rollupContractScore(
      measuredRequirements.map(({ quality }) => quality.score),
    );
    if (p3Score === null) continue;

    applyQuality(portfolio, portfolio.p3, {
      score: p3Score,
      state: qualityState(p3Score),
      measuredAt: Game.time,
      evidence: measuredRequirements
        .sort((a, b) => a.requirement.domain.localeCompare(b.requirement.domain))
        .map(
          ({ requirement, quality }) =>
            `${requirement.domain} ${quality.score} ${quality.state}`,
        ),
    });
  }
}
