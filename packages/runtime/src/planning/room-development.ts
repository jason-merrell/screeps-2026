import type {
  RoomDevelopmentStage,
  RoomDevelopmentStageId,
  RoomPlan,
  RoomPlanRoad,
  RoomPlanStructure,
} from "./room-plan";
import {
  ROOM_DEVELOPMENT_STAGES,
  ROOM_PLAN_HORIZON_RCL,
  ROOM_PLAN_VERSION,
} from "./room-plan";

/** A deliberately small plan surface keeps the evaluator deterministic and easy to replay. */
export interface RoomDevelopmentPlanSnapshot {
  readonly version: number;
  readonly horizonRcl: number;
  readonly stages?: readonly RoomDevelopmentStage[];
  readonly structures: readonly RoomPlanStructure[];
  readonly roads?: readonly RoomPlanRoad[];
}

/** Built structures only: construction sites are intent, not realized outcomes. */
export interface ObservedRoomStructure {
  readonly structureType: StructureConstant;
  readonly x: number;
  readonly y: number;
}

/** Owned construction intent at an exact planned coordinate; never realized outcome evidence. */
export interface ObservedRoomConstructionSite {
  readonly structureType: BuildableStructureConstant;
  readonly x: number;
  readonly y: number;
}

/**
 * A blocker is supplied by construction/reconciliation policy. The evaluator does not guess
 * whether another structure can legally share a tile (roads and ramparts make that ambiguous).
 */
export interface RoomDevelopmentStructureBlocker {
  readonly plannedStructureId: string;
  readonly reason: string;
}

export interface RoomDevelopmentEvaluationInput {
  readonly controllerLevel: number;
  readonly plan: RoomDevelopmentPlanSnapshot;
  readonly structures: readonly ObservedRoomStructure[];
  readonly constructionSites?: readonly ObservedRoomConstructionSite[];
  readonly blockedStructures?: readonly RoomDevelopmentStructureBlocker[];
}

export type RoomDevelopmentHorizonStatus =
  | "v4_rcl8"
  | "legacy_horizon_gap"
  | "invalid_v4_plan";

export type RoomDevelopmentStageStatus =
  | "horizon_gap"
  | "invalid_plan"
  | "controller_ineligible"
  | "prerequisite_blocked"
  | "not_started"
  | "in_progress"
  | "blocked"
  | "realized";

export interface RoomDevelopmentStructureEvaluation {
  readonly plannedStructureId: string;
  readonly stageId: RoomDevelopmentStageId;
  readonly structureType: BuildableStructureConstant;
  readonly x: number;
  readonly y: number;
  readonly minRcl: number;
  readonly priority: number;
  readonly strategicWeight: number;
  readonly controllerEligible: boolean;
  readonly realized: boolean;
  readonly underConstruction: boolean;
  readonly blocked: boolean;
  readonly blockerReasons: readonly string[];
}

export interface RoomDevelopmentStageEvaluation {
  readonly id: RoomDevelopmentStageId;
  readonly title: string;
  readonly minRcl: number;
  readonly stageWeight: number;
  readonly prerequisiteStageIds: readonly RoomDevelopmentStageId[];
  readonly controllerEligible: boolean;
  readonly prerequisitesSatisfied: boolean;
  readonly status: RoomDevelopmentStageStatus;
  /** All required structures through the plan's RCL8 horizon. */
  readonly requiredStructures: readonly RoomDevelopmentStructureEvaluation[];
  /** Required structures whose own minRcl is legal at the current controller level. */
  readonly eligibleStructures: readonly RoomDevelopmentStructureEvaluation[];
  readonly futureStructures: readonly RoomDevelopmentStructureEvaluation[];
  readonly realizedStructures: readonly RoomDevelopmentStructureEvaluation[];
  readonly missingStructures: readonly RoomDevelopmentStructureEvaluation[];
  /** Missing eligible structures with an explicit reconciliation/construction blocker. */
  readonly blockedStructures: readonly RoomDevelopmentStructureEvaluation[];
  readonly eligibleRequiredWeight: number;
  readonly realizedRequiredWeight: number;
  /** Null means the stage is not controller-eligible or its horizon cannot be evaluated. */
  readonly realizationPercentage: number | null;
}

export type RoomDevelopmentMilestoneKind =
  | "replace_legacy_plan"
  | "repair_v4_plan"
  | "resolve_structure_blocker"
  | "complete_structure_site"
  | "realize_structure"
  | "reach_controller_level"
  | "mature_outcome_realized";

