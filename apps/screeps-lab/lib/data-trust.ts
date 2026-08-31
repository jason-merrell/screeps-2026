const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const SNAPSHOT_FRESHNESS_MS = 30 * MINUTE;
export const EXPERIMENT_FRESHNESS_MS = 72 * HOUR;
export const BENCHMARK_FRESHNESS_MS = 72 * HOUR;
export const CORRELATION_MAX_SKEW_MS = 30 * MINUTE;

export const benchmarkPhases = [
  "perception",
  "planning",
  "arbitration",
  "execution",
  "observability",
] as const;

export type BenchmarkPhase = (typeof benchmarkPhases)[number];
export type BenchmarkSchema =
  | "ptr-longitudinal"
  | "headless-comparison"
  | "legacy-phase"
  | "unknown";

export type BenchmarkComparison = {
  comparable: boolean | null;
  verdict: string | null;
  repetitions: number | null;
  tickBudget: number | null;
  comparisonCount: number;
};

export type BenchmarkMetrics = {
  schema: BenchmarkSchema;
  phases: Partial<Record<BenchmarkPhase, number>>;
  phaseSource: "benchmark-metrics" | "correlated-experiment" | null;
  averageTotal: number | null;
  maxTotal: number | null;
  bucket: number | null;
  sampleCount: number | null;
  intervalMs: number | null;
  durationMs: number | null;
  evidenceClass: string | null;
  outcomeStatus: string | null;
  comparison: BenchmarkComparison | null;
  missingFields: string[];
};

export type BenchmarkRow = {
  id?: number | null;
  sample_key: string | null;
  colony_id?: string | null;
  benchmark_name: string | null;
  runtime_sha: string | null;
  captured_at: string | null;
  metrics: unknown;
  source: string | null;
  source_ref: string | null;
  inserted_at?: string | null;
  colony?: {
    target: string | null;
    shard: string | null;
    room_name: string | null;
  } | null;
};

export type ExperimentEvidenceRow = {
  experiment_key: string;
  name: string;
  target: string | null;
  shard: string | null;
  room_name: string | null;
  runtime_sha: string | null;
  completed_at: string | null;
  status: string;
  result?: unknown;
};

export type BenchmarkSample = {
  id: number | null;
  sampleKey: string | null;
  colonyId: string | null;
  benchmarkName: string;
  runtimeSha: string | null;
  capturedAt: string | null;
  source: string | null;
  sourceRef: string | null;
  target: string | null;
  shard: string | null;
  room: string | null;
  metrics: BenchmarkMetrics;
  correlatedExperimentKey: string | null;
};

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const finiteInteger = (value: unknown): number | null => {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
};

function sumNumericValues(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return null;
  const values = Object.values(record)
    .map(finiteNumber)
    .filter((entry): entry is number => entry !== null);
  return values.length ? values.reduce((sum, entry) => sum + entry, 0) : null;
}

function cpuRecordFromExperiment(
  experiment: ExperimentEvidenceRow | null,
): JsonRecord | null {
  const result = asRecord(experiment?.result);
  const observability = asRecord(result?.observability);
  return asRecord(observability?.cpu);
}

function phasesFromCpuRecord(
  cpu: JsonRecord | null,
): Partial<Record<BenchmarkPhase, number>> {
  if (!cpu) return {};
  const planning = firstNumber(
    cpu.averagePlanning,
    cpu.averageEconomy,
    sumNumericValues(cpu.averagePlanners),
  );
  return compactPhases({
    perception: finiteNumber(cpu.averagePerception),
    planning,
    arbitration: finiteNumber(cpu.averageArbitration),
    execution: finiteNumber(cpu.averageExecution),
    observability: finiteNumber(cpu.averageObservability),
  });
}

function compactPhases(
  values: Record<BenchmarkPhase, number | null>,
): Partial<Record<BenchmarkPhase, number>> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [BenchmarkPhase, number] => entry[1] !== null,
    ),
  );
}

