const requestIdOf = (raw) => {
  const requestId = String(raw?.request?.id ?? "");
  if (!/^\d+$/.test(requestId)) throw new Error("Benchmark request id must be immutable and numeric");
  return requestId;
};

export const buildBootstrapComparisonBenchmark = (raw) => {
  const benchmark = raw?.benchmark;
  if (benchmark?.name !== "bootstrap-suite" || benchmark.target !== "headless") return null;
  const requestId = requestIdOf(raw);
  const comparison = benchmark.comparison;
  if (comparison?.schema !== "screeps-headless-bootstrap-comparison/v1") {
    throw new Error("Invalid headless bootstrap comparison payload");
  }

  return {
    schema: "screeps-benchmark-sample/v1",
    schemaVersion: 1,
    sampleKey: `headless-benchmark:${requestId}`,
    benchmarkName: "bootstrap-suite controlled comparison",
    runtimeSha: benchmark.candidateSha ?? null,
    capturedAt: benchmark.completedAt ?? null,
    target: "headless",
    shard: benchmark.shard ?? "headless",
    room: benchmark.room ?? "W0N0",
    sourceRef: `github-comment:${requestId}`,
    metrics: {
      evidenceClass: "controlled-headless-comparison",
      fixtureVersion: benchmark.fixtureVersion ?? null,
      tickBudget: benchmark.tickBudget ?? null,
      repetitions: benchmark.repetitions ?? null,
      baselineSha: benchmark.baselineSha ?? null,
      candidateSha: benchmark.candidateSha ?? null,
      comparable: comparison.comparable ?? false,
      verdict: comparison.verdict ?? "invalid",
      comparisons: comparison.comparisons ?? {},
      milestonePolicy: comparison.policy?.lowerIsBetter ?? [],
    },
    result: {
      evidenceClass: "controlled-headless-comparison",
      fixtureVersion: benchmark.fixtureVersion ?? null,
      tickBudget: benchmark.tickBudget ?? null,
      repetitions: benchmark.repetitions ?? null,
      baselineSha: benchmark.baselineSha ?? null,
      candidateSha: benchmark.candidateSha ?? null,
      comparison,
    },
  };
};