export interface RoomDevelopmentMilestone {
  readonly kind: RoomDevelopmentMilestoneKind;
  readonly stageId: RoomDevelopmentStageId | null;
  readonly plannedStructureId: string | null;
  readonly reason: string;
}

export interface RoomDevelopmentEvaluation {
  readonly horizonStatus: RoomDevelopmentHorizonStatus;
  readonly controllerLevel: number;
  /** Empty for a valid plan. Legacy and invalid plans explain why scoring was withheld. */
  readonly validationIssues: readonly string[];
  readonly stages: readonly RoomDevelopmentStageEvaluation[];
  readonly missingStructures: readonly RoomDevelopmentStructureEvaluation[];
  readonly blockedStructures: readonly RoomDevelopmentStructureEvaluation[];
  /** The earliest eligible, prerequisite-satisfied stage not yet realized. */
  readonly activeStageId: RoomDevelopmentStageId | null;
  /** The stage after active, or the first controller-ineligible stage after current completion. */
  readonly nextStageId: RoomDevelopmentStageId | null;
  readonly eligibleStageWeight: number;
  /** Sum of stage weight multiplied by each eligible stage's internal realization ratio. */
  readonly realizedStageWeight: number;
  /** Null is intentional when the plan cannot truthfully evidence the v4/RCL8 horizon. */
  readonly overallEligibleRealizationPercentage: number | null;
  readonly nextMilestone: RoomDevelopmentMilestone;
}

const MAX_ROOM_COORDINATE = 49;
const MIN_CONTROLLER_LEVEL = 0;
const MAX_CONTROLLER_LEVEL = 8;

export type CanonicalMatureStructureType =
  | "extension"
  | "tower"
  | "spawn"
  | "storage"
  | "terminal"
  | "link"
  | "lab"
  | "extractor"
  | "factory"
  | "observer"
  | "powerSpawn"
  | "nuker";

export const CANONICAL_MATURE_STRUCTURE_COUNTS = Object.freeze({
  extension: 60,
  tower: 6,
  spawn: 3,
  storage: 1,
  terminal: 1,
  link: 6,
  lab: 10,
  extractor: 1,
  factory: 1,
  observer: 1,
  powerSpawn: 1,
  nuker: 1,
}) satisfies Readonly<Record<CanonicalMatureStructureType, number>>;

export const CANONICAL_STRUCTURE_COUNTS_BY_RCL = Object.freeze({
  extension: Object.freeze([0, 0, 5, 10, 20, 30, 40, 50, 60]),
  tower: Object.freeze([0, 0, 0, 1, 1, 2, 2, 3, 6]),
  spawn: Object.freeze([0, 1, 1, 1, 1, 1, 1, 2, 3]),
  storage: Object.freeze([0, 0, 0, 0, 1, 1, 1, 1, 1]),
  terminal: Object.freeze([0, 0, 0, 0, 0, 0, 1, 1, 1]),
  link: Object.freeze([0, 0, 0, 0, 0, 2, 3, 4, 6]),
  lab: Object.freeze([0, 0, 0, 0, 0, 0, 3, 6, 10]),
  extractor: Object.freeze([0, 0, 0, 0, 0, 0, 1, 1, 1]),
  factory: Object.freeze([0, 0, 0, 0, 0, 0, 0, 1, 1]),
  observer: Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 1]),
  powerSpawn: Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 1]),
  nuker: Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 1]),
}) satisfies Readonly<Record<CanonicalMatureStructureType, readonly number[]>>;

interface PlannedDevelopmentRequirement {
  readonly id: string;
  readonly stage?: RoomDevelopmentStageId;
  readonly structureType: BuildableStructureConstant;
  readonly x: number;
  readonly y: number;
  readonly minRcl: number;
  readonly priority: number;
  readonly strategicWeight?: number;
  readonly requiredForStage?: boolean;
}

const NEUTRAL_DEVELOPMENT_STRUCTURE_TYPES = new Set<StructureConstant>([
  "container",
  "road",
]);

interface DevelopmentEvidenceCandidate {
  readonly structureType: StructureConstant;
  readonly my?: boolean;
}

