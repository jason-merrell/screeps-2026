import { describe, expect, it } from "vitest";

import {
  buildControlPlaneProvenance,
  findCorrelatedExperiment,
  mapBenchmarkSample,
  type BenchmarkRow,
  type ExperimentEvidenceRow,
} from "./data-trust";

const capturedAt = "2026-08-30T11:40:00.000Z";

const experiment = (
  overrides: Partial<ExperimentEvidenceRow> = {},
): ExperimentEvidenceRow => ({
  experiment_key: "ptr-experiment:42",
  name: "bootstrap-rcl3",
  target: "ptr",
  shard: "shard3",
  room_name: "E52N38",
  runtime_sha: "abc123",
  completed_at: capturedAt,
  status: "succeeded",
  result: {
    sampleCount: 4,
    intervalMs: 5_000,
    startedAt: "2026-08-30T11:30:00.000Z",
    completedAt: capturedAt,
    observability: {
      cpu: {
        averageTotal: 5.1,
        maxTotal: 7.2,
        bucket: 10_000,
        averagePerception: 0.1,
        averagePlanners: {
          defense: 0.05,
          spawning: 0.15,
          construction: 0.2,
          economy: 0.6,
        },
        averageArbitration: 0.2,
        averageExecution: 0.7,
        averageObservability: 0.4,
      },
    },
  },
  ...overrides,
});

const benchmarkRow = (overrides: Partial<BenchmarkRow> = {}): BenchmarkRow => ({
  id: 42,
  sample_key: "ptr-experiment:42",
  colony_id: "colony-1",
  benchmark_name: "bootstrap-rcl3",
  runtime_sha: "abc123",
  captured_at: capturedAt,
  metrics: {
    evidenceClass: "live-ptr-longitudinal",
    cpuAverageTotal: 5.2,
    cpuMaxTotal: 7.3,
    cpuBucketFinal: 10_000,
    sampleCount: 4,
    intervalMs: 5_000,
    durationMs: 600_000,
    outcomeStatus: "passed",
  },
  source: "ptr-experiment",
  source_ref: "github-comment:42",
  colony: {
    target: "ptr",
    shard: "shard3",
    room_name: "E52N38",
  },
  ...overrides,
});

