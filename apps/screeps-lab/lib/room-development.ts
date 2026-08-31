import type {
  Point,
  RoomDevelopmentStage,
  RoomDevelopmentStageId,
  RuntimeRoomDevelopmentRequirement,
  RuntimeRoomDevelopmentStageStatus,
  RuntimeRoomDevelopmentSummary,
  RuntimeTrace,
  SettlementProjectionFault,
  Snapshot,
} from "./control-plane";

/** Presentation metadata only; runtime owns every development judgment. */
export const CANONICAL_ROOM_DEVELOPMENT_STAGES = [
  {
    id: "bootstrap",
    title: "Bootstrap Base",
    minRcl: 1,
    weight: 15,
    prerequisiteStageIds: [],
  },
  {
    id: "logistics",
    title: "Logistics Base",
    minRcl: 2,
    weight: 15,
    prerequisiteStageIds: ["bootstrap"],
  },
  {
    id: "core-economy",
    title: "Core Economy Base",
    minRcl: 4,
    weight: 25,
    prerequisiteStageIds: ["bootstrap", "logistics"],
  },
  {
    id: "advanced-operations",
    title: "Advanced Operations Base",
    minRcl: 6,
    weight: 20,
    prerequisiteStageIds: ["core-economy"],
  },
  {
    id: "mature-rcl8",
    title: "Mature RCL8 Base",
    minRcl: 8,
    weight: 25,
    prerequisiteStageIds: ["advanced-operations"],
  },
] as const satisfies readonly RoomDevelopmentStage[];

export type DevelopmentEvidenceState =
  | "plan-missing"
  | "horizon-debt"
  | "plan-invalid"
  | "runtime-evidence-unavailable"
  | "developing"
  | "footprint-realized";
export type DevelopmentHealth = "critical" | "watch" | "healthy";
export type DevelopmentStageStatus =
  | "horizon-gap"
  | "invalid-plan"
  | "future"
  | "prerequisite-locked"
  | "not-started"
  | "in-progress"
  | "blocked"
  | "realized";
export type DevelopmentBlockerKind = "runtime-evaluated";

export type DevelopmentBlocker = {
  plannedStructureId: string;
  stageId: RoomDevelopmentStageId;
  plannedStructureType: string;
  x: number;
  y: number;
  kind: DevelopmentBlockerKind;
  occupantType: string;
  reason: string;
};
export type DevelopmentRequirement = {
  id: string;
  stageId: RoomDevelopmentStageId;
  structureType: string;
  x: number;
  y: number;
  minRcl: number;
  priority: number;
  strategicWeight: number;
  controllerEligible: boolean;
  realized: boolean;
  underConstruction: boolean;
  blockers: DevelopmentBlocker[];
};
export type DevelopmentStageSummary = {
  id: RoomDevelopmentStageId;
  title: string;
  minRcl: number;
  weight: number;
  status: DevelopmentStageStatus;
  controllerEligible: boolean;
  prerequisitesSatisfied: boolean;
  realizationPercentage: number | null;
  realizedCount: number;
  eligibleCount: number;
  missingCount: number;
};
export type DefensiveEnvelopeState =
  | "locked"
  | "missing-plan"
  | "planned"
  | "building"
  | "condition-unknown"
  | "strengthening"
  | "ready";
