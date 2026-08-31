import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { compareRuntimeTrials } from "../scenario/benchmark-lib.mjs";
import { isolatedScenarioEnvironment } from "../scenario/child-environment.mjs";
import { runDiagnosticChild } from "../scenario/diagnostic-child.mjs";
import { benchmarkExitCode } from "../scenario/verdict-policy.mjs";
import { writeBenchmarkInfrastructureFailure } from "./lib/benchmark-failure-artifact.mjs";

const execFileAsync = promisify(execFile);
const requestId = process.env.SCREEPS_REQUEST_ID || "manual";
const command = process.env.SCREEPS_COMMAND || "/benchmark name=traffic-suite";

if (/\bname=bootstrap-suite\b/.test(command)) {
  await import("./run-headless-bootstrap-benchmark.mjs");
  process.exit(process.exitCode ?? 0);
}

const repetitions = Math.max(
  3,
  Math.min(5, Number(process.env.SCREEPS_BENCHMARK_RUNS || 3)),
);
const scenarioNames = ["head-on", "funnel", "crossing"];
const fixtureVersion = "traffic-v1";
const tickBudget = 320;
const ROOM_NAME = "W0N0";
const artifactPath = path.resolve(
  process.env.SCREEPS_INSIGHTS_ARTIFACT_PATH ||
    "artifacts/screeps-insights.json",
);

const exec = async (file, args, options = {}) => {
  const result = await execFileAsync(file, args, {
    ...options,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  return result;
};

const git = async (...args) => {
  const { stdout } = await execFileAsync("git", args, {
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
};

let candidateSha = null;
let baselineSha = null;
const runRoot = path.resolve("scenario", ".benchmark-runtime", requestId);
const baselineWorktree = path.join(runRoot, "baseline-worktree");
const bundleDir = path.join(runRoot, "bundles");
const resultDir = path.join(runRoot, "results");
const baselineBundle = path.join(bundleDir, "baseline.js");
const candidateBundle = path.join(bundleDir, "candidate.js");
let worktreeAdded = false;
let stage = "resolve-revisions";

const buildBundle = async (entryPoint, outfile, runtimeSha) => {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    sourcemap: false,
    minify: false,
    define: {
      __SCREEPS_RUNTIME_SHA__: JSON.stringify(runtimeSha),
    },
    logLevel: "silent",
  });
};

const runTrial = async ({
  runtime,
  runtimeSha,
  bundle,
  scenario,
  repetition,
}) => {
  const resultPath = path.join(
    resultDir,
    `${runtime}-${scenario}-${repetition}.json`,
  );
  const result = await runDiagnosticChild({
    execFileAsync,
    file: process.execPath,
    args: ["scenario/run-one.mjs", scenario],
    options: {
      env: isolatedScenarioEnvironment({
        SCENARIO_RESULT_PATH: resultPath,
        SCENARIO_BUNDLE_PATH: bundle,
      }),
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    },
    resultPath,
    resultName: scenario,
  });
  return {
    ...result,
    benchmark: {
      runtime,
      runtimeSha,
      fixtureVersion,
      tickBudget,
      repetition,
    },
  };
};

try {
  candidateSha =
    process.env.SCREEPS_BENCHMARK_CANDIDATE_SHA ||
    (await git("rev-parse", "HEAD"));
  baselineSha =
    process.env.SCREEPS_BENCHMARK_BASELINE_SHA ||
    (await git("rev-parse", "HEAD^1"));
  stage = "prepare-runtime";
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(bundleDir, { recursive: true });
  await mkdir(resultDir, { recursive: true });

  console.log(`[benchmark] candidate=${candidateSha}`);
  console.log(`[benchmark] baseline=${baselineSha}`);
  console.log(
    `[benchmark] fixture=${fixtureVersion} repetitions=${repetitions} tickBudget=${tickBudget}`,
  );

  stage = "create-baseline-worktree";
  await exec(
    "git",
    ["worktree", "add", "--detach", baselineWorktree, baselineSha],
    {
      timeout: 30_000,
    },
  );
  worktreeAdded = true;

  stage = "build-runtime-bundles";
  await Promise.all([
    buildBundle(
      path.resolve("packages/runtime/src/scenarios/headless-traffic.ts"),
      candidateBundle,
      candidateSha,
    ),
    buildBundle(
      path.join(
        baselineWorktree,
        "packages/runtime/src/scenarios/headless-traffic.ts",
      ),
      baselineBundle,
      baselineSha,
    ),
  ]);

  const baselineTrials = [];
  const candidateTrials = [];
  stage = "execute-private-server-trials";
  for (const scenario of scenarioNames) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      console.log(
        `[benchmark] paired ${scenario} repetition=${repetition}: baseline + candidate`,
      );
      const [baselineTrial, candidateTrial] = await Promise.all([
        runTrial({
          runtime: "baseline",
          runtimeSha: baselineSha,
          bundle: baselineBundle,
          scenario,
          repetition,
        }),
        runTrial({
          runtime: "candidate",
          runtimeSha: candidateSha,
          bundle: candidateBundle,
          scenario,
          repetition,
        }),
      ]);
      baselineTrials.push(baselineTrial);
      candidateTrials.push(candidateTrial);
    }
  }

  stage = "compare-trials";
  const comparison = compareRuntimeTrials({
    baselineSha,
    candidateSha,
    fixtureVersion,
    tickBudget,
    repetitions,
    scenarioNames,
    baselineTrials,
    candidateTrials,
  });
  const completedAt = new Date().toISOString();
  const artifact = {
    request: {
      id: requestId,
      command,
      mode: "benchmark",
      target: "headless",
    },
    benchmark: {
      name: "traffic-suite",
      status: comparison.comparable ? "completed" : "invalid",
      target: "headless",
      shard: "headless",
      room: ROOM_NAME,
      fixtureVersion,
      tickBudget,
      repetitions,
      baselineSha,
      candidateSha,
      completedAt,
      comparison,
      trials: {
        baseline: baselineTrials,
        candidate: candidateTrials,
      },
    },
  };

  stage = "write-artifact";
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[benchmark] verdict=${comparison.verdict} comparable=${comparison.comparable}`,
  );
  for (const name of scenarioNames) {
    const item = comparison.comparisons[name];
    console.log(
      `[benchmark] ${name}: ${item.baselineStatus} -> ${item.candidateStatus}; deltas=${JSON.stringify(item.deltas)}`,
    );
  }
  process.exitCode = benchmarkExitCode(comparison.verdict);
} catch (error) {
  const artifact = await writeBenchmarkInfrastructureFailure({
    artifactPath,
    requestId,
    command,
    benchmarkName: "traffic-suite",
    comparisonSchema: "screeps-headless-comparison/v1",
    fixtureVersion,
    tickBudget,
    repetitions,
    room: ROOM_NAME,
    candidateSha,
    baselineSha,
    stage,
    error,
  });
  console.error(
    `[benchmark] infrastructure failure at ${stage}; diagnostics=${artifactPath}`,
    error,
  );
  process.exitCode = benchmarkExitCode(artifact.benchmark.comparison.verdict);
} finally {
  if (worktreeAdded) {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", baselineWorktree],
      {
        maxBuffer: 1024 * 1024,
      },
    ).catch(() => {});
  }
  await rm(runRoot, { recursive: true, force: true }).catch(() => {});
}
