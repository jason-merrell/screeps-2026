import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function expectSetupFailureArtifact(script, command, benchmarkName) {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "screeps-benchmark-failure-"),
  );
  const artifactPath = path.join(tempDir, "nested", "insights.json");

  try {
    await expect(
      execFileAsync(process.execPath, [script], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SCREEPS_REQUEST_ID: "failure-contract-test",
          SCREEPS_COMMAND: command,
          SCREEPS_BENCHMARK_BASELINE_SHA: "not-a-real-git-revision",
          SCREEPS_INSIGHTS_ARTIFACT_PATH: artifactPath,
        },
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 1 });

    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(artifact).toMatchObject({
      request: {
        id: "failure-contract-test",
        command,
        mode: "benchmark",
        target: "headless",
      },
      benchmark: {
        name: benchmarkName,
        status: "infrastructure-failed",
        baselineSha: "not-a-real-git-revision",
        comparison: {
          comparable: false,
          verdict: "invalid",
          failure: { stage: "create-baseline-worktree" },
        },
      },
    });
    expect(artifact.benchmark.failure.message).toContain(
      "not-a-real-git-revision",
    );
    expect(artifact.benchmark.failure.recordedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe("controlled benchmark setup failure contract", () => {
  it("writes diagnostics when traffic benchmark setup fails before trials", async () => {
    await expectSetupFailureArtifact(
      "scripts/run-headless-benchmark.mjs",
      "/benchmark name=traffic-suite runs=3",
      "traffic-suite",
    );
  });

  it("writes diagnostics when production benchmark setup fails before trials", async () => {
    await expectSetupFailureArtifact(
      "scripts/run-headless-bootstrap-benchmark.mjs",
      "/benchmark name=bootstrap-suite runs=3",
      "bootstrap-suite",
    );
  });
});