export type DefensiveEnvelopeSummary = {
  state: DefensiveEnvelopeState;
  strategy: string | null;
  plannedCount: number;
  builtCount: number;
  atTargetCount: number | null;
  conditionEvidenceCount: number;
  coveragePercentage: number | null;
  targetHits: number;
  underAttack: boolean;
  nextMissingTile: Point | null;
};
export type DevelopmentMilestone = {
  kind:
    | "publish-plan"
    | "replace-plan"
    | "repair-plan"
    | "resolve-blocker"
    | "build-structure"
    | "complete-site"
    | "reach-rcl"
    | "repair-projection"
    | "refresh-projection-evidence"
    | "plan-defense"
    | "build-defense"
    | "strengthen-defense"
    | "footprint-realized";
  title: string;
  reason: string;
};
export type RoomDevelopmentSummary = {
  state: DevelopmentEvidenceState;
  health: DevelopmentHealth;
  controllerLevel: number | null;
  planVersion: number | null;
  planHorizonRcl: number | null;
  horizonDebt: boolean;
  validationIssues: string[];
  realizationPercentage: number | null;
  stages: DevelopmentStageSummary[];
  activeStageId: RoomDevelopmentStageId | null;
  nextStageId: RoomDevelopmentStageId | null;
  missingStructureCount: number;
  blockedStructureCount: number;
  missingCriticalStructures: DevelopmentRequirement[];
  blockedStructures: DevelopmentRequirement[];
  firstBlocker: DevelopmentBlocker | null;
  nextMilestone: DevelopmentMilestone;
  defense: DefensiveEnvelopeSummary;
  projection: RoomProjectionEvidenceSummary;
};
export type RoomProjectionEvidenceSummary = {
  planId: string | null;
  deliverableId: string | null;
  plannerRevision: number | null;
  projectionRevision: number | null;
  projectionFingerprint: string | null;
  generatedAt: number | null;
  traceAlignment: "matched" | "mismatch" | "unavailable";
  runtimeUsability: {
    usable: boolean;
    status: NonNullable<
      NonNullable<RuntimePlanTrace["projectionUsability"]>["status"]
    >;
    reason: string;
  } | null;
  matureEnergyService: {
    status: "authorization-debt" | "incomplete" | "fault" | "unavailable";
    reason: string;
    sourceLinks: number | null;
    controllerLinkPlanId: string | null;
    coreLinkPlanId: string | null;
  } | null;
  fault: SettlementProjectionFault | null;
  faultAlignment: "current" | "stale" | "unverifiable" | null;
};

type RuntimePlanTrace = NonNullable<
  NonNullable<RuntimeTrace["settlement"]>["plans"]
>[number];
const integerOrNull = (value: number | null | undefined) =>
  Number.isSafeInteger(value) ? (value ?? null) : null;
const controllerLevelOf = (snapshot: Snapshot | null): number | null => {
  const level = snapshot?.colony?.controller?.level;
  return Number.isInteger(level) && (level ?? -1) >= 0 && (level ?? 9) <= 8
    ? (level ?? null)
    : null;
};
const percentage = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 100_000) / 1_000 : null;
const tracePlanFor = (snapshot: Snapshot | null): RuntimePlanTrace | null =>
  snapshot?.room
    ? (snapshot.runtimeTrace?.settlement?.plans?.find(
        (candidate) => candidate.roomName === snapshot.room,
      ) ?? null)
    : null;

