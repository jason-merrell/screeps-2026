const ACTIVITY_WEIGHT_POLICY_ID =
  "eqvm:activity-weight:equal-terminal-samples:v1";
const FSPM_FRAMEWORK_REFERENCE_SHA = "02d581886a759d19044ff91a80d743fa042f23f7";
const EVIDENCE_WINDOW_TICKS = 1_500;
const COVERAGE_STATUSES = new Set([
  "unavailable",
  "partial",
  "complete",
  "stale",
  "invalid",
]);
const GOVERNANCE_CHECK_KEYS = [
  "empireRoot",
  "packageProjection",
  "approvalLedger",
  "ancestry",
  "relationships",
  "exactWeights",
  "receiptContracts",
  "acceptancePolicies",
  "receiptLedgers",
];

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;

const boundedNonblankString = (value, maxLength) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= maxLength
    ? value
    : null;

const boundedStringArray = (value, maxItems, maxLength) => {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const sanitized = value.map((entry) =>
    boundedNonblankString(entry, maxLength),
  );
  return sanitized.every(Boolean) ? sanitized : null;
};

const nonnegativeSafeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

export const sanitizeEqvmPolicyAuthorization = (value) => {
  const candidate = record(value);
  if (!candidate) return null;
  if (candidate.status === "unapproved") {
    const authorizationDebt = boundedNonblankString(
      candidate.authorizationDebt,
      500,
    );
    return authorizationDebt
      ? { status: "unapproved", authorizationDebt }
      : null;
  }
  // Nested approval claims are attacker-controlled snapshot data. The current
  // authority package has no EQVM policy-approval ledger against which to
  // resolve them, so every approval-shaped claim fails closed.
  return null;
};

const sanitizeWeightedCoverage = (value) => {
  const candidate = record(value);
  if (!candidate || !COVERAGE_STATUSES.has(candidate.status)) return null;
  const expectedWeightBasisPoints = nonnegativeSafeInteger(
    candidate.expectedWeightBasisPoints,
  );
  const coveredWeightBasisPoints = nonnegativeSafeInteger(
    candidate.coveredWeightBasisPoints,
  );
  const missingIds = boundedStringArray(candidate.missingIds, 256, 240);
  const staleIds = boundedStringArray(candidate.staleIds, 256, 240);
  const invalidIds = boundedStringArray(candidate.invalidIds, 256, 240);
  const evidence = boundedStringArray(candidate.evidence, 32, 500);
  if (
    expectedWeightBasisPoints === null ||
    coveredWeightBasisPoints === null ||
    coveredWeightBasisPoints > expectedWeightBasisPoints ||
    !missingIds ||
    !staleIds ||
    !invalidIds ||
    !evidence ||
    (candidate.status === "complete" &&
      (coveredWeightBasisPoints !== expectedWeightBasisPoints ||
        missingIds.length > 0 ||
        staleIds.length > 0 ||
        invalidIds.length > 0))
  )
    return null;

  return {
    status: candidate.status,
    expectedWeightBasisPoints,
    coveredWeightBasisPoints,
    missingIds,
    staleIds,
    invalidIds,
    evidence,
  };
};

const occursNoLaterThan = (measuredAt, maximumTick) =>
  maximumTick === undefined ||
  (maximumTick !== null && measuredAt <= maximumTick);

export const sanitizeWeightedEqvmIndex = (value, weightKey, maximumTick) => {
  const candidate = record(value);
  if (
    !candidate ||
    !["taskWeightBasisPoints", "deliverableWeightBasisPoints"].includes(
      weightKey,
    )
  )
    return null;
  const measuredAt = nonnegativeSafeInteger(candidate.measuredAt);
  const weight = nonnegativeSafeInteger(candidate[weightKey]);
  const coverage = sanitizeWeightedCoverage(candidate.coverage);
  const policyAuthorization = sanitizeEqvmPolicyAuthorization(
    candidate.policyAuthorization,
  );
  if (
    measuredAt === null ||
    !occursNoLaterThan(measuredAt, maximumTick) ||
    weight === null ||
    !coverage ||
    !policyAuthorization ||
    candidate.activityWeightPolicyId !== ACTIVITY_WEIGHT_POLICY_ID ||
    policyAuthorization.status !== "unapproved" ||
    candidate.score !== null ||
    coverage.status === "complete"
  )
    return null;

  return {
    score: null,
    measuredAt,
    activityWeightPolicyId: ACTIVITY_WEIGHT_POLICY_ID,
    [weightKey]: weight,
    coverage,
    policyAuthorization,
  };
};

