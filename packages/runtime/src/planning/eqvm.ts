import type {
  ColonyDeliverable,
  ColonyFspmPortfolio,
  ColonyTask,
  FspmActivityKpiAggregationPolicy,
  FspmActivityKpiSample,
  FspmActivityRecord,
  FspmCanonicalEqvmRollupState,
  FspmDeliverableQi,
  FspmEqvmCoverageStatus,
  FspmEqvmPolicyApproval,
  FspmEqvmPolicyAuthorization,
  FspmEqvmResearchEstimate,
  FspmKpiRating,
  FspmP3Pqi,
  FspmTaskQi,
  FspmWeightedEqvmCoverage,
} from "./fspm";
import { FSPM_GOVERNANCE_SHA, fspmTaskDefinition } from "./fspm-catalog";
import { FSPM_WEIGHT_BASIS_POINTS } from "./fspm-governance";

const EQVM_DECIMAL_PLACES = 3;

/**
 * Research-only cohort configuration for the Activity -> Task formula.
 * The framework reference explains EQVM, but does not constitute accountable
 * approval of these concrete recurring-Activity weights or cohort bounds.
 */
export const FSPM_ACTIVITY_KPI_AGGREGATION_POLICY = Object.freeze({
  id: "eqvm:activity-weight:equal-terminal-samples:v1",
  model: "equal_weight",
  evidenceScope: "terminal_activity_kpi_samples",
  activityWeightUnits: 1,
  historyLimit: 24,
  freshnessWindowTicks: 1_500,
  frameworkReferenceSha: FSPM_GOVERNANCE_SHA,
  configurationClass: "implementation_research_configuration",
  policyAuthorization: {
    status: "unapproved",
    authorizationDebt:
      "Accountable management has not approved the recurring Activity sample weights, reporting cohort, or freshness window.",
  },
  rationale:
    "Research configuration: each of the latest 24 terminal Activity KPI samples in the evidence window receives one equal weight unit; missing, in-progress, stale, or unverified evidence remains explicit.",
} as const satisfies FspmActivityKpiAggregationPolicy);

/**
 * SHA-256 of the ordered canonical policy fields (id, model, evidence scope,
 * unit weight, cohort limit, freshness window, and framework reference).
 */
export const FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH =
  "634237a44656e206f1343f8d3a1dc608eb436ddb81a72ad6b52dd1ff62989e08";

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Structural validation only. A well-formed nested claim is not authority;
 * canonical use must additionally resolve it from the governed approval ledger.
 */
export function isApprovedEqvmPolicyAuthorization(
  value: unknown,
): value is FspmEqvmPolicyApproval {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.status === "approved" &&
    nonEmptyString(record.approvalEventId) &&
    nonEmptyString(record.approvalAuthorityOuId) &&
    nonEmptyString(record.accountablePositionId) &&
    nonEmptyString(record.signerPrincipalId) &&
    Number.isSafeInteger(record.approvedAtTick) &&
    (record.approvedAtTick as number) >= 0 &&
    record.approvedPolicyContentHash === FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH
  );
}

/**
 * There is no governed EQVM policy-approval ledger in the current authority
 * package. Fail closed instead of trusting a self-asserted approval-shaped
 * object from Memory, trace, or a caller. A future resolver must bind the
 * event, policy content, accountable authority, signer, effective tick, and
 * the complete rated Activity cohort before returning an approval.
 */
function resolveLedgerAttestedEqvmPolicyApproval(
  _value: unknown,
): FspmEqvmPolicyApproval | null {
  return null;
}

function hasCanonicalEqvmPolicyContent(
  policy: FspmActivityKpiAggregationPolicy,
): boolean {
  return (
    policy.id === "eqvm:activity-weight:equal-terminal-samples:v1" &&
    policy.model === "equal_weight" &&
    policy.evidenceScope === "terminal_activity_kpi_samples" &&
    policy.activityWeightUnits === 1 &&
    policy.historyLimit === 24 &&
    policy.freshnessWindowTicks === 1_500 &&
    policy.frameworkReferenceSha === FSPM_GOVERNANCE_SHA
  );
}

