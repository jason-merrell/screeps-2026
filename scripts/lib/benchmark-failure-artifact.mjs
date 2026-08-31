import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const errorEvidence = (error) => ({
  name: error instanceof Error ? error.name : "Error",
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? (error.stack ?? null) : null,
  code:
    typeof error?.code === "string" || typeof error?.code === "number"
      ? error.code
      : null,
});

export function buildBenchmarkInfrastructureFailure({
  requestId,
  command,
  benchmarkName,
  comparisonSchema,
  fixtureVersion,
  tickBudget,
  repetitions,
  room,
  candidateSha,
  baselineSha,
  stage,
  error,
}) {
  const failure = {
    stage,
    recordedAt: new Date().toISOString(),
    ...errorEvidence(error),
  };
  return {
    request: {
      id: requestId,
      command,
      mode: "benchmark",
      target: "headless",
    },
    benchmark: {
      name: benchmarkName,
      status: "infrastructure-failed",
      target: "headless",
      shard: "headless",
      room,
      fixtureVersion,
      tickBudget,
      repetitions,
      baselineSha,
      candidateSha,
      completedAt: failure.recordedAt,
      comparison: {
        schema: comparisonSchema,
        schemaVersion: 1,
        comparable: false,
        verdict: "invalid",
        failure,
      },
      failure,
    },
  };
}

export async function writeBenchmarkInfrastructureFailure({
  artifactPath,
  ...input
}) {
  const artifact = buildBenchmarkInfrastructureFailure(input);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}
