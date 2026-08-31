const requestIdOf = (raw) => {
  const requestId = String(raw?.request?.id ?? "");
  if (!/^\d+$/.test(requestId)) {
    throw new Error(`Invalid benchmark request id '${requestId}'`);
  }
  return requestId;
};

export const buildExperimentBenchmark = (raw, { runtimeSha = null } = {}) => {
  const experiment = raw?.experiment;
  if (experiment?.name !== "bootstrap-rcl3") return null;
  const requestId = requestIdOf(raw);

  const first = Array.isArray(experiment.samples)
    ? experiment.samples[0]
    : null;
  const final =
    experiment.final ??
    (Array.isArray(experiment.samples) ? experiment.samples.at(-1) : null);
  const startedAt = experiment.startedAt ?? first?.collectedAt ?? null;
  const completedAt = experiment.completedAt ?? final?.collectedAt ?? null;
  const durationMs =
    startedAt && completedAt
      ? Math.max(
          0,
          new Date(completedAt).getTime() - new Date(startedAt).getTime(),
        )
      : null;

  const milestoneSamples = Object.fromEntries(
    Object.entries(experiment.transitions ?? {}).map(([name, transition]) => [
      name,
      transition?.sample ?? null,
    ]),
  );

  return {
    schema: "screeps-benchmark-sample/v1",
    schemaVersion: 1,
    sampleKey: `ptr-experiment:${requestId}`,
    benchmarkName: experiment.name,
    runtimeSha,
    capturedAt: completedAt,
    target: "ptr",
    shard: experiment.shard,
    room: experiment.room,
    sourceRef: `github-comment:${requestId}`,
    metrics: {
      evidenceClass: "live-ptr-longitudinal",
      sampleCount: experiment.sampleCount ?? null,
      intervalMs: experiment.intervalMs ?? null,
      durationMs,
      outcomeStatus: experiment.status ?? null,
      startRcl: first?.state?.controller?.level ?? null,
      finalRcl: final?.state?.controller?.level ?? null,
      finalControllerProgress: final?.state?.controller?.progress ?? null,
      finalControllerProgressTotal:
        final?.state?.controller?.progressTotal ?? null,
      finalWorkforce: final?.state?.workforce?.total ?? null,
      finalWorkforceTarget: final?.state?.workforce?.target ?? null,
      finalSpawnEnergy: final?.state?.spawn?.energy ?? null,
      finalSpawnCapacity: final?.state?.spawn?.capacity ?? null,
      finalConstructionSites:
        final?.state?.structures?.constructionSites ?? null,
      finalExtensionSites: final?.state?.structures?.extensionSites ?? null,
      finalExtensions: final?.state?.structures?.extensions ?? null,
      finalActivityClassification:
        final?.evaluation?.activityExpectation?.classification ?? null,
      finalAcceptableInactivity:
        final?.evaluation?.activityExpectation?.acceptableInactivity ?? false,
      finalActivityBlockers:
        final?.evaluation?.activityExpectation?.blockers ?? [],
      controllerProgressDelta: experiment.delta?.controllerProgress ?? null,
      workforceDelta: experiment.delta?.workforce ?? null,
      harvestedDelta: experiment.delta?.harvested ?? null,
      constructionSpendDelta: experiment.delta?.constructionSpend ?? null,
      controllerSpendDelta: experiment.delta?.controllerSpend ?? null,
      cpuAverageTotal: experiment.observability?.cpu?.averageTotal ?? null,
      cpuMaxTotal: experiment.observability?.cpu?.maxTotal ?? null,
      cpuBucketFinal: experiment.observability?.cpu?.bucket ?? null,
      intentsAverageProposed:
        experiment.observability?.intents?.averageProposed ?? null,
      intentsAverageAccepted:
        experiment.observability?.intents?.averageAccepted ?? null,
      intentsAverageRejected:
        experiment.observability?.intents?.averageRejected ?? null,
      milestoneSamples,
    },
    result: {
      evidenceClass: "live-ptr-longitudinal",
      outcomeStatus: experiment.status ?? null,
      sampleCount: experiment.sampleCount ?? null,
      intervalMs: experiment.intervalMs ?? null,
      startedAt,
      completedAt,
      transitions: experiment.transitions ?? {},
      delta: experiment.delta ?? null,
      observability: experiment.observability ?? null,
      final: final
        ? {
            collectedAt: final.collectedAt ?? null,
            state: final.state ?? null,
            evaluation: final.evaluation ?? null,
          }
        : null,
    },
  };
};

export const buildHeadlessComparisonBenchmark = (raw) => {
  const benchmark = raw?.benchmark;
  if (benchmark?.name !== "traffic-suite") return null;
  if (benchmark.target !== "headless") return null;
  const requestId = requestIdOf(raw);
  const comparison = benchmark.comparison;
  if (comparison?.schema !== "screeps-headless-comparison/v1") {
    throw new Error("Invalid headless comparison payload");
  }

  return {
    schema: "screeps-benchmark-sample/v1",
    schemaVersion: 1,
    sampleKey: `headless-benchmark:${requestId}`,
    benchmarkName: "traffic-suite controlled comparison",
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

export const buildBenchmarkSample = (raw, options = {}) =>
  buildExperimentBenchmark(raw, options) ??
  buildHeadlessComparisonBenchmark(raw, options);
