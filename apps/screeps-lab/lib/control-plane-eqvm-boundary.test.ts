import { describe, expect, it } from "vitest";

import { normalizeFspmAuthority } from "./control-plane";

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
  score: null as number | null,
  status: "unavailable",
  measuredAt: 2_000,
  activityWeightPolicyId: policyId,
  activityWeightModel: "equal_weight",
  configurationClass: "implementation_research_configuration",
  frameworkReferenceSha: frameworkSha,
  unavailabilityReason: "activity_weight_policy_unapproved",
  policyAuthorization: { ...debt } as Record<string, unknown>,
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

const withheldRollup = (
  weightKey: "taskWeightBasisPoints" | "deliverableWeightBasisPoints",
) => ({
  score: null as number | null,
  measuredAt: 2_000,
  activityWeightPolicyId: policyId,
  [weightKey]: 10_000,
  policyAuthorization: { ...debt } as Record<string, unknown>,
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

const snapshot = (colony: Record<string, unknown>) => ({
  schema: "screeps-observability-snapshot/v1",
  schemaVersion: 1,
  target: "ptr",
  shard: "shard3",
  room: "W1N1",
  runtimeTrace: {
    tick: 2_000,
    fspm: { colonies: [colony] },
  },
});

const decodedColony = (value: unknown) => {
  const decoded = normalizeFspmAuthority(value);
  expect(decoded).not.toBeNull();
  const colony = decoded?.runtimeTrace?.fspm?.colonies?.[0];
  expect(colony).toBeDefined();
  if (!colony) throw new Error("test fixture did not decode an FSPM colony");
  return colony;
};

describe("control-plane stored EQVM render boundary", () => {
  it("removes every approval-shaped claim before producing UI props", () => {
    const approved = {
      status: "approved",
      approvalEventId: "approval:forged",
      approvalAuthorityOuId: "ou:empire",
      accountablePositionId: "position:forged",
      signerPrincipalId: "principal:forged",
      approvedAtTick: 1_900,
      approvedPolicyContentHash: "0".repeat(64),
    };
    const qi = withheldTaskQi();
    Object.assign(qi, {
      score: 1.5,
      status: "complete",
      configurationClass: "governed_configuration",
      policyAuthorization: approved,
    });
    delete (qi as { unavailabilityReason?: string }).unavailabilityReason;
    const dqi = withheldRollup("taskWeightBasisPoints");
    Object.assign(dqi, {
      score: 1.5,
      policyAuthorization: approved,
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
    const rowPayload = snapshot({
      governance: governance(),
      p3: {
        id: "p3:colony",
        type: "portfolio",
        subType: "ou_portfolio",
        name: "Colony",
        parentP3Id: null,
        temporalBasis: "game_tick",
        startTick: 1,
        status: "active",
        pqi,
      },
      contract: { id: "legacy", status: "active" },
      requirements: [],
      deliverables: [{ dqi }],
      tasks: [{ qi }],
    });

    const colony = decodedColony(rowPayload);

    expect(colony.p3).not.toHaveProperty("pqi");
    expect(colony.deliverables[0]).not.toHaveProperty("dqi");
    expect(colony.tasks[0]).not.toHaveProperty("qi");
    expect(qi).toHaveProperty("score", 1.5);
  });

  it("removes future, wrong-policy/hash, and numeric-under-debt states", () => {
    const future = withheldTaskQi();
    future.measuredAt = 2_001;
    const wrongPolicy = withheldTaskQi();
    wrongPolicy.activityWeightPolicyId = "eqvm:forged-policy:v1";
    const wrongHash = withheldTaskQi();
    wrongHash.frameworkReferenceSha = "f".repeat(40);
    const numericDebt = withheldTaskQi();
    numericDebt.score = 1.25;
    const numericDqi = withheldRollup("taskWeightBasisPoints");
    numericDqi.score = 1.25;
    const futurePqi = withheldRollup("deliverableWeightBasisPoints");
    futurePqi.measuredAt = 2_001;
    const colony = decodedColony(
      snapshot({
        governance: governance(),
        p3: {
          id: "p3:colony",
          type: "portfolio",
          subType: "ou_portfolio",
          name: "Colony",
          parentP3Id: null,
          temporalBasis: "game_tick",
          startTick: 1,
          status: "active",
          pqi: futurePqi,
        },
        contract: { id: "legacy", status: "active" },
        requirements: [],
        deliverables: [{ dqi: numericDqi }],
        tasks: [future, wrongPolicy, wrongHash, numericDebt].map((qi) => ({
          qi,
        })),
      }),
    );

    expect(colony.p3).not.toHaveProperty("pqi");
    expect(colony.deliverables[0]).not.toHaveProperty("dqi");
    for (const task of colony.tasks) expect(task).not.toHaveProperty("qi");
  });

  it("retains only canonical unavailable/null claims", () => {
    const colony = decodedColony(
      snapshot({
        governance: governance(),
        p3: {
          id: "p3:colony",
          type: "portfolio",
          subType: "ou_portfolio",
          name: "Colony",
          parentP3Id: null,
          temporalBasis: "game_tick",
          startTick: 1,
          status: "active",
          pqi: withheldRollup("deliverableWeightBasisPoints"),
        },
        contract: { id: "legacy", status: "active" },
        requirements: [],
        deliverables: [{ dqi: withheldRollup("taskWeightBasisPoints") }],
        tasks: [{ qi: withheldTaskQi() }],
      }),
    );

    expect(colony.p3?.pqi).toMatchObject({ score: null });
    expect(colony.deliverables[0]?.dqi).toMatchObject({ score: null });
    expect(colony.tasks[0]?.qi).toMatchObject({
      score: null,
      status: "unavailable",
      policyAuthorization: { status: "unapproved" },
    });
  });

  it("cannot crash or retain claims through a malformed colony container", () => {
    const malformed = snapshot({});
    const runtimeTrace = malformed.runtimeTrace as {
      fspm: { colonies: unknown };
    };
    runtimeTrace.fspm.colonies = {
      attacker: {
        qi: { score: 1.5 },
        nested: [{ dqi: { score: 1.5 }, pqi: { score: 1.5 } }],
      },
    };

    expect(() => normalizeFspmAuthority(malformed)).not.toThrow();
    expect(
      normalizeFspmAuthority(malformed)?.runtimeTrace?.fspm?.colonies,
    ).toEqual([]);
  });
});