function currentMetricPhases(
  metrics: JsonRecord,
): Partial<Record<BenchmarkPhase, number>> {
  return compactPhases({
    perception: finiteNumber(metrics.cpuAveragePerception),
    planning: firstNumber(
      metrics.cpuAveragePlanning,
      metrics.cpuAverageEconomy,
      sumNumericValues(metrics.cpuAveragePlanners),
    ),
    arbitration: finiteNumber(metrics.cpuAverageArbitration),
    execution: finiteNumber(metrics.cpuAverageExecution),
    observability: finiteNumber(metrics.cpuAverageObservability),
  });
}

function legacyMetricPhases(
  metrics: JsonRecord,
): Partial<Record<BenchmarkPhase, number>> {
  return compactPhases({
    perception: finiteNumber(metrics.perception),
    planning: firstNumber(metrics.planning, metrics.economy),
    arbitration: finiteNumber(metrics.arbitration),
    execution: finiteNumber(metrics.execution),
    observability: finiteNumber(metrics.observability),
  });
}

export function findCorrelatedExperiment(
  benchmark: BenchmarkRow | null,
  experiments: ExperimentEvidenceRow[],
): ExperimentEvidenceRow | null {
  if (!benchmark?.sample_key) return null;
  return (
    experiments.find(
      (experiment) => experiment.experiment_key === benchmark.sample_key,
    ) ?? null
  );
}