describe("benchmark decoding", () => {
  it("maps current PTR aggregate metrics and phase CPU from the exact correlated experiment", () => {
    const row = benchmarkRow();
    const correlated = findCorrelatedExperiment(row, [experiment()]);
    const sample = mapBenchmarkSample(row, correlated);

    expect(correlated?.experiment_key).toBe(row.sample_key);
    expect(sample?.metrics.schema).toBe("ptr-longitudinal");
    expect(sample?.metrics.phaseSource).toBe("correlated-experiment");
    expect(sample?.metrics.phases).toEqual({
      perception: 0.1,
      planning: 1,
      arbitration: 0.2,
      execution: 0.7,
      observability: 0.4,
    });
    expect(sample?.metrics.averageTotal).toBe(5.2);
    expect(sample?.metrics.missingFields).toEqual([]);
  });

  it("does not retain baseline phase values when a current sample has no correlated phase evidence", () => {
    const sample = mapBenchmarkSample(benchmarkRow(), null);

    expect(sample?.metrics.phases).toEqual({});
    expect(sample?.metrics.averageTotal).toBe(5.2);
    expect(sample?.metrics.missingFields).toEqual([
      "benchmark.cpu.perception",
      "benchmark.cpu.planning",
      "benchmark.cpu.arbitration",
      "benchmark.cpu.execution",
      "benchmark.cpu.observability",
    ]);
  });

  it("does not merge phase evidence when the runtime correlation conflicts", () => {
    const sample = mapBenchmarkSample(
      benchmarkRow(),
      experiment({ runtime_sha: "different-runtime" }),
    );

    expect(sample?.correlatedExperimentKey).toBeNull();
    expect(sample?.metrics.phaseSource).toBeNull();
    expect(sample?.metrics.phases).toEqual({});
  });

  it("does not consume phase evidence when the room scope conflicts", () => {
    const sample = mapBenchmarkSample(
      benchmarkRow(),
      experiment({ room_name: "E51N38" }),
    );

    expect(sample?.correlatedExperimentKey).toBeNull();
    expect(sample?.metrics.phaseSource).toBeNull();
    expect(sample?.metrics.phases).toEqual({});
  });

  it("does not consume phase evidence when either runtime identity is missing", () => {
    const sample = mapBenchmarkSample(
      benchmarkRow({ runtime_sha: null }),
      experiment(),
    );

    expect(sample?.correlatedExperimentKey).toBeNull();
    expect(sample?.metrics.phaseSource).toBeNull();
    expect(sample?.metrics.phases).toEqual({});
  });

  it("keeps a partial correlated experiment exclusive instead of filling it from another schema", () => {
    const sample = mapBenchmarkSample(
      benchmarkRow({
        metrics: {
          evidenceClass: "live-ptr-longitudinal",
          cpuAveragePerception: 99,
          planning: 88,
          arbitration: 77,
          execution: 66,
          observability: 55,
          cpuAverageTotal: 5.2,
          cpuMaxTotal: 7.3,
          cpuBucketFinal: 10_000,
          sampleCount: 4,
          intervalMs: 5_000,
          durationMs: 600_000,
          outcomeStatus: "passed",
        },
      }),
      experiment({
        result: {
          observability: { cpu: { averagePerception: 0.125 } },
        },
      }),
    );

    expect(sample?.metrics.phaseSource).toBe("correlated-experiment");
    expect(sample?.metrics.phases).toEqual({ perception: 0.125 });
    expect(sample?.metrics.missingFields).toEqual([
      "benchmark.cpu.planning",
      "benchmark.cpu.arbitration",
      "benchmark.cpu.execution",
      "benchmark.cpu.observability",
    ]);
  });

  it("uses only the current PTR metric schema when no correlated phase series exists", () => {
    const sample = mapBenchmarkSample(
      benchmarkRow({
        metrics: {
          evidenceClass: "live-ptr-longitudinal",
          cpuAveragePerception: 0.25,
          planning: 88,
          arbitration: 77,
          execution: 66,
          observability: 55,
          cpuAverageTotal: 5.2,
          cpuMaxTotal: 7.3,
          cpuBucketFinal: 10_000,
          sampleCount: 4,
          intervalMs: 5_000,
          durationMs: 600_000,
          outcomeStatus: "passed",
        },
      }),
      null,
    );

    expect(sample?.metrics.phaseSource).toBe("benchmark-metrics");
    expect(sample?.metrics.phases).toEqual({ perception: 0.25 });
    expect(sample?.metrics.missingFields).toEqual([
      "benchmark.cpu.planning",
      "benchmark.cpu.arbitration",
      "benchmark.cpu.execution",
      "benchmark.cpu.observability",
    ]);
  });

  it("maps the legacy economy phase to planning without mixing schemas", () => {
    const sample = mapBenchmarkSample(
      benchmarkRow({
        sample_key: "legacy-1",
        source: "migration",
        metrics: {
          perception: 0.036,
          economy: 0.165,
          arbitration: 0.018,
          execution: 0.76,
          observability: 0.033,
          total: 1.012,
        },
      }),
      null,
    );

    expect(sample?.metrics.schema).toBe("legacy-phase");
    expect(sample?.metrics.phases.planning).toBe(0.165);
    expect(sample?.metrics.averageTotal).toBe(1.012);
  });

  it("represents headless comparisons without inventing phase CPU", () => {
    const sample = mapBenchmarkSample(
      benchmarkRow({
        sample_key: "headless-benchmark:9",
        source: "headless-comparison",
        metrics: {
          evidenceClass: "controlled-headless-comparison",
          comparable: true,
          verdict: "passed",
          repetitions: 5,
          tickBudget: 250,
          comparisons: { headOn: {}, crossing: {} },
        },
      }),
      null,
    );

    expect(sample?.metrics.schema).toBe("headless-comparison");
    expect(sample?.metrics.phases).toEqual({});
    expect(sample?.metrics.comparison).toEqual({
      comparable: true,
      verdict: "passed",
      repetitions: 5,
      tickBudget: 250,
      comparisonCount: 2,
    });
  });
});