function projectionEvidence(
  snapshot: Snapshot | null,
): RoomProjectionEvidenceSummary {
  const plan = snapshot?.roomPlan;
  const tracePlan = tracePlanFor(snapshot);
  const fault =
    snapshot?.runtimeTrace?.settlement?.faults?.find(
      (candidate) => candidate.roomName === snapshot?.room,
    ) ?? null;
  const plannerRevision = integerOrNull(plan?.plannerRevision);
  const projectionRevision = integerOrNull(plan?.projectionRevision);
  const projectionFingerprint = plan?.projectionFingerprint?.trim() || null;
  const tracePlanner = integerOrNull(tracePlan?.plannerRevision);
  const traceRevision = integerOrNull(tracePlan?.projectionRevision);
  const traceFingerprint = tracePlan?.projectionFingerprint?.trim() || null;
  const traceUsability = tracePlan?.projectionUsability;
  const runtimeUsability =
    typeof traceUsability?.usable === "boolean" &&
    traceUsability.status &&
    traceUsability.reason?.trim()
      ? {
          usable: traceUsability.usable,
          status: traceUsability.status as NonNullable<
            typeof traceUsability.status
          >,
          reason: traceUsability.reason?.trim() ?? "",
        }
      : null;
  const rawEnergyTopology = tracePlan?.energyTopology;
  const matureEnergyService =
    rawEnergyTopology &&
    (rawEnergyTopology.status === "authorization-debt" ||
      rawEnergyTopology.status === "incomplete" ||
      rawEnergyTopology.status === "fault" ||
      rawEnergyTopology.status === "unavailable") &&
    rawEnergyTopology.reason?.trim()
      ? {
          status: rawEnergyTopology.status,
          reason: rawEnergyTopology.reason?.trim() ?? "",
          sourceLinks: integerOrNull(rawEnergyTopology.sourceLinks),
          controllerLinkPlanId:
            rawEnergyTopology.controllerLinkPlanId?.trim() || null,
          coreLinkPlanId: rawEnergyTopology.coreLinkPlanId?.trim() || null,
        }
      : null;
  const planIdentity =
    plannerRevision !== null &&
    projectionRevision !== null &&
    projectionFingerprint !== null;
  const traceIdentity =
    tracePlanner !== null &&
    traceRevision !== null &&
    traceFingerprint !== null;
  const traceAlignment =
    !planIdentity || !traceIdentity
      ? "unavailable"
      : plannerRevision === tracePlanner &&
          projectionRevision === traceRevision &&
          projectionFingerprint === traceFingerprint
        ? "matched"
        : "mismatch";

  let faultAlignment: RoomProjectionEvidenceSummary["faultAlignment"] = null;
  if (fault) {
    const faultPlanner = integerOrNull(
      fault.status === "active"
        ? fault.retainedPlannerRevision
        : fault.targetPlannerRevision,
    );
    const faultRevision = integerOrNull(
      fault.status === "active"
        ? fault.retainedProjectionRevision
        : fault.supersededByRevision,
    );
    const faultFingerprint =
      (fault.status === "active"
        ? fault.retainedProjectionFingerprint
        : fault.supersededByFingerprint
      )?.trim() || null;
    if (
      planIdentity &&
      faultPlanner !== null &&
      faultRevision !== null &&
      faultFingerprint
    ) {
      faultAlignment =
        plannerRevision === faultPlanner &&
        projectionRevision === faultRevision &&
        projectionFingerprint === faultFingerprint
          ? "current"
          : "stale";
    } else if (
      !plan &&
      fault.status === "active" &&
      fault.retainedPlannerRevision == null &&
      fault.retainedProjectionRevision == null &&
      fault.retainedProjectionFingerprint == null
    ) {
      faultAlignment = "current";
    } else {
      faultAlignment = "unverifiable";
    }
  }
  return {
    planId: plan?.planId?.trim() || null,
    deliverableId: plan?.deliverableId?.trim() || null,
    plannerRevision,
    projectionRevision,
    projectionFingerprint,
    generatedAt: integerOrNull(plan?.generatedAt),
    traceAlignment,
    runtimeUsability,
    matureEnergyService,
    fault,
    faultAlignment,
  };
}

function projectionMilestone(
  projection: RoomProjectionEvidenceSummary,
): DevelopmentMilestone | null {
  if (
    projection.fault?.status === "active" &&
    projection.faultAlignment === "current"
  ) {
    return {
      kind: "repair-projection",
      title: "Restore settlement projection generation",
      reason: `${projection.fault.reason ?? "Projection regeneration failed."} Retry ${projection.fault.attemptCount ?? "?"} is held until tick ${projection.fault.nextRetryTick ?? "manual recovery"}.`,
    };
  }
  if (
    projection.runtimeUsability?.usable !== true ||
    projection.runtimeUsability.status !== "current"
  ) {
    return {
      kind: "refresh-projection-evidence",
      title: "Restore an operational projection",
      reason:
        projection.runtimeUsability?.reason ??
        "Runtime projection-usability evidence is missing for this snapshot.",
    };
  }
  if (
    projection.traceAlignment === "mismatch" ||
    projection.faultAlignment === "stale" ||
    projection.faultAlignment === "unverifiable"
  ) {
    return {
      kind: "refresh-projection-evidence",
      title: "Refresh projection evidence",
      reason:
        "The durable projection and runtime evidence do not prove the same planner revision, projection revision, and fingerprint.",
    };
  }
  return null;
}