const copyPolicyAuthorization = (
  authorization: FspmEqvmPolicyAuthorization,
): FspmEqvmPolicyAuthorization =>
  authorization.status === "approved"
    ? {
        status: "approved",
        approvalEventId: authorization.approvalEventId,
        approvalAuthorityOuId: authorization.approvalAuthorityOuId,
        accountablePositionId: authorization.accountablePositionId,
        signerPrincipalId: authorization.signerPrincipalId,
        approvedAtTick: authorization.approvedAtTick,
        approvedPolicyContentHash: authorization.approvedPolicyContentHash,
      }
    : {
        status: "unapproved",
        authorizationDebt: authorization.authorizationDebt,
      };

const approvalIdentity = (approval: FspmEqvmPolicyApproval): string =>
  [
    approval.approvalEventId,
    approval.approvalAuthorityOuId,
    approval.accountablePositionId,
    approval.signerPrincipalId,
    approval.approvedAtTick,
    approval.approvedPolicyContentHash,
  ].join("\u0000");

const roundMultiplier = (value: number): number =>
  Math.round(value * 10 ** EQVM_DECIMAL_PLACES) / 10 ** EQVM_DECIMAL_PLACES;

export function activityKpiMultiplier(rating: FspmKpiRating): number | null {
  switch (rating) {
    case "exceptional":
      return 1.5;
    case "satisfactory":
      return 1;
    case "marginal":
      return 0.75;
    case "unsatisfactory":
      return 0.5;
    case "rejected":
      return 0;
    case "in_progress":
      return null;
  }
}

export interface TaskQiEvidenceContext {
  task: Pick<ColonyTask, "id" | "taskKey">;
  activities: Readonly<Record<string, FspmActivityRecord>>;
  policy?: FspmActivityKpiAggregationPolicy;
}

type CalculatedTaskQiEvidence = Omit<
  FspmEqvmResearchEstimate,
  "configurationClass" | "policyAuthorization"
> &
  Pick<
    FspmActivityKpiAggregationPolicy,
    "configurationClass" | "policyAuthorization"
  >;

interface ClassifiedActivitySample {
  sample: FspmActivityKpiSample;
  kind: "fresh" | "stale" | "unrated" | "invalid";
  reason?: string;
}

function classifyActivitySample(
  sample: FspmActivityKpiSample,
  measuredAt: number,
  context: TaskQiEvidenceContext,
): ClassifiedActivitySample {
  const policy = context.policy ?? FSPM_ACTIVITY_KPI_AGGREGATION_POLICY;
  if (
    !Number.isInteger(sample.tick) ||
    sample.tick < 0 ||
    sample.tick > measuredAt ||
    !sample.activityId.trim() ||
    !sample.actor.trim() ||
    !sample.activityType.trim()
  ) {
    return { sample, kind: "invalid", reason: "invalid sample identity/tick" };
  }

  if (sample.rating === "in_progress") {
    return sample.value === null
      ? { sample, kind: "unrated" }
      : {
          sample,
          kind: "invalid",
          reason: "in-progress sample carries a KPI multiplier",
        };
  }

  const expectedMultiplier = activityKpiMultiplier(sample.rating);
  if (
    expectedMultiplier === null ||
    sample.value !== expectedMultiplier ||
    sample.source !== "terminal_activity_kpi" ||
    sample.activityWeightPolicyId !== policy.id ||
    !Number.isInteger(sample.activityCompletedAtTick) ||
    sample.activityCompletedAtTick !== sample.tick ||
    !sample.evidence.trim()
  ) {
    return {
      sample,
      kind: "invalid",
      reason: "terminal KPI metadata, multiplier, or evidence is invalid",
    };
  }

  const activity = context.activities[sample.activityId];
  if (
    !activity ||
    activity.taskId !== context.task.id ||
    activity.status !== "completed" ||
    activity.completedAt !== sample.activityCompletedAtTick ||
    activity.assignee !== sample.actor ||
    sample.activityType !== context.task.taskKey ||
    activity.kpiScore !== sample.rating ||
    activity.kpiEvidence !== sample.evidence
  ) {
    return {
      sample,
      kind: "invalid",
      reason: "sample is not verified by its terminal Activity record",
    };
  }

  return measuredAt - sample.tick > policy.freshnessWindowTicks
    ? { sample, kind: "stale" }
    : { sample, kind: "fresh" };
}