describe("control-plane provenance", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const sourceExperiment = experiment();
  const sourceBenchmark = mapBenchmarkSample(benchmarkRow(), sourceExperiment);
  const sourceSnapshot = {
    capturedAt: "2026-08-30T11:50:00.000Z",
    sourceRequestId: "42",
    colonyId: "colony-1",
    target: "ptr",
    shard: "shard3",
    room: "E52N38",
    runtimeTick: 82_000_000,
    runtimeSha: "abc123",
    hasFspm: true,
  };

  it("reports fresh only when every stream is complete, recent, and correlated", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: sourceSnapshot,
      experiments: [sourceExperiment],
      benchmark: sourceBenchmark,
      correlatedExperiment: sourceExperiment,
    });

    expect(provenance.state).toBe("fresh");
    expect(provenance.streams.snapshot.state).toBe("fresh");
    expect(provenance.correlation.state).toBe("matched");
    expect(provenance.missingFields).toEqual([]);
  });

  it("reports stale when an otherwise complete stream exceeds its freshness window", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: { ...sourceSnapshot, capturedAt: "2026-08-30T11:20:00.000Z" },
      experiments: [sourceExperiment],
      benchmark: sourceBenchmark,
      correlatedExperiment: sourceExperiment,
    });

    expect(provenance.state).toBe("stale");
    expect(provenance.streams.snapshot.state).toBe("stale");
  });

  it("fails closed when all rows are fresh but their runtime identity differs", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: { ...sourceSnapshot, runtimeSha: "different-runtime" },
      experiments: [sourceExperiment],
      benchmark: sourceBenchmark,
      correlatedExperiment: sourceExperiment,
    });

    expect(provenance.state).toBe("partial");
    expect(provenance.correlation.issues).toContain(
      "Snapshot, benchmark, and experiment runtime SHAs do not match exactly.",
    );
  });

  it("fails closed on room-scope drift", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: { ...sourceSnapshot, room: "E51N38" },
      experiments: [sourceExperiment],
      benchmark: sourceBenchmark,
      correlatedExperiment: sourceExperiment,
    });

    expect(provenance.state).toBe("partial");
    expect(provenance.correlation.issues).toContain(
      "Snapshot, benchmark, and experiment scopes do not match exactly.",
    );
  });

  it("fails closed when timestamps exceed the declared correlation window", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: {
        ...sourceSnapshot,
        capturedAt: "2026-08-30T12:11:00.000Z",
      },
      experiments: [sourceExperiment],
      benchmark: sourceBenchmark,
      correlatedExperiment: sourceExperiment,
    });

    expect(provenance.state).toBe("partial");
    expect(provenance.correlation.issues).toContain(
      "Cross-stream capture skew exceeds the 30-minute correlation window.",
    );
  });

  it("requires one exact request lineage instead of inferring it from scope", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: { ...sourceSnapshot, sourceRequestId: "43" },
      experiments: [sourceExperiment],
      benchmark: sourceBenchmark,
      correlatedExperiment: sourceExperiment,
    });

    expect(provenance.state).toBe("partial");
    expect(provenance.correlation.issues).toContain(
      "Snapshot, benchmark, and experiment lack one exact request lineage.",
    );
  });

  it("reports partial when correlation identifiers do not resolve", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: sourceSnapshot,
      experiments: [sourceExperiment],
      benchmark: sourceBenchmark,
      correlatedExperiment: null,
    });

    expect(provenance.state).toBe("partial");
    expect(provenance.correlation.state).toBe("partial");
    expect(provenance.correlation.issues).toContain(
      "No succeeded experiment matches benchmark.sample_key.",
    );
  });

  it("distinguishes empty fallback from total query failure", () => {
    const fallback = buildControlPlaneProvenance({
      now,
      snapshot: null,
      experiments: [],
      benchmark: null,
      correlatedExperiment: null,
    });
    const error = buildControlPlaneProvenance({
      now,
      snapshot: null,
      experiments: [],
      benchmark: null,
      correlatedExperiment: null,
      errors: { snapshot: "500", experiments: "500", benchmark: "500" },
    });

    expect(fallback.state).toBe("fallback");
    expect(error.state).toBe("error");
  });

  it("keeps usable streams visible while reporting a single-stream query error as partial", () => {
    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: sourceSnapshot,
      experiments: [sourceExperiment],
      benchmark: null,
      correlatedExperiment: null,
      errors: { benchmark: "PGRST500" },
    });

    expect(provenance.state).toBe("partial");
    expect(provenance.streams.snapshot.state).toBe("fresh");
    expect(provenance.streams.benchmark.state).toBe("error");
    expect(provenance.streams.benchmark.errorCode).toBe("PGRST500");
  });

  it("cannot use a fresh unrelated experiment to green an old correlated lineage", () => {
    const oldCorrelated = experiment({
      completed_at: "2026-05-01T00:00:00.000Z",
      result: {
        sampleCount: 4,
        intervalMs: 5_000,
        startedAt: "2026-05-01T00:00:00.000Z",
        completedAt: "2026-05-01T00:10:00.000Z",
        observability: { cpu: { averagePerception: 0.1 } },
      },
    });
    const unrelatedFresh = experiment({
      experiment_key: "ptr-experiment:new",
      completed_at: "2026-08-30T11:55:00.000Z",
    });
    const oldSample = mapBenchmarkSample(benchmarkRow(), oldCorrelated);

    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: sourceSnapshot,
      experiments: [unrelatedFresh, oldCorrelated],
      benchmark: oldSample,
      correlatedExperiment: oldCorrelated,
    });

    // The exact lineage is both stale and phase-incomplete, so the aggregate
    // fails closed to partial rather than allowing the unrelated fresh row to
    // produce a green state.
    expect(provenance.state).toBe("partial");
    expect(provenance.streams.experiments).toMatchObject({
      identifier: "ptr-experiment:42",
      state: "stale",
    });
  });

  it("reports the exact correlated experiment as partial when required evidence is missing", () => {
    const incomplete = experiment({
      runtime_sha: null,
      room_name: null,
      result: undefined,
    });
    const sample = mapBenchmarkSample(benchmarkRow(), incomplete);

    const provenance = buildControlPlaneProvenance({
      now,
      snapshot: sourceSnapshot,
      experiments: [experiment({ experiment_key: "ptr-experiment:new" })],
      benchmark: sample,
      correlatedExperiment: incomplete,
    });

    expect(provenance.state).toBe("partial");
    expect(provenance.streams.experiments.state).toBe("partial");
    expect(provenance.missingFields).toEqual(
      expect.arrayContaining([
        "experiment.runtime_sha",
        "experiment.room_name",
        "experiment.result",
      ]),
    );
  });
});
