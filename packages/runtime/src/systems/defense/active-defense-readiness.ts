/**
 * Pure evidence model for a future creep-combat defense service.
 *
 * Nothing in this module creates an intent, selects an actor, mutates Memory,
 * or grants FSPM authority. It is safe to use for replay analysis and
 * operational-health diagnostics while creep combat remains unapproved.
 */

const TOWER_ATTACK_POWER = 600;
const TOWER_ATTACK_MINIMUM = 150;
const TOWER_OPTIMAL_RANGE = 5;
const TOWER_FALLOFF_RANGE = 20;
const TOWER_ENERGY_PER_ATTACK = 10;
const HEAL_POWER = 12;
const RANGED_HEAL_POWER = 4;
const ATTACK_POWER = 30;
const RANGED_ATTACK_POWER = 10;
const DISMANTLE_POWER = 50;

const TOUGH_DAMAGE_MULTIPLIER: Readonly<Record<string, number>> = Object.freeze(
  {
    GO: 0.7,
    GHO2: 0.5,
    XGHO2: 0.3,
  },
);
const HEAL_BOOST_MULTIPLIER: Readonly<Record<string, number>> = Object.freeze({
  LO: 2,
  LHO2: 3,
  XLHO2: 4,
});
const ATTACK_BOOST_MULTIPLIER: Readonly<Record<string, number>> = Object.freeze(
  {
    UH: 2,
    UH2O: 3,
    XUH2O: 4,
  },
);
const RANGED_ATTACK_BOOST_MULTIPLIER: Readonly<Record<string, number>> =
  Object.freeze({ KO: 2, KHO2: 3, XKHO2: 4 });
const DISMANTLE_BOOST_MULTIPLIER: Readonly<Record<string, number>> =
  Object.freeze({ ZH: 2, ZH2O: 3, XZH2O: 4 });

const LEGAL_BOOSTS_BY_PART: Readonly<
  Record<BodyPartConstant, ReadonlySet<string>>
> = Object.freeze({
  move: new Set(["ZO", "ZHO2", "XZHO2"]),
  work: new Set([
    "UO",
    "UHO2",
    "XUHO2",
    "LH",
    "LH2O",
    "XLH2O",
    "ZH",
    "ZH2O",
    "XZH2O",
    "GH",
    "GH2O",
    "XGH2O",
  ]),
  carry: new Set(["KH", "KH2O", "XKH2O"]),
  attack: new Set(Object.keys(ATTACK_BOOST_MULTIPLIER)),
  ranged_attack: new Set(Object.keys(RANGED_ATTACK_BOOST_MULTIPLIER)),
  tough: new Set(Object.keys(TOUGH_DAMAGE_MULTIPLIER)),
  heal: new Set(Object.keys(HEAL_BOOST_MULTIPLIER)),
  claim: new Set<string>(),
});

export const PREPARED_CREEP_COMBAT_AUTHORITY_DEBT = Object.freeze({
  code: "creep_combat_authority_unapproved",
  authorized: false,
  currentAuthorityPackageSchema: "screeps-fspm-authority-package/v1",
  currentAuthorityPackageId: "authority-package:empire:colony-operations:v1",
  requiredSupersessionPackageSchema: "screeps-fspm-authority-package/v2",
  requiredSupersessionPackageId:
    "authority-package:empire:colony-operations:v2",
  reason:
    "the active authority package has no reviewed creep-combat Task/Procedure or combat intent operation",
} as const);

export interface DefenseBodyPartEvidence {
  readonly type: BodyPartConstant;
  readonly hits: number;
  readonly boost?: string | number;
}

export interface HostileDefenseEvidence {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly hits: number;
  readonly hitsMax: number;
  /** Engine body order is material because front-loaded TOUGH absorbs first. */
  readonly body: readonly DefenseBodyPartEvidence[];
}

export interface DefenseTowerEvidence {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly energy: number;
  readonly energyCapacity: number;
}

export interface HostileBodyThreatProfile {
  readonly evidenceComplete: boolean;
  readonly evidenceErrors: readonly string[];
  readonly activeCombatParts: number;
  readonly meleeDamagePerTick: number;
  readonly rangedDamagePerTick: number;
  readonly dismantleDamagePerTick: number;
  readonly healPowerPerTick: number;
  readonly claimParts: number;
  /** Conservative targeting weight. It is diagnostic, not execution policy. */
  readonly threatScore: number;
}

