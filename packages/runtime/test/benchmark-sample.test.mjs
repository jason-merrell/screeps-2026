import { describe, expect, it } from "vitest";
import { buildExperimentBenchmark } from "../../../scripts/lib/benchmark-sample.mjs";

const artifact = {
  request: { id: "5416836682", mode: "experiment", target: "ptr" },
  experiment: {
    name: "bootstrap-rcl3",
    room: "E52N38",
    shard: "shard3",
    sampleCount: 3,
    intervalMs: 5000,
    startedAt: "2026-08-25T20:00:00.000Z",
    completedAt: "2026-08-25T20:00:10.000Z",
    status: "progressing",
    transitions: { rcl2: { sample: 2, collectedAt: "2026-08-25T20:00:10.000Z" } },
    delta: {
      rcl: 1,
      controllerProgress: 24,
      workforce: 0,
      harvested: 32,
      constructionSpend: 0,
      controllerSpend: 20,
    },
    observability: {
      cpu: { averageTotal: 2.5, maxTotal: 4.25, bucket: 10000 },
      intents: { averageProposed: 3, averageAccepted: 3, averageRejected: 0 },
    },
    samples: [
      {
        collectedAt: "2026-08-25T20:00:00.000Z",
        state: { controller: { level: 1, progress: 23, progressTotal: 200 } },
      },
    ],
    final: {
      collectedAt: "2026-08-25T20:00:10.000Z",
      state: {
        controller: { level: 2, progress: 47, progressTotal: 45000 },
        spawn: { energy: 300, capacity: 300 },
        workforce: { target: 5, total: 5 },
        structures: { constructionSites: 6, extensionSites: 5, extensions: 0 },
      },
      evaluation: { status: "progressing" },
    },
  },
};

describe("experiment benchmark samples", () => {
  it("builds stable identity and longitudinal metrics from the actual PTR state shape", () => {
    const result = buildExperimentBenchmark(artifact, { runtimeSha: "366fa1bed2aa9ec3d57de23d06906acf4edcb725" });

    expect(result?.sampleKey).toBe("ptr-experiment:5416836682");
    expect(result?.benchmarkName).toBe("bootstrap-rcl3");
    expect(result?.room).toBe("E52N38");
    expect(result?.metrics).toMatchObject({
      durationMs: 10000,
      startRcl: 1,
      finalRcl: 2,
      finalWorkforce: 5,
      finalWorkforceTarget: 5,
      finalSpawnEnergy: 300,
      finalSpawnCapacity: 300,
      finalConstructionSites: 6,
      finalExtensionSites: 5,
      finalExtensions: 0,
      controllerProgressDelta: 24,
      harvestedDelta: 32,
      controllerSpendDelta: 20,
      cpuAverageTotal: 2.5,
      cpuMaxTotal: 4.25,
      intentsAverageRejected: 0,
      milestoneSamples: { rcl2: 2 },
    });
  });

  it("is idempotent for the same immutable request artifact", () => {
    const first = buildExperimentBenchmark(artifact, { runtimeSha: "366fa1b" });
    const second = buildExperimentBenchmark(structuredClone(artifact), { runtimeSha: "366fa1b" });

    expect(second).toEqual(first);
  });

  it("ignores non-experiment artifacts", () => {
    expect(buildExperimentBenchmark({ request: { id: "123" } })).toBeNull();
  });
});