function emptyStages(
  controllerLevel: number | null,
  status: "horizon-gap" | "invalid-plan",
): DevelopmentStageSummary[] {
  return CANONICAL_ROOM_DEVELOPMENT_STAGES.map((stage) => ({
    id: stage.id,
    title: stage.title,
    minRcl: stage.minRcl,
    weight: stage.weight,
    status,
    controllerEligible:
      controllerLevel !== null && controllerLevel >= stage.minRcl,
    prerequisitesSatisfied: false,
    realizationPercentage: null,
    realizedCount: 0,
    eligibleCount: 0,
    missingCount: 0,
  }));
}
function unknownDefense(
  controllerLevel: number | null,
): DefensiveEnvelopeSummary {
  return {
    state:
      controllerLevel !== null && controllerLevel < 4
        ? "locked"
        : "condition-unknown",
    strategy: null,
    plannedCount: 0,
    builtCount: 0,
    atTargetCount: null,
    conditionEvidenceCount: 0,
    coveragePercentage: null,
    targetHits: 0,
    underAttack: false,
    nextMissingTile: null,
  };
}
function unavailableSummary(
  snapshot: Snapshot | null,
  state:
    | "plan-missing"
    | "horizon-debt"
    | "plan-invalid"
    | "runtime-evidence-unavailable",
  issues: string[],
  milestone: DevelopmentMilestone,
): RoomDevelopmentSummary {
  const controllerLevel = controllerLevelOf(snapshot);
  const plan = snapshot?.roomPlan;
  const projection = projectionEvidence(snapshot);
  const projectionOverride =
    state === "runtime-evidence-unavailable" ||
    (projection.fault?.status === "active" &&
      projection.faultAlignment === "current")
      ? projectionMilestone(projection)
      : null;
  return {
    state,
    health: "critical",
    controllerLevel,
    planVersion: plan?.version ?? null,
    planHorizonRcl: plan?.horizonRcl ?? null,
    horizonDebt: state === "horizon-debt",
    validationIssues: issues,
    realizationPercentage: null,
    stages: emptyStages(
      controllerLevel,
      state === "plan-missing" || state === "horizon-debt"
        ? "horizon-gap"
        : "invalid-plan",
    ),
    activeStageId: null,
    nextStageId: null,
    missingStructureCount: 0,
    blockedStructureCount: 0,
    missingCriticalStructures: [],
    blockedStructures: [],
    firstBlocker: null,
    nextMilestone: projectionOverride ?? milestone,
    defense: unknownDefense(controllerLevel),
    projection,
  };
}

const runtimeStatus = (
  status: RuntimeRoomDevelopmentStageStatus,
): DevelopmentStageStatus =>
  ({
    horizon_gap: "horizon-gap",
    invalid_plan: "invalid-plan",
    controller_ineligible: "future",
    prerequisite_blocked: "prerequisite-locked",
    not_started: "not-started",
    in_progress: "in-progress",
    blocked: "blocked",
    realized: "realized",
  })[status] as DevelopmentStageStatus;

