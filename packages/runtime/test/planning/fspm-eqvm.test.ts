import { describe, expect, it } from "vitest";
import {
  computeDeliverableQi,
  computeP3Pqi,
  FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH,
} from "../../src/planning/eqvm";
import type {
  ColonyDeliverable,
  ColonyTask,
  FspmDeliverableQi,
  FspmEqvmCoverageStatus,
  FspmEqvmPolicyApproval,
  FspmTaskQi,
} from "../../src/planning/fspm";

const APPROVED_POLICY: FspmEqvmPolicyApproval = {
  status: "approved",
  approvalEventId: "approval:eqvm-policy:v1",
  approvalAuthorityOuId: "ou:colony-management",
  accountablePositionId: "position:colony-manager",
  signerPrincipalId: "principal:test-accountable-manager",
  approvedAtTick: 80,
  approvedPolicyContentHash: FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH,
};

const taskQi = (
  score: number | null,
  status: FspmEqvmCoverageStatus,
): FspmTaskQi => {
  const summary = {
    measuredAt: 100,
    activityWeightPolicyId:
      "eqvm:activity-weight:equal-terminal-samples:v1" as const,
    activityWeightModel: "equal_weight" as const,
    configurationClass: "governed_configuration" as const,
    frameworkReferenceSha: "02d581886a759d19044ff91a80d743fa042f23f7",
    policyAuthorization: { ...APPROVED_POLICY },
    evidenceWindowTicks: 1_500,
    ratedActivities: score === null ? 0 : 1,
    totalActivities: score === null ? 0 : 1,
    freshActivities: score === null ? 0 : 1,
    staleActivities: status === "stale" ? 1 : 0,
    unratedActivities: 0,
    invalidActivities: status === "invalid" ? 1 : 0,
    exceptional: 0,
    satisfactory: 0,
    marginal: 0,
    unsatisfactory: 0,
    rejected: 0,
    evidence: [`coverage ${status}`],
  };
  return status === "complete" && score !== null
    ? { ...summary, score, status: "complete" }
    : {
        ...summary,
        score: null,
        status: status === "complete" ? "invalid" : status,
      };
};

const task = (
  id: string,
  deliverableId: string,
  weight: number,
  score: number | null,
  status: FspmEqvmCoverageStatus = "complete",
): ColonyTask =>
  ({
    id,
    deliverableId,
    status: "active",
    taskWeight: weight,
    qi: taskQi(score, status),
  }) as ColonyTask;

const dqi = (
  score: number | null,
  status: FspmEqvmCoverageStatus,
): FspmDeliverableQi => {
  const summary = {
    measuredAt: 100,
    activityWeightPolicyId:
      "eqvm:activity-weight:equal-terminal-samples:v1" as const,
    policyAuthorization: { ...APPROVED_POLICY },
    taskWeightBasisPoints: 10_000,
  };
  const coverage = {
    expectedWeightBasisPoints: 10_000,
    coveredWeightBasisPoints: status === "complete" ? 10_000 : 0,
    missingIds: [] as string[],
    staleIds: [] as string[],
    invalidIds: [] as string[],
    evidence: [`coverage ${status}`],
  };
  return status === "complete" && score !== null
    ? {
        ...summary,
        score,
        coverage: { ...coverage, status: "complete" },
      }
    : {
        ...summary,
        score: null,
        coverage: {
          ...coverage,
          status: status === "complete" ? "invalid" : status,
        },
      };
};

const deliverable = (
  id: string,
  weightBasisPoints: number,
  score?: number | null,
  status: FspmEqvmCoverageStatus = "complete",
): ColonyDeliverable =>
  ({
    id,
    status: "active",
    siblingWeightBasisPoints: weightBasisPoints,
    ...(score === undefined ? {} : { dqi: dqi(score, status) }),
  }) as ColonyDeliverable;