export function mapBenchmarkSample(
  row: BenchmarkRow | null,
  correlatedExperiment: ExperimentEvidenceRow | null,
): BenchmarkSample | null {
  if (!row) return null;

  const metrics = asRecord(row.metrics) ?? {};
  const evidenceClass = nonEmptyString(metrics.evidenceClass);
  const hasComparison = asRecord(metrics.comparisons) !== null;
  const hasLegacyPhases = Object.keys(legacyMetricPhases(metrics)).length > 0;
  const schema: BenchmarkSchema =
    evidenceClass === "controlled-headless-comparison" || hasComparison
      ? "headless-comparison"
      : evidenceClass === "live-ptr-longitudinal" ||
          row.source === "ptr-experiment"
        ? "ptr-longitudinal"
        : hasLegacyPhases
          ? "legacy-phase"
          : "unknown";

  const experimentIdentityMatches = Boolean(
    correlatedExperiment &&
      correlatedExperiment.experiment_key === row.sample_key &&
      row.runtime_sha &&
      correlatedExperiment.runtime_sha &&
      row.runtime_sha === correlatedExperiment.runtime_sha &&
      row.colony?.target &&
      correlatedExperiment.target === row.colony.target &&
      row.colony.shard &&
      correlatedExperiment.shard === row.colony.shard &&
      row.colony.room_name &&
      correlatedExperiment.room_name === row.colony.room_name,
  );
  const experimentCpu = cpuRecordFromExperiment(
    experimentIdentityMatches ? correlatedExperiment : null,
  );
  const experimentPhases = phasesFromCpuRecord(experimentCpu);
  const currentPhases = currentMetricPhases(metrics);
  const legacyPhases = legacyMetricPhases(metrics);
  const hasExperimentPhases = Object.keys(experimentPhases).length > 0;
  const persistedPhases =
    schema === "ptr-longitudinal"
      ? currentPhases
      : schema === "legacy-phase"
        ? legacyPhases
        : {};
  const phases =
    schema === "headless-comparison"
      ? {}
      : hasExperimentPhases
        ? experimentPhases
        : persistedPhases;
  const phaseSource = hasExperimentPhases
    ? "correlated-experiment"
    : Object.keys(persistedPhases).length > 0
      ? "benchmark-metrics"
      : null;
  const averageTotal = firstNumber(
    metrics.cpuAverageTotal,
    asRecord(metrics.cpu)?.averageTotal,
    experimentCpu?.averageTotal,
    metrics.total,
  );
  const maxTotal = firstNumber(
    metrics.cpuMaxTotal,
    asRecord(metrics.cpu)?.maxTotal,
    experimentCpu?.maxTotal,
  );
  const bucket = firstNumber(
    metrics.cpuBucketFinal,
    asRecord(metrics.cpu)?.bucket,
    experimentCpu?.bucket,
  );
  const sampleCount = finiteInteger(metrics.sampleCount);
  const intervalMs = finiteInteger(metrics.intervalMs);
  const durationMs = finiteInteger(metrics.durationMs);
  const outcomeStatus = nonEmptyString(metrics.outcomeStatus);

  const missingFields: string[] = [];
  if (!asRecord(row.metrics)) missingFields.push("benchmark.metrics");
  if (schema === "ptr-longitudinal" || schema === "legacy-phase") {
    for (const phase of benchmarkPhases) {
      if (phases[phase] === undefined)
        missingFields.push(`benchmark.cpu.${phase}`);
    }
    if (schema === "ptr-longitudinal") {
      if (averageTotal === null)
        missingFields.push("benchmark.metrics.cpuAverageTotal");
      if (maxTotal === null)
        missingFields.push("benchmark.metrics.cpuMaxTotal");
      if (bucket === null)
        missingFields.push("benchmark.metrics.cpuBucketFinal");
      if (sampleCount === null)
        missingFields.push("benchmark.metrics.sampleCount");
      if (intervalMs === null)
        missingFields.push("benchmark.metrics.intervalMs");
      if (durationMs === null)
        missingFields.push("benchmark.metrics.durationMs");
      if (!evidenceClass) missingFields.push("benchmark.metrics.evidenceClass");
      if (!outcomeStatus) missingFields.push("benchmark.metrics.outcomeStatus");
    }
  } else if (schema === "unknown") {
    missingFields.push("benchmark.metrics.recognizedSchema");
  }

  const comparisons = asRecord(metrics.comparisons);
  const comparison =
    schema === "headless-comparison"
      ? {
          comparable:
            typeof metrics.comparable === "boolean" ? metrics.comparable : null,
          verdict: nonEmptyString(metrics.verdict),
          repetitions: finiteInteger(metrics.repetitions),
          tickBudget: finiteInteger(metrics.tickBudget),
          comparisonCount: comparisons ? Object.keys(comparisons).length : 0,
        }
      : null;
  if (comparison) {
    if (comparison.comparable === null)
      missingFields.push("benchmark.metrics.comparable");
    if (!comparison.verdict) missingFields.push("benchmark.metrics.verdict");
    if (!comparisons) missingFields.push("benchmark.metrics.comparisons");
    if (comparison.repetitions === null)
      missingFields.push("benchmark.metrics.repetitions");
    if (comparison.tickBudget === null)
      missingFields.push("benchmark.metrics.tickBudget");
    if (!evidenceClass) missingFields.push("benchmark.metrics.evidenceClass");
  }

  return {
    id: row.id ?? null,
    sampleKey: row.sample_key,
    colonyId: row.colony_id ?? null,
    benchmarkName: row.benchmark_name ?? "Unnamed benchmark",
    runtimeSha: row.runtime_sha,
    capturedAt: row.captured_at,
    source: row.source,
    sourceRef: row.source_ref,
    target: row.colony?.target ?? null,
    shard: row.colony?.shard ?? null,
    room: row.colony?.room_name ?? null,
    correlatedExperimentKey: experimentIdentityMatches
      ? (correlatedExperiment?.experiment_key ?? null)
      : null,
    metrics: {
      schema,
      phases,
      phaseSource,
      averageTotal,
      maxTotal,
      bucket,
      sampleCount,
      intervalMs,
      durationMs,
      evidenceClass,
      outcomeStatus,
      comparison,
      missingFields,
    },
  };
}