export type DiagnosticTowerPressureState =
  | "defeating-current-volley-after-healing"
  | "sustainable-at-current-geometry"
  | "healing-stalemate"
  | "battery-unavailable"
  | "evidence-incomplete";

export interface DiagnosticTowerTargetFeasibility {
  readonly targetId: string;
  readonly evidenceComplete: boolean;
  readonly evidenceErrors: readonly string[];
  readonly threat: HostileBodyThreatProfile;
  readonly energizedTowerCount: number;
  readonly rawVolleyDamage: number;
  readonly postMitigationVolleyDamage: number;
  readonly maximumHealingPressure: number;
  readonly netDamageAtCurrentGeometry: number;
  /** Damage reaches current hits before queued healing is resolved. */
  readonly preHealDamageReachesCurrentHits: boolean;
  /** Net damage still reaches current hits after maximum healing pressure. */
  readonly resolvedVolleyDefeatsTarget: boolean;
  readonly indicativeVolleysToDefeat: number | null;
  readonly pressureState: DiagnosticTowerPressureState;
  /** Transparent diagnostic score used only by rankPreparedDefenseTargets. */
  readonly targetingScore: number;
}

export type SafeModeEvidence =
  | { readonly state: "active"; readonly remainingTicks: number }
  | { readonly state: "available"; readonly availableActivations: number }
  | {
      readonly state: "cooldown";
      readonly availableActivations: number;
      readonly cooldownTicks: number;
    }
  | { readonly state: "unavailable"; readonly availableActivations: 0 }
  | { readonly state: "unknown" };

export interface IncomingNukeEvidence {
  readonly id: string;
  readonly ticksToLand: number;
  readonly criticalAssetsInBlast: number;
  /** Lowest observed protection among the affected critical assets. */
  readonly minimumProtectiveRampartHits: number;
  /** Caller-supplied protection requirement for those exact blast positions. */
  readonly requiredProtectiveRampartHits: number;
}

export interface StrategicDefenseEnergyEvidence {
  readonly storageEnergy: number | null;
  readonly terminalEnergy: number | null;
  readonly reserveTarget: number;
}

export type PreparedTowerCoverageState =
  | "no-hostiles-observed"
  | "sustainable"
  | "partial"
  | "infeasible"
  | "indeterminate";

export type PreparedDefenseReadinessDebtCode =
  | "creep_combat_authority_unapproved"
  | "defense_evidence_incomplete"
  | "tower_battery_infeasible"
  | "tower_reserve_below_half"
  | "strategic_energy_reserve_below_half"
  | "safe_mode_fallback_unavailable"
  | "incoming_nuke_protection_gap";

export interface PreparedDefenseOperationalHealthCapInput {
  readonly controllerLevel: number;
  readonly hostileCount: number;
  readonly towerCoverage: PreparedTowerCoverageState;
  readonly towerReserveRatio: number | null;
  readonly strategicEnergyReserveRatio: number | null;
  readonly safeModeFallback: "active" | "available" | "unavailable" | "unknown";
  readonly incomingNukeCount: number;
  readonly unprotectedNukeCount: number;
  readonly evidenceComplete: boolean;
}

export interface PreparedDefenseOperationalHealthCap {
  /** Null means this prepared capability imposes no operational-health cap. */
  readonly cap: number | null;
  readonly debt: readonly PreparedDefenseReadinessDebtCode[];
}

export interface PreparedActiveDefenseInput {
  readonly controllerLevel: number;
  readonly towers: readonly DefenseTowerEvidence[];
  readonly hostiles: readonly HostileDefenseEvidence[];
  readonly energy: StrategicDefenseEnergyEvidence;
  readonly safeMode: SafeModeEvidence;
  readonly incomingNukes: readonly IncomingNukeEvidence[];
}