const taskQiEvidence = (
  status: FspmEqvmCoverageStatus,
  classified: ClassifiedActivitySample[],
  policy: FspmActivityKpiAggregationPolicy,
  missingActivityIds: string[],
  extraActivityIds: string[],
): string[] => {
  const fresh = classified.filter(
    ({ kind, sample }) =>
      kind === "fresh" && !extraActivityIds.includes(sample.activityId),
  );
  const stale = classified.filter(({ kind }) => kind === "stale");
  const unrated = classified.filter(({ kind }) => kind === "unrated");
  const invalid = classified.filter(({ kind }) => kind === "invalid");
  return [
    `coverage ${status} · ${fresh.length}/${classified.length + missingActivityIds.length} verified fresh terminal Activity KPI samples`,
    `${policy.configurationClass === "governed_configuration" ? "governed" : "research-only"} activity weighting ${policy.model} · one unit per terminal sample · latest ${policy.historyLimit} configured cohort · sum(weight × KPI rating) / sum(weights)`,
    policy.policyAuthorization.status === "approved"
      ? `policy approved · event ${policy.policyAuthorization.approvalEventId} · signer ${policy.policyAuthorization.signerPrincipalId} · policy hash ${policy.policyAuthorization.approvedPolicyContentHash}`
      : `policy unapproved · framework reference ${policy.frameworkReferenceSha} · ${policy.policyAuthorization.authorizationDebt}`,
    `evidence window ${policy.freshnessWindowTicks} ticks · ${stale.length} stale · ${unrated.length} unrated · ${invalid.length} invalid`,
    ...(missingActivityIds.length > 0
      ? [
          `missing terminal Activity KPI samples: ${missingActivityIds.join(", ")}`,
        ]
      : []),
    ...(extraActivityIds.length > 0
      ? [
          `extra terminal Activity KPI samples outside configured cohort: ${extraActivityIds.join(", ")}`,
        ]
      : []),
    ...(invalid.length > 0
      ? invalid
          .sort((left, right) =>
            left.sample.activityId.localeCompare(right.sample.activityId),
          )
          .map(
            ({ sample, reason }) =>
              `${sample.activityId}: ${reason ?? "invalid KPI evidence"}`,
          )
      : []),
  ];
};

/**
 * Calculate a non-authoritative research estimate from verified terminal
 * Activity KPI evidence. Missing, partial, stale, or invalid cohorts never
 * receive a numeric estimate.
 */
function calculateTaskQiEvidence(
  samples: FspmActivityKpiSample[],
  measuredAt: number,
  context: TaskQiEvidenceContext,
): CalculatedTaskQiEvidence {
  const policy = context.policy ?? FSPM_ACTIVITY_KPI_AGGREGATION_POLICY;
  const expectedFreshActivityIds = Object.values(context.activities)
    .filter(
      (activity) =>
        activity.taskId === context.task.id &&
        activity.status === "completed" &&
        activity.completedAt !== undefined &&
        activity.completedAt <= measuredAt &&
        measuredAt - activity.completedAt <= policy.freshnessWindowTicks,
    )
    .sort(
      (left, right) =>
        (left.completedAt ?? 0) - (right.completedAt ?? 0) ||
        left.id.localeCompare(right.id),
    )
    .slice(-policy.historyLimit)
    .map((activity) => activity.id);
  const expectedFreshActivityIdSet = new Set(expectedFreshActivityIds);
  const duplicateActivityIds = new Set<string>();
  const seen = new Set<string>();
  for (const sample of samples) {
    if (seen.has(sample.activityId))
      duplicateActivityIds.add(sample.activityId);
    seen.add(sample.activityId);
  }

  const classified = samples.map((sample) => {
    if (duplicateActivityIds.has(sample.activityId)) {
      return {
        sample,
        kind: "invalid" as const,
        reason: "multiple terminal KPI samples reference one Activity",
      };
    }
    return classifyActivitySample(sample, measuredAt, {
      task: context.task,
      activities: context.activities,
      policy,
    });
  });
  const allFresh = classified.filter(({ kind }) => kind === "fresh");
  const extraActivityIds = allFresh
    .filter(({ sample }) => !expectedFreshActivityIdSet.has(sample.activityId))
    .map(({ sample }) => sample.activityId)
    .sort();
  const fresh = allFresh.filter(({ sample }) =>
    expectedFreshActivityIdSet.has(sample.activityId),
  );
  const stale = classified.filter(({ kind }) => kind === "stale");
  const unrated = classified.filter(({ kind }) => kind === "unrated");
  const invalid = classified.filter(({ kind }) => kind === "invalid");
  const sampledActivityIds = new Set(
    samples.map((sample) => sample.activityId),
  );
  const missingActivityIds = expectedFreshActivityIds
    .filter((activityId) => !sampledActivityIds.has(activityId))
    .sort();

  let status: FspmEqvmCoverageStatus;
  if (invalid.length > 0 || extraActivityIds.length > 0) status = "invalid";
  else if (missingActivityIds.length > 0) status = "partial";
  else if (fresh.length === 0 && stale.length > 0) status = "stale";
  else if (fresh.length === 0) status = "unavailable";
  else if (unrated.length > 0) status = "partial";
  else status = "complete";

  const score =
    status === "complete"
      ? roundMultiplier(
          fresh.reduce((sum, { sample }) => sum + (sample.value ?? 0), 0) /
            fresh.length,
        )
      : null;
  const ratings = fresh.map(({ sample }) => sample.rating);

  return {
    score,
    status,
    measuredAt,
    activityWeightPolicyId: policy.id,
    activityWeightModel: policy.model,
    configurationClass: policy.configurationClass,
    frameworkReferenceSha: policy.frameworkReferenceSha,
    policyAuthorization: copyPolicyAuthorization(policy.policyAuthorization),
    evidenceWindowTicks: policy.freshnessWindowTicks,
    ratedActivities: fresh.length,
    totalActivities: samples.length + missingActivityIds.length,
    freshActivities: fresh.length,
    staleActivities: stale.length,
    unratedActivities: unrated.length,
    invalidActivities: invalid.length + extraActivityIds.length,
    exceptional: ratings.filter((rating) => rating === "exceptional").length,
    satisfactory: ratings.filter((rating) => rating === "satisfactory").length,
    marginal: ratings.filter((rating) => rating === "marginal").length,
    unsatisfactory: ratings.filter((rating) => rating === "unsatisfactory")
      .length,
    rejected: ratings.filter((rating) => rating === "rejected").length,
    evidence: taskQiEvidence(
      status,
      classified,
      policy,
      missingActivityIds,
      extraActivityIds,
    ),
  };
}

