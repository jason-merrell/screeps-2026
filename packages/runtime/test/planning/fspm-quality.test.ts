import { describe, expect, it } from "vitest";
import type {
  FspmOperationalHealth,
  FspmOperationalHealthSample,
} from "../../src/planning/fspm";
import {
  capDefenseOperationalHealthForAuthority,
  operationalActivityRiskCap,
  operationalHealthTrendFromSamples,
  rollupOperationalHealthScore,
  scoreDefenseReadiness,
  scoreWorkforceReadiness,
} from "../../src/planning/quality";
import { defensiveRampartTargetHits } from "../../src/systems/defense/readiness";
import {
  assessMatureCapabilityReadiness,
  MATURE_CAPABILITY_GATES,
} from "../../src/systems/maturity/capability-readiness";

describe("operational health contract", () => {
  it("keeps room-state health bounded and evidence explicit", () => {
    const quality: FspmOperationalHealth = {
      score: 85,
      state: "healthy",
      trend: "stable",
      measuredAt: 123,
      evidence: ["workforce 4/4"],
    };

    expect(quality.score).toBeGreaterThanOrEqual(0);
    expect(quality.score).toBeLessThanOrEqual(100);
    expect(["healthy", "watch", "degraded"]).toContain(quality.state);
    expect(["new", "improving", "stable", "declining"]).toContain(
      quality.trend,
    );
    expect(quality.evidence).toEqual(["workforce 4/4"]);
  });

  it("rolls room-state signals without calling them FSPM quality", () => {
    expect(rollupOperationalHealthScore([100, 80, 75])).toBe(85);
    expect(rollupOperationalHealthScore([])).toBeNull();
  });

  it("derives direction only after a meaningful history window", () => {
    const sample = (
      tick: number,
      score: number,
    ): FspmOperationalHealthSample => ({
      tick,
      score,
      state: score >= 85 ? "healthy" : score >= 60 ? "watch" : "degraded",
    });

    expect(operationalHealthTrendFromSamples([sample(100, 80)])).toBe("new");
    expect(
      operationalHealthTrendFromSamples([sample(100, 80), sample(110, 95)]),
    ).toBe("new");
    expect(
      operationalHealthTrendFromSamples([sample(100, 80), sample(125, 90)]),
    ).toBe("improving");
    expect(
      operationalHealthTrendFromSamples([sample(100, 90), sample(125, 80)]),
    ).toBe("declining");
    expect(
      operationalHealthTrendFromSamples([sample(100, 90), sample(125, 86)]),
    ).toBe("stable");
  });

  it("does not call an under-built mature defense healthy during peacetime", () => {
    expect(
      scoreDefenseReadiness({
        towerCount: 1,
        expectedTowerCount: 6,
        towerReserveRatio: 1,
        perimeterBuilt: 0,
        perimeterRequired: 1,
        perimeterAtTarget: 0,
      }),
    ).toBe(26);

    expect(
      scoreDefenseReadiness({
        towerCount: 6,
        expectedTowerCount: 6,
        towerReserveRatio: 1,
        perimeterBuilt: 24,
        perimeterRequired: 24,
        perimeterAtTarget: 24,
      }),
    ).toBe(100);
    expect(capDefenseOperationalHealthForAuthority(100, 8)).toBe(84);
    expect(capDefenseOperationalHealthForAuthority(100, 2)).toBe(100);
    expect(capDefenseOperationalHealthForAuthority(100, Number.NaN)).toBe(40);
  });

  it("does not count specialized or incapable bodies as free generalist coverage", () => {
    expect(
      scoreWorkforceReadiness({
        desiredGeneralists: 3,
        generalistCarryCoverage: { available: 0, required: 3 },
        generalistMoveCoverage: { available: 0, required: 3 },
        generalistWorkCoverage: { available: 0, required: 3 },
        logisticsStatus: "required",
        producerCoverage: { available: 2, required: 2 },
        recurringReplacementEnergy: 80,
        replacementBudgetEnergy: 100,
        replacementBudgetStatus: "within-budget",
        transportCarryCoverage: { available: 0, required: 6 },
        viableGeneralists: 0,
        viablePopulation: 12,
      }),
    ).toBe(0);

    expect(
      scoreWorkforceReadiness({
        desiredGeneralists: 3,
        generalistCarryCoverage: { available: 3, required: 3 },
        generalistMoveCoverage: { available: 3, required: 3 },
        generalistWorkCoverage: { available: 3, required: 3 },
        logisticsStatus: "required",
        producerCoverage: { available: 2, required: 2 },
        recurringReplacementEnergy: 80,
        replacementBudgetEnergy: 100,
        replacementBudgetStatus: "within-budget",
        transportCarryCoverage: { available: 6, required: 6 },
        viableGeneralists: 3,
        viablePopulation: 7,
      }),
    ).toBe(100);
  });

  it("withholds healthy workforce status when projection-backed logistics cannot be verified", () => {
    expect(
      scoreWorkforceReadiness({
        desiredGeneralists: 3,
        generalistCarryCoverage: { available: 3, required: 3 },
        generalistMoveCoverage: { available: 3, required: 3 },
        generalistWorkCoverage: { available: 3, required: 3 },
        logisticsStatus: "projection-unavailable",
        producerCoverage: null,
        recurringReplacementEnergy: 80,
        replacementBudgetEnergy: 100,
        replacementBudgetStatus: "within-budget",
        transportCarryCoverage: null,
        viableGeneralists: 3,
        viablePopulation: 3,
      }),
    ).toBe(59);
  });

  it("cannot score mature bootstrap-scale actors as complete capacity", () => {
    expect(
      scoreWorkforceReadiness({
        desiredGeneralists: 7,
        generalistCarryCoverage: { available: 7, required: 42 },
        generalistMoveCoverage: { available: 7, required: 42 },
        generalistWorkCoverage: { available: 7, required: 42 },
        logisticsStatus: "required",
        producerCoverage: { available: 2, required: 2 },
        recurringReplacementEnergy: 80,
        replacementBudgetEnergy: 100,
        replacementBudgetStatus: "within-budget",
        transportCarryCoverage: { available: 32, required: 32 },
        viableGeneralists: 7,
        viablePopulation: 10,
      }),
    ).toBe(17);
  });

  it("cannot call a minimum-survival replacement exception healthy", () => {
    expect(
      scoreWorkforceReadiness({
        desiredGeneralists: 7,
        generalistCarryCoverage: { available: 7, required: 7 },
        generalistMoveCoverage: { available: 7, required: 7 },
        generalistWorkCoverage: { available: 7, required: 7 },
        logisticsStatus: "required",
        producerCoverage: { available: 2, required: 2 },
        recurringReplacementEnergy: 13_400,
        replacementBudgetEnergy: 12_000,
        replacementBudgetStatus: "minimum-survival-exception",
        transportCarryCoverage: { available: 80, required: 80 },
        viableGeneralists: 7,
        viablePopulation: 12,
      }),
    ).toBe(40);
  });

  it("flags prolonged current execution failure without fabricating a KPI", () => {
    expect(
      operationalActivityRiskCap({
        inProgressTicks: 180,
        productiveTicks: 0,
        blockedTicks: 0,
        targetRetargets: 59,
      }),
    ).toBe(40);
    expect(
      operationalActivityRiskCap({
        inProgressTicks: 10,
        productiveTicks: 4,
        blockedTicks: 1,
        targetRetargets: 0,
      }),
    ).toBe(25);
    expect(
      operationalActivityRiskCap({
        inProgressTicks: 10,
        productiveTicks: 4,
        blockedTicks: 0,
        targetRetargets: 0,
      }),
    ).toBeNull();
  });

  it("scales the defensive condition target by RCL and active threat", () => {
    expect(defensiveRampartTargetHits(3)).toBe(10_000);
    expect(defensiveRampartTargetHits(8)).toBe(5_000_000);
    expect(defensiveRampartTargetHits(8, true)).toBe(10_000_000);
  });

  it("cannot call an RCL8 footprint mature while advanced services are authorization debt", () => {
    const readiness = assessMatureCapabilityReadiness(8);

    expect(readiness).toMatchObject({
      applicable: true,
      authorizedAndImplemented: 0,
      required: 7,
      coveragePercentage: 0,
      operationalHealthCap: 59,
    });
    expect(readiness.debt.map((gate) => gate.id)).toEqual([
      "link-energy-service",
      "terminal-market-service",
      "laboratory-reaction-service",
      "factory-production-service",
      "observer-intelligence-service",
      "power-processing-service",
      "strategic-strike-service",
    ]);
    expect(MATURE_CAPABILITY_GATES.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(MATURE_CAPABILITY_GATES)).toBe(true);
  });

  it("does not apply mature-service debt before those services unlock", () => {
    expect(assessMatureCapabilityReadiness(4)).toEqual({
      applicable: false,
      authorizedAndImplemented: 0,
      required: 0,
      coveragePercentage: null,
      operationalHealthCap: null,
      debt: [],
    });
  });
});
