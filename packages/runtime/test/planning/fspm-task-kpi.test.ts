import { describe, expect, it } from "vitest";
import type {
  FspmActivityKpiSample,
  FspmActivityRecord,
} from "../../src/planning/fspm";
import {
  activityKpiMultiplier,
  computeEqvmResearchEstimate,
  computeTaskQi,
  FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
  FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH,
} from "../../src/planning/task-kpi";

const taskId = "task:W1N1:economy:maintain-colony-energy-service";
const task = {
  id: taskId,
  taskKey: "maintain-colony-energy-service",
} as const;

const terminalSample = (
  tick: number,
  rating: Exclude<FspmActivityKpiSample["rating"], "in_progress">,
): FspmActivityKpiSample => ({
  tick,
  activityId: `activity:${tick}`,
  activityType: "maintain-colony-energy-service",
  actor: "worker-1",
  rating,
  value: activityKpiMultiplier(rating),
  evidence: `verified ${rating} terminal outcome at ${tick}`,
  source: "terminal_activity_kpi",
  activityCompletedAtTick: tick,
  activityWeightPolicyId: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY.id,
});

const completedActivity = (
  sample: FspmActivityKpiSample,
): FspmActivityRecord => ({
  id: sample.activityId,
  taskId,
  assignee: sample.actor,
  status: "completed",
  currentProcedureId: "procedure:test",
  qualityDescription: "verified terminal work",
  qualityMetric: "terminal KPI evidence",
  kpiMetric: {
    metric: "terminal result",
    exceptional: "1.50",
    satisfactory: "1.00",
    unsatisfactory: "0.50",
  },
  kpiScore: sample.rating as Exclude<
    FspmActivityKpiSample["rating"],
    "in_progress"
  >,
  kpiEvidence: sample.evidence,
  createdAt: Math.max(0, sample.tick - 2),
  startedAt: Math.max(0, sample.tick - 1),
  completedAt: sample.tick,
  updatedAt: sample.tick,
  metrics: {
    inProgressTicks: 1,
    onHoldTicks: 0,
    productiveTicks: 1,
    travelTicks: 0,
    idleTicks: 0,
    holdCount: 0,
    resumeCount: 0,
    taskPreemptions: 0,
    procedureTransitions: 0,
  },
});

const contextFor = (samples: FspmActivityKpiSample[]) => ({
  task,
  activities: Object.fromEntries(
    samples
      .filter((sample) => sample.rating !== "in_progress")
      .map((sample) => [sample.activityId, completedActivity(sample)]),
  ),
  policy: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
});