export function computeEqvmResearchEstimate(
  samples: FspmActivityKpiSample[],
  measuredAt: number,
  context: TaskQiEvidenceContext,
): FspmEqvmResearchEstimate {
  const policy = context.policy ?? FSPM_ACTIVITY_KPI_AGGREGATION_POLICY;
  if (
    policy.configurationClass !== "implementation_research_configuration" ||
    policy.policyAuthorization.status !== "unapproved"
  ) {
    throw new Error(
      "EQVM research telemetry requires an explicitly unapproved research configuration",
    );
  }
  return calculateTaskQiEvidence(samples, measuredAt, {
    ...context,
    policy,
  }) as FspmEqvmResearchEstimate;
}

function withholdUnapprovedTaskQi(
  estimate: CalculatedTaskQiEvidence,
  authorizationDebt: string,
): FspmTaskQi {
  return {
    ...estimate,
    score: null,
    status: "unavailable",
    configurationClass: "implementation_research_configuration",
    policyAuthorization: { status: "unapproved", authorizationDebt },
    unavailabilityReason: "activity_weight_policy_unapproved",
    evidence: [
      `canonical Task QI unavailable · ${authorizationDebt}`,
      ...estimate.evidence,
    ],
  };
}

/**
 * Canonical Task QI fails closed until accountable management approves a
 * concrete Activity weighting/cohort policy. The separately named research
 * estimate retains formula diagnostics without acquiring authority semantics.
 */
export function computeVerifiedTaskQi(
  samples: FspmActivityKpiSample[],
  measuredAt: number,
  context: TaskQiEvidenceContext,
): FspmTaskQi {
  const policy = context.policy ?? FSPM_ACTIVITY_KPI_AGGREGATION_POLICY;
  const evidence = calculateTaskQiEvidence(samples, measuredAt, {
    ...context,
    policy,
  });
  const ledgerApproval = resolveLedgerAttestedEqvmPolicyApproval(
    policy.policyAuthorization,
  );
  if (
    policy.configurationClass === "governed_configuration" &&
    hasCanonicalEqvmPolicyContent(policy) &&
    ledgerApproval &&
    ledgerApproval.approvedAtTick <= measuredAt
  ) {
    return evidence.status === "complete" && isEqvmMultiplier(evidence.score)
      ? {
          ...evidence,
          score: evidence.score,
          status: "complete",
          configurationClass: "governed_configuration",
          policyAuthorization: copyPolicyAuthorization(
            ledgerApproval,
          ) as FspmEqvmPolicyApproval,
        }
      : {
          ...evidence,
          score: null,
          status: evidence.status === "complete" ? "invalid" : evidence.status,
          configurationClass: "governed_configuration",
          policyAuthorization: copyPolicyAuthorization(
            ledgerApproval,
          ) as FspmEqvmPolicyApproval,
        };
  }

  const authorizationDebt =
    policy.policyAuthorization.status === "unapproved"
      ? policy.policyAuthorization.authorizationDebt
      : !hasCanonicalEqvmPolicyContent(policy) ||
          !isApprovedEqvmPolicyAuthorization(policy.policyAuthorization)
        ? "EQVM policy approval provenance or evaluated policy content is invalid."
        : "EQVM policy approval cannot be resolved from a governed approval ledger; nested approval claims are not authority.";
  return withholdUnapprovedTaskQi(evidence, authorizationDebt);
}

