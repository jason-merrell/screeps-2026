import { describe, expect, it } from "vitest";

import {
  enforceEqvmSnapshotBoundary,
  sanitizeEqvmPolicyAuthorization,
  sanitizeTaskQi,
  sanitizeWeightedEqvmIndex,
} from "../../../scripts/lib/eqvm-snapshot.mjs";

const policyId = "eqvm:activity-weight:equal-terminal-samples:v1";
const frameworkSha = "02d581886a759d19044ff91a80d743fa042f23f7";
const policyHash =
  "634237a44656e206f1343f8d3a1dc608eb436ddb81a72ad6b52dd1ff62989e08";
const authorizationDebt = {
  status: "unapproved",
  authorizationDebt: "Accountable approval has not been recorded.",
};
const approval = {
  status: "approved",
  approvalEventId: "approval:eqvm:v1",
  approvalAuthorityOuId: "ou:empire",
  accountablePositionId: "position:portfolio-manager",
  signerPrincipalId: "principal:manager",
  approvedAtTick: 1_900,
  approvedPolicyContentHash: policyHash,
};

const unapprovedTaskQi = () => ({
  score: null,
  status: "unavailable",
  measuredAt: 2_000,
  activityWeightPolicyId: policyId,
  activityWeightModel: "equal_weight",
  configurationClass: "implementation_research_configuration",
  frameworkReferenceSha: frameworkSha,
  unavailabilityReason: "activity_weight_policy_unapproved",
  policyAuthorization: { ...authorizationDebt },
  evidenceWindowTicks: 1_500,
  ratedActivities: 1,
  totalActivities: 2,
  freshActivities: 1,
  staleActivities: 0,
  unratedActivities: 0,
  invalidActivities: 0,
  exceptional: 0,
  satisfactory: 1,
  marginal: 0,
  unsatisfactory: 0,
  rejected: 0,
  evidence: ["one terminal Activity is fresh; one is missing"],
});

const unapprovedRollup = () => ({
  score: null,
  measuredAt: 2_000,
  activityWeightPolicyId: policyId,
  taskWeightBasisPoints: 10_000,
  policyAuthorization: { ...authorizationDebt },
  coverage: {
    status: "unavailable",
    expectedWeightBasisPoints: 10_000,
    coveredWeightBasisPoints: 0,
    missingIds: ["task:one"],
    staleIds: [],
    invalidIds: [],
    evidence: ["canonical child QI unavailable"],
  },
});

const governance = (valid = true) => ({
  valid,
  executionEligible: valid,
  checks: {
    empireRoot: true,
    packageProjection: true,
    approvalLedger: true,
    ancestry: true,
    relationships: true,
    exactWeights: true,
    receiptContracts: true,
    acceptancePolicies: true,
    receiptLedgers: true,
  },
});