export type ProvenanceState =
  | "fresh"
  | "stale"
  | "partial"
  | "fallback"
  | "error";
export type StreamName = "snapshot" | "experiments" | "benchmark";

export type StreamProvenance = {
  name: StreamName;
  label: string;
  state: ProvenanceState;
  hasData: boolean;
  observedAt: string | null;
  ageMs: number | null;
  freshForMs: number;
  identifier: string | null;
  source: string | null;
  sourceRef: string | null;
  target: string | null;
  shard: string | null;
  room: string | null;
  runtimeSha: string | null;
  sampleWindow: string | null;
  missingFields: string[];
  errorCode: string | null;
};

export type SnapshotEvidence = {
  capturedAt: string | null;
  sourceRequestId: string | null;
  colonyId: string | null;
  target: string | null;
  shard: string | null;
  room: string | null;
  runtimeTick: number | null;
  runtimeSha: string | null;
  hasFspm: boolean;
};

export type CorrelationProvenance = {
  state: "matched" | "partial" | "unavailable";
  identifier: string | null;
  identifiers: string[];
  issues: string[];
};

export type ControlPlaneProvenance = {
  state: ProvenanceState;
  label: string;
  summary: string;
  evaluatedAt: string;
  streams: Record<StreamName, StreamProvenance>;
  correlation: CorrelationProvenance;
  missingFields: string[];
};

type ProvenanceInput = {
  now?: Date;
  snapshot: SnapshotEvidence | null;
  experiments: ExperimentEvidenceRow[];
  benchmark: BenchmarkSample | null;
  correlatedExperiment: ExperimentEvidenceRow | null;
  errors?: Partial<Record<StreamName, string | null>>;
};

function ageOf(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, nowMs - timestamp);
}

function streamProvenance(input: {
  name: StreamName;
  label: string;
  hasData: boolean;
  observedAt: string | null;
  freshForMs: number;
  identifier: string | null;
  source: string | null;
  sourceRef: string | null;
  target: string | null;
  shard: string | null;
  room: string | null;
  runtimeSha: string | null;
  sampleWindow: string | null;
  missingFields: string[];
  errorCode?: string | null;
  nowMs: number;
}): StreamProvenance {
  const ageMs = ageOf(input.observedAt, input.nowMs);
  const errorCode = input.errorCode ?? null;
  const state: ProvenanceState = errorCode
    ? "error"
    : !input.hasData
      ? "fallback"
      : input.missingFields.length > 0 || ageMs === null
        ? "partial"
        : ageMs > input.freshForMs
          ? "stale"
          : "fresh";
  return {
    name: input.name,
    label: input.label,
    state,
    hasData: input.hasData,
    observedAt: input.observedAt,
    ageMs,
    freshForMs: input.freshForMs,
    identifier: input.identifier,
    source: input.source,
    sourceRef: input.sourceRef,
    target: input.target,
    shard: input.shard,
    room: input.room,
    runtimeSha: input.runtimeSha,
    sampleWindow: input.sampleWindow,
    missingFields: input.missingFields,
    errorCode,
  };
}

function snapshotMissingFields(snapshot: SnapshotEvidence | null): string[] {
  if (!snapshot) return [];
  const missing: string[] = [];
  if (!snapshot.capturedAt) missing.push("snapshot.captured_at");
  if (!snapshot.sourceRequestId) missing.push("snapshot.source_request_id");
  if (!snapshot.colonyId) missing.push("snapshot.colony_id");
  if (!snapshot.target) missing.push("snapshot.payload.target");
  if (!snapshot.shard) missing.push("snapshot.payload.shard");
  if (!snapshot.room) missing.push("snapshot.payload.room");
  if (snapshot.runtimeTick === null)
    missing.push("snapshot.payload.runtimeTrace.tick");
  if (!snapshot.runtimeSha)
    missing.push("snapshot.payload.runtimeTrace.runtimeSha");
  if (!snapshot.hasFspm) missing.push("snapshot.payload.runtimeTrace.fspm");
  return missing;
}