export const sanitizeTaskQi = (value, maximumTick) => {
  const candidate = record(value);
  if (!candidate || !COVERAGE_STATUSES.has(candidate.status)) return null;
  const integerFields = [
    "measuredAt",
    "evidenceWindowTicks",
    "ratedActivities",
    "totalActivities",
    "freshActivities",
    "staleActivities",
    "unratedActivities",
    "invalidActivities",
    "exceptional",
    "satisfactory",
    "marginal",
    "unsatisfactory",
    "rejected",
  ];
  const integers = Object.fromEntries(
    integerFields.map((field) => [
      field,
      nonnegativeSafeInteger(candidate[field]),
    ]),
  );
  const evidence = boundedStringArray(candidate.evidence, 32, 500);
  const frameworkReferenceSha = boundedNonblankString(
    candidate.frameworkReferenceSha,
    80,
  );
  const policyAuthorization = sanitizeEqvmPolicyAuthorization(
    candidate.policyAuthorization,
  );
  const ratingTotal =
    (integers.exceptional ?? 0) +
    (integers.satisfactory ?? 0) +
    (integers.marginal ?? 0) +
    (integers.unsatisfactory ?? 0) +
    (integers.rejected ?? 0);
  if (
    Object.values(integers).some((entry) => entry === null) ||
    !occursNoLaterThan(integers.measuredAt, maximumTick) ||
    integers.evidenceWindowTicks !== EVIDENCE_WINDOW_TICKS ||
    !evidence ||
    frameworkReferenceSha !== FSPM_FRAMEWORK_REFERENCE_SHA ||
    policyAuthorization?.status !== "unapproved" ||
    candidate.activityWeightPolicyId !== ACTIVITY_WEIGHT_POLICY_ID ||
    candidate.activityWeightModel !== "equal_weight" ||
    candidate.score !== null ||
    candidate.status !== "unavailable" ||
    candidate.configurationClass !== "implementation_research_configuration" ||
    candidate.unavailabilityReason !== "activity_weight_policy_unapproved" ||
    integers.ratedActivities !== integers.freshActivities ||
    ratingTotal !== integers.ratedActivities ||
    integers.freshActivities +
      integers.staleActivities +
      integers.unratedActivities +
      integers.invalidActivities >
      integers.totalActivities
  )
    return null;

  return {
    score: null,
    status: "unavailable",
    measuredAt: integers.measuredAt,
    activityWeightPolicyId: ACTIVITY_WEIGHT_POLICY_ID,
    activityWeightModel: "equal_weight",
    configurationClass: "implementation_research_configuration",
    frameworkReferenceSha,
    unavailabilityReason: "activity_weight_policy_unapproved",
    policyAuthorization,
    evidenceWindowTicks: integers.evidenceWindowTicks,
    ratedActivities: integers.ratedActivities,
    totalActivities: integers.totalActivities,
    freshActivities: integers.freshActivities,
    staleActivities: integers.staleActivities,
    unratedActivities: integers.unratedActivities,
    invalidActivities: integers.invalidActivities,
    exceptional: integers.exceptional,
    satisfactory: integers.satisfactory,
    marginal: integers.marginal,
    unsatisfactory: integers.unsatisfactory,
    rejected: integers.rejected,
    evidence,
  };
};

const hasEligibleGovernance = (colony) => {
  const governance = record(colony?.governance);
  const checks = record(governance?.checks);
  return Boolean(
    governance?.valid === true &&
      governance.executionEligible === true &&
      Object.keys(checks ?? {}).length === GOVERNANCE_CHECK_KEYS.length &&
      GOVERNANCE_CHECK_KEYS.every((key) => checks?.[key] === true) &&
      Object.values(checks).every((value) => value === true),
  );
};

const stripEqvmClaims = (value) => {
  if (Array.isArray(value)) {
    for (const child of value) stripEqvmClaims(child);
    return;
  }
  const candidate = record(value);
  if (!candidate) return;
  delete candidate.qi;
  delete candidate.dqi;
  delete candidate.pqi;
  for (const child of Object.values(candidate)) stripEqvmClaims(child);
};

const captureOptionalEqvm = (accepted, parent, key, sanitizer, allowed) => {
  const candidate = allowed ? sanitizer(parent[key]) : null;
  if (candidate) accepted.push({ parent, key, candidate });
};

/**
 * Applies the strict canonical-quality boundary to a separately bounded trace.
 * This intentionally mutates and returns that sanitized trace copy. Generic
 * JSON bounding is not sufficient for authority-bearing EQVM fields.
 */
