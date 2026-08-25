const LOWER_IS_BETTER = [
  "runningTicks",
  "pathFinds",
  "congestionRepaths",
  "stuckRequests",
  "fatigueWaits",
];

export const trialSignature = (trial) =>
  JSON.stringify({
    name: trial?.name ?? null,
    status: trial?.status ?? null,
    ticksObserved: trial?.ticksObserved ?? null,
    phase: trial?.finalState?.phase ?? null,
    runningTicks: trial?.finalState?.runningTicks ?? null,
    metrics: trial?.finalState?.metrics ?? null,
    nativeTileExchangeCount: trial?.analysis?.nativeTileExchangeCount ?? null,
    leftHorizontalCorridor:
      trial?.analysis?.headOnPrimaryCreepsLeftHorizontalCorridor ?? null,
  });

export function summarizeRuntimeTrials(trials, scenarioNames) {
  const scenarios = {};
  let deterministic = true;

  for (const name of scenarioNames) {
    const matches = trials.filter((trial) => trial.name === name);
    const signatures = [...new Set(matches.map(trialSignature))];
    const representative = matches[0] ?? null;
    const scenarioDeterministic = matches.length > 0 && signatures.length === 1;
    deterministic &&= scenarioDeterministic;
    scenarios[name] = {
      repetitions: matches.length,
      deterministic: scenarioDeterministic,
      signatureCount: signatures.length,
      status: representative?.status ?? "missing",
      ticksObserved: representative?.ticksObserved ?? null,
      runningTicks: representative?.finalState?.runningTicks ?? null,
      metrics: representative?.finalState?.metrics ?? null,
      analysis: representative?.analysis ?? null,
    };
  }

  return { deterministic, scenarios };
}

export function compareRuntimeTrials({
  baselineSha,
  candidateSha,
  fixtureVersion,
  tickBudget,
  repetitions,
  scenarioNames,
  baselineTrials,
  candidateTrials,
}) {
  const baseline = summarizeRuntimeTrials(baselineTrials, scenarioNames);
  const candidate = summarizeRuntimeTrials(candidateTrials, scenarioNames);
  const comparable =
    baseline.deterministic &&
    candidate.deterministic &&
    scenarioNames.every(
      (name) =>
        baseline.scenarios[name].repetitions === repetitions &&
        candidate.scenarios[name].repetitions === repetitions,
    );

  const comparisons = {};
  let hasRegression = false;
  let hasImprovement = false;

  for (const name of scenarioNames) {
    const base = baseline.scenarios[name];
    const next = candidate.scenarios[name];
    const deltas = Object.fromEntries(
      LOWER_IS_BETTER.map((key) => {
        const before = key === "runningTicks" ? base.runningTicks : base.metrics?.[key] ?? null;
        const after = key === "runningTicks" ? next.runningTicks : next.metrics?.[key] ?? null;
        return [key, before === null || after === null ? null : after - before];
      }),
    );

    const statusRegression = base.status === "passed" && next.status !== "passed";
    const statusImprovement = base.status !== "passed" && next.status === "passed";
    const metricRegression = Object.values(deltas).some((delta) => typeof delta === "number" && delta > 0);
    const metricImprovement = Object.values(deltas).some((delta) => typeof delta === "number" && delta < 0);
    hasRegression ||= statusRegression || metricRegression;
    hasImprovement ||= statusImprovement || metricImprovement;

    comparisons[name] = {
      baselineStatus: base.status,
      candidateStatus: next.status,
      deltas,
      regression: statusRegression || metricRegression,
      improvement: statusImprovement || metricImprovement,
    };
  }

  const verdict = !comparable
    ? "invalid"
    : hasRegression
      ? "regressed"
      : hasImprovement
        ? "improved"
        : "equivalent";

  return {
    schema: "screeps-headless-comparison/v1",
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
      rule: "candidate regresses if any guarded metric worsens or a previously passing scenario fails; otherwise any guarded improvement wins",
      excludes: ["localServerCpu"],
    },
    baseline,
    candidate,
    comparisons,
  };
}
