import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { compareBootstrapTrials } from "../scenario/bootstrap-benchmark-lib.mjs";

const execFileAsync = promisify(execFile);
const requestId = process.env.SCREEPS_REQUEST_ID || "manual";
const command = process.env.SCREEPS_COMMAND || "/benchmark name=bootstrap-suite runs=2";
const repetitions = Math.max(2, Math.min(5, Number(process.env.SCREEPS_BENCHMARK_RUNS || 2)));
const fixtureVersion = "bootstrap-v1";
const tickBudget = 400;
const ROOM_NAME = "W0N0";

const exec = async (file, args, options = {}) => {
  const result = await execFileAsync(file, args, { ...options, maxBuffer: 8 * 1024 * 1024 });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  return result;
};
const git = async (...args) => {
  const { stdout } = await execFileAsync("git", args, { maxBuffer: 1024 * 1024 });
  return stdout.trim();
};
const buildBundle = async (entryPoint, outfile) => {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    sourcemap: false,
    minify: false,
    logLevel: "silent",
  });
};

const candidateSha = await git("rev-parse", "HEAD");
const baselineSha = await git("rev-parse", "HEAD^1");
const runRoot = path.resolve("scenario", ".bootstrap-benchmark-runtime", requestId);
const baselineWorktree = path.join(runRoot, "baseline-worktree");
const bundleDir = path.join(runRoot, "bundles");
const resultDir = path.join(runRoot, "results");
const activeBundle = path.resolve("scenario", "dist", "bootstrap-main.js");
const baselineBundle = path.join(bundleDir, "baseline.js");
const candidateBundle = path.join(bundleDir, "candidate.js");
let worktreeAdded = false;

const runTrial = async ({ runtime, runtimeSha, bundle, repetition }) => {
  await copyFile(bundle, activeBundle);
  const resultPath = path.join(resultDir, `${runtime}-bootstrap-${repetition}.json`);
  await exec(process.execPath, ["scenario/run-bootstrap.mjs"], {
    env: {
      ...process.env,
      SCENARIO_RESULT_PATH: resultPath,
      BOOTSTRAP_TICK_BUDGET: String(tickBudget),
    },
    timeout: 180_000,
  });
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  return {
    ...result,
    benchmark: { runtime, runtimeSha, fixtureVersion, tickBudget, repetition },
  };
};

try {
  await rm(runRoot, { recursive: true, force: true });
  await Promise.all([
    mkdir(bundleDir, { recursive: true }),
    mkdir(resultDir, { recursive: true }),
    mkdir(path.dirname(activeBundle), { recursive: true }),
  ]);

  console.log(`[bootstrap-benchmark] candidate=${candidateSha}`);
  console.log(`[bootstrap-benchmark] baseline=${baselineSha}`);
  console.log(
    `[bootstrap-benchmark] fixture=${fixtureVersion} repetitions=${repetitions} tickBudget=${tickBudget}`,
  );

  await exec("git", ["worktree", "add", "--detach", baselineWorktree, baselineSha], {
    timeout: 30_000,
  });
  worktreeAdded = true;

  await Promise.all([
    buildBundle(path.resolve("packages/runtime/src/main.ts"), candidateBundle),
    buildBundle(path.join(baselineWorktree, "packages/runtime/src/main.ts"), baselineBundle),
  ]);

  const baselineTrials = [];
  const candidateTrials = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    console.log(`[bootstrap-benchmark] baseline repetition=${repetition}`);
    baselineTrials.push(
      await runTrial({
        runtime: "baseline",
        runtimeSha: baselineSha,
        bundle: baselineBundle,
        repetition,
      }),
    );
    console.log(`[bootstrap-benchmark] candidate repetition=${repetition}`);
    candidateTrials.push(
      await runTrial({
        runtime: "candidate",
        runtimeSha: candidateSha,
        bundle: candidateBundle,
        repetition,
      }),
    );
  }

  const comparison = compareBootstrapTrials({
    baselineSha,
    candidateSha,
    fixtureVersion,
    tickBudget,
    repetitions,
    baselineTrials,
    candidateTrials,
  });
  const completedAt = new Date().toISOString();
  const artifact = {
    request: { id: requestId, command, mode: "benchmark", target: "headless" },
    benchmark: {
      name: "bootstrap-suite",
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
      trials: { baseline: baselineTrials, candidate: candidateTrials },
    },
  };

  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/screeps-insights.json", `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(
    `[bootstrap-benchmark] verdict=${comparison.verdict} comparable=${comparison.comparable} deltas=${JSON.stringify(comparison.comparisons.bootstrap.deltas)}`,
  );
} finally {
  if (worktreeAdded) {
    await execFileAsync("git", ["worktree", "remove", "--force", baselineWorktree], {
      maxBuffer: 1024 * 1024,
    }).catch(() => {});
  }
  await rm(runRoot, { recursive: true, force: true }).catch(() => {});
}
