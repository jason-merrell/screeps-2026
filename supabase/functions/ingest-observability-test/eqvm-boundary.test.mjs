import { describe, expect, it } from "vitest";

import { sanitizeStoredObservabilitySnapshot } from "../_shared/eqvm-snapshot.mjs";

const policyId = "eqvm:activity-weight:equal-terminal-samples:v1";
const frameworkSha = "02d581886a759d19044ff91a80d743fa042f23f7";
const debt = {
  status: "unapproved",
  authorizationDebt: "Accountable approval has not been recorded.",
};

const governance = () => ({
  valid: true,
  executionEligible: true,
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

const withheldTaskQi = () => ({
  score: null,
  status: "unavailable",
  measuredAt: 2_000,
  activityWeightPolicyId: policyId,
  activityWeightModel: "equal_weight",
  configurationClass: "implementation_research_configuration",
  frameworkReferenceSha: frameworkSha,
  unavailabilityReason: "activity_weight_policy_unapproved",
  policyAuthorization: { ...debt },
  evidenceWindowTicks: 1_500,
  ratedActivities: 1,
  totalActivities: 1,
  freshActivities: 1,
  staleActivities: 0,
  unratedActivities: 0,
  invalidActivities: 0,
  exceptional: 0,
  satisfactory: 1,
  marginal: 0,
  unsatisfactory: 0,
  rejected: 0,
  evidence: ["canonical metric withheld pending accountable policy approval"],
});

const withheldRollup = (weightKey) => ({
  score: null,
  measuredAt: 2_000,
  activityWeightPolicyId: policyId,
  [weightKey]: 10_000,
  policyAuthorization: { ...debt },
  coverage: {
    status: "unavailable",
    expectedWeightBasisPoints: 10_000,
    coveredWeightBasisPoints: 0,
    missingIds: ["child:one"],
    staleIds: [],
    invalidIds: [],
    evidence: ["canonical child metric unavailable"],
  },
});

const snapshot = (colony) => ({
  schema: "screeps-observability-snapshot/v1",
  schemaVersion: 1,
  target: "ptr",
  shard: "shard3",
  room: "W1N1",
  runtimeTrace: {
    tick: 2_000,
    fspm: {
      rootP3: {
        pqi: withheldRollup("deliverableWeightBasisPoints"),
      },
      colonies: [colony],
    },
  },
});

const eqvmClaimPaths = (value, path = "$", claims = []) => {
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      eqvmClaimPaths(child, `${path}[${index}]`, claims);
    });
    return claims;
  }
  if (!value || typeof value !== "object") return claims;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === "qi" || key === "dqi" || key === "pqi") {
      claims.push(childPath);
    }
    eqvmClaimPaths(child, childPath, claims);
  }
  return claims;
};