interface WeightedQualityItem {
  id: string;
  weightBasisPoints: number;
  score: number | null;
  status: FspmEqvmCoverageStatus;
  policyAuthorization: FspmEqvmPolicyAuthorization | null;
}

const isEqvmMultiplier = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0 && value <= 1.5;

function approvedTaskQiAuthorization(
  qi: FspmTaskQi | undefined,
  measuredAt: number,
): FspmEqvmPolicyApproval | null {
  if (
    !qi ||
    qi.activityWeightPolicyId !== FSPM_ACTIVITY_KPI_AGGREGATION_POLICY.id ||
    qi.activityWeightModel !== FSPM_ACTIVITY_KPI_AGGREGATION_POLICY.model ||
    qi.frameworkReferenceSha !== FSPM_GOVERNANCE_SHA ||
    qi.evidenceWindowTicks !==
      FSPM_ACTIVITY_KPI_AGGREGATION_POLICY.freshnessWindowTicks ||
    qi.measuredAt !== measuredAt ||
    qi.configurationClass !== "governed_configuration" ||
    !isApprovedEqvmPolicyAuthorization(qi.policyAuthorization) ||
    !(
      (qi.status === "complete" && isEqvmMultiplier(qi.score)) ||
      (qi.status !== "complete" && qi.score === null)
    )
  ) {
    return null;
  }
  return resolveLedgerAttestedEqvmPolicyApproval(qi.policyAuthorization);
}

function approvedDeliverableQiAuthorization(
  dqi: FspmDeliverableQi | undefined,
  measuredAt: number,
): FspmEqvmPolicyApproval | null {
  if (
    !dqi ||
    dqi.activityWeightPolicyId !== FSPM_ACTIVITY_KPI_AGGREGATION_POLICY.id ||
    dqi.measuredAt !== measuredAt ||
    !isApprovedEqvmPolicyAuthorization(dqi.policyAuthorization) ||
    !(
      (dqi.coverage.status === "complete" && isEqvmMultiplier(dqi.score)) ||
      (dqi.coverage.status !== "complete" && dqi.score === null)
    )
  ) {
    return null;
  }
  return resolveLedgerAttestedEqvmPolicyApproval(dqi.policyAuthorization);
}

