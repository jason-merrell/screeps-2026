import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isolatedScenarioEnvironment } from "./child-environment.mjs";
import { runDiagnosticChild } from "./diagnostic-child.mjs";
import { scenarioExitCode, scenarioSuiteStatus } from "./verdict-policy.mjs";

const execFileAsync = promisify(execFile);
const requested = (process.env.SCREEPS_SCENARIO || "head-on").toLowerCase();
const requestId = process.env.SCREEPS_REQUEST_ID || "manual";
const command = process.env.SCREEPS_COMMAND || `/scenario name=${requested}`;
const supported = new Set(["head-on", "funnel", "crossing", "traffic-suite"]);

if (!supported.has(requested))
  throw new Error(`Unsupported scenario request '${requested}'`);

const names =
  requested === "traffic-suite"
    ? ["head-on", "funnel", "crossing"]
    : [requested];
const resultDir = path.resolve("scenario", ".results", requestId);
await rm(resultDir, { recursive: true, force: true });
await mkdir(resultDir, { recursive: true });

const results = [];
for (const name of names) {
  const resultPath = path.join(resultDir, `${name}.json`);
  console.log(`[scenario] running ${name}`);
  results.push(
    await runDiagnosticChild({
      execFileAsync,
      file: process.execPath,
      args: ["scenario/run-one.mjs", name],
      options: {
        env: isolatedScenarioEnvironment({
          SCENARIO_RESULT_PATH: resultPath,
        }),
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      resultPath,
      resultName: name,
    }),
  );
}

const status = scenarioSuiteStatus(results);
const artifact = {
  request: {
    id: requestId,
    command,
    mode: "scenario",
    target: "headless-private-server",
  },
  scenario: {
    requested,
    status,
    completedAt: new Date().toISOString(),
    results,
  },
};

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/screeps-insights.json",
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);

for (const result of results) {
  const metrics = result.finalState?.metrics;
  console.log(
    `[scenario] ${result.name}: ${result.status}; ticks=${result.ticksObserved ?? "?"}; pathFinds=${metrics?.pathFinds ?? "?"}; repaths=${metrics?.congestionRepaths ?? "?"}; swaps=${metrics?.headOnSwaps ?? "?"}`,
  );
}
console.log(`[scenario] request ${requested}: ${status}`);

await rm(resultDir, { recursive: true, force: true }).catch(() => {});
process.exitCode = scenarioExitCode(status);