describe("EQVM snapshot authorization boundary", () => {
  it("retains an explicitly withheld canonical Task QI", () => {
    expect(sanitizeTaskQi(unapprovedTaskQi())).toMatchObject({
      score: null,
      status: "unavailable",
      configurationClass: "implementation_research_configuration",
      policyAuthorization: authorizationDebt,
      unavailabilityReason: "activity_weight_policy_unapproved",
    });
  });

  it("rejects every numeric or complete state under an unapproved policy", () => {
    const numeric = unapprovedTaskQi();
    numeric.score = 1;
    expect(sanitizeTaskQi(numeric)).toBeNull();

    const complete = unapprovedTaskQi();
    complete.status = "complete";
    expect(sanitizeTaskQi(complete)).toBeNull();

    const rollup = unapprovedRollup();
    rollup.score = 1;
    expect(
      sanitizeWeightedEqvmIndex(rollup, "taskWeightBasisPoints"),
    ).toBeNull();
  });

  it("rejects self-asserted approval-shaped Task QI without a ledger event", () => {
    const task = unapprovedTaskQi();
    task.score = 1;
    task.status = "complete";
    task.configurationClass = "governed_configuration";
    delete task.unavailabilityReason;
    task.policyAuthorization = { ...approval };
    expect(sanitizeEqvmPolicyAuthorization(approval)).toBeNull();
    expect(sanitizeTaskQi(task)).toBeNull();

    task.policyAuthorization.approvedAtTick = 2_001;
    expect(sanitizeTaskQi(task)).toBeNull();
    task.policyAuthorization.approvedAtTick = 1_900;
    task.policyAuthorization.approvedPolicyContentHash = "0".repeat(64);
    expect(sanitizeTaskQi(task)).toBeNull();
  });

  it("rejects self-asserted approval-shaped DQI and PQI rollups", () => {
    const rollup = unapprovedRollup();
    rollup.score = 1.125;
    rollup.policyAuthorization = { ...approval };
    rollup.coverage = {
      ...rollup.coverage,
      status: "complete",
      coveredWeightBasisPoints: 10_000,
      missingIds: [],
    };
    expect(
      sanitizeWeightedEqvmIndex(rollup, "taskWeightBasisPoints"),
    ).toBeNull();
    expect(
      sanitizeWeightedEqvmIndex(
        {
          ...rollup,
          deliverableWeightBasisPoints: 10_000,
        },
        "deliverableWeightBasisPoints",
      ),
    ).toBeNull();

    rollup.policyAuthorization.approvedAtTick = 2_001;
    expect(
      sanitizeWeightedEqvmIndex(rollup, "taskWeightBasisPoints"),
    ).toBeNull();
  });

  it("rejects lossy evidence coercion instead of dropping malformed entries", () => {
    const task = unapprovedTaskQi();
    task.evidence = ["valid", 42];
    expect(sanitizeTaskQi(task)).toBeNull();

    const rollup = unapprovedRollup();
    rollup.coverage.missingIds = ["task:one", null];
    expect(
      sanitizeWeightedEqvmIndex(rollup, "taskWeightBasisPoints"),
    ).toBeNull();
  });

  it("strips approval-shaped EQVM from the production v2 trace path", () => {
    const taskQi = unapprovedTaskQi();
    Object.assign(taskQi, {
      score: 1.5,
      status: "complete",
      configurationClass: "governed_configuration",
      policyAuthorization: { ...approval },
    });
    delete taskQi.unavailabilityReason;
    const dqi = unapprovedRollup();
    Object.assign(dqi, {
      score: 1.5,
      policyAuthorization: { ...approval },
      coverage: {
        ...dqi.coverage,
        status: "complete",
        coveredWeightBasisPoints: 10_000,
        missingIds: [],
      },
    });
    const pqi = {
      ...dqi,
      deliverableWeightBasisPoints: 10_000,
    };
    const trace = {
      fspm: {
        rootP3: { pqi: structuredClone(pqi) },
        colonies: [
          {
            governance: governance(),
            p3: { pqi: structuredClone(pqi) },
            deliverables: [{ dqi: structuredClone(dqi) }],
            tasks: [{ qi: structuredClone(taskQi) }],
          },
        ],
      },
    };

    enforceEqvmSnapshotBoundary(trace);

    expect(trace.fspm.rootP3).not.toHaveProperty("pqi");
    expect(trace.fspm.colonies[0].p3).not.toHaveProperty("pqi");
    expect(trace.fspm.colonies[0].deliverables[0]).not.toHaveProperty("dqi");
    expect(trace.fspm.colonies[0].tasks[0]).not.toHaveProperty("qi");
  });

  it("preserves withheld EQVM only under complete eligible governance", () => {
    const dqi = unapprovedRollup();
    const pqi = {
      ...unapprovedRollup(),
      deliverableWeightBasisPoints: 10_000,
    };
    const eligible = {
      governance: governance(),
      p3: { pqi: structuredClone(pqi) },
      deliverables: [{ dqi: structuredClone(dqi) }],
      tasks: [{ qi: unapprovedTaskQi() }],
    };
    const blocked = structuredClone(eligible);
    blocked.governance = governance(false);
    const trace = { tick: 2_000, fspm: { colonies: [eligible, blocked] } };

    enforceEqvmSnapshotBoundary(trace);

    expect(eligible.p3.pqi).toMatchObject({
      score: null,
      policyAuthorization: { status: "unapproved" },
    });
    expect(eligible.deliverables[0].dqi).toMatchObject({ score: null });
    expect(eligible.tasks[0].qi).toMatchObject({ score: null });
    expect(blocked.p3).not.toHaveProperty("pqi");
    expect(blocked.deliverables[0]).not.toHaveProperty("dqi");
    expect(blocked.tasks[0]).not.toHaveProperty("qi");
  });

  it("strips future-dated and policy-mismatched withheld claims", () => {
    const futureTask = unapprovedTaskQi();
    futureTask.measuredAt = 2_001;
    const wrongFrameworkTask = unapprovedTaskQi();
    wrongFrameworkTask.frameworkReferenceSha = "0".repeat(40);
    const wrongPolicyRollup = unapprovedRollup();
    wrongPolicyRollup.activityWeightPolicyId = "eqvm:attacker-policy:v1";
    const futurePqi = {
      ...unapprovedRollup(),
      measuredAt: 2_001,
      deliverableWeightBasisPoints: 10_000,
    };
    const trace = {
      tick: 2_000,
      fspm: {
        colonies: [
          {
            governance: governance(),
            p3: { pqi: futurePqi },
            deliverables: [{ dqi: wrongPolicyRollup }],
            tasks: [{ qi: futureTask }, { qi: wrongFrameworkTask }],
          },
        ],
      },
    };

    enforceEqvmSnapshotBoundary(trace);

    expect(trace.fspm.colonies[0].p3).not.toHaveProperty("pqi");
    expect(trace.fspm.colonies[0].deliverables[0]).not.toHaveProperty("dqi");
    expect(trace.fspm.colonies[0].tasks[0]).not.toHaveProperty("qi");
    expect(trace.fspm.colonies[0].tasks[1]).not.toHaveProperty("qi");
  });

  it("requires exactly the governed eligibility checks", () => {
    const colony = {
      governance: governance(),
      tasks: [{ qi: unapprovedTaskQi() }],
    };
    colony.governance.checks.attackerExtension = true;
    const trace = { tick: 2_000, fspm: { colonies: [colony] } };

    enforceEqvmSnapshotBoundary(trace);

    expect(colony.tasks[0]).not.toHaveProperty("qi");
  });
});