function validateRuntimeDevelopment(
  snapshot: Snapshot,
  tracePlan: RuntimePlanTrace,
  development: RuntimeRoomDevelopmentSummary,
): string[] {
  const issues: string[] = [];
  const horizonStatuses = new Set([
    "v4_rcl8",
    "legacy_horizon_gap",
    "invalid_v4_plan",
  ]);
  const stageStatuses = new Set<RuntimeRoomDevelopmentStageStatus>([
    "horizon_gap",
    "invalid_plan",
    "controller_ineligible",
    "prerequisite_blocked",
    "not_started",
    "in_progress",
    "blocked",
    "realized",
  ]);
  const milestoneKinds = new Set([
    "replace_legacy_plan",
    "repair_v4_plan",
    "resolve_structure_blocker",
    "complete_structure_site",
    "realize_structure",
    "reach_controller_level",
    "mature_outcome_realized",
  ]);
  const validPercentage = (value: number | null) =>
    value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
  const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (development.source !== "runtime_room_development_evaluator")
    issues.push("runtime development source marker is invalid");
  if (
    !Number.isSafeInteger(development.evaluatedAt) ||
    development.evaluatedAt < 0
  )
    issues.push("runtime development evaluation tick is invalid");
  const traceTick = integerOrNull(snapshot.runtimeTrace?.tick);
  if (traceTick === null)
    issues.push("runtime trace tick is missing or invalid");
  else if (development.evaluatedAt !== traceTick)
    issues.push("runtime development evaluation is not from the snapshot tick");
  if (!horizonStatuses.has(development.horizonStatus))
    issues.push("runtime development horizon status is invalid");
  if (!validPercentage(development.realizationPercentage))
    issues.push("runtime development realization is outside 0..100");
  if (
    !count(development.missingStructures) ||
    !count(development.blockedStructures) ||
    development.blockedStructures > development.missingStructures
  )
    issues.push("runtime development aggregate counts are inconsistent");
  if (development.stages.length !== CANONICAL_ROOM_DEVELOPMENT_STAGES.length)
    issues.push("runtime development stage evidence is incomplete");
  for (const [index, expected] of CANONICAL_ROOM_DEVELOPMENT_STAGES.entries()) {
    const actual = development.stages[index];
    if (
      !actual ||
      actual.id !== expected.id ||
      actual.title !== expected.title ||
      actual.minRcl !== expected.minRcl ||
      actual.stageWeight !== expected.weight
    ) {
      issues.push(
        `runtime development stage ${expected.id} identity is invalid`,
      );
      continue;
    }
    if (!stageStatuses.has(actual.status))
      issues.push(`runtime development stage ${expected.id} status is invalid`);
    if (
      !validPercentage(actual.realizationPercentage) ||
      !count(actual.realizedStructures) ||
      !count(actual.eligibleStructures) ||
      !count(actual.missingStructures) ||
      !count(actual.blockedStructures) ||
      actual.realizedStructures + actual.missingStructures !==
        actual.eligibleStructures ||
      actual.blockedStructures > actual.missingStructures
    ) {
      issues.push(
        `runtime development stage ${expected.id} counts are inconsistent`,
      );
    }
  }
  if (
    development.missingCriticalStructures.length > development.missingStructures
  )
    issues.push("runtime critical queue exceeds its declared missing count");
  if (!milestoneKinds.has(development.nextMilestone.kind))
    issues.push("runtime development milestone kind is invalid");
  if (!development.nextMilestone.reason?.trim())
    issues.push("runtime development milestone reason is missing");
  if (
    integerOrNull(tracePlan.controllerLevel) !== null &&
    controllerLevelOf(snapshot) !== null &&
    tracePlan.controllerLevel !== controllerLevelOf(snapshot)
  )
    issues.push("runtime development controller evidence is inconsistent");
  const ids = development.missingCriticalStructures.map(
    (item) => item.plannedStructureId,
  );
  if (new Set(ids).size !== ids.length)
    issues.push("runtime critical queue contains duplicate plan identities");
  for (const item of development.missingCriticalStructures) {
    if (
      !item.plannedStructureId?.trim() ||
      !CANONICAL_ROOM_DEVELOPMENT_STAGES.some(
        (stage) => stage.id === item.stageId,
      ) ||
      !Number.isInteger(item.x) ||
      item.x < 0 ||
      item.x > 49 ||
      !Number.isInteger(item.y) ||
      item.y < 0 ||
      item.y > 49 ||
      (item.blocked && item.blockerReasons.length === 0)
    ) {
      issues.push(
        `runtime critical requirement ${item.plannedStructureId || "unknown"} is invalid`,
      );
    }
  }
  const mirrors: Array<[unknown, unknown, string]> = [
    [tracePlan.horizonStatus, development.horizonStatus, "horizon status"],
    [tracePlan.activeStageId, development.activeStageId, "active stage"],
    [tracePlan.nextStageId, development.nextStageId, "next stage"],
    [
      tracePlan.realizationPercentage,
      development.realizationPercentage,
      "realization",
    ],
    [
      tracePlan.missingStructures,
      development.missingStructures,
      "missing count",
    ],
    [
      tracePlan.blockedStructures,
      development.blockedStructures,
      "blocked count",
    ],
  ];
  for (const [outer, inner, label] of mirrors)
    if (outer !== undefined && outer !== null && outer !== inner)
      issues.push(`runtime development ${label} mirror is inconsistent`);
  return [...new Set(issues)];
}