function experimentMissingFields(
  experiment: ExperimentEvidenceRow | null,
): string[] {
  if (!experiment) return [];
  const missing: string[] = [];
  if (!experiment.experiment_key) missing.push("experiment.experiment_key");
  if (!experiment.completed_at) missing.push("experiment.completed_at");
  if (!experiment.runtime_sha) missing.push("experiment.runtime_sha");
  if (!experiment.target) missing.push("experiment.target");
  if (!experiment.shard) missing.push("experiment.shard");
  if (!experiment.room_name) missing.push("experiment.room_name");
  if (!asRecord(experiment.result)) missing.push("experiment.result");
  else if (!experimentSampleWindow(experiment))
    missing.push("experiment.result.sampleWindow");
  return missing;
}

function benchmarkMissingFields(benchmark: BenchmarkSample | null): string[] {
  if (!benchmark) return [];
  const missing = [...benchmark.metrics.missingFields];
  if (!benchmark.sampleKey) missing.push("benchmark.sample_key");
  if (!benchmark.capturedAt) missing.push("benchmark.captured_at");
  if (!benchmark.runtimeSha) missing.push("benchmark.runtime_sha");
  if (!benchmark.source) missing.push("benchmark.source");
  if (!benchmark.sourceRef) missing.push("benchmark.source_ref");
  if (!benchmark.colonyId) missing.push("benchmark.colony_id");
  if (!benchmark.target) missing.push("benchmark.colony.target");
  if (!benchmark.shard) missing.push("benchmark.colony.shard");
  if (!benchmark.room) missing.push("benchmark.colony.room_name");
  return missing;
}

function formatWindowDuration(durationMs: number): string {
  if (durationMs < MINUTE) return `${Math.round(durationMs / 1000)}s`;
  return `${Math.round(durationMs / MINUTE)}m`;
}

function experimentSampleWindow(
  experiment: ExperimentEvidenceRow | null,
): string | null {
  const result = asRecord(experiment?.result);
  if (!result) return null;
  const sampleCount = finiteInteger(result.sampleCount);
  const intervalMs = finiteInteger(result.intervalMs);
  const startedAt = nonEmptyString(result.startedAt);
  const completedAt = nonEmptyString(result.completedAt);
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const completedMs = completedAt ? Date.parse(completedAt) : Number.NaN;
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(completedMs)
      ? Math.max(0, completedMs - startedMs)
      : null;
  if (sampleCount !== null) {
    const parts = [`${sampleCount} sample${sampleCount === 1 ? "" : "s"}`];
    if (intervalMs !== null)
      parts.push(`${formatWindowDuration(intervalMs)} cadence`);
    if (durationMs !== null)
      parts.push(`${formatWindowDuration(durationMs)} span`);
    return parts.join(" · ");
  }
  const repetitions = finiteInteger(result.repetitions);
  const tickBudget = finiteInteger(result.tickBudget);
  if (repetitions !== null && tickBudget !== null)
    return `${repetitions} repetitions × ${tickBudget} ticks`;
  return null;
}

function benchmarkSampleWindow(benchmark: BenchmarkSample | null): string | null {
  if (!benchmark) return null;
  const comparison = benchmark.metrics.comparison;
  if (
    comparison &&
    comparison.repetitions !== null &&
    comparison.tickBudget !== null
  ) {
    return `${comparison.repetitions} repetitions × ${comparison.tickBudget} ticks`;
  }
  if (benchmark.metrics.sampleCount === null) return null;
  const parts = [
    `${benchmark.metrics.sampleCount} sample${benchmark.metrics.sampleCount === 1 ? "" : "s"}`,
  ];
  if (benchmark.metrics.intervalMs !== null)
    parts.push(`${formatWindowDuration(benchmark.metrics.intervalMs)} cadence`);
  if (benchmark.metrics.durationMs !== null)
    parts.push(`${formatWindowDuration(benchmark.metrics.durationMs)} span`);
  return parts.join(" · ");
}