/** Roads and containers are neutral in Screeps; all other evidence must be owned. */
export function isDevelopmentEvidenceStructure(
  structure: DevelopmentEvidenceCandidate,
): boolean {
  return (
    NEUTRAL_DEVELOPMENT_STRUCTURE_TYPES.has(structure.structureType) ||
    structure.my === true
  );
}

/** Final-state overlap rules shared by blocker detection and construction. */
export function canShareDevelopmentTile(
  existing: StructureConstant,
  planned: BuildableStructureConstant,
): boolean {
  return (
    existing === planned ||
    existing === "rampart" ||
    planned === "rampart" ||
    ((existing === "road" || planned === "road") &&
      (existing === "container" || planned === "container"))
  );
}

function roundPercentage(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 100_000) / 1_000;
}

function isValidCoordinate(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_ROOM_COORDINATE;
}

function structureKey(structure: ObservedRoomStructure): string {
  return `${structure.structureType}:${structure.x}:${structure.y}`;
}

function constructionSiteKey(site: ObservedRoomConstructionSite): string {
  return `${site.structureType}:${site.x}:${site.y}`;
}

function plannedStructureKey(structure: PlannedDevelopmentRequirement): string {
  return `${structure.structureType}:${structure.x}:${structure.y}`;
}

function plannedRequirements(
  plan: RoomDevelopmentPlanSnapshot,
): PlannedDevelopmentRequirement[] {
  return [
    ...plan.structures,
    ...(plan.roads ?? []).map((road) => ({
      ...road,
      structureType: "road" as const,
      priority: 0,
    })),
  ];
}

/**
 * Pure publication/admission invariant for the fixed strategic RCL8 inventory.
 * Variable roads, containers, and ramparts are validated elsewhere because
 * terrain and source count determine their legal mature quantity.
 */
export function validateCanonicalRoomPlanInventory(
  plan: Pick<RoomDevelopmentPlanSnapshot, "structures">,
): string[] {
  const issues: string[] = [];
  for (const [structureType, target] of Object.entries(
    CANONICAL_MATURE_STRUCTURE_COUNTS,
  ) as Array<[CanonicalMatureStructureType, number]>) {
    const structures = plan.structures.filter(
      (structure) => structure.structureType === structureType,
    );
    if (structures.length !== target) {
      issues.push(
        `canonical RCL8 inventory requires exactly ${target} ${structureType} structures; received ${structures.length}`,
      );
    }

    for (let rcl = 1; rcl < ROOM_PLAN_HORIZON_RCL; rcl += 1) {
      const expected =
        CANONICAL_STRUCTURE_COUNTS_BY_RCL[structureType][rcl] ?? 0;
      const committed = structures.filter(
        (structure) => structure.minRcl <= rcl,
      ).length;
      if (committed !== expected) {
        issues.push(
          `canonical ${structureType} progression at RCL${rcl} requires exactly ${expected} structures; received ${committed}`,
        );
      }
    }
  }
  return issues;
}