function mapRequirement(
  item: RuntimeRoomDevelopmentRequirement,
): DevelopmentRequirement {
  return {
    id: item.plannedStructureId,
    stageId: item.stageId,
    structureType: item.structureType,
    x: item.x,
    y: item.y,
    minRcl: item.minRcl,
    priority: item.priority,
    strategicWeight: item.strategicWeight,
    controllerEligible: true,
    realized: false,
    underConstruction: item.underConstruction,
    blockers: item.blockerReasons.map((reason) => ({
      plannedStructureId: item.plannedStructureId,
      stageId: item.stageId,
      plannedStructureType: item.structureType,
      x: item.x,
      y: item.y,
      kind: "runtime-evaluated",
      occupantType: "runtime-evaluated obstruction",
      reason,
    })),
  };
}

function defensiveEnvelopeFromRuntime(
  controllerLevel: number | null,
  tracePlan: RuntimePlanTrace,
): DefensiveEnvelopeSummary {
  if (controllerLevel !== null && controllerLevel < 4)
    return { ...unknownDefense(controllerLevel), state: "locked" };
  const evidence = tracePlan.defense;
  if (!evidence) return unknownDefense(controllerLevel);
  const planned = integerOrNull(evidence.perimeterPlanned);
  const built = integerOrNull(evidence.perimeterBuilt);
  const atTarget = integerOrNull(evidence.perimeterAtTarget);
  const valid =
    planned !== null &&
    planned >= 0 &&
    built !== null &&
    built >= 0 &&
    built <= planned &&
    (atTarget === null || (atTarget >= 0 && atTarget <= built));
  const state: DefensiveEnvelopeState =
    planned === 0
      ? "missing-plan"
      : !valid
        ? "condition-unknown"
        : built === 0
          ? "planned"
          : built < planned
            ? "building"
            : atTarget === null
              ? "condition-unknown"
              : atTarget < planned
                ? "strengthening"
                : "ready";
  return {
    state,
    strategy: evidence.strategy?.trim() || null,
    plannedCount: planned ?? 0,
    builtCount: valid ? (built ?? 0) : 0,
    atTargetCount: valid ? atTarget : null,
    conditionEvidenceCount: valid && atTarget !== null ? (built ?? 0) : 0,
    coveragePercentage:
      valid && planned !== null && built !== null
        ? percentage(built, planned)
        : null,
    targetHits:
      Number.isFinite(evidence.targetHits) && (evidence.targetHits ?? -1) >= 0
        ? (evidence.targetHits ?? 0)
        : 0,
    underAttack: evidence.underAttack === true,
    nextMissingTile:
      Number.isInteger(evidence.nextMissingTile?.x) &&
      Number.isInteger(evidence.nextMissingTile?.y)
        ? (evidence.nextMissingTile ?? null)
        : null,
  };
}