export const enforceEqvmSnapshotBoundary = (runtimeTrace) => {
  const trace = record(runtimeTrace);
  const fspm = record(trace?.fspm);
  if (!trace) return runtimeTrace;
  const accepted = [];
  const traceTick = nonnegativeSafeInteger(trace.tick);

  if (fspm && Array.isArray(fspm.colonies)) {
    for (const colonyValue of fspm.colonies) {
      const colony = record(colonyValue);
      if (!colony) continue;
      // A quality sample cannot be authoritative without a trustworthy temporal
      // ceiling. The trace tick is captured by the publication fence and is the
      // latest tick any nested EQVM measurement may claim.
      const allowed = traceTick !== null && hasEligibleGovernance(colony);
      const p3 = record(colony.p3);
      if (p3) {
        captureOptionalEqvm(
          accepted,
          p3,
          "pqi",
          (value) =>
            sanitizeWeightedEqvmIndex(
              value,
              "deliverableWeightBasisPoints",
              traceTick,
            ),
          allowed,
        );
      }
      if (Array.isArray(colony.deliverables)) {
        for (const deliverableValue of colony.deliverables) {
          const deliverable = record(deliverableValue);
          if (!deliverable) continue;
          captureOptionalEqvm(
            accepted,
            deliverable,
            "dqi",
            (value) =>
              sanitizeWeightedEqvmIndex(
                value,
                "taskWeightBasisPoints",
                traceTick,
              ),
            allowed,
          );
        }
      }
      if (Array.isArray(colony.tasks)) {
        for (const taskValue of colony.tasks) {
          const task = record(taskValue);
          if (!task) continue;
          captureOptionalEqvm(
            accepted,
            task,
            "qi",
            (value) => sanitizeTaskQi(value, traceTick),
            allowed,
          );
        }
      }
    }
  }

  // Unknown, malformed, or future paths never inherit authority by shape.
  stripEqvmClaims(trace);
  for (const { parent, key, candidate } of accepted) parent[key] = candidate;
  return runtimeTrace;
};

/**
 * Clones a stored or inbound snapshot before applying the EQVM authority
 * boundary. This is deliberately synchronous: neither the Next.js render tree
 * nor the persistence call can observe the untrusted approval-shaped fields.
 *
 * @template {object} T
 * @param {unknown} value
 * @returns {T | null}
 */
export const sanitizeStoredObservabilitySnapshot = (value) => {
  const candidate = record(value);
  if (!candidate) return null;

  let snapshot;
  try {
    snapshot = structuredClone(candidate);
  } catch {
    return null;
  }
  if (
    snapshot.schema !== "screeps-observability-snapshot/v1" ||
    snapshot.schemaVersion !== 1
  )
    return null;

  const runtimeTrace = record(snapshot.runtimeTrace);
  const sanitizedRuntimeTrace = runtimeTrace
    ? structuredClone(runtimeTrace)
    : null;
  stripEqvmClaims(snapshot);
  if (sanitizedRuntimeTrace) {
    enforceEqvmSnapshotBoundary(sanitizedRuntimeTrace);
    snapshot.runtimeTrace = sanitizedRuntimeTrace;
  } else if (
    snapshot.runtimeTrace !== undefined &&
    snapshot.runtimeTrace !== null
  ) {
    delete snapshot.runtimeTrace;
  }
  return snapshot;
};

/**
 * Longitudinal telemetry is publicly readable and does not need canonical
 * quality rollups. Strip every EQVM claim after applying the strict decoder so
 * legacy or forged approval-shaped data cannot be retained through this
 * secondary transport.
 *
 * @template {object} T
 * @param {unknown} value
 * @returns {T | null}
 */
export const sanitizeStoredTelemetrySample = (value) => {
  const candidate = record(value);
  if (!candidate) return null;

  let sample;
  try {
    sample = structuredClone(candidate);
  } catch {
    return null;
  }
  if (
    sample.schema !== "screeps-telemetry-sample/v1" ||
    sample.schemaVersion !== 1
  ) {
    return null;
  }

  if (sample.runtimeTrace !== undefined && sample.runtimeTrace !== null) {
    const runtimeTrace = record(sample.runtimeTrace);
    if (runtimeTrace) {
      enforceEqvmSnapshotBoundary(runtimeTrace);
    } else {
      delete sample.runtimeTrace;
    }
  }
  stripEqvmClaims(sample);
  return sample;
};
