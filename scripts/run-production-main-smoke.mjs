import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { isolatedScenarioEnvironment } from "../scenario/child-environment.mjs";
import { runDiagnosticChild } from "../scenario/diagnostic-child.mjs";
import {
  scenarioExitCode,
  scenarioSuiteStatus,
} from "../scenario/verdict-policy.mjs";
import { resolveProofRuntimeSha } from "./lib/runtime-sha.mjs";

const execFileAsync = promisify(execFile);
const artifactPath = path.resolve(
  process.env.SCREEPS_PRODUCTION_SMOKE_ARTIFACT ||
    "artifacts/production-main-smoke.json",
);
const runtimeRoot = path.resolve(
  "scenario",
  ".production-main-smoke-orchestrator",
  String(process.pid),
);
let stage = "resolve-runtime-sha";

try {
  const runtimeSha = resolveProofRuntimeSha();
  await mkdir(runtimeRoot, { recursive: true });
  const modes = [
    {
      name: "normal",
      maintenanceFault: false,
      malformedAuthority: false,
      malformedColonyAuthority: false,
    },
    {
      name: "fspm-maintenance-fault",
      maintenanceFault: true,
      malformedAuthority: false,
      malformedColonyAuthority: false,
    },
    {
      name: "malformed-fspm-authority",
      maintenanceFault: false,
      malformedAuthority: true,
      malformedColonyAuthority: false,
    },
    {
      name: "malformed-colony-authority",
      maintenanceFault: false,
      malformedAuthority: false,
      malformedColonyAuthority: true,
    },
  ];
  const scenarios = [];

  for (const mode of modes) {
    const bundlePath = path.join(runtimeRoot, `${mode.name}.js`);
    const childResultPath = path.join(runtimeRoot, `${mode.name}.json`);
    stage = `build-production-main:${mode.name}`;
    await build({
      entryPoints: ["packages/runtime/src/main.ts"],
      outfile: bundlePath,
      bundle: true,
      format: "cjs",
      platform: "neutral",
      target: "es2020",
      sourcemap: false,
      minify: false,
      define: {
        __SCREEPS_RUNTIME_SHA__: JSON.stringify(runtimeSha),
        __SCREEPS_TEST_FAULT_FSPM_MAINTENANCE__: JSON.stringify(
          mode.maintenanceFault,
        ),
      },
      logLevel: "silent",
    });

    stage = `execute-private-server:${mode.name}`;
    scenarios.push(
      await runDiagnosticChild({
        execFileAsync,
        file: process.execPath,
        args: ["scenario/run-production-main-smoke.mjs"],
        options: {
          env: isolatedScenarioEnvironment({
            SCENARIO_BUNDLE_PATH: bundlePath,
            SCENARIO_RESULT_PATH: childResultPath,
            EXPECTED_RUNTIME_SHA: runtimeSha,
            PRODUCTION_SMOKE_TICKS: "12",
            PRODUCTION_SMOKE_MODE: mode.name,
            SCENARIO_EXPECT_MAINTENANCE_FAULT: String(mode.maintenanceFault),
            SCENARIO_EXPECT_MALFORMED_AUTHORITY: String(
              mode.malformedAuthority,
            ),
            SCENARIO_EXPECT_MALFORMED_COLONY_AUTHORITY: String(
              mode.malformedColonyAuthority,
            ),
          }),
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
        resultPath: childResultPath,
        resultName: `production-main-smoke:${mode.name}`,
      }),
    );
  }

  const status = scenarioSuiteStatus(scenarios);
  const result = {
    name: "production-main-smoke",
    status,
    error:
      status === "passed"
        ? null
        : "One or more production main.loop modes failed",
    runtimeSha,
    scenarios,
  };
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.exitCode = scenarioExitCode(status);
} catch (error) {
  const result = {
    name: "production-main-smoke",
    status: "infrastructure-failed",
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    failure: { stage, recordedAt: new Date().toISOString() },
  };
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.error(
    `[production-main-smoke] infrastructure failure at ${stage}; diagnostics=${artifactPath}`,
    error,
  );
  process.exitCode = scenarioExitCode(result.status);
} finally {
  await rm(runtimeRoot, { recursive: true, force: true }).catch(() => {});
}
