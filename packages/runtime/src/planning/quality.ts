import type { WorldSnapshot } from "../runtime/context";
import { desiredBootstrapWorkforce } from "../systems/spawning/workforce";
import type { FspmDomain, FspmQuality } from "./fspm";

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const qualityState = (score: number): FspmQuality["state"] =>
  score >= 85 ? "healthy" : score >= 60 ? "watch" : "degraded";

function sameQuality(left: FspmQuality | undefined, right: FspmQuality): boolean {
  return (
    left?.score === right.score &&
    left.state === right.state &&
    left.evidence.length === right.evidence.length &&
    left.evidence.every((value, index) => value === right.evidence[index])
  );
}

function measureEconomy(room: Room, creeps: Creep[]): FspmQuality {
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

function measureSpawning(room: Room, creeps: Creep[]): FspmQuality {
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

function measureConstruction(roomName: string): FspmQuality {
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

function measureDefense(room: Room): FspmQuality {
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
): FspmQuality {
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

export function reconcileFspmQuality(world: WorldSnapshot): void {
  for (const room of world.rooms) {
    const portfolio = Memory.colonies[room.name]?.fspm;
    if (!portfolio) continue;
    const creeps = world.creeps.filter((creep) => creep.room.name === room.name);

    for (const domain of ["economy", "spawning", "construction", "defense"] as const) {
      const requirement = portfolio.requirements[domain];
      const deliverable = portfolio.deliverables[domain];
      if (!requirement || !deliverable) continue;

      const quality = measureDomain(domain, room, creeps);
      if (!sameQuality(requirement.quality, quality)) requirement.quality = quality;
      if (!sameQuality(deliverable.quality, quality)) deliverable.quality = quality;
    }
  }
}