export interface PreparedActiveDefenseReadiness {
  readonly authority: typeof PREPARED_CREEP_COMBAT_AUTHORITY_DEBT;
  readonly evidenceComplete: boolean;
  readonly evidenceErrors: readonly string[];
  readonly rankedTargets: readonly DiagnosticTowerTargetFeasibility[];
  readonly towerCoverage: PreparedTowerCoverageState;
  readonly towerReserveApplicable: boolean;
  readonly towerReserveRatio: number | null;
  readonly fullBatteryVolleysAvailable: number;
  readonly strategicEnergyReserve: number | null;
  readonly strategicEnergyReserveApplicable: boolean;
  readonly strategicEnergyReserveRatio: number | null;
  readonly safeModeFallback: PreparedDefenseOperationalHealthCapInput["safeModeFallback"];
  /** Safe mode is intentionally never counted as nuke protection. */
  readonly unprotectedNukes: readonly IncomingNukeEvidence[];
  readonly operationalHealth: PreparedDefenseOperationalHealthCap;
}

const finiteNonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const nonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

const validRoomCoordinate = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 49;

const rangeBetween = (
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number => Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));

/** Exact official-server tower attack falloff, independent of Screeps globals. */
export function preparedTowerAttackPowerAtRange(range: number): number {
  if (!Number.isFinite(range)) return 0;
  const normalized = Math.max(0, Math.floor(range));
  if (normalized <= TOWER_OPTIMAL_RANGE) return TOWER_ATTACK_POWER;
  if (normalized >= TOWER_FALLOFF_RANGE) return TOWER_ATTACK_MINIMUM;
  const falloff =
    ((TOWER_ATTACK_POWER - TOWER_ATTACK_MINIMUM) *
      (normalized - TOWER_OPTIMAL_RANGE)) /
    (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
  return Math.floor(TOWER_ATTACK_POWER - falloff);
}

function legalPartType(type: BodyPartConstant): boolean {
  return (
    type === "move" ||
    type === "work" ||
    type === "carry" ||
    type === "attack" ||
    type === "ranged_attack" ||
    type === "tough" ||
    type === "heal" ||
    type === "claim"
  );
}

function bodyEvidenceErrors(
  body: readonly DefenseBodyPartEvidence[],
): string[] {
  const errors: string[] = [];
  if (body.length === 0 || body.length > 50) {
    errors.push(`body length ${body.length} is outside 1..50`);
  }
  body.forEach((part, index) => {
    if (!legalPartType(part.type)) {
      errors.push(`body[${index}] has unsupported part ${String(part.type)}`);
    }
    if (!nonNegativeInteger(part.hits) || part.hits > 100) {
      errors.push(`body[${index}] has invalid hits ${String(part.hits)}`);
    }
    if (
      part.boost !== undefined &&
      (typeof part.boost !== "string" ||
        !LEGAL_BOOSTS_BY_PART[part.type]?.has(part.boost))
    ) {
      errors.push(
        `body[${index}] has unsupported boost ${String(part.boost)} for ${String(part.type)}`,
      );
    }
  });
  return errors;
}

function boostMultiplier(
  part: DefenseBodyPartEvidence,
  known: Readonly<Record<string, number>>,
): number {
  if (part.boost === undefined) return 1;
  if (typeof part.boost !== "string") return 4;
  const multiplier = known[part.boost];
  if (multiplier !== undefined) return multiplier;
  // An unknown boost must not cause threat analysis to understate capability.
  return LEGAL_BOOSTS_BY_PART[part.type]?.has(part.boost) ? 1 : 4;
}

/** Profile live combat output only; destroyed parts contribute no pressure. */
export function profileHostileBody(
  body: readonly DefenseBodyPartEvidence[],
): HostileBodyThreatProfile {
  const evidenceErrors = bodyEvidenceErrors(body);
  let activeCombatParts = 0;
  let meleeDamagePerTick = 0;
  let rangedDamagePerTick = 0;
  let dismantleDamagePerTick = 0;
  let healPowerPerTick = 0;
  let claimParts = 0;

  for (const part of body) {
    if (!finiteNonNegative(part.hits) || part.hits <= 0) continue;
    switch (part.type) {
      case "attack":
        activeCombatParts += 1;
        meleeDamagePerTick +=
          ATTACK_POWER * boostMultiplier(part, ATTACK_BOOST_MULTIPLIER);
        break;
      case "ranged_attack":
        activeCombatParts += 1;
        rangedDamagePerTick +=
          RANGED_ATTACK_POWER *
          boostMultiplier(part, RANGED_ATTACK_BOOST_MULTIPLIER);
        break;
      case "work":
        activeCombatParts += 1;
        dismantleDamagePerTick +=
          DISMANTLE_POWER * boostMultiplier(part, DISMANTLE_BOOST_MULTIPLIER);
        break;
      case "heal":
        activeCombatParts += 1;
        healPowerPerTick +=
          HEAL_POWER * boostMultiplier(part, HEAL_BOOST_MULTIPLIER);
        break;
      case "claim":
        activeCombatParts += 1;
        claimParts += 1;
        break;
    }
  }

  // Healing and controller pressure lead because they prolong or disable the
  // siege; the remaining weights are expressed in native per-tick output.
  const threatScore =
    healPowerPerTick * 8 +
    claimParts * 600 +
    rangedDamagePerTick * 6 +
    meleeDamagePerTick * 3 +
    dismantleDamagePerTick * 2;
  return {
    evidenceComplete: evidenceErrors.length === 0,
    evidenceErrors,
    activeCombatParts,
    meleeDamagePerTick,
    rangedDamagePerTick,
    dismantleDamagePerTick,
    healPowerPerTick,
    claimParts,
    threatScore,
  };
}

/**
 * Apply tower damage through the current body in engine order. Unsupported
 * TOUGH boost evidence assumes maximum legal resistance and is marked
 * incomplete by profileHostileBody, avoiding false confidence.
 */
export function towerDamageAfterOrderedTough(
  rawDamage: number,
  body: readonly DefenseBodyPartEvidence[],
): number {
  if (!finiteNonNegative(rawDamage)) return 0;
  let remainingRawDamage = rawDamage;
  let reducedDamage = 0;
  for (const part of body) {
    if (remainingRawDamage <= 0) break;
    if (!finiteNonNegative(part.hits) || part.hits <= 0) continue;
    const ratio =
      part.type === "tough" && part.boost !== undefined
        ? typeof part.boost === "string"
          ? (TOUGH_DAMAGE_MULTIPLIER[part.boost] ?? 0.3)
          : 0.3
        : 1;
    const rawCapacity = Math.min(100, part.hits) / ratio;
    const rawApplied = Math.min(rawCapacity, remainingRawDamage);
    reducedDamage += rawApplied * (1 - ratio);
    remainingRawDamage -= rawApplied;
  }
  // Screeps rounds the aggregate reduction once after ordered part handling.
  return Math.max(0, rawDamage - Math.round(reducedDamage));
}

function hostileEvidenceErrors(hostile: HostileDefenseEvidence): string[] {
  const errors = [...bodyEvidenceErrors(hostile.body)];
  if (hostile.id.length === 0) errors.push("hostile id is empty");
  if (!validRoomCoordinate(hostile.x) || !validRoomCoordinate(hostile.y)) {
    errors.push(`${hostile.id || "hostile"} position is invalid`);
  }
  if (
    !nonNegativeInteger(hostile.hits) ||
    !nonNegativeInteger(hostile.hitsMax) ||
    hostile.hits <= 0 ||
    hostile.hitsMax <= 0 ||
    hostile.hits > hostile.hitsMax
  ) {
    errors.push(`${hostile.id || "hostile"} hit evidence is invalid`);
  }
  const bodyHits = hostile.body.reduce(
    (total, part) =>
      total + (finiteNonNegative(part.hits) ? Math.min(100, part.hits) : 0),
    0,
  );
  if (bodyHits !== hostile.hits) {
    errors.push(
      `${hostile.id || "hostile"} body hits ${bodyHits} do not match creep hits ${hostile.hits}`,
    );
  }
  if (hostile.hitsMax !== hostile.body.length * 100) {
    errors.push(
      `${hostile.id || "hostile"} hitsMax ${hostile.hitsMax} does not match body capacity ${hostile.body.length * 100}`,
    );
  }
  return errors;
}

function towerEvidenceErrors(tower: DefenseTowerEvidence): string[] {
  const errors: string[] = [];
  if (tower.id.length === 0) errors.push("tower id is empty");
  if (!validRoomCoordinate(tower.x) || !validRoomCoordinate(tower.y)) {
    errors.push(`${tower.id || "tower"} position is invalid`);
  }
  if (
    !nonNegativeInteger(tower.energy) ||
    !nonNegativeInteger(tower.energyCapacity) ||
    tower.energyCapacity <= 0 ||
    tower.energy > tower.energyCapacity
  ) {
    errors.push(`${tower.id || "tower"} energy evidence is invalid`);
  }
  return errors;
}

function duplicateIdErrors(
  records: readonly { readonly id: string }[],
  kind: string,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    if (!seen.add(record.id)) duplicates.add(record.id);
  }
  return [...duplicates]
    .sort()
    .map((id) => `duplicate ${kind} id ${id || "<empty>"}`);
}