function computeWeightedCoverage(
  label: "Task" | "Deliverable",
  items: WeightedQualityItem[],
): { score: number | null; coverage: FspmWeightedEqvmCoverage } {
  const duplicateIds = items
    .filter(
      (item, index) =>
        items.findIndex((candidate) => candidate.id === item.id) !== index,
    )
    .map(({ id }) => id);
  const invalidWeightItems = items.filter(
    ({ weightBasisPoints }) =>
      !Number.isInteger(weightBasisPoints) ||
      weightBasisPoints <= 0 ||
      weightBasisPoints > FSPM_WEIGHT_BASIS_POINTS,
  );
  const totalWeight = items.reduce(
    (sum, { weightBasisPoints }) => sum + weightBasisPoints,
    0,
  );
  const complete = items.filter(
    ({ status, score, policyAuthorization }) =>
      status === "complete" &&
      isEqvmMultiplier(score) &&
      isApprovedEqvmPolicyAuthorization(policyAuthorization),
  );
  const coveredWeight = complete.reduce(
    (sum, { weightBasisPoints }) => sum + weightBasisPoints,
    0,
  );
  const staleIds = items
    .filter(({ status }) => status === "stale")
    .map(({ id }) => id)
    .sort();
  const invalidIds = [
    ...items
      .filter(
        ({ status, score }) =>
          status === "invalid" ||
          (status === "complete" && !isEqvmMultiplier(score)),
      )
      .map(({ id }) => id),
    ...invalidWeightItems.map(({ id }) => id),
    ...duplicateIds,
  ]
    .filter((id, index, values) => values.indexOf(id) === index)
    .sort();
  const missingIds = items
    .filter(
      ({ status, policyAuthorization }) =>
        status === "unavailable" ||
        status === "partial" ||
        !isApprovedEqvmPolicyAuthorization(policyAuthorization),
    )
    .map(({ id }) => id)
    .sort();

  let status: FspmEqvmCoverageStatus;
  if (items.length === 0) {
    status = "unavailable";
  } else if (
    invalidIds.length > 0 ||
    totalWeight !== FSPM_WEIGHT_BASIS_POINTS
  ) {
    status = "invalid";
  } else if (coveredWeight === 0 && staleIds.length === 0) {
    status = "unavailable";
  } else if (coveredWeight === 0 && staleIds.length === items.length) {
    status = "stale";
  } else if (
    coveredWeight !== FSPM_WEIGHT_BASIS_POINTS ||
    missingIds.length > 0 ||
    staleIds.length > 0
  ) {
    status = "partial";
  } else {
    status = "complete";
  }

  const score =
    status === "complete"
      ? roundMultiplier(
          complete.reduce(
            (sum, item) => sum + item.weightBasisPoints * (item.score ?? 0),
            0,
          ) / FSPM_WEIGHT_BASIS_POINTS,
        )
      : null;
  const evidence = [
    `coverage ${status} · ${coveredWeight}/${FSPM_WEIGHT_BASIS_POINTS} bp verified`,
    `${label} weights ${totalWeight}/${FSPM_WEIGHT_BASIS_POINTS} bp`,
    ...items
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(
        ({
          id,
          weightBasisPoints,
          score: itemScore,
          status: itemStatus,
          policyAuthorization,
        }) =>
          `${id} · ${weightBasisPoints} bp × ${itemScore === null ? itemStatus : itemScore} · authorization ${policyAuthorization?.status ?? "missing"}`,
      ),
  ];
  return {
    score,
    coverage: {
      status,
      expectedWeightBasisPoints: FSPM_WEIGHT_BASIS_POINTS,
      coveredWeightBasisPoints: coveredWeight,
      missingIds,
      staleIds,
      invalidIds,
      evidence,
    },
  };
}

function rollupPolicyAuthorization(
  label: "DQI" | "PQI",
  items: WeightedQualityItem[],
): FspmEqvmPolicyAuthorization {
  const approvals = items.flatMap((item) =>
    isApprovedEqvmPolicyAuthorization(item.policyAuthorization)
      ? [item.policyAuthorization]
      : [],
  );
  const identity = approvals[0] ? approvalIdentity(approvals[0]) : null;
  if (
    items.length > 0 &&
    approvals.length === items.length &&
    identity !== null &&
    approvals.every((approval) => approvalIdentity(approval) === identity)
  ) {
    return copyPolicyAuthorization(approvals[0] as FspmEqvmPolicyApproval);
  }
  return {
    status: "unapproved",
    authorizationDebt: `${label} unavailable: every child must carry one identical Activity-weight policy approval resolved from the governed approval ledger; no such ledger exists in the current authority package.`,
  };
}

function canonicalRollupState(
  items: WeightedQualityItem[],
  weighted: ReturnType<typeof computeWeightedCoverage>,
  policyAuthorization: FspmEqvmPolicyAuthorization,
): FspmCanonicalEqvmRollupState {
  if (isApprovedEqvmPolicyAuthorization(policyAuthorization)) {
    return weighted.coverage.status === "complete" &&
      isEqvmMultiplier(weighted.score)
      ? {
          score: weighted.score,
          policyAuthorization,
          coverage: { ...weighted.coverage, status: "complete" },
        }
      : {
          score: null,
          policyAuthorization,
          coverage: {
            ...weighted.coverage,
            status:
              weighted.coverage.status === "complete"
                ? "invalid"
                : weighted.coverage.status,
          },
        };
  }

  const conflictingApprovals = weighted.coverage.status === "complete";
  return {
    score: null,
    policyAuthorization,
    coverage: {
      ...weighted.coverage,
      status: conflictingApprovals
        ? "invalid"
        : (weighted.coverage.status as Exclude<
            FspmEqvmCoverageStatus,
            "complete"
          >),
      coveredWeightBasisPoints: conflictingApprovals
        ? 0
        : weighted.coverage.coveredWeightBasisPoints,
      invalidIds: conflictingApprovals
        ? items.map(({ id }) => id).sort()
        : weighted.coverage.invalidIds,
      evidence: [
        `canonical rollup unavailable · ${policyAuthorization.authorizationDebt}`,
        ...weighted.coverage.evidence,
      ],
    },
  };
}