function defenseMilestone(
  defense: DefensiveEnvelopeSummary,
): DevelopmentMilestone | null {
  if (defense.state === "missing-plan")
    return {
      kind: "plan-defense",
      title: "Generate the defensive envelope",
      reason:
        "Runtime reports no planned perimeter for a controller that can support ramparts.",
    };
  if (
    defense.state === "planned" ||
    defense.state === "building" ||
    defense.state === "condition-unknown"
  )
    return {
      kind: "build-defense",
      title: "Close the defensive envelope",
      reason: defense.nextMissingTile
        ? `Build the runtime-selected perimeter tile at (${defense.nextMissingTile.x}, ${defense.nextMissingTile.y}); ${defense.builtCount}/${defense.plannedCount} are built.`
        : "Runtime defensive condition evidence is incomplete; readiness remains withheld.",
    };
  if (defense.state === "strengthening")
    return {
      kind: "strengthen-defense",
      title: "Harden the defensive envelope",
      reason: `Raise every perimeter rampart to ${defense.targetHits.toLocaleString()} hits; ${defense.atTargetCount ?? 0}/${defense.plannedCount} meet target.`,
    };
  return null;
}

function runtimeMilestone(
  development: RuntimeRoomDevelopmentSummary,
): DevelopmentMilestone {
  const stage = CANONICAL_ROOM_DEVELOPMENT_STAGES.find(
    (candidate) => candidate.id === development.nextMilestone.stageId,
  );
  const requirement = development.missingCriticalStructures.find(
    (candidate) =>
      candidate.plannedStructureId ===
      development.nextMilestone.plannedStructureId,
  );
  const reason = development.nextMilestone.reason;
  switch (development.nextMilestone.kind) {
    case "replace_legacy_plan":
      return { kind: "replace-plan", title: "Replace the capped plan", reason };
    case "repair_v4_plan":
      return { kind: "repair-plan", title: "Repair the room plan", reason };
    case "resolve_structure_blocker":
      return {
        kind: "resolve-blocker",
        title: `Resolve ${requirement?.structureType ?? "structure"} blocker`,
        reason,
      };
    case "complete_structure_site":
      return {
        kind: "complete-site",
        title: `Complete ${requirement?.structureType ?? "construction site"}`,
        reason,
      };
    case "realize_structure":
      return {
        kind: "build-structure",
        title: `Build ${requirement?.structureType ?? "next structure"}`,
        reason,
      };
    case "reach_controller_level":
      return {
        kind: "reach-rcl",
        title: `Advance to RCL${stage?.minRcl ?? "?"}`,
        reason,
      };
    case "mature_outcome_realized":
      return {
        kind: "footprint-realized",
        title: "RCL8 footprint realized",
        reason: `${reason} Advanced capability actuation is not evidenced by this footprint result.`,
      };
  }
}