export function healerPressureAgainst(
  target: HostileDefenseEvidence,
  hostile: HostileDefenseEvidence,
): number {
  const range = rangeBetween(target, hostile);
  const base = range <= 1 ? HEAL_POWER : range <= 3 ? RANGED_HEAL_POWER : 0;
  if (base === 0) return 0;
  return hostile.body.reduce((total, part) => {
    if (part.type !== "heal" || part.hits <= 0) return total;
    return total + base * boostMultiplier(part, HEAL_BOOST_MULTIPLIER);
  }, 0);
}

export function assessDiagnosticTowerTargetFeasibility(
  towers: readonly DefenseTowerEvidence[],
  target: HostileDefenseEvidence,
  hostiles: readonly HostileDefenseEvidence[],
): DiagnosticTowerTargetFeasibility {
  const threat = profileHostileBody(target.body);
  const evidenceErrors = [
    ...hostileEvidenceErrors(target),
    ...towers.flatMap(towerEvidenceErrors),
    ...hostiles.flatMap(hostileEvidenceErrors),
    ...duplicateIdErrors(towers, "tower"),
    ...duplicateIdErrors(hostiles, "hostile"),
  ];
  const energizedTowers = towers.filter(
    (tower) =>
      towerEvidenceErrors(tower).length === 0 &&
      tower.energy >= TOWER_ENERGY_PER_ATTACK,
  );
  const rawVolleyDamage = energizedTowers.reduce(
    (total, tower) =>
      total + preparedTowerAttackPowerAtRange(rangeBetween(tower, target)),
    0,
  );
  const postMitigationVolleyDamage = towerDamageAfterOrderedTough(
    rawVolleyDamage,
    target.body,
  );
  const maximumHealingPressure = hostiles.reduce(
    (total, hostile) => total + healerPressureAgainst(target, hostile),
    0,
  );
  const preHealDamageReachesCurrentHits =
    postMitigationVolleyDamage >= target.hits && target.hits > 0;
  // The engine applies pending damage, then pending healing, then death. Damage
  // exceeding current hits is therefore not decisive when same-tick healing
  // leaves positive resolved hits.
  const netDamageAtCurrentGeometry = Math.min(
    target.hits,
    Math.max(0, postMitigationVolleyDamage - maximumHealingPressure),
  );
  const resolvedVolleyDefeatsTarget =
    netDamageAtCurrentGeometry >= target.hits && target.hits > 0;
  const evidenceComplete = evidenceErrors.length === 0;
  const pressureState: DiagnosticTowerPressureState = !evidenceComplete
    ? "evidence-incomplete"
    : energizedTowers.length === 0
      ? "battery-unavailable"
      : resolvedVolleyDefeatsTarget
        ? "defeating-current-volley-after-healing"
        : netDamageAtCurrentGeometry > 0
          ? "sustainable-at-current-geometry"
          : "healing-stalemate";
  const indicativeVolleysToDefeat =
    netDamageAtCurrentGeometry > 0
      ? Math.ceil(target.hits / netDamageAtCurrentGeometry)
      : null;
  const feasibilityWeight = resolvedVolleyDefeatsTarget
    ? 500
    : netDamageAtCurrentGeometry > 0
      ? 100
      : 0;

  return {
    targetId: target.id,
    evidenceComplete,
    evidenceErrors,
    threat,
    energizedTowerCount: energizedTowers.length,
    rawVolleyDamage,
    postMitigationVolleyDamage,
    maximumHealingPressure,
    netDamageAtCurrentGeometry,
    preHealDamageReachesCurrentHits,
    resolvedVolleyDefeatsTarget,
    indicativeVolleysToDefeat,
    pressureState,
    targetingScore: threat.threatScore + feasibilityWeight,
  };
}

