import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const requested = (process.env.SCREEPS_SCENARIO || "head-on").toLowerCase();
const requestId = process.env.SCREEPS_REQUEST_ID || "manual";
const command = process.env.SCREEPS_COMMAND || `/scenario name=${requested}`;
const supported = new Set(["head-on", "funnel", "crossing", "traffic-suite"]);

if (!supported.has(requested)) throw new Error(`Unsupported scenario request '${requested}'`);

const names = requested === "traffic-suite" ? ["head-on", "funnel", "crossing"] : [requested];
const resultDir = path.resolve("scenario", ".results", requestId);
await rm(resultDir, { recursive: true, force: true });
await mkdir(resultDir, { recursive: true });

const results = [];
for (const name of names) {
  const resultPath = path.join(resultDir, `${name}.json`);
  console.log(`[scenario] running ${name}`);
  const { stdout, stderr } = await execFileAsync(process.execPath, ["scenario/run-one.mjs", name], {
    env: { ...process.env, SCENARIO_RESULT_PATH: resultPath },
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  results.push(JSON.parse(await readFile(resultPath, "utf8")));
}

const status = results.every((result) => result.status === "passed") ? "passed" : "failed";
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
await writeFile("artifacts/screeps-insights.json", `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

for (const result of results) {
  const metrics = result.finalState?.metrics;
  console.log(
    `[scenario] ${result.name}: ${result.status}; ticks=${result.ticksObserved ?? "?"}; pathFinds=${metrics?.pathFinds ?? "?"}; repaths=${metrics?.congestionRepaths ?? "?"}; swaps=${metrics?.headOnSwaps ?? "?"}`,
  );
}
console.log(`[scenario] request ${requested}: ${status}`);

await rm(resultDir, { recursive: true, force: true }).catch(() => {});