function requestCorrelationId(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(?:github-comment:|ptr-experiment:)?(\d+)$/);
  return match?.[1] ?? null;
}

function parsedTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildCorrelation(input: ProvenanceInput): CorrelationProvenance {
  const { snapshot, benchmark, correlatedExperiment } = input;
  const identifiers = [
    snapshot?.sourceRequestId ? `snapshot:${snapshot.sourceRequestId}` : null,
    benchmark?.sampleKey ? `benchmark:${benchmark.sampleKey}` : null,
    benchmark?.sourceRef ? `source:${benchmark.sourceRef}` : null,
    correlatedExperiment?.experiment_key
      ? `experiment:${correlatedExperiment.experiment_key}`
      : null,
    benchmark?.runtimeSha ? `runtime:${benchmark.runtimeSha}` : null,
    snapshot?.runtimeSha ? `snapshot-runtime:${snapshot.runtimeSha}` : null,
    benchmark?.colonyId ? `colony:${benchmark.colonyId}` : null,
  ].filter((identifier): identifier is string => identifier !== null);

  if (!snapshot || !benchmark) {
    return {
      state: "unavailable",
      identifier: benchmark?.sampleKey ?? null,
      identifiers,
      issues: [],
    };
  }

  const issues: string[] = [];
  if (!correlatedExperiment) {
    issues.push("No succeeded experiment matches benchmark.sample_key.");
  } else {
    if (
      benchmark.runtimeSha &&
      correlatedExperiment.runtime_sha &&
      benchmark.runtimeSha !== correlatedExperiment.runtime_sha
    ) {
      issues.push("Benchmark and experiment runtime SHAs differ.");
    }
    if (
      snapshot.target &&
      correlatedExperiment.target &&
      snapshot.target !== correlatedExperiment.target
    ) {
      issues.push("Snapshot and experiment targets differ.");
    }
    if (
      snapshot.shard &&
      correlatedExperiment.shard &&
      snapshot.shard !== correlatedExperiment.shard
    ) {
      issues.push("Snapshot and experiment shards differ.");
    }
    if (
      snapshot.room &&
      correlatedExperiment.room_name &&
      snapshot.room !== correlatedExperiment.room_name
    ) {
      issues.push("Snapshot and experiment rooms differ.");
    }
  }
  const snapshotRequest = requestCorrelationId(snapshot.sourceRequestId);
  const benchmarkRequest = requestCorrelationId(benchmark.sourceRef);
  const experimentRequest = requestCorrelationId(
    correlatedExperiment?.experiment_key ?? null,
  );
  if (
    !snapshotRequest ||
    !benchmarkRequest ||
    !experimentRequest ||
    new Set([snapshotRequest, benchmarkRequest, experimentRequest]).size !== 1
  ) {
    issues.push("Snapshot, benchmark, and experiment lack one exact request lineage.");
  }

  const scopes = [
    [snapshot.target, snapshot.shard, snapshot.room],
    [benchmark.target, benchmark.shard, benchmark.room],
    [
      correlatedExperiment?.target ?? null,
      correlatedExperiment?.shard ?? null,
      correlatedExperiment?.room_name ?? null,
    ],
  ];
  if (
    scopes.some((scope) => scope.some((value) => !value)) ||
    new Set(scopes.map((scope) => scope.join("/"))).size !== 1
  ) {
    issues.push("Snapshot, benchmark, and experiment scopes do not match exactly.");
  }

  const runtimeShas = [
    snapshot.runtimeSha,
    benchmark.runtimeSha,
    correlatedExperiment?.runtime_sha ?? null,
  ];
  if (
    runtimeShas.some((runtimeSha) => !runtimeSha) ||
    new Set(runtimeShas).size !== 1
  ) {
    issues.push("Snapshot, benchmark, and experiment runtime SHAs do not match exactly.");
  }

  const timestamps = [
    parsedTimestamp(snapshot.capturedAt),
    parsedTimestamp(benchmark.capturedAt),
    parsedTimestamp(correlatedExperiment?.completed_at ?? null),
  ];
  if (timestamps.some((timestamp) => timestamp === null)) {
    issues.push("All three streams need valid capture timestamps for correlation.");
  } else {
    const values = timestamps as number[];
    if (Math.max(...values) - Math.min(...values) > CORRELATION_MAX_SKEW_MS) {
      issues.push("Cross-stream capture skew exceeds the 30-minute correlation window.");
    }
  }
  if (
    snapshot.colonyId &&
    benchmark.colonyId &&
    snapshot.colonyId !== benchmark.colonyId
  ) {
    issues.push("Snapshot and benchmark colony identifiers differ.");
  }

  return {
    state: issues.length ? "partial" : "matched",
    identifier: benchmark.sampleKey,
    identifiers,
    issues,
  };
}