/** Deterministic decision support only; this function cannot issue combat work. */
export function rankPreparedDefenseTargets(
  towers: readonly DefenseTowerEvidence[],
  hostiles: readonly HostileDefenseEvidence[],
): DiagnosticTowerTargetFeasibility[] {
  return hostiles
    .map((hostile) =>
      assessDiagnosticTowerTargetFeasibility(towers, hostile, hostiles),
    )
    .sort(
      (left, right) =>
        Number(left.evidenceComplete) - Number(right.evidenceComplete) ||
        right.targetingScore - left.targetingScore ||
        right.threat.threatScore - left.threat.threatScore ||
        right.netDamageAtCurrentGeometry - left.netDamageAtCurrentGeometry ||
        left.targetId.localeCompare(right.targetId),
    );
}

function safeModeFallback(
  evidence: SafeModeEvidence,
): PreparedDefenseOperationalHealthCapInput["safeModeFallback"] {
  switch (evidence.state) {
    case "active":
      return finiteNonNegative(evidence.remainingTicks) &&
        evidence.remainingTicks > 0
        ? "active"
        : "unknown";
    case "available":
      return finiteNonNegative(evidence.availableActivations) &&
        evidence.availableActivations > 0
        ? "available"
        : "unknown";
    case "cooldown":
    case "unavailable":
      return "unavailable";
    case "unknown":
      return "unknown";
  }
}

