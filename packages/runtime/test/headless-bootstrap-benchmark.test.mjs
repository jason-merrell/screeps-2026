import { describe, expect, it } from "vitest";

import {
  compareBootstrapTrials,
  summarizeBootstrapTrials,
} from "../../../scenario/bootstrap-benchmark-lib.mjs";
import { buildBootstrapComparisonBenchmark } from "../../../scripts/lib/bootstrap-benchmark-sample.mjs";

const trial = (overrides = {}) => ({
  name: "bootstrap",
  status: "passed",
  ticksObserved: 180,
  milestones: {
    firstWorker: 12,
    firstHarvest: 18,
    firstSpawnRefill: 28,
    rcl2: 180,
  },
  final: {
    controllerLevel: 2,
    controllerProgress: 0,
    workers: 3,
    spawnEnergy: 120,
  },
  ...overrides,
});

describe("headless bootstrap benchmark", () => {
  it("accepts repeated deterministic passing trials", () => {
    const summary = summarizeBootstrapTrials([trial(), trial()]);
    expect(summary.deterministic).toBe(true);
    expect(summary.valid).toBe(true);
  });

  it("rejects nondeterministic or incomplete milestone trials", () => {
    const nondeterministic = summarizeBootstrapTrials([
      trial(),
      trial({ milestones: { ...trial().milestones, rcl2: 181 }, ticksObserved: 181 }),
    ]);
    expect(nondeterministic.deterministic).toBe(false);
    expect(nondeterministic.valid).toBe(false);

    const incomplete = summarizeBootstrapTrials([
      trial({ milestones: { ...trial().milestones, firstSpawnRefill: null } }),
    ]);
    expect(incomplete.valid).toBe(false);
  });

  it("compares milestone ticks with lower-is-better policy", () => {
    const comparison = compareBootstrapTrials({
      baselineSha: "a".repeat(40),
      candidateSha: "b".repeat(40),
      fixtureVersion: "bootstrap-v1",
      tickBudget: 400,
      repetitions: 2,
      baselineTrials: [trial(), trial()],
      candidateTrials: [
        trial({
          ticksObserved: 175,
          milestones: { ...trial().milestones, firstSpawnRefill: 25, rcl2: 175 },
        }),
        trial({
          ticksObserved: 175,
          milestones: { ...trial().milestones, firstSpawnRefill: 25, rcl2: 175 },
        }),
      ],
    });

    expect(comparison.comparable).toBe(true);
    expect(comparison.verdict).toBe("improved");
    expect(comparison.comparisons.bootstrap.deltas).toMatchObject({
      firstWorker: 0,
      firstHarvest: 0,
      firstSpawnRefill: -3,
      rcl2: -5,
    });
  });

  it("normalizes a controlled bootstrap artifact for persistence", () => {
    const comparison = compareBootstrapTrials({
      baselineSha: "a".repeat(40),
      candidateSha: "b".repeat(40),
      fixtureVersion: "bootstrap-v1",
      tickBudget: 400,
      repetitions: 2,
      baselineTrials: [trial(), trial()],
      candidateTrials: [trial(), trial()],
    });
    const sample = buildBootstrapComparisonBenchmark({
      request: { id: "12345" },
      benchmark: {
        name: "bootstrap-suite",
        target: "headless",
        shard: "headless",
        room: "W0N0",
        fixtureVersion: "bootstrap-v1",
        tickBudget: 400,
        repetitions: 2,
        baselineSha: "a".repeat(40),
        candidateSha: "b".repeat(40),
        completedAt: "2026-08-27T00:00:00.000Z",
        comparison,
      },
    });

    expect(sample.sampleKey).toBe("headless-benchmark:12345");
    expect(sample.benchmarkName).toBe("bootstrap-suite controlled comparison");
    expect(sample.metrics.verdict).toBe("equivalent");
    expect(sample.metrics.milestonePolicy).toEqual([
      "firstWorker",
      "firstHarvest",
      "firstSpawnRefill",
      "rcl2",
    ]);
  });
});
