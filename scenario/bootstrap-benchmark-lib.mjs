const LOWER_IS_BETTER = ["firstWorker", "firstHarvest", "firstSpawnRefill", "rcl2"];

export const bootstrapTrialSignature = (trial) =>
  JSON.stringify({
    status: trial?.status ?? null,
    ticksObserved: trial?.ticksObserved ?? null,
    milestones: trial?.milestones ?? null,
    final: trial?.final
      ? {
          controllerLevel: trial.final.controllerLevel ?? null,
          controllerProgress: trial.final.controllerProgress ?? null,
          workers: trial.final.workers ?? null,
          spawnEnergy: trial.final.spawnEnergy ?? null,
        }
      : null,
  });

export function summarizeBootstrapTrials(trials) {
  const signatures = [...new Set(trials.map(bootstrapTrialSignature))];
  const representative = trials[0] ?? null;
  const deterministic = trials.length > 0 && signatures.length === 1;
  const milestonesComplete = LOWER_IS_BETTER.every(
    (key) => typeof representative?.milestones?.[key] === "number",
  );
  const valid = deterministic && representative?.status === "passed" && milestonesComplete;

  return {
    repetitions: trials.length,
    deterministic,
    valid,
    signatureCount: signatures.length,
    status: representative?.status ?? "missing",
    ticksObserved: representative?.ticksObserved ?? null,
    milestones: representative?.milestones ?? null,
    final: representative?.final ?? null,
  };
}

export function compareBootstrapTrials({
  baselineSha,
  candidateSha,
  fixtureVersion,
  tickBudget,
  repetitions,
  baselineTrials,
  candidateTrials,
}) {
  const baseline = summarizeBootstrapTrials(baselineTrials);
  const candidate = summarizeBootstrapTrials(candidateTrials);
  const comparable =
    baseline.deterministic &&
    candidate.deterministic &&
    baseline.valid &&
    candidate.valid &&
    baseline.repetitions === repetitions &&
    candidate.repetitions === repetitions;

  const metricsComparable = baseline.status === "passed" && candidate.status === "passed";
  const deltas = Object.fromEntries(
    LOWER_IS_BETTER.map((key) => {
      const before = baseline.milestones?.[key] ?? null;
      const after = candidate.milestones?.[key] ?? null;
      return [key, !metricsComparable || before === null || after === null ? null : after - before];
    }),
  );
  const statusRegression = baseline.status === "passed" && candidate.status !== "passed";
  const statusImprovement = baseline.status !== "passed" && candidate.status === "passed";
  const metricRegression = Object.values(deltas).some(
    (delta) => typeof delta === "number" && delta > 0,
  );
  const metricImprovement = Object.values(deltas).some(
    (delta) => typeof delta === "number" && delta < 0,
  );

  const verdict = !comparable
    ? "invalid"
    : statusRegression || metricRegression
      ? "regressed"
      : statusImprovement || metricImprovement
        ? "improved"
        : "equivalent";

  return {
    schema: "screeps-headless-bootstrap-comparison/v1",
    schemaVersion: 1,
    fixtureVersion,
    tickBudget,
    repetitions,
    baselineSha,
    candidateSha,
    comparable,
    verdict,
    policy: {
      lowerIsBetter: LOWER_IS_BETTER,
      rule: "comparison is valid only when repeated bootstrap trials are deterministic, pass, and reach every required milestone; lower milestone ticks are better",
      excludes: ["localServerCpu", "wallClockDuration"],
    },
    baseline,
    candidate,
    comparisons: {
      bootstrap: {
        baselineStatus: baseline.status,
        candidateStatus: candidate.status,
        deltas,
        regression: statusRegression || metricRegression,
        improvement: statusImprovement || metricImprovement,
      },
    },
  };
}
