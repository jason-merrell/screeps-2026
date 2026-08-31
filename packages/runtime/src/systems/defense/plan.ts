import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";
import {
  healerPressureAgainst,
  preparedTowerAttackPowerAtRange,
  towerDamageAfterOrderedTough,
} from "./active-defense-readiness";

const TOWER_ATTACK_POWER = preparedTowerAttackPowerAtRange(0);
const TOWER_ATTACK_ENERGY_COST = 10;
export const TOWER_HEAL_PIN_RESERVE = 500;
const ROOM_EDGE = 49;
const HEAL_BOOST_MULTIPLIER: Readonly<Record<string, number>> = {
  LO: 2,
  LHO2: 3,
  XLHO2: 4,
};
const ATTACK_BOOST_MULTIPLIER: Readonly<Record<string, number>> = {
  UH: 2,
  UH2O: 3,
  XUH2O: 4,
  KO: 2,
  KHO2: 3,
  XKHO2: 4,
  ZH: 2,
  ZH2O: 3,
  XZH2O: 4,
};

const ACTIVE_PART_THREAT: Readonly<Partial<Record<BodyPartConstant, number>>> =
  {
    heal: 100,
    claim: 90,
    ranged_attack: 75,
    attack: 65,
    work: 40,
  };
const STRATEGIC_ASSET_TYPES: ReadonlySet<StructureConstant> = new Set([
  "spawn",
  "storage",
  "terminal",
  "tower",
]);

export interface TowerBatteryMember {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Current energy when live room evidence is available. */
  readonly energy?: number;
}

export interface TowerBatteryHostile {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly hits: number;
  readonly hitsMax: number;
  readonly body: readonly {
    readonly type: BodyPartConstant;
    readonly hits: number;
    readonly boost?: string | number;
  }[];
  /** Range to the nearest strategic colony asset, when room evidence is available. */
  readonly assetRange?: number;
}

export interface TowerBatteryTargetScore {
  readonly targetId: string;
  readonly score: number;
  readonly threatScore: number;
  readonly projectedDamage: number;
  /** Engine-equivalent damage after ordered boost mitigation; may include overkill. */
  readonly postMitigationDamage: number;
  /** Post-mitigation damage capped to the target's current hit points. */
  readonly effectiveProjectedDamage: number;
  readonly projectedHealing: number;
  readonly netDamage: number;
  readonly volleysToKill: number | null;
  readonly currentHits: number;
  readonly damagePressure: number;
  readonly injuryRatio: number;
  readonly rangeEffectiveness: number;
  readonly assetPressure: number;
  readonly edgeEscapeRisk: number;
}

export interface TowerBatteryVolleyAssignment {
  readonly towerId: string;
  readonly targetId: string;
  /** This tower's exact raw contribution at the target's current range. */
  readonly rawDamage: number;
  /** Number of towers reserved for this target in the coordinated volley. */
  readonly reservedTowerCount: number;
  readonly reservedRawDamage: number;
  readonly reservedPostMitigationDamage: number;
  readonly projectedHealing: number;
  readonly reservedNetDamage: number;
  readonly targetCurrentHits: number;
  readonly resolvedVolleyDefeatsTarget: boolean;
  readonly threatScore: number;
}

/** Exact official-server attack falloff, kept independent from Screeps globals for replay tests. */
export const towerAttackPowerAtRange = preparedTowerAttackPowerAtRange;