describe("authoritative EQVM hierarchy", () => {
  it("withholds DQI from approval-shaped Task QI without a governed ledger", () => {
    const deliverableId = "deliverable:W1N1:economy";
    const result = computeDeliverableQi(
      { id: deliverableId },
      [
        task("task:energy-service", deliverableId, 65, 1.5),
        task("task:controller", deliverableId, 35, 0.5),
      ],
      100,
    );

    expect(result).toMatchObject({
      score: null,
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt: expect.stringContaining("governed approval ledger"),
      },
      taskWeightBasisPoints: 10_000,
      coverage: {
        status: "unavailable",
        expectedWeightBasisPoints: 10_000,
        coveredWeightBasisPoints: 0,
        missingIds: ["task:controller", "task:energy-service"],
      },
    });
  });

  it("withholds DQI when any governed Task weight lacks verified QI", () => {
    const deliverableId = "deliverable:W1N1:economy";
    const result = computeDeliverableQi(
      { id: deliverableId },
      [
        task("task:energy-service", deliverableId, 65, 1),
        task("task:controller", deliverableId, 35, null, "unavailable"),
      ],
      100,
    );

    expect(result).toMatchObject({
      score: null,
      coverage: {
        status: "unavailable",
        coveredWeightBasisPoints: 0,
        missingIds: ["task:controller", "task:energy-service"],
      },
    });
  });

  it("withholds P3/PQI from approval-shaped DQI without a governed ledger", () => {
    const result = computeP3Pqi(
      [
        deliverable("deliverable:economy", 3_500, 1.15),
        deliverable("deliverable:spawning", 2_500, 1),
        deliverable("deliverable:construction", 2_500, 0.75),
        deliverable("deliverable:defense", 1_500, 0.5),
      ],
      100,
    );

    expect(result).toMatchObject({
      score: null,
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt: expect.stringContaining("governed approval ledger"),
      },
      deliverableWeightBasisPoints: 10_000,
      coverage: {
        status: "unavailable",
        expectedWeightBasisPoints: 10_000,
        coveredWeightBasisPoints: 0,
        missingIds: [
          "deliverable:construction",
          "deliverable:defense",
          "deliverable:economy",
          "deliverable:spawning",
        ],
      },
    });
  });

  it("never renormalizes around missing DQI evidence", () => {
    const result = computeP3Pqi(
      [
        deliverable("deliverable:economy", 3_500, 1),
        deliverable("deliverable:spawning", 2_500, 1),
        deliverable("deliverable:construction", 2_500),
        deliverable("deliverable:defense", 1_500, 1),
      ],
      100,
    );

    expect(result).toMatchObject({
      score: null,
      coverage: {
        status: "unavailable",
        coveredWeightBasisPoints: 0,
        missingIds: [
          "deliverable:construction",
          "deliverable:defense",
          "deliverable:economy",
          "deliverable:spawning",
        ],
      },
    });
  });

  it("does not mistake an untrusted zero-shaped PQI for verified zero", () => {
    const completeZero = computeP3Pqi(
      [deliverable("deliverable:only", 10_000, 0)],
      100,
    );
    const unavailable = computeP3Pqi(
      [deliverable("deliverable:only", 10_000)],
      100,
    );

    expect(completeZero).toMatchObject({
      score: null,
      coverage: { status: "unavailable", coveredWeightBasisPoints: 0 },
      policyAuthorization: { status: "unapproved" },
    });
    expect(unavailable).toMatchObject({
      score: null,
      coverage: { status: "unavailable" },
    });
  });

  it("fails closed when sibling weights do not total 10,000 basis points", () => {
    const result = computeP3Pqi(
      [
        deliverable("deliverable:a", 6_000, 1),
        deliverable("deliverable:b", 3_000, 1),
      ],
      100,
    );
    expect(result).toMatchObject({
      score: null,
      deliverableWeightBasisPoints: 9_000,
      coverage: { status: "invalid" },
    });
  });

  it.each([9_000, 11_000])(
    "marks all-unavailable Task evidence invalid when governed weights total %i basis points",
    (totalWeightBasisPoints) => {
      const deliverableId = "deliverable:W1N1:economy";
      const result = computeDeliverableQi(
        { id: deliverableId },
        [
          task("task:a", deliverableId, 60, null, "unavailable"),
          task(
            "task:b",
            deliverableId,
            totalWeightBasisPoints / 100 - 60,
            null,
            "unavailable",
          ),
        ],
        100,
      );

      expect(result).toMatchObject({
        score: null,
        taskWeightBasisPoints: totalWeightBasisPoints,
        coverage: {
          status: "invalid",
          expectedWeightBasisPoints: 10_000,
          coveredWeightBasisPoints: 0,
        },
      });
    },
  );

  it.each([9_000, 11_000])(
    "marks all-unavailable Deliverable evidence invalid when governed weights total %i basis points",
    (totalWeightBasisPoints) => {
      const result = computeP3Pqi(
        [
          deliverable("deliverable:a", 6_000),
          deliverable("deliverable:b", totalWeightBasisPoints - 6_000),
        ],
        100,
      );

      expect(result).toMatchObject({
        score: null,
        deliverableWeightBasisPoints: totalWeightBasisPoints,
        coverage: {
          status: "invalid",
          expectedWeightBasisPoints: 10_000,
          coveredWeightBasisPoints: 0,
        },
      });
    },
  );

  it("rejects an out-of-scale child quality multiplier", () => {
    const deliverableId = "deliverable:W1N1:economy";
    const result = computeDeliverableQi(
      { id: deliverableId },
      [task("task:poisoned", deliverableId, 100, 100)],
      100,
    );

    expect(result).toMatchObject({
      score: null,
      coverage: {
        status: "invalid",
        coveredWeightBasisPoints: 0,
        invalidIds: ["task:poisoned"],
      },
    });
  });

  it("withholds DQI and PQI when unapproved records claim numeric complete quality", () => {
    const deliverableId = "deliverable:W1N1:economy";
    const forgedTask = task("task:unapproved", deliverableId, 100, 1.5);
    forgedTask.qi = {
      ...forgedTask.qi,
      score: 1.5,
      status: "complete",
      configurationClass: "implementation_research_configuration",
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt: "accountable approval required",
      },
    } as unknown as FspmTaskQi;

    const withheldDqi = computeDeliverableQi(
      { id: deliverableId },
      [forgedTask],
      100,
    );
    expect(withheldDqi).toMatchObject({
      score: null,
      policyAuthorization: { status: "unapproved" },
      coverage: {
        status: "unavailable",
        coveredWeightBasisPoints: 0,
        missingIds: ["task:unapproved"],
      },
    });

    const forgedDeliverable = deliverable(deliverableId, 10_000, 1.5);
    forgedDeliverable.dqi = {
      ...forgedDeliverable.dqi,
      score: 1.5,
      coverage: {
        ...forgedDeliverable.dqi?.coverage,
        status: "complete",
      },
      policyAuthorization: {
        status: "unapproved",
        authorizationDebt: "accountable approval required",
      },
    } as unknown as FspmDeliverableQi;
    expect(computeP3Pqi([forgedDeliverable], 100)).toMatchObject({
      score: null,
      policyAuthorization: { status: "unapproved" },
      coverage: {
        status: "unavailable",
        coveredWeightBasisPoints: 0,
        missingIds: [deliverableId],
      },
    });
  });
});