const provenanceLabels: Record<ProvenanceState, string> = {
  fresh: "Fresh · correlated",
  stale: "Stale evidence",
  partial: "Partial evidence",
  fallback: "No persisted evidence",
  error: "Source error",
};

function summarizeProvenance(
  state: ProvenanceState,
  streams: Record<StreamName, StreamProvenance>,
  correlation: CorrelationProvenance,
): string {
  if (state === "fresh")
    return "All three Supabase streams are fresh, complete, and correlated.";
  if (state === "error")
    return "Supabase queries failed before any persisted evidence could be verified.";
  if (state === "fallback")
    return "No persisted snapshot, experiment, or benchmark row is available.";
  if (state === "stale") {
    const labels = Object.values(streams)
      .filter((stream) => stream.state === "stale")
      .map((stream) => stream.label.toLowerCase());
    const subject = labels.join(" and ");
    return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${labels.length === 1 ? "is" : "are"} older than the declared freshness window.`;
  }
  const degraded = Object.values(streams)
    .filter((stream) => stream.state !== "fresh" && stream.state !== "stale")
    .map((stream) => stream.label.toLowerCase());
  if (correlation.state === "partial")
    degraded.push("cross-stream correlation");
  const labels = [...new Set(degraded)];
  const subject =
    labels.length <= 1
      ? (labels[0] ?? "Persisted evidence")
      : `${labels.slice(0, -1).join(", ")}${labels.length > 2 ? "," : ""} and ${labels.at(-1)}`;
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${labels.length === 1 ? "is" : "are"} incomplete; available values remain visible without synthetic blending.`;
}

export function buildControlPlaneProvenance(
  input: ProvenanceInput,
): ControlPlaneProvenance {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const latestExperiment = input.experiments[0] ?? null;
  // Once a benchmark is selected, its exact correlated experiment is the only
  // experiment row that can describe that evidence stream. A newer unrelated
  // experiment must never make an old or incomplete benchmark lineage green.
  const provenanceExperiment = input.benchmark
    ? input.correlatedExperiment
    : latestExperiment;
  const errors = input.errors ?? {};

  const streams: Record<StreamName, StreamProvenance> = {
    snapshot: streamProvenance({
      name: "snapshot",
      label: "Snapshot",
      hasData: input.snapshot !== null,
      observedAt: input.snapshot?.capturedAt ?? null,
      freshForMs: SNAPSHOT_FRESHNESS_MS,
      identifier: input.snapshot?.sourceRequestId ?? null,
      source: "observability_snapshots",
      sourceRef: input.snapshot?.sourceRequestId ?? null,
      target: input.snapshot?.target ?? null,
      shard: input.snapshot?.shard ?? null,
      room: input.snapshot?.room ?? null,
      runtimeSha: input.snapshot?.runtimeSha ?? null,
      sampleWindow:
        input.snapshot?.runtimeTick === null || input.snapshot === null
          ? null
          : `1 tick · game tick ${input.snapshot.runtimeTick}`,
      missingFields: snapshotMissingFields(input.snapshot),
      errorCode: errors.snapshot,
      nowMs,
    }),
    experiments: streamProvenance({
      name: "experiments",
      label: "Experiments",
      hasData: provenanceExperiment !== null,
      observedAt: provenanceExperiment?.completed_at ?? null,
      freshForMs: EXPERIMENT_FRESHNESS_MS,
      identifier: provenanceExperiment?.experiment_key ?? null,
      source: "experiments",
      sourceRef: provenanceExperiment?.experiment_key ?? null,
      target: provenanceExperiment?.target ?? null,
      shard: provenanceExperiment?.shard ?? null,
      room: provenanceExperiment?.room_name ?? null,
      runtimeSha: provenanceExperiment?.runtime_sha ?? null,
      sampleWindow: experimentSampleWindow(provenanceExperiment),
      missingFields: experimentMissingFields(provenanceExperiment),
      errorCode: errors.experiments,
      nowMs,
    }),
    benchmark: streamProvenance({
      name: "benchmark",
      label: "Benchmark",
      hasData: input.benchmark !== null,
      observedAt: input.benchmark?.capturedAt ?? null,
      freshForMs: BENCHMARK_FRESHNESS_MS,
      identifier: input.benchmark?.sampleKey ?? null,
      source: input.benchmark?.source ?? null,
      sourceRef: input.benchmark?.sourceRef ?? null,
      target: input.benchmark?.target ?? null,
      shard: input.benchmark?.shard ?? null,
      room: input.benchmark?.room ?? null,
      runtimeSha: input.benchmark?.runtimeSha ?? null,
      sampleWindow: benchmarkSampleWindow(input.benchmark),
      missingFields: benchmarkMissingFields(input.benchmark),
      errorCode: errors.benchmark,
      nowMs,
    }),
  };
  const correlation = buildCorrelation(input);
  const availableStreams = Object.values(streams).filter(
    (stream) => stream.hasData,
  ).length;
  const errorStreams = Object.values(streams).filter(
    (stream) => stream.state === "error",
  ).length;
  const incomplete = Object.values(streams).some(
    (stream) =>
      stream.state === "partial" ||
      stream.state === "fallback" ||
      stream.state === "error",
  );
  const state: ProvenanceState =
    availableStreams === 0 && errorStreams > 0
      ? "error"
      : availableStreams === 0
        ? "fallback"
        : incomplete || correlation.state !== "matched"
          ? "partial"
          : Object.values(streams).some((stream) => stream.state === "stale")
            ? "stale"
            : "fresh";
  const missingFields = Object.values(streams).flatMap(
    (stream) => stream.missingFields,
  );

  return {
    state,
    label: provenanceLabels[state],
    summary: summarizeProvenance(state, streams, correlation),
    evaluatedAt: now.toISOString(),
    streams,
    correlation,
    missingFields,
  };
}

export function unavailableControlPlaneProvenance(
  now = new Date(),
): ControlPlaneProvenance {
  return buildControlPlaneProvenance({
    now,
    snapshot: null,
    experiments: [],
    benchmark: null,
    correlatedExperiment: null,
    errors: {
      snapshot: "unhandled_load_error",
      experiments: "unhandled_load_error",
      benchmark: "unhandled_load_error",
    },
  });
}

export function formatEvidenceAge(ageMs: number | null): string {
  if (ageMs === null) return "age unknown";
  if (ageMs < MINUTE) return "just now";
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)}m old`;
  if (ageMs < 24 * HOUR) return `${Math.floor(ageMs / HOUR)}h old`;
  return `${Math.floor(ageMs / (24 * HOUR))}d old`;
}