function rangeBetween(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function activeThreat(body: TowerBatteryHostile["body"]): number {
  const weighted = body.reduce((total, part) => {
    if (part.hits <= 0) return total;
    const boost =
      typeof part.boost === "string"
        ? ((part.type === "heal"
            ? HEAL_BOOST_MULTIPLIER[part.boost]
            : ATTACK_BOOST_MULTIPLIER[part.boost]) ?? 1)
        : 1;
    return total + (ACTIVE_PART_THREAT[part.type] ?? 0) * boost;
  }, 0);
  // Scouts and haulers remain valid targets, but never outrank an active threat
  // merely because they are closer to the battery.
  return Math.max(1, weighted);
}

function damageAfterTough(
  rawDamage: number,
  hostile: TowerBatteryHostile,
): number {
  return towerDamageAfterOrderedTough(rawDamage, hostile.body);
}

function projectedHealing(
  target: TowerBatteryHostile,
  hostiles: readonly TowerBatteryHostile[],
): number {
  return hostiles
    .filter(validHostile)
    .reduce(
      (total, healer) => total + healerPressureAgainst(target, healer),
      0,
    );
}

function validTower(tower: TowerBatteryMember): boolean {
  return (
    tower.id.length > 0 &&
    Number.isFinite(tower.x) &&
    Number.isFinite(tower.y) &&
    (tower.energy === undefined ||
      (Number.isFinite(tower.energy) && tower.energy >= 0))
  );
}

function validHostile(hostile: TowerBatteryHostile): boolean {
  return (
    hostile.id.length > 0 &&
    hostile.hits > 0 &&
    hostile.hitsMax > 0 &&
    Number.isFinite(hostile.hits) &&
    Number.isFinite(hostile.hitsMax) &&
    Number.isFinite(hostile.x) &&
    Number.isFinite(hostile.y)
  );
}

/**
 * Rank live hostiles for one coordinated tower volley. Threat parts dominate,
 * while range efficiency and current damage create meaningful kill pressure.
 * Complexity is O(towers * hostiles), followed by a small deterministic sort.
 */
export function rankTowerBatteryTargets(
  towers: readonly TowerBatteryMember[],
  hostiles: readonly TowerBatteryHostile[],
): TowerBatteryTargetScore[] {
  return rankTowerBatteryTargetsWithHealingSources(towers, hostiles, hostiles);
}

function rankTowerBatteryTargetsWithHealingSources(
  towers: readonly TowerBatteryMember[],
  targetCandidates: readonly TowerBatteryHostile[],
  healingSources: readonly TowerBatteryHostile[],
): TowerBatteryTargetScore[] {
  const availableTowers = towers.filter(validTower);
  if (availableTowers.length === 0) return [];

  return targetCandidates
    .filter(validHostile)
    .map((hostile): TowerBatteryTargetScore => {
      const projectedDamage = availableTowers.reduce(
        (total, tower) =>
          total + towerAttackPowerAtRange(rangeBetween(tower, hostile)),
        0,
      );
      const postMitigationDamage = damageAfterTough(projectedDamage, hostile);
      const effectiveProjectedDamage = Math.min(
        hostile.hits,
        postMitigationDamage,
      );
      const incomingHealing = projectedHealing(hostile, healingSources);
      const netDamage = Math.min(
        hostile.hits,
        Math.max(0, postMitigationDamage - incomingHealing),
      );
      const volleysToKill =
        netDamage > 0 ? Math.ceil(hostile.hits / netDamage) : null;
      const threatScore = activeThreat(hostile.body);
      const damagePressure = Math.min(1, netDamage / hostile.hits);
      const injuryRatio = Math.max(
        0,
        Math.min(1, 1 - hostile.hits / hostile.hitsMax),
      );
      const rangeEffectiveness =
        projectedDamage / (availableTowers.length * TOWER_ATTACK_POWER);
      const assetPressure =
        hostile.assetRange === undefined
          ? 0
          : 1 / (1 + Math.max(0, hostile.assetRange));
      const edgeRange = Math.min(
        hostile.x,
        hostile.y,
        ROOM_EDGE - hostile.x,
        ROOM_EDGE - hostile.y,
      );
      const edgeEscapeRisk =
        edgeRange <= 3 &&
        (volleysToKill === null || volleysToKill > edgeRange + 1)
          ? (4 - Math.max(0, edgeRange)) / 4
          : 0;
      const score =
        threatScore * 10 +
        damagePressure * 300 +
        injuryRatio * 100 +
        rangeEffectiveness * 100 +
        assetPressure * 150 -
        edgeEscapeRisk * 150;

      return {
        targetId: hostile.id,
        score,
        threatScore,
        projectedDamage,
        postMitigationDamage,
        effectiveProjectedDamage,
        projectedHealing: incomingHealing,
        netDamage,
        volleysToKill,
        currentHits: hostile.hits,
        damagePressure,
        injuryRatio,
        rangeEffectiveness,
        assetPressure,
        edgeEscapeRisk,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.threatScore - left.threatScore ||
        right.projectedDamage - left.projectedDamage ||
        left.currentHits - right.currentHits ||
        left.targetId.localeCompare(right.targetId),
    );
}

export function selectTowerBatteryTarget(
  towers: readonly TowerBatteryMember[],
  hostiles: readonly TowerBatteryHostile[],
): TowerBatteryTargetScore | null {
  return rankTowerBatteryTargets(towers, hostiles)[0] ?? null;
}

function hasDuplicateId(values: readonly { readonly id: string }[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) return true;
    seen.add(value.id);
  }
  return false;
}

interface TowerBatteryTargetReservation {
  readonly target: TowerBatteryHostile;
  readonly rankedTarget: TowerBatteryTargetScore;
  readonly towerCandidates: readonly {
    readonly tower: TowerBatteryMember;
    readonly rawDamage: number;
  }[];
  readonly reservedTowerCount: number;
  readonly reservedRawDamage: number;
  readonly reservedPostMitigationDamage: number;
  readonly projectedHealing: number;
  readonly reservedNetDamage: number;
  readonly resolvedVolleyDefeatsTarget: boolean;
}

function reserveTowersForTarget(
  towers: readonly TowerBatteryMember[],
  target: TowerBatteryHostile,
  rankedTarget: TowerBatteryTargetScore,
  healingSources: readonly TowerBatteryHostile[],
): TowerBatteryTargetReservation {
  const towerCandidates = towers
    .map((tower) => ({
      tower,
      rawDamage: towerAttackPowerAtRange(rangeBetween(tower, target)),
    }))
    .sort(
      (left, right) =>
        right.rawDamage - left.rawDamage ||
        left.tower.id.localeCompare(right.tower.id),
    );
  const incomingHealing = projectedHealing(target, healingSources);
  let reservedRawDamage = 0;
  let reservedPostMitigationDamage = 0;
  let reservedNetDamage = 0;
  let reservedTowerCount = towerCandidates.length;
  let resolvedVolleyDefeatsTarget = false;

  for (const [index, candidate] of towerCandidates.entries()) {
    reservedRawDamage += candidate.rawDamage;
    reservedPostMitigationDamage = damageAfterTough(reservedRawDamage, target);
    reservedNetDamage = Math.min(
      target.hits,
      Math.max(0, reservedPostMitigationDamage - incomingHealing),
    );
    if (reservedNetDamage >= target.hits) {
      reservedTowerCount = index + 1;
      resolvedVolleyDefeatsTarget = true;
      break;
    }
  }

  return {
    target,
    rankedTarget,
    towerCandidates,
    reservedTowerCount,
    reservedRawDamage,
    reservedPostMitigationDamage,
    projectedHealing: incomingHealing,
    reservedNetDamage,
    resolvedVolleyDefeatsTarget,
  };
}

/**
 * Reserve a coordinated single-tick volley without wasting the entire battery
 * on targets that a smaller tower subset defeats. A reservation is released to
 * the next ranked hostile only after cumulative ordered-TOUGH damage also
 * covers the maximum healing currently available from hostile positions. A
 * zero-net top-ranked stalemate yields to a lower one-tick-resolvable target,
 * preventing impenetrable healing from shielding the rest of an invading
 * force. Any positive-net top threat keeps focus, so opportunistic low-value
 * kills cannot interrupt decisive pressure. If every remaining target is
 * heal-locked, one tower may pin healing while retaining a 500-energy reserve;
 * the rest conserve energy instead of repeating a six-tower zero-net volley.
 *
 * Screeps has at most six towers in one room, so the bounded greedy search is
 * O(hostiles * towers^2) and avoids a combinatorial subset search. Sorting each
 * target's tower candidates by exact raw contribution makes the first lethal
 * prefix the minimum possible tower count; IDs break equal-damage ties.
 */
export function allocateTowerBatteryVolley(
  towers: readonly TowerBatteryMember[],
  hostiles: readonly TowerBatteryHostile[],
): TowerBatteryVolleyAssignment[] {
  const validTowers = towers.filter(validTower);
  const validTargets = hostiles.filter(validHostile);
  // Game object IDs are unique. Exported replay inputs that violate that
  // invariant cannot be canonicalized without guessing which geometry is real.
  if (hasDuplicateId(validTowers) || hasDuplicateId(validTargets)) return [];

  let remainingTowers = validTowers.sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  let remainingTargets = validTargets.sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  // A hostile reserved for lethal tower damage can still contribute a pending
  // heal during this tick. Keep the original complete source set for every
  // reservation instead of optimistically removing earlier targets.
  const healingSources = remainingTargets;
  const assignments: TowerBatteryVolleyAssignment[] = [];

  while (remainingTowers.length > 0 && remainingTargets.length > 0) {
    const rankedTargets = rankTowerBatteryTargetsWithHealingSources(
      remainingTowers,
      remainingTargets,
      healingSources,
    );
    let topReservation: TowerBatteryTargetReservation | null = null;
    let lethalStalemateBypass: TowerBatteryTargetReservation | null = null;
    let pressureStalemateBypass: TowerBatteryTargetReservation | null = null;

    for (const [index, rankedTarget] of rankedTargets.entries()) {
      const target = remainingTargets.find(
        (hostile) => hostile.id === rankedTarget.targetId,
      );
      if (!target) continue;
      const reservation = reserveTowersForTarget(
        remainingTowers,
        target,
        rankedTarget,
        healingSources,
      );
      if (index === 0) {
        topReservation = reservation;
        // A sustainable high-ranked threat must not be abandoned merely to
        // collect low-value one-tick kills elsewhere. Only a zero-net top
        // target opens the stalemate-bypass search.
        if (
          reservation.resolvedVolleyDefeatsTarget ||
          reservation.reservedNetDamage > 0
        ) {
          break;
        }
        continue;
      }
      if (reservation.resolvedVolleyDefeatsTarget) {
        lethalStalemateBypass = reservation;
        break;
      }
      if (reservation.reservedNetDamage > 0) {
        pressureStalemateBypass ??= reservation;
      }
    }

    // Never spend the full battery on a zero-net healing stalemate while a
    // ranked lower target is one-tick resolvable. If nothing is resolvable,
    // prefer useful positive pressure; otherwise retain the top fallback.
    let selectedReservation =
      (topReservation &&
      (topReservation.resolvedVolleyDefeatsTarget ||
        topReservation.reservedNetDamage > 0)
        ? topReservation
        : null) ??
      lethalStalemateBypass ??
      pressureStalemateBypass ??
      topReservation;
    if (!selectedReservation) break;

    if (
      selectedReservation === topReservation &&
      !selectedReservation.resolvedVolleyDefeatsTarget &&
      selectedReservation.reservedNetDamage === 0
    ) {
      const pinCandidate = selectedReservation.towerCandidates.find(
        ({ tower }) =>
          tower.energy === undefined ||
          tower.energy >= TOWER_HEAL_PIN_RESERVE + TOWER_ATTACK_ENERGY_COST,
      );
      if (!pinCandidate) break;
      selectedReservation = reserveTowersForTarget(
        [pinCandidate.tower],
        selectedReservation.target,
        selectedReservation.rankedTarget,
        healingSources,
      );
    }
    const reservedTowers = selectedReservation.towerCandidates.slice(
      0,
      selectedReservation.reservedTowerCount,
    );
    for (const candidate of reservedTowers) {
      assignments.push({
        towerId: candidate.tower.id,
        targetId: selectedReservation.target.id,
        rawDamage: candidate.rawDamage,
        reservedTowerCount: selectedReservation.reservedTowerCount,
        reservedRawDamage: selectedReservation.reservedRawDamage,
        reservedPostMitigationDamage:
          selectedReservation.reservedPostMitigationDamage,
        projectedHealing: selectedReservation.projectedHealing,
        reservedNetDamage: selectedReservation.reservedNetDamage,
        targetCurrentHits: selectedReservation.target.hits,
        resolvedVolleyDefeatsTarget:
          selectedReservation.resolvedVolleyDefeatsTarget,
        threatScore: selectedReservation.rankedTarget.threatScore,
      });
    }

    const reservedTowerIds = new Set(
      reservedTowers.map((candidate) => candidate.tower.id),
    );
    remainingTowers = remainingTowers.filter(
      (tower) => !reservedTowerIds.has(tower.id),
    );
    remainingTargets = remainingTargets.filter(
      (hostile) => hostile.id !== selectedReservation.target.id,
    );
    if (!selectedReservation.resolvedVolleyDefeatsTarget) break;
  }

  return assignments.sort((left, right) =>
    left.towerId.localeCompare(right.towerId),
  );
}

export function planDefense(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];

  for (const room of [...world.rooms].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const hostiles = room
      .find(FIND_HOSTILE_CREEPS)
      .filter((hostile) => hostile.hits > 0);
    if (hostiles.length === 0) continue;

    const structures = room.find(FIND_MY_STRUCTURES);
    const towers = structures
      .filter(
        (structure): structure is StructureTower =>
          structure.structureType === STRUCTURE_TOWER,
      )
      .filter(
        (tower) =>
          tower.store.getUsedCapacity(RESOURCE_ENERGY) >= TOWER_ENERGY_COST,
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    if (towers.length === 0) continue;

    const towerEvidence = towers.map((tower) => ({
      id: tower.id,
      x: tower.pos.x,
      y: tower.pos.y,
      energy: tower.store.getUsedCapacity(RESOURCE_ENERGY),
    }));
    const hostileEvidence = hostiles.map((hostile) => ({
      id: hostile.id,
      x: hostile.pos.x,
      y: hostile.pos.y,
      hits: hostile.hits,
      hitsMax: hostile.hitsMax,
      body: hostile.body,
      assetRange: structures
        .filter((structure) =>
          STRATEGIC_ASSET_TYPES.has(structure.structureType),
        )
        .reduce(
          (nearest, structure) =>
            Math.min(nearest, rangeBetween(hostile.pos, structure.pos)),
          Number.POSITIVE_INFINITY,
        ),
    }));
    const assignments = allocateTowerBatteryVolley(
      towerEvidence,
      hostileEvidence,
    );

    for (const assignment of assignments) {
      const availableTarget = hostiles.find(
        (hostile) => hostile.id === assignment.targetId,
      );
      if (!availableTarget) continue;

      intents.push({
        type: "towerAttack",
        towerId: assignment.towerId as Id<StructureTower>,
        targetId: availableTarget.id,
        priority: 3000,
        reason: `coordinated tower volley in ${room.name}: reserved ${assignment.reservedTowerCount} tower${assignment.reservedTowerCount === 1 ? "" : "s"} for threat ${assignment.threatScore}, projected ${assignment.reservedRawDamage} raw/${assignment.reservedNetDamage} net damage after tough and ${assignment.projectedHealing} positionally available healing against ${assignment.targetCurrentHits} current hits`,
        trace: createIntentTrace({
          roomName: room.name,
          domain: "defense",
          task: "maintain-defensive-readiness",
          procedure: "repel-hostile",
        }),
      });
    }
  }

  return intents;
}