describe("FSPM Task QI", () => {
  it("calculates the research estimate across the complete FSPM multiplier scale", () => {
    const samples = [
      terminalSample(96, "exceptional"),
      terminalSample(97, "satisfactory"),
      terminalSample(98, "marginal"),
      terminalSample(99, "unsatisfactory"),
      terminalSample(100, "rejected"),
    ];

    expect(
      computeEqvmResearchEstimate(samples, 100, contextFor(samples)),
    ).toEqual({
      score: 0.75,
      status: "complete",
      measuredAt: 100,
      activityWeightPolicyId: "eqvm:activity-weight:equal-terminal-samples:v1",
      activityWeightModel: "equal_weight",
      configurationClass: "implementation_research_configuration",
      frameworkReferenceSha: "02d581886a759d19044ff91a80d743fa042f23f7",
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt:
          "Accountable management has not approved the recurring Activity sample weights, reporting cohort, or freshness window.",
      },
      evidenceWindowTicks: 1_500,
      ratedActivities: 5,
      totalActivities: 5,
      freshActivities: 5,
      staleActivities: 0,
      unratedActivities: 0,
      invalidActivities: 0,
      exceptional: 1,
      satisfactory: 1,
      marginal: 1,
      unsatisfactory: 1,
      rejected: 1,
      evidence: [
        "coverage complete · 5/5 verified fresh terminal Activity KPI samples",
        "research-only activity weighting equal_weight · one unit per terminal sample · latest 24 configured cohort · sum(weight × KPI rating) / sum(weights)",
        "policy unapproved · framework reference 02d581886a759d19044ff91a80d743fa042f23f7 · Accountable management has not approved the recurring Activity sample weights, reporting cohort, or freshness window.",
        "evidence window 1500 ticks · 0 stale · 0 unrated · 0 invalid",
      ],
    });
  });

  it("reports no KPI evidence as unavailable, never as zero", () => {
    const qi = computeEqvmResearchEstimate([], 100, contextFor([]));
    expect(qi).toMatchObject({
      score: null,
      status: "unavailable",
      ratedActivities: 0,
      totalActivities: 0,
    });
  });

  it("withholds Task QI for partial evidence without scoring in-progress work", () => {
    const terminal = terminalSample(100, "satisfactory");
    const inProgress: FspmActivityKpiSample = {
      tick: 100,
      activityId: "activity:in-progress",
      activityType: "transfer",
      actor: "worker-2",
      rating: "in_progress",
      value: null,
      evidence: "traveling to governed target",
    };
    const samples = [terminal, inProgress];

    expect(
      computeEqvmResearchEstimate(samples, 100, contextFor(samples)),
    ).toMatchObject({
      score: null,
      status: "partial",
      ratedActivities: 1,
      unratedActivities: 1,
    });
  });

  it("distinguishes stale evidence from never-observed evidence", () => {
    const samples = [terminalSample(100, "satisfactory")];
    expect(
      computeEqvmResearchEstimate(samples, 1_601, contextFor(samples)),
    ).toMatchObject({
      score: null,
      status: "stale",
      staleActivities: 1,
    });
  });

  it("rejects a terminal sample that is not verified by its Activity record", () => {
    const samples = [terminalSample(100, "exceptional")];
    expect(
      computeEqvmResearchEstimate(samples, 100, {
        task,
        activities: {},
        policy: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      }),
    ).toMatchObject({
      score: null,
      status: "invalid",
      invalidActivities: 1,
    });
  });

  it("keeps a verified rejected score of zero distinct from unavailable", () => {
    const samples = [terminalSample(100, "rejected")];
    expect(
      computeEqvmResearchEstimate(samples, 100, contextFor(samples)),
    ).toMatchObject({
      score: 0,
      status: "complete",
      rejected: 1,
    });
  });

  it("rejects cross-Task sample substitution", () => {
    const sample = terminalSample(100, "exceptional");
    const poisoned = completedActivity(sample);
    poisoned.taskId = "task:W1N1:defense:maintain-defensive-readiness";

    expect(
      computeEqvmResearchEstimate([sample], 100, {
        task,
        activities: { [sample.activityId]: poisoned },
        policy: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      }),
    ).toMatchObject({ score: null, status: "invalid" });
  });

  it("withholds Task QI when a fresh terminal Activity is missing its sample", () => {
    const included = terminalSample(99, "satisfactory");
    const missing = terminalSample(100, "exceptional");
    const activities = {
      [included.activityId]: completedActivity(included),
      [missing.activityId]: completedActivity(missing),
    };

    const qi = computeEqvmResearchEstimate([included], 100, {
      task,
      activities,
      policy: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
    });
    expect(qi).toMatchObject({
      score: null,
      status: "partial",
      ratedActivities: 1,
      totalActivities: 2,
    });
    expect(qi.evidence).toContain(
      "missing terminal Activity KPI samples: activity:100",
    );
  });

  it("rejects wrong actor and Activity type evidence", () => {
    const wrongActor = terminalSample(99, "satisfactory");
    wrongActor.actor = "impostor";
    const wrongType = terminalSample(100, "satisfactory");
    wrongType.activityType = "repel-hostile";
    const canonicalActor = completedActivity({
      ...wrongActor,
      actor: "worker-1",
    });
    const canonicalType = completedActivity({
      ...wrongType,
      activityType: task.taskKey,
    });

    expect(
      computeEqvmResearchEstimate([wrongActor, wrongType], 100, {
        task,
        activities: {
          [wrongActor.activityId]: canonicalActor,
          [wrongType.activityId]: canonicalType,
        },
        policy: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      }),
    ).toMatchObject({
      score: null,
      status: "invalid",
      invalidActivities: 2,
    });
  });

  it("rejects duplicate Activity KPI samples", () => {
    const sample = terminalSample(100, "satisfactory");
    expect(
      computeEqvmResearchEstimate([sample, { ...sample }], 100, {
        task,
        activities: { [sample.activityId]: completedActivity(sample) },
        policy: FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      }),
    ).toMatchObject({
      score: null,
      status: "invalid",
      invalidActivities: 2,
    });
  });

  it("rejects samples outside the governed latest-24 reporting cohort", () => {
    const samples = Array.from({ length: 25 }, (_, index) =>
      terminalSample(100 + index, "satisfactory"),
    );
    const qi = computeEqvmResearchEstimate(samples, 124, contextFor(samples));

    expect(qi).toMatchObject({
      score: null,
      status: "invalid",
      ratedActivities: 24,
      invalidActivities: 1,
    });
    expect(qi.evidence).toContain(
      "extra terminal Activity KPI samples outside configured cohort: activity:100",
    );
  });

  it("withholds canonical Task QI while the concrete Activity-weight policy is unapproved", () => {
    const samples = [terminalSample(100, "exceptional")];

    expect(computeTaskQi(samples, 100, contextFor(samples))).toMatchObject({
      score: null,
      status: "unavailable",
      policyAuthorization: { status: "unapproved" },
      unavailabilityReason: "activity_weight_policy_unapproved",
    });
  });

  it("withholds an approval-shaped Task QI until a governed ledger resolves it", () => {
    const samples = [terminalSample(100, "exceptional")];
    const researchContext = contextFor(samples);
    const approvedPolicy = {
      ...FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      configurationClass: "governed_configuration" as const,
      policyAuthorization: {
        status: "approved" as const,
        approvalEventId: "approval:eqvm-policy:v1",
        approvalAuthorityOuId: "ou:colony-management",
        accountablePositionId: "position:colony-manager",
        signerPrincipalId: "principal:test-accountable-manager",
        approvedAtTick: 80,
        approvedPolicyContentHash: FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH,
      },
    };

    expect(
      computeTaskQi(samples, 100, {
        ...researchContext,
        policy: approvedPolicy,
      }),
    ).toMatchObject({
      score: null,
      status: "unavailable",
      configurationClass: "implementation_research_configuration",
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt: expect.stringContaining("governed approval ledger"),
      },
      unavailabilityReason: "activity_weight_policy_unapproved",
    });
  });

  it("withholds a naked approval claim that is not bound to the exact policy content", () => {
    const samples = [terminalSample(100, "exceptional")];
    const researchContext = contextFor(samples);
    const forgedPolicy = {
      ...FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      configurationClass: "governed_configuration" as const,
      policyAuthorization: {
        status: "approved" as const,
        approvalEventId: "approval:eqvm-policy:v1",
        approvalAuthorityOuId: "ou:colony-management",
        accountablePositionId: "position:colony-manager",
        signerPrincipalId: "principal:test-accountable-manager",
        approvedAtTick: 80,
        approvedPolicyContentHash: "a".repeat(64),
      },
    };

    expect(
      computeTaskQi(samples, 100, {
        ...researchContext,
        policy: forgedPolicy,
      }),
    ).toMatchObject({
      score: null,
      status: "unavailable",
      configurationClass: "implementation_research_configuration",
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt: expect.stringContaining("invalid"),
      },
    });
  });

  it("withholds approved provenance when the evaluated policy differs from its content hash", () => {
    const samples = [terminalSample(100, "exceptional")];
    const researchContext = contextFor(samples);
    const mismatchedPolicy = {
      ...FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
      freshnessWindowTicks: 10 as 1_500,
      configurationClass: "governed_configuration" as const,
      policyAuthorization: {
        status: "approved" as const,
        approvalEventId: "approval:eqvm-policy:v1",
        approvalAuthorityOuId: "ou:colony-management",
        accountablePositionId: "position:colony-manager",
        signerPrincipalId: "principal:test-accountable-manager",
        approvedAtTick: 80,
        approvedPolicyContentHash: FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH,
      },
    };

    expect(
      computeTaskQi(samples, 100, {
        ...researchContext,
        policy: mismatchedPolicy,
      }),
    ).toMatchObject({
      score: null,
      status: "unavailable",
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt: expect.stringContaining("invalid"),
      },
    });
  });
});