function sameStageIds(
  actual: readonly RoomDevelopmentStageId[],
  expected: readonly RoomDevelopmentStageId[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

function validateV4Plan(input: RoomDevelopmentEvaluationInput): string[] {
  const issues: string[] = [];
  const { controllerLevel, plan } = input;

  if (
    !Number.isInteger(controllerLevel) ||
    controllerLevel < MIN_CONTROLLER_LEVEL ||
    controllerLevel > MAX_CONTROLLER_LEVEL
  ) {
    issues.push(
      `controllerLevel must be an integer from 0 through 8; received ${controllerLevel}`,
    );
  }

  if (plan.version !== ROOM_PLAN_VERSION) {
    issues.push(
      `expected room-plan version ${ROOM_PLAN_VERSION}; received ${plan.version}`,
    );
  }
  if (plan.horizonRcl !== ROOM_PLAN_HORIZON_RCL) {
    issues.push(
      `expected an RCL${ROOM_PLAN_HORIZON_RCL} horizon; received RCL${plan.horizonRcl}`,
    );
  }

  const stages = plan.stages;
  if (!stages) {
    issues.push("v4 plan is missing its development-stage catalog");
  } else {
    if (stages.length !== ROOM_DEVELOPMENT_STAGES.length) {
      issues.push(
        `expected ${ROOM_DEVELOPMENT_STAGES.length} development stages; received ${stages.length}`,
      );
    }

    for (const [index, expected] of ROOM_DEVELOPMENT_STAGES.entries()) {
      const actual = stages[index];
      if (!actual) {
        issues.push(`missing development stage ${expected.id}`);
        continue;
      }
      if (actual.id !== expected.id) {
        issues.push(
          `stage ${index + 1} must be ${expected.id}; received ${actual.id}`,
        );
        continue;
      }
      if (actual.minRcl !== expected.minRcl) {
        issues.push(
          `stage ${expected.id} must unlock at RCL${expected.minRcl}; received RCL${actual.minRcl}`,
        );
      }
      if (actual.weight !== expected.weight) {
        issues.push(
          `stage ${expected.id} must carry weight ${expected.weight}; received ${actual.weight}`,
        );
      }
      if (
        !sameStageIds(
          actual.prerequisiteStageIds,
          expected.prerequisiteStageIds,
        )
      ) {
        issues.push(`stage ${expected.id} has non-canonical prerequisites`);
      }
    }
  }

  const seenIds = new Set<string>();
  const seenPlacements = new Set<string>();
  const requiredCounts = new Map<RoomDevelopmentStageId, number>();
  const initiallyEligibleCounts = new Map<RoomDevelopmentStageId, number>();

  for (const structure of plannedRequirements(plan)) {
    if (structure.requiredForStage !== true) continue;

    if (!structure.id.trim()) {
      issues.push("required structures must have a non-empty id");
    }
    if (seenIds.has(structure.id)) {
      issues.push(`required structure id ${structure.id} is duplicated`);
    }
    seenIds.add(structure.id);

    const placement = plannedStructureKey(structure);
    if (seenPlacements.has(placement)) {
      issues.push(`required placement ${placement} is duplicated`);
    }
    seenPlacements.add(placement);

    if (!structure.stage) {
      issues.push(
        `required structure ${structure.id} has no development stage`,
      );
      continue;
    }
    const canonicalStage = ROOM_DEVELOPMENT_STAGES.find(
      (stage) => stage.id === structure.stage,
    );
    if (!canonicalStage) {
      issues.push(
        `required structure ${structure.id} references unknown stage ${structure.stage}`,
      );
      continue;
    }

    requiredCounts.set(
      structure.stage,
      (requiredCounts.get(structure.stage) ?? 0) + 1,
    );
    if (structure.minRcl <= canonicalStage.minRcl) {
      initiallyEligibleCounts.set(
        structure.stage,
        (initiallyEligibleCounts.get(structure.stage) ?? 0) + 1,
      );
    }

    if (
      !Number.isFinite(structure.strategicWeight) ||
      (structure.strategicWeight ?? 0) <= 0
    ) {
      issues.push(
        `required structure ${structure.id} must have a positive strategicWeight`,
      );
    }
    if (
      !Number.isInteger(structure.minRcl) ||
      structure.minRcl < 1 ||
      structure.minRcl > ROOM_PLAN_HORIZON_RCL
    ) {
      issues.push(
        `required structure ${structure.id} has invalid minRcl ${structure.minRcl}`,
      );
    }
    if (!isValidCoordinate(structure.x) || !isValidCoordinate(structure.y)) {
      issues.push(
        `required structure ${structure.id} has an invalid room coordinate`,
      );
    }
    if (!Number.isFinite(structure.priority)) {
      issues.push(
        `required structure ${structure.id} has invalid priority ${structure.priority}`,
      );
    }
  }

  for (const stage of ROOM_DEVELOPMENT_STAGES) {
    if ((requiredCounts.get(stage.id) ?? 0) === 0) {
      issues.push(`stage ${stage.id} has no required structure evidence`);
    } else if ((initiallyEligibleCounts.get(stage.id) ?? 0) === 0) {
      issues.push(
        `stage ${stage.id} has no requirement eligible at its RCL${stage.minRcl} unlock`,
      );
    }
  }

  return [...new Set(issues)];
}

/** Pure schema/development-catalog validation for projection admission gates. */
export function validateRoomDevelopmentPlan(
  plan: RoomDevelopmentPlanSnapshot,
): string[] {
  return [
    ...new Set([
      ...validateV4Plan({
        controllerLevel: 0,
        plan,
        structures: [],
        constructionSites: [],
        blockedStructures: [],
      }),
      ...validateCanonicalRoomPlanInventory(plan),
    ]),
  ];
}

function emptyStageEvaluations(
  controllerLevel: number,
  status: "horizon_gap" | "invalid_plan",
): RoomDevelopmentStageEvaluation[] {
  return ROOM_DEVELOPMENT_STAGES.map((stage) => ({
    id: stage.id,
    title: stage.title,
    minRcl: stage.minRcl,
    stageWeight: stage.weight,
    prerequisiteStageIds: stage.prerequisiteStageIds,
    controllerEligible: controllerLevel >= stage.minRcl,
    prerequisitesSatisfied: false,
    status,
    requiredStructures: [],
    eligibleStructures: [],
    futureStructures: [],
    realizedStructures: [],
    missingStructures: [],
    blockedStructures: [],
    eligibleRequiredWeight: 0,
    realizedRequiredWeight: 0,
    realizationPercentage: null,
  }));
}

function unevaluableResult(
  input: RoomDevelopmentEvaluationInput,
  horizonStatus: "legacy_horizon_gap" | "invalid_v4_plan",
  issues: readonly string[],
): RoomDevelopmentEvaluation {
  const legacy = horizonStatus === "legacy_horizon_gap";
  const reason = legacy
    ? `Room plan v${input.plan.version} has an RCL${input.plan.horizonRcl} horizon and cannot evidence the five-stage v4/RCL8 development outcome. Generate the required operational v4/RCL8 projection before reporting realization health.`
    : `The v4/RCL8 plan cannot be scored safely: ${issues.join("; ")}.`;

  return {
    horizonStatus,
    controllerLevel: input.controllerLevel,
    validationIssues: issues,
    stages: emptyStageEvaluations(
      input.controllerLevel,
      legacy ? "horizon_gap" : "invalid_plan",
    ),
    missingStructures: [],
    blockedStructures: [],
    activeStageId: null,
    nextStageId: null,
    eligibleStageWeight: 0,
    realizedStageWeight: 0,
    overallEligibleRealizationPercentage: null,
    nextMilestone: {
      kind: legacy ? "replace_legacy_plan" : "repair_v4_plan",
      stageId: null,
      plannedStructureId: null,
      reason,
    },
  };
}

function compareRequirements(
  left: RoomDevelopmentStructureEvaluation,
  right: RoomDevelopmentStructureEvaluation,
): number {
  return (
    right.strategicWeight - left.strategicWeight ||
    right.priority - left.priority ||
    left.plannedStructureId.localeCompare(right.plannedStructureId)
  );
}

function evaluateValidV4Plan(
  input: RoomDevelopmentEvaluationInput,
): RoomDevelopmentEvaluation {
  const observedPlacements = new Set(input.structures.map(structureKey));
  const constructionPlacements = new Set(
    (input.constructionSites ?? []).map(constructionSiteKey),
  );
  const blockerReasons = new Map<string, string[]>();
  for (const blocker of input.blockedStructures ?? []) {
    const reason = blocker.reason.trim();
    if (!reason) continue;
    const reasons = blockerReasons.get(blocker.plannedStructureId) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    blockerReasons.set(blocker.plannedStructureId, reasons);
  }

  const requirements = new Map<
    RoomDevelopmentStageId,
    RoomDevelopmentStructureEvaluation[]
  >();
  for (const stage of ROOM_DEVELOPMENT_STAGES) requirements.set(stage.id, []);

  for (const planned of plannedRequirements(input.plan)) {
    if (
      planned.requiredForStage !== true ||
      !planned.stage ||
      planned.strategicWeight === undefined
    ) {
      continue;
    }

    const controllerEligible = input.controllerLevel >= planned.minRcl;
    const realized = observedPlacements.has(plannedStructureKey(planned));
    const underConstruction =
      !realized && constructionPlacements.has(plannedStructureKey(planned));
    const reasons = realized ? [] : (blockerReasons.get(planned.id) ?? []);
    requirements.get(planned.stage)?.push({
      plannedStructureId: planned.id,
      stageId: planned.stage,
      structureType: planned.structureType,
      x: planned.x,
      y: planned.y,
      minRcl: planned.minRcl,
      priority: planned.priority,
      strategicWeight: planned.strategicWeight,
      controllerEligible,
      realized,
      underConstruction,
      blocked: !realized && reasons.length > 0,
      blockerReasons: reasons,
    });
  }

  const stages: RoomDevelopmentStageEvaluation[] = [];
  const stageById = new Map<
    RoomDevelopmentStageId,
    RoomDevelopmentStageEvaluation
  >();

  for (const stage of ROOM_DEVELOPMENT_STAGES) {
    const requiredStructures = [...(requirements.get(stage.id) ?? [])].sort(
      compareRequirements,
    );
    const controllerEligible = input.controllerLevel >= stage.minRcl;
    const eligibleStructures = controllerEligible
      ? requiredStructures.filter((structure) => structure.controllerEligible)
      : [];
    const futureStructures = requiredStructures.filter(
      (structure) => !structure.controllerEligible,
    );
    const realizedStructures = eligibleStructures.filter(
      (structure) => structure.realized,
    );
    const missingStructures = eligibleStructures.filter(
      (structure) => !structure.realized,
    );
    const blockedStructures = missingStructures.filter(
      (structure) => structure.blocked,
    );
    const eligibleRequiredWeight = eligibleStructures.reduce(
      (total, structure) => total + structure.strategicWeight,
      0,
    );
    const realizedRequiredWeight = realizedStructures.reduce(
      (total, structure) => total + structure.strategicWeight,
      0,
    );
    const realizationPercentage = controllerEligible
      ? roundPercentage(realizedRequiredWeight, eligibleRequiredWeight)
      : null;
    const prerequisitesSatisfied = stage.prerequisiteStageIds.every(
      (prerequisiteId) => stageById.get(prerequisiteId)?.status === "realized",
    );

    let status: RoomDevelopmentStageStatus;
    if (!controllerEligible) {
      status = "controller_ineligible";
    } else if (!prerequisitesSatisfied) {
      status = "prerequisite_blocked";
    } else if (realizedRequiredWeight === eligibleRequiredWeight) {
      status = "realized";
    } else if (blockedStructures.length > 0) {
      status = "blocked";
    } else if (realizedRequiredWeight === 0) {
      status = "not_started";
    } else {
      status = "in_progress";
    }

    const evaluation: RoomDevelopmentStageEvaluation = {
      id: stage.id,
      title: stage.title,
      minRcl: stage.minRcl,
      stageWeight: stage.weight,
      prerequisiteStageIds: stage.prerequisiteStageIds,
      controllerEligible,
      prerequisitesSatisfied,
      status,
      requiredStructures,
      eligibleStructures,
      futureStructures,
      realizedStructures,
      missingStructures,
      blockedStructures,
      eligibleRequiredWeight,
      realizedRequiredWeight,
      realizationPercentage,
    };
    stages.push(evaluation);
    stageById.set(stage.id, evaluation);
  }

  const activeIndex = stages.findIndex(
    (stage) =>
      stage.controllerEligible &&
      stage.prerequisitesSatisfied &&
      stage.status !== "realized",
  );
  const firstIneligibleIndex = stages.findIndex(
    (stage) => !stage.controllerEligible,
  );
  const activeStage = activeIndex >= 0 ? stages[activeIndex] : undefined;
  const nextStage =
    activeIndex >= 0
      ? stages[activeIndex + 1]
      : firstIneligibleIndex >= 0
        ? stages[firstIneligibleIndex]
        : undefined;

  const eligibleStages = stages.filter((stage) => stage.controllerEligible);
  const eligibleStageWeight = eligibleStages.reduce(
    (total, stage) => total + stage.stageWeight,
    0,
  );
  const realizedStageWeight = eligibleStages.reduce(
    (total, stage) =>
      total +
      stage.stageWeight *
        (stage.realizedRequiredWeight / stage.eligibleRequiredWeight),
    0,
  );
  const overallEligibleRealizationPercentage =
    eligibleStageWeight > 0
      ? roundPercentage(realizedStageWeight, eligibleStageWeight)
      : null;

  let nextMilestone: RoomDevelopmentMilestone;
  if (activeStage) {
    const requirement = [...activeStage.missingStructures].sort(
      compareRequirements,
    )[0];
    if (!requirement) {
      // Valid plans cannot reach this branch, but the fail-closed explanation keeps telemetry honest.
      nextMilestone = {
        kind: "repair_v4_plan",
        stageId: activeStage.id,
        plannedStructureId: null,
        reason: `${activeStage.title} is incomplete but exposes no missing eligible requirement. Repair its v4 evidence metadata.`,
      };
    } else if (requirement.blocked) {
      nextMilestone = {
        kind: "resolve_structure_blocker",
        stageId: activeStage.id,
        plannedStructureId: requirement.plannedStructureId,
        reason: `${activeStage.title} requires ${requirement.structureType} at (${requirement.x}, ${requirement.y}), but it is blocked: ${requirement.blockerReasons.join("; ")}.`,
      };
    } else if (requirement.underConstruction) {
      nextMilestone = {
        kind: "complete_structure_site",
        stageId: activeStage.id,
        plannedStructureId: requirement.plannedStructureId,
        reason: `${activeStage.title} is ${activeStage.realizationPercentage}% realized. Complete the owned ${requirement.structureType} construction site at (${requirement.x}, ${requirement.y}) next.`,
      };
    } else {
      nextMilestone = {
        kind: "realize_structure",
        stageId: activeStage.id,
        plannedStructureId: requirement.plannedStructureId,
        reason: `${activeStage.title} is ${activeStage.realizationPercentage}% realized. Realize ${requirement.structureType} at (${requirement.x}, ${requirement.y}) next.`,
      };
    }
  } else if (nextStage) {
    nextMilestone = {
      kind: "reach_controller_level",
      stageId: nextStage.id,
      plannedStructureId: null,
      reason: `${nextStage.title} becomes controller-eligible at RCL${nextStage.minRcl}; the room is currently RCL${input.controllerLevel}.`,
    };
  } else {
    nextMilestone = {
      kind: "mature_outcome_realized",
      stageId: null,
      plannedStructureId: null,
      reason:
        "All five v4/RCL8 development stages are fully realized at their exact planned coordinates.",
    };
  }

  return {
    horizonStatus: "v4_rcl8",
    controllerLevel: input.controllerLevel,
    validationIssues: [],
    stages,
    missingStructures: stages.flatMap((stage) => stage.missingStructures),
    blockedStructures: stages.flatMap((stage) => stage.blockedStructures),
    activeStageId: activeStage?.id ?? null,
    nextStageId: nextStage?.id ?? null,
    eligibleStageWeight,
    realizedStageWeight,
    overallEligibleRealizationPercentage,
    nextMilestone,
  };
}

/**
 * Evaluates realized development outcomes without reading Game, Memory, or time. Exact
 * (structureType, x, y) identity is required; nearby or same-type substitutes do not count.
 */
export function evaluateRoomDevelopment(
  input: RoomDevelopmentEvaluationInput,
): RoomDevelopmentEvaluation {
  if (
    input.plan.version < ROOM_PLAN_VERSION ||
    input.plan.horizonRcl < ROOM_PLAN_HORIZON_RCL
  ) {
    const issues = [
      `room-plan v${input.plan.version}/RCL${input.plan.horizonRcl} predates the required operational v4/RCL8 projection`,
    ];
    return unevaluableResult(input, "legacy_horizon_gap", issues);
  }

  const issues = validateV4Plan(input);
  if (issues.length > 0)
    return unevaluableResult(input, "invalid_v4_plan", issues);
  return evaluateValidV4Plan(input);
}

/** Thin Screeps adapter; the evaluator above remains the sole policy implementation. */
export function evaluateRoomDevelopmentForRoom(
  room: Room,
  plan: RoomPlan,
  blockedStructures?: readonly RoomDevelopmentStructureBlocker[],
): RoomDevelopmentEvaluation {
  const currentHorizon =
    plan.version === ROOM_PLAN_VERSION &&
    plan.horizonRcl === ROOM_PLAN_HORIZON_RCL;
  if (!currentHorizon) {
    return evaluateRoomDevelopment({
      controllerLevel: room.controller?.level ?? 0,
      plan,
      structures: [],
      constructionSites: [],
      blockedStructures: [],
    });
  }

  const structures = room
    .find(FIND_STRUCTURES)
    .filter(isDevelopmentEvidenceStructure)
    .map((structure) => ({
      structureType: structure.structureType,
      x: structure.pos.x,
      y: structure.pos.y,
    }));
  const constructionSites = room
    .find(FIND_MY_CONSTRUCTION_SITES)
    .map((site) => ({
      structureType: site.structureType,
      x: site.pos.x,
      y: site.pos.y,
    }));

  return evaluateRoomDevelopment({
    controllerLevel: room.controller?.level ?? 0,
    plan,
    structures,
    constructionSites,
    blockedStructures:
      blockedStructures ?? roomDevelopmentBlockersForRoom(room, plan),
  });
}

function pointMatches(
  object: { readonly pos: { readonly x: number; readonly y: number } },
  requirement: PlannedDevelopmentRequirement,
): boolean {
  return object.pos.x === requirement.x && object.pos.y === requirement.y;
}

function controllerStructureLimit(
  structureType: BuildableStructureConstant,
  controllerLevel: number,
): number {
  const limits = CONTROLLER_STRUCTURES[structureType] as
    | Record<number, number>
    | undefined;
  return limits?.[controllerLevel] ?? 0;
}

/**
 * Derive concrete siting blockers from visible room evidence. Same-type sites
 * remain in-progress work; only evidence that prevents the next legal site is
 * reported as blocked.
 */
export function roomDevelopmentBlockersForRoom(
  room: Room,
  plan: RoomDevelopmentPlanSnapshot,
): RoomDevelopmentStructureBlocker[] {
  const blockers: RoomDevelopmentStructureBlocker[] = [];
  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  const sources = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);
  const controllerLevel = room.controller?.level ?? 0;

  const add = (
    requirement: PlannedDevelopmentRequirement,
    reason: string,
  ): void => {
    blockers.push({ plannedStructureId: requirement.id, reason });
  };

  for (const requirement of plannedRequirements(plan)) {
    if (
      requirement.requiredForStage !== true ||
      requirement.minRcl > controllerLevel
    ) {
      continue;
    }

    const structuresAtTile = structures.filter((structure) =>
      pointMatches(structure, requirement),
    );
    if (
      structuresAtTile.some(
        (structure) =>
          structure.structureType === requirement.structureType &&
          isDevelopmentEvidenceStructure(structure),
      )
    ) {
      continue;
    }

    const sitesAtTile = sites.filter((site) => pointMatches(site, requirement));
    if (
      sitesAtTile.some(
        (site) => site.my && site.structureType === requirement.structureType,
      )
    ) {
      continue;
    }

    if (
      !isValidCoordinate(requirement.x) ||
      !isValidCoordinate(requirement.y) ||
      requirement.x === 0 ||
      requirement.x === MAX_ROOM_COORDINATE ||
      requirement.y === 0 ||
      requirement.y === MAX_ROOM_COORDINATE
    ) {
      add(
        requirement,
        "planned coordinate is outside the buildable room interior",
      );
      continue;
    }
    if (
      room.getTerrain().get(requirement.x, requirement.y) === TERRAIN_MASK_WALL
    ) {
      add(requirement, "planned coordinate is a terrain wall");
      continue;
    }
    if (room.controller && pointMatches(room.controller, requirement)) {
      add(requirement, "planned coordinate is occupied by the room controller");
      continue;
    }
    if (sources.some((source) => pointMatches(source, requirement))) {
      add(requirement, "planned coordinate is occupied by an energy source");
      continue;
    }
    if (
      requirement.structureType !== "extractor" &&
      minerals.some((mineral) => pointMatches(mineral, requirement))
    ) {
      add(requirement, "planned coordinate is occupied by a mineral deposit");
      continue;
    }

    const incompatibleSite = sitesAtTile.find(
      (site) => !site.my || site.structureType !== requirement.structureType,
    );
    if (incompatibleSite) {
      add(
        requirement,
        `${incompatibleSite.my ? "incompatible" : "unowned"} ${incompatibleSite.structureType} construction site occupies the planned coordinate`,
      );
      continue;
    }

    const incompatibleStructure = structuresAtTile.find(
      (structure) =>
        !isDevelopmentEvidenceStructure(structure) ||
        !canShareDevelopmentTile(
          structure.structureType,
          requirement.structureType,
        ),
    );
    if (incompatibleStructure) {
      add(
        requirement,
        `incompatible ${incompatibleStructure.structureType} structure occupies the planned coordinate`,
      );
      continue;
    }

    const limit = controllerStructureLimit(
      requirement.structureType,
      controllerLevel,
    );
    const committed =
      structures.filter(
        (structure) =>
          structure.structureType === requirement.structureType &&
          isDevelopmentEvidenceStructure(structure),
      ).length +
      sites.filter(
        (site) => site.my && site.structureType === requirement.structureType,
      ).length;
    if (committed >= limit) {
      add(
        requirement,
        `RCL${controllerLevel} ${requirement.structureType} limit ${limit} is fully committed away from the planned coordinate`,
      );
    }
  }

  return blockers.sort(
    (left, right) =>
      left.plannedStructureId.localeCompare(right.plannedStructureId) ||
      left.reason.localeCompare(right.reason),
  );
}