/** DQI = Sum(Task Weight x verified Task QI) / Sum(Task Weights). */
export function computeDeliverableQi(
  deliverable: Pick<ColonyDeliverable, "id">,
  tasks: ColonyTask[],
  measuredAt: number,
): FspmDeliverableQi {
  const governedTasks = tasks.filter(
    (task) => task.status === "active" && task.deliverableId === deliverable.id,
  );
  const items: WeightedQualityItem[] = governedTasks.map((task) => ({
    id: task.id,
    weightBasisPoints: (task.taskWeight ?? 0) * 100,
    score: task.qi?.score ?? null,
    status: task.qi?.status ?? "unavailable",
    policyAuthorization: approvedTaskQiAuthorization(task.qi, measuredAt),
  }));
  const weighted = computeWeightedCoverage("Task", items);
  const policyAuthorization = rollupPolicyAuthorization("DQI", items);
  return {
    ...canonicalRollupState(items, weighted, policyAuthorization),
    measuredAt,
    activityWeightPolicyId: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY.id,
    taskWeightBasisPoints: governedTasks.reduce(
      (sum, task) => sum + (task.taskWeight ?? 0) * 100,
      0,
    ),
  };
}

/** P3/PQI = Sum(Deliverable Weight x DQI) / Sum(Deliverable Weights). */
export function computeP3Pqi(
  deliverables: ColonyDeliverable[],
  measuredAt: number,
): FspmP3Pqi {
  const governedDeliverables = deliverables.filter(
    (deliverable) => deliverable.status === "active",
  );
  const items: WeightedQualityItem[] = governedDeliverables.map(
    (deliverable) => ({
      id: deliverable.id,
      weightBasisPoints: deliverable.siblingWeightBasisPoints,
      score: deliverable.dqi?.score ?? null,
      status: deliverable.dqi?.coverage.status ?? "unavailable",
      policyAuthorization: approvedDeliverableQiAuthorization(
        deliverable.dqi,
        measuredAt,
      ),
    }),
  );
  const weighted = computeWeightedCoverage("Deliverable", items);
  const policyAuthorization = rollupPolicyAuthorization("PQI", items);
  return {
    ...canonicalRollupState(items, weighted, policyAuthorization),
    measuredAt,
    activityWeightPolicyId: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY.id,
    deliverableWeightBasisPoints: governedDeliverables.reduce(
      (sum, deliverable) => sum + deliverable.siblingWeightBasisPoints,
      0,
    ),
  };
}

/** Recalculate the complete evidence hierarchy without changing authority. */
export function reconcilePortfolioEqvm(
  portfolio: ColonyFspmPortfolio,
  measuredAt: number,
): void {
  const activities = portfolio.activities ?? {};
  const tasks = Object.values(portfolio.tasks)
    .filter((task): task is ColonyTask => Boolean(task))
    .sort((left, right) => left.id.localeCompare(right.id));
  portfolio.eqvmResearchTelemetry ??= {};

  for (const task of tasks) {
    const definition = fspmTaskDefinition(task.domain, task.taskKey);
    if (!definition) continue;
    const estimate = computeEqvmResearchEstimate(
      portfolio.activityKpiHistory?.[task.id] ?? [],
      measuredAt,
      {
        task,
        activities,
        policy: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      },
    );
    portfolio.eqvmResearchTelemetry[task.id] = estimate;
    task.qi = withholdUnapprovedTaskQi(
      estimate,
      estimate.policyAuthorization.authorizationDebt,
    );
  }

  const deliverables = Object.values(portfolio.deliverables)
    .filter((record): record is ColonyDeliverable => Boolean(record))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const deliverable of deliverables) {
    deliverable.dqi = computeDeliverableQi(deliverable, tasks, measuredAt);
  }
  portfolio.p3.pqi = computeP3Pqi(deliverables, measuredAt);
}