function safeModeEvidenceErrors(evidence: SafeModeEvidence): string[] {
  switch (evidence.state) {
    case "active":
      return nonNegativeInteger(evidence.remainingTicks) &&
        evidence.remainingTicks > 0
        ? []
        : ["active safe-mode remaining ticks are invalid"];
    case "available":
      return nonNegativeInteger(evidence.availableActivations) &&
        evidence.availableActivations > 0
        ? []
        : ["available safe-mode count is invalid"];
    case "cooldown":
      return nonNegativeInteger(evidence.availableActivations) &&
        nonNegativeInteger(evidence.cooldownTicks) &&
        evidence.cooldownTicks > 0
        ? []
        : ["safe-mode cooldown evidence is invalid"];
    case "unavailable":
      return [];
    case "unknown":
      return ["safe-mode evidence is unavailable"];
  }
}

/**
 * Fail-closed cap for operational health. This does not create an FSPM KPI,
 * and callers cannot toggle creep-combat authority through its input.
 */
export function preparedDefenseOperationalHealthCap(
  input: PreparedDefenseOperationalHealthCapInput,
): PreparedDefenseOperationalHealthCap {
  const debt = new Set<PreparedDefenseReadinessDebtCode>();
  let cap: number | null = null;
  const applyCap = (candidate: number): void => {
    cap = cap === null ? candidate : Math.min(cap, candidate);
  };

  const controllerLevelValid =
    Number.isInteger(input.controllerLevel) &&
    input.controllerLevel >= 0 &&
    input.controllerLevel <= 8;
  const countsValid =
    nonNegativeInteger(input.hostileCount) &&
    nonNegativeInteger(input.incomingNukeCount) &&
    nonNegativeInteger(input.unprotectedNukeCount) &&
    input.unprotectedNukeCount <= input.incomingNukeCount;
  const ratioValid = (ratio: number | null): boolean =>
    ratio === null || (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1);
  const coverageConsistent =
    (input.hostileCount === 0 &&
      input.towerCoverage === "no-hostiles-observed") ||
    (input.hostileCount > 0 && input.towerCoverage !== "no-hostiles-observed");
  const capEvidenceComplete =
    input.evidenceComplete &&
    controllerLevelValid &&
    countsValid &&
    ratioValid(input.towerReserveRatio) &&
    ratioValid(input.strategicEnergyReserveRatio) &&
    coverageConsistent;
  const towerReserveApplicable =
    controllerLevelValid && Math.floor(input.controllerLevel) >= 3;
  const strategicEnergyReserveApplicable =
    controllerLevelValid && Math.floor(input.controllerLevel) >= 4;

  if (towerReserveApplicable) {
    debt.add(PREPARED_CREEP_COMBAT_AUTHORITY_DEBT.code);
    applyCap(84);
  }
  if (!capEvidenceComplete) {
    debt.add("defense_evidence_incomplete");
    applyCap(40);
  }
  if (input.unprotectedNukeCount > 0) {
    debt.add("incoming_nuke_protection_gap");
    applyCap(25);
  }
  if (
    towerReserveApplicable &&
    (input.towerReserveRatio === null || input.towerReserveRatio < 0.5)
  ) {
    debt.add("tower_reserve_below_half");
    applyCap(input.hostileCount > 0 ? 40 : 59);
  }
  if (
    strategicEnergyReserveApplicable &&
    (input.strategicEnergyReserveRatio === null ||
      input.strategicEnergyReserveRatio < 0.5)
  ) {
    debt.add("strategic_energy_reserve_below_half");
    applyCap(input.hostileCount > 0 ? 40 : 59);
  }
  if (
    input.hostileCount > 0 &&
    (input.towerCoverage === "infeasible" ||
      input.towerCoverage === "indeterminate")
  ) {
    debt.add("tower_battery_infeasible");
    applyCap(
      input.safeModeFallback === "active" ||
        input.safeModeFallback === "available"
        ? 40
        : 25,
    );
  } else if (input.hostileCount > 0 && input.towerCoverage === "partial") {
    debt.add("tower_battery_infeasible");
    applyCap(59);
  }
  if (
    input.hostileCount > 0 &&
    input.safeModeFallback !== "active" &&
    input.safeModeFallback !== "available"
  ) {
    debt.add("safe_mode_fallback_unavailable");
    if (
      input.towerCoverage === "infeasible" ||
      input.towerCoverage === "indeterminate"
    ) {
      applyCap(25);
    }
  }

  return { cap, debt: [...debt].sort() };
}

