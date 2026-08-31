const PASSING_BENCHMARK_VERDICTS = new Set(["equivalent", "improved"]);

export function scenarioSuiteStatus(results) {
  if (!Array.isArray(results) || results.length === 0)
    return "infrastructure-failed";

  let hasScenarioFailure = false;
  for (const result of results) {
    if (result?.status === "infrastructure-failed")
      return "infrastructure-failed";
    if (result?.status === "failed") {
      hasScenarioFailure = true;
      continue;
    }
    if (result?.status !== "passed") return "infrastructure-failed";
  }

  return hasScenarioFailure ? "failed" : "passed";
}

export function scenarioExitCode(status) {
  return status === "passed" ? 0 : 1;
}

export function benchmarkExitCode(verdict) {
  return PASSING_BENCHMARK_VERDICTS.has(verdict) ? 0 : 1;
}
