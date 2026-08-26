import { describe, expect, it } from "vitest";
import { compareRuntimeTrials, trialSignature } from "../../../scenario/benchmark-lib.mjs";

const trial = (name, overrides = {}) => ({
  name,
  status: "passed",
  ticksObserved: 40,
  finalState: {
    phase: "complete",
    runningTicks: 12,
    metrics: {
      requests: 20,
      cachedPathAttempts: 8,
      pathFinds: 3,
      congestionRepaths: 1,
      fatigueWaits: 0,
      stuckRequests: 0,
      headOnSwapAttempts: 1,
      headOnSwaps: 1,
    },
  },
  analysis: {
    nativeTileExchangeCount: 0,
    headOnPrimaryCreepsLeftHorizontalCorridor: false,
  },
  localServerCpu: Math.random(),
  ...overrides,
});

const compare = (baselineTrials, candidateTrials) =>
  compareRuntimeTrials({
    baselineSha: "aaaaaaa",
    candidateSha: "bbbbbbb",
    fixtureVersion: "traffic-v1",
    tickBudget: 320,
    repetitions: 2,
    scenarioNames: ["head-on"],
    baselineTrials,
    candidateTrials,
  });

describe("headless benchmark comparison", () => {
  it("ignores diagnostic local CPU when checking repeatability", () => {
    const left = trial("head-on", { localServerCpu: 1.2 });
    const right = trial("head-on", { localServerCpu: 9.9 });
    expect(trialSignature(left)).toBe(trialSignature(right));
  });

  it("calls identical repeated passing trials equivalent", () => {
    const baseline = [trial("head-on"), trial("head-on")];
    const candidate = [trial("head-on"), trial("head-on")];
    const result = compare(baseline, candidate);
    expect(result.comparable).toBe(true);
    expect(result.verdict).toBe("equivalent");
  });

  it("rejects deterministic failures instead of calling them equivalent", () => {
    const failed = trial("head-on", {
      status: "failed",
      ticksObserved: 320,
      finalState: null,
    });
    const result = compare(
      [failed, structuredClone(failed)],
      [structuredClone(failed), structuredClone(failed)],
    );
    expect(result.baseline.deterministic).toBe(true);
    expect(result.baseline.valid).toBe(false);
    expect(result.comparable).toBe(false);
    expect(result.verdict).toBe("invalid");
  });

  it("rejects non-deterministic trial sets instead of inventing a winner", () => {
    const baseline = [trial("head-on"), trial("head-on")];
    const candidate = [
      trial("head-on"),
      trial("head-on", {
        finalState: {
          phase: "complete",
          runningTicks: 13,
          metrics: trial("head-on").finalState.metrics,
        },
      }),
    ];
    const result = compare(baseline, candidate);
    expect(result.comparable).toBe(false);
    expect(result.verdict).toBe("invalid");
  });

  it("flags a guarded metric increase as a regression", () => {
    const baseline = [trial("head-on"), trial("head-on")];
    const slower = trial("head-on", {
      finalState: {
        phase: "complete",
        runningTicks: 13,
        metrics: { ...trial("head-on").finalState.metrics, pathFinds: 4 },
      },
    });
    const result = compare(baseline, [slower, structuredClone(slower)]);
    expect(result.verdict).toBe("regressed");
    expect(result.comparisons["head-on"].deltas.runningTicks).toBe(1);
    expect(result.comparisons["head-on"].deltas.pathFinds).toBe(1);
  });

  it("calls a strictly non-regressing metric decrease an improvement", () => {
    const baseline = [trial("head-on"), trial("head-on")];
    const faster = trial("head-on", {
      finalState: {
        phase: "complete",
        runningTicks: 11,
        metrics: { ...trial("head-on").finalState.metrics, pathFinds: 2 },
      },
    });
    const result = compare(baseline, [faster, structuredClone(faster)]);
    expect(result.verdict).toBe("improved");
  });
});