export function assessPreparedActiveDefense(
  input: PreparedActiveDefenseInput,
): PreparedActiveDefenseReadiness {
  const rankedTargets = rankPreparedDefenseTargets(
    input.towers,
    input.hostiles,
  );
  const evidenceErrors: string[] = [
    ...input.towers.flatMap(towerEvidenceErrors),
    ...input.hostiles.flatMap(hostileEvidenceErrors),
    ...duplicateIdErrors(input.towers, "tower"),
    ...duplicateIdErrors(input.hostiles, "hostile"),
  ];
  if (
    !Number.isInteger(input.controllerLevel) ||
    input.controllerLevel < 0 ||
    input.controllerLevel > 8
  ) {
    evidenceErrors.push("controller level is outside 0..8");
  }
  const towerEnergy = input.towers.reduce(
    (total, tower) =>
      total + (finiteNonNegative(tower.energy) ? tower.energy : 0),
    0,
  );
  const towerCapacity = input.towers.reduce(
    (total, tower) =>
      total +
      (finiteNonNegative(tower.energyCapacity) ? tower.energyCapacity : 0),
    0,
  );
  const towerReserveRatio =
    towerCapacity > 0 ? Math.min(1, towerEnergy / towerCapacity) : null;
  const towerReserveApplicable = Math.floor(input.controllerLevel) >= 3;
  const validTowerVolleys = input.towers
    .filter((tower) => towerEvidenceErrors(tower).length === 0)
    .map((tower) => Math.floor(tower.energy / TOWER_ENERGY_PER_ATTACK));
  const fullBatteryVolleysAvailable =
    validTowerVolleys.length > 0 ? Math.min(...validTowerVolleys) : 0;

  const { storageEnergy, terminalEnergy, reserveTarget } = input.energy;
  const boundedControllerLevel = Math.max(
    0,
    Math.min(8, Math.floor(input.controllerLevel)),
  );
  const storageApplicable = boundedControllerLevel >= 4;
  const terminalApplicable = boundedControllerLevel >= 6;
  const strategicEnergyReserveApplicable = storageApplicable;
  if (
    (storageApplicable && storageEnergy === null) ||
    (storageEnergy !== null && !finiteNonNegative(storageEnergy))
  ) {
    evidenceErrors.push("storage energy evidence is unavailable or invalid");
  }
  if (
    (terminalApplicable && terminalEnergy === null) ||
    (terminalEnergy !== null && !finiteNonNegative(terminalEnergy))
  ) {
    evidenceErrors.push("terminal energy evidence is unavailable or invalid");
  }
  if (
    !finiteNonNegative(reserveTarget) ||
    (strategicEnergyReserveApplicable && reserveTarget <= 0)
  ) {
    evidenceErrors.push("strategic energy reserve target is invalid");
  }
  const strategicEnergyReserve =
    (!storageApplicable ||
      (storageEnergy !== null && finiteNonNegative(storageEnergy))) &&
    (!terminalApplicable ||
      (terminalEnergy !== null && finiteNonNegative(terminalEnergy)))
      ? (storageEnergy ?? 0) + (terminalEnergy ?? 0)
      : null;
  const strategicEnergyReserveRatio =
    strategicEnergyReserveApplicable &&
    strategicEnergyReserve !== null &&
    reserveTarget > 0
      ? Math.min(1, strategicEnergyReserve / reserveTarget)
      : null;

  const fallback = safeModeFallback(input.safeMode);
  evidenceErrors.push(...safeModeEvidenceErrors(input.safeMode));
  const incomingNukeIds = duplicateIdErrors(input.incomingNukes, "nuke");
  evidenceErrors.push(...incomingNukeIds);
  const unprotectedNukes = [...input.incomingNukes]
    .filter((nuke) => {
      if (
        nuke.id.length === 0 ||
        !nonNegativeInteger(nuke.ticksToLand) ||
        !nonNegativeInteger(nuke.criticalAssetsInBlast) ||
        !nonNegativeInteger(nuke.minimumProtectiveRampartHits) ||
        !nonNegativeInteger(nuke.requiredProtectiveRampartHits) ||
        (nuke.criticalAssetsInBlast > 0 &&
          nuke.requiredProtectiveRampartHits === 0)
      ) {
        evidenceErrors.push(
          `incoming nuke ${nuke.id || "<unknown>"} is invalid`,
        );
        return true;
      }
      return (
        nuke.criticalAssetsInBlast > 0 &&
        nuke.minimumProtectiveRampartHits < nuke.requiredProtectiveRampartHits
      );
    })
    .sort(
      (left, right) =>
        left.ticksToLand - right.ticksToLand || left.id.localeCompare(right.id),
    );

  const decisiveOrSustainable = new Set<DiagnosticTowerPressureState>([
    "defeating-current-volley-after-healing",
    "sustainable-at-current-geometry",
  ]);
  const towerCoverage: PreparedTowerCoverageState =
    input.hostiles.length === 0
      ? "no-hostiles-observed"
      : rankedTargets.some((target) => !target.evidenceComplete)
        ? "indeterminate"
        : rankedTargets.every((target) =>
              decisiveOrSustainable.has(target.pressureState),
            )
          ? "sustainable"
          : rankedTargets.some((target) =>
                decisiveOrSustainable.has(target.pressureState),
              )
            ? "partial"
            : "infeasible";
  const evidenceComplete = evidenceErrors.length === 0;
  const operationalHealth = preparedDefenseOperationalHealthCap({
    controllerLevel: input.controllerLevel,
    hostileCount: input.hostiles.length,
    towerCoverage,
    towerReserveRatio,
    strategicEnergyReserveRatio,
    safeModeFallback: fallback,
    incomingNukeCount: input.incomingNukes.length,
    unprotectedNukeCount: unprotectedNukes.length,
    evidenceComplete,
  });

  return {
    authority: PREPARED_CREEP_COMBAT_AUTHORITY_DEBT,
    evidenceComplete,
    evidenceErrors: [...new Set(evidenceErrors)].sort(),
    rankedTargets,
    towerCoverage,
    towerReserveApplicable,
    towerReserveRatio,
    fullBatteryVolleysAvailable,
    strategicEnergyReserve,
    strategicEnergyReserveApplicable,
    strategicEnergyReserveRatio,
    safeModeFallback: fallback,
    unprotectedNukes,
    operationalHealth,
  };
}