export function deriveRoomDevelopment(
  snapshot: Snapshot | null,
): RoomDevelopmentSummary {
  const controllerLevel = controllerLevelOf(snapshot);
  const plan = snapshot?.roomPlan;
  if (!plan)
    return unavailableSummary(
      snapshot,
      "plan-missing",
      ["room plan is missing"],
      {
        kind: "publish-plan",
        title: "Publish an operational room-plan projection",
        reason:
          "No durable room plan is available, so development realization cannot be evidenced.",
      },
    );
  if (plan.version !== 4 || plan.horizonRcl !== 8)
    return unavailableSummary(
      snapshot,
      "horizon-debt",
      [
        `expected plan v4/RCL8; received v${plan.version ?? "?"}/RCL${plan.horizonRcl ?? "?"}`,
      ],
      {
        kind: "replace-plan",
        title: "Replace the capped planning horizon",
        reason: `The RCL${controllerLevel ?? "?"} colony retains operational projection v${plan.version ?? "?"} with only an RCL${plan.horizonRcl ?? "?"} horizon.`,
      },
    );

  const projection = projectionEvidence(snapshot);
  const projectionBlocker = projectionMilestone(projection);
  if (projectionBlocker)
    return unavailableSummary(
      snapshot,
      "runtime-evidence-unavailable",
      [
        "runtime development evaluation is not authoritative for the current projection epoch",
      ],
      projectionBlocker,
    );
  const tracePlan = tracePlanFor(snapshot);
  const development = tracePlan?.development;
  if (!tracePlan || !development)
    return unavailableSummary(
      snapshot,
      "runtime-evidence-unavailable",
      [
        "runtime development evaluation is unavailable for the current projection epoch",
      ],
      {
        kind: "refresh-projection-evidence",
        title: "Publish runtime development evidence",
        reason:
          "The Lab will not derive a second score from snapshot objects. Publish the runtime evaluator result for this exact projection epoch.",
      },
    );
  const traceIssues = validateRuntimeDevelopment(
    snapshot,
    tracePlan,
    development,
  );
  if (traceIssues.length > 0)
    return unavailableSummary(
      snapshot,
      "runtime-evidence-unavailable",
      traceIssues,
      {
        kind: "refresh-projection-evidence",
        title: "Repair runtime development evidence",
        reason:
          traceIssues[0] ?? "Runtime development evidence is inconsistent.",
      },
    );

  const stages: DevelopmentStageSummary[] = development.stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    minRcl: stage.minRcl,
    weight: stage.stageWeight,
    status: runtimeStatus(stage.status),
    controllerEligible: stage.controllerEligible,
    prerequisitesSatisfied: stage.prerequisitesSatisfied,
    realizationPercentage: stage.realizationPercentage,
    realizedCount: stage.realizedStructures,
    eligibleCount: stage.eligibleStructures,
    missingCount: stage.missingStructures,
  }));
  const missingCriticalStructures =
    development.missingCriticalStructures.map(mapRequirement);
  const blockedStructures = missingCriticalStructures.filter(
    (requirement) => requirement.blockers.length > 0,
  );
  const defense = defensiveEnvelopeFromRuntime(controllerLevel, tracePlan);
  const milestone = runtimeMilestone(development);
  const nextMilestone =
    development.nextMilestone.kind === "mature_outcome_realized"
      ? (defenseMilestone(defense) ?? milestone)
      : milestone;
  const footprintRealized =
    development.horizonStatus === "v4_rcl8" &&
    development.realizationPercentage === 100 &&
    stages
      .filter((stage) => stage.controllerEligible)
      .every((stage) => stage.status === "realized") &&
    (defense.state === "ready" || defense.state === "locked");
  const state: DevelopmentEvidenceState =
    development.horizonStatus === "legacy_horizon_gap"
      ? "horizon-debt"
      : development.horizonStatus === "invalid_v4_plan"
        ? "plan-invalid"
        : footprintRealized
          ? "footprint-realized"
          : "developing";
  const health: DevelopmentHealth =
    state === "footprint-realized"
      ? "healthy"
      : controllerLevel === 8 ||
          development.blockedStructures > 0 ||
          defense.state === "missing-plan"
        ? "critical"
        : "watch";
  return {
    state,
    health,
    controllerLevel,
    planVersion: plan.version ?? null,
    planHorizonRcl: plan.horizonRcl ?? null,
    horizonDebt: state === "horizon-debt",
    validationIssues: [...development.validationIssues],
    realizationPercentage: development.realizationPercentage,
    stages,
    activeStageId: development.activeStageId,
    nextStageId: development.nextStageId,
    missingStructureCount: development.missingStructures,
    blockedStructureCount: development.blockedStructures,
    missingCriticalStructures,
    blockedStructures,
    firstBlocker: blockedStructures[0]?.blockers[0] ?? null,
    nextMilestone,
    defense,
    projection,
  };
}