describe("observability ingest EQVM persistence boundary", () => {
  it("persists only canonical withheld claims and never mutates the request", () => {
    const input = snapshot({
      governance: governance(),
      p3: { pqi: withheldRollup("deliverableWeightBasisPoints") },
      deliverables: [{ dqi: withheldRollup("taskWeightBasisPoints") }],
      tasks: [{ qi: withheldTaskQi() }],
    });

    const stored = sanitizeStoredObservabilitySnapshot(input);

    expect(stored).not.toBe(input);
    expect(stored.runtimeTrace.fspm.rootP3).not.toHaveProperty("pqi");
    expect(stored.runtimeTrace.fspm.colonies[0].p3.pqi).toMatchObject({
      score: null,
      policyAuthorization: { status: "unapproved" },
    });
    expect(
      stored.runtimeTrace.fspm.colonies[0].deliverables[0].dqi,
    ).toMatchObject({ score: null });
    expect(stored.runtimeTrace.fspm.colonies[0].tasks[0].qi).toMatchObject({
      score: null,
      status: "unavailable",
    });
    expect(input.runtimeTrace.fspm.rootP3).toHaveProperty("pqi");
  });

  it("strips forged approval, future, wrong-policy/hash, and numeric debt claims", () => {
    const approved = withheldTaskQi();
    Object.assign(approved, {
      score: 1.5,
      status: "complete",
      configurationClass: "governed_configuration",
      policyAuthorization: {
        status: "approved",
        approvalEventId: "approval:forged",
        approvalAuthorityOuId: "ou:empire",
        accountablePositionId: "position:forged",
        signerPrincipalId: "principal:forged",
        approvedAtTick: 1_900,
        approvedPolicyContentHash: "0".repeat(64),
      },
    });
    delete approved.unavailabilityReason;
    const future = withheldTaskQi();
    future.measuredAt = 2_001;
    const wrongPolicy = withheldTaskQi();
    wrongPolicy.activityWeightPolicyId = "eqvm:forged-policy:v1";
    const wrongHash = withheldTaskQi();
    wrongHash.frameworkReferenceSha = "f".repeat(40);
    const numericDebt = withheldTaskQi();
    numericDebt.score = 1.25;
    const forgedDqi = withheldRollup("taskWeightBasisPoints");
    forgedDqi.score = 1.5;
    forgedDqi.coverage.status = "complete";
    forgedDqi.coverage.coveredWeightBasisPoints = 10_000;
    forgedDqi.coverage.missingIds = [];
    forgedDqi.policyAuthorization = approved.policyAuthorization;
    const futurePqi = withheldRollup("deliverableWeightBasisPoints");
    futurePqi.measuredAt = 2_001;
    const input = snapshot({
      governance: governance(),
      p3: { pqi: futurePqi },
      deliverables: [{ dqi: forgedDqi }],
      tasks: [approved, future, wrongPolicy, wrongHash, numericDebt].map(
        (qi) => ({
          qi,
        }),
      ),
    });

    const stored = sanitizeStoredObservabilitySnapshot(input);
    const colony = stored.runtimeTrace.fspm.colonies[0];

    expect(colony.p3).not.toHaveProperty("pqi");
    expect(colony.deliverables[0]).not.toHaveProperty("dqi");
    for (const task of colony.tasks) expect(task).not.toHaveProperty("qi");
  });

  it("purges off-path claims while restoring only exact canonical withheld records", () => {
    const input = snapshot({
      governance: { ...governance(), pqi: { score: 1.5 } },
      requirements: [{ qi: { score: 1.5 } }],
      p3: { pqi: withheldRollup("deliverableWeightBasisPoints") },
      deliverables: [{ dqi: withheldRollup("taskWeightBasisPoints") }],
      tasks: [{ qi: withheldTaskQi(), nested: { pqi: { score: 1.5 } } }],
    });
    input.qi = { score: 1.5 };
    input.runtimeTrace.unexpected = { dqi: { score: 1.5 } };

    const stored = sanitizeStoredObservabilitySnapshot(input);

    expect(eqvmClaimPaths(stored)).toEqual([
      "$.runtimeTrace.fspm.colonies[0].p3.pqi",
      "$.runtimeTrace.fspm.colonies[0].deliverables[0].dqi",
      "$.runtimeTrace.fspm.colonies[0].tasks[0].qi",
    ]);
  });

  it("purges every claim from malformed non-array colony containers", () => {
    const input = snapshot({});
    input.runtimeTrace.fspm.colonies = {
      attacker: {
        qi: { score: 1.5 },
        nested: [{ dqi: { score: 1.5 }, pqi: { score: 1.5 } }],
      },
    };

    const stored = sanitizeStoredObservabilitySnapshot(input);

    expect(eqvmClaimPaths(stored)).toEqual([]);
  });

  it("rejects malformed outer payloads before persistence", () => {
    expect(sanitizeStoredObservabilitySnapshot(null)).toBeNull();
    expect(
      sanitizeStoredObservabilitySnapshot({
        schema: "screeps-observability-snapshot/v2",
        schemaVersion: 1,
      }),
    ).toBeNull();
  });
});
