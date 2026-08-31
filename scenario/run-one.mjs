import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { scenarioExitCode } from "./verdict-policy.mjs";

const require = createRequire(import.meta.url);
const { ScreepsServer, TerrainMatrix } = require("screeps-server-mockup");
const mockupPackage = require("screeps-server-mockup/package.json");

const scenario = process.argv[2];
const resultPath = process.env.SCENARIO_RESULT_PATH;
const bundlePath = path.resolve(
  process.env.SCENARIO_BUNDLE_PATH || "scenario/dist/main.js",
);
const ROOM_NAME = "W0N0";
const MAX_ENGINE_TICKS = 320;
const STARTUP_TICK_LIMIT = 20;
const LOG_TAIL_LINES = 80;
const supported = new Set(["head-on", "funnel", "crossing"]);

if (!supported.has(scenario))
  throw new Error(`Unsupported headless scenario '${scenario}'`);
if (!resultPath) throw new Error("SCENARIO_RESULT_PATH is required");

const runRoot = path.resolve(
  "scenario",
  ".runtime",
  `${scenario}-${process.pid}`,
);
const serverPath = path.join(runRoot, "server");
const logdir = path.join(runRoot, "logs");
const port = 22000 + (process.pid % 1000);
let server;
let preflight = null;
let exitCode = 1;

function createTerrain() {
  const terrain = new TerrainMatrix();
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) terrain.set(x, y, "wall");
  }

  const carve = (x, y) => terrain.set(x, y, "plain");

  // Spawn pocket and one-tile horizontal corridor.
  for (let x = 10; x <= 40; x += 1) carve(x, 25);
  for (let x = 10; x <= 14; x += 1) {
    for (let y = 24; y <= 26; y += 1) carve(x, y);
  }

  // Cardinal crossing used by crossing/funnel scenarios.
  for (let y = 15; y <= 35; y += 1) carve(25, y);

  // Three destination bays on the east side for the funnel scenario.
  for (let x = 33; x <= 36; x += 1) {
    for (let y = 24; y <= 26; y += 1) carve(x, y);
  }

  return terrain;
}

function summarizeCreeps(objects) {
  return objects
    .filter(
      (object) => object.type === "creep" && typeof object.name === "string",
    )
    .map((object) => ({
      name: object.name,
      x: object.x,
      y: object.y,
      fatigue: object.fatigue ?? 0,
      spawning: object.spawning ?? false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function positionMap(sample) {
  return new Map(
    sample.creeps.map((creep) => [creep.name, { x: creep.x, y: creep.y }]),
  );
}

function analyzeTimeline(timeline) {
  const nativeTileExchanges = [];
  const running = timeline.filter((sample) => sample.phase === "running");

  for (let index = 1; index < running.length; index += 1) {
    const previous = running[index - 1];
    const current = running[index];
    const before = positionMap(previous);
    const after = positionMap(current);
    const names = [...before.keys()].filter((name) => after.has(name));

    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const a = names[left];
        const b = names[right];
        const aBefore = before.get(a);
        const bBefore = before.get(b);
        const aAfter = after.get(a);
        const bAfter = after.get(b);
        if (!aBefore || !bBefore || !aAfter || !bAfter) continue;

        if (
          aAfter.x === bBefore.x &&
          aAfter.y === bBefore.y &&
          bAfter.x === aBefore.x &&
          bAfter.y === aBefore.y
        ) {
          nativeTileExchanges.push({
            fromGameTime: previous.gameTime,
            toGameTime: current.gameTime,
            creeps: [a, b],
            before: { [a]: aBefore, [b]: bBefore },
            after: { [a]: aAfter, [b]: bAfter },
          });
        }
      }
    }
  }

  const runningCreeps = running.flatMap((sample) => sample.creeps);
  const offHorizontalCorridor = runningCreeps
    .filter(
      (creep) => creep.name === "scenario-A" || creep.name === "scenario-B",
    )
    .filter((creep) => creep.y !== 25);

  return {
    nativeTileExchanges,
    nativeTileExchangeCount: nativeTileExchanges.length,
    headOnPrimaryCreepsLeftHorizontalCorridor: offHorizontalCorridor.length > 0,
  };
}

function finalAssertions(state) {
  return [
    {
      name: "scenario completed before deadline",
      passed: state?.phase === "complete",
      actual: state?.phase ?? "missing",
      expected: "complete",
    },
  ];
}

async function readLogTail(fileName) {
  try {
    const raw = await readFile(path.join(logdir, fileName), "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-LOG_TAIL_LINES);
  } catch {
    return [];
  }
}

async function captureServerLogs() {
  const [storage, engineRunner, engineProcessor] = await Promise.all([
    readLogTail("storage.log"),
    readLogTail("engine_runner.log"),
    readLogTail("engine_processor.log"),
  ]);
  return { storage, engineRunner, engineProcessor };
}

async function writeResult(result) {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

try {
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });

  const bundle = await readFile(bundlePath, "utf8");
  server = new ScreepsServer({ path: serverPath, logdir, port });
  server.on("error", (message) =>
    console.error(`[headless:${scenario}] ${message}`),
  );

  // Start from the mock server's own known-good 3x3 world so engine/runtime
  // metadata matches its canonical test fixture. Only W0N0 terrain is replaced
  // with the deterministic traffic arena; the room's canonical controller is retained.
  await server.world.stubWorld();
  await server.world.setTerrain(ROOM_NAME, createTerrain());

  const bot = await server.world.addBot({
    username: `scenario-${scenario}`,
    room: ROOM_NAME,
    x: 12,
    y: 25,
    spawnName: "ScenarioSpawn",
    cpu: 100,
    cpuAvailable: 10000,
    modules: { main: bundle },
  });
  const consoleEvents = [];
  bot.on("console", (log = [], results = []) => {
    const event = { log, results };
    consoleEvents.push(event);
    if (log.length > 0 || results.length > 0) {
      console.error(`[headless:${scenario}:console] ${JSON.stringify(event)}`);
    }
  });

  const { env, db } = await server.world.load();
  await env.set(
    env.keys.MEMORY + bot.id,
    JSON.stringify({ headlessScenarioName: scenario }),
  );

  const [databaseUsers, driverUsers, codeRows] = await Promise.all([
    db.users.find(),
    server.driver.getAllUsers(),
    db["users.code"].find({ user: bot.id }),
  ]);
  preflight = {
    botId: bot.id,
    databaseUsers: databaseUsers.map((user) => ({
      id: user._id?.toString?.() ?? String(user._id),
      username: user.username ?? null,
      active: user.active ?? null,
      cpu: user.cpu ?? null,
    })),
    driverUsers: driverUsers.map((user) => ({
      id: user._id?.toString?.() ?? String(user._id),
      username: user.username ?? null,
      active: user.active ?? null,
      cpu: user.cpu ?? null,
    })),
    codeRows: codeRows.map((row) => ({
      branch: row.branch ?? null,
      activeWorld: row.activeWorld ?? null,
      modules: Object.keys(row.modules ?? {}),
    })),
  };
  console.error(
    `[headless:${scenario}:preflight] ${JSON.stringify(preflight)}`,
  );

  if (!driverUsers.some((user) => user._id?.toString?.() === bot.id)) {
    throw new Error(
      `driver.getAllUsers() did not return headless bot ${bot.id}`,
    );
  }
  if (
    !codeRows.some(
      (row) =>
        typeof row.modules?.main === "string" && row.modules.main.length > 0,
    )
  ) {
    throw new Error(`headless bot ${bot.id} has no non-empty main module`);
  }

  await server.start();

  const timeline = [];
  let state = null;
  let startupFailure = null;
  for (let index = 0; index < MAX_ENGINE_TICKS; index += 1) {
    await server.tick();
    const [rawMemory, roomObjects, localCpu, gameTime] = await Promise.all([
      bot.memory,
      server.world.roomObjects(ROOM_NAME),
      bot.lastUsedCpu,
      server.world.gameTime,
    ]);

    const memory = JSON.parse(rawMemory || "{}");
    state = memory.headlessTraffic ?? null;
    timeline.push({
      index,
      gameTime,
      phase: state?.phase ?? null,
      stageIndex: state?.stageIndex ?? null,
      runningTicks: state?.runningTicks ?? null,
      lastMetrics: state?.lastMetrics ?? null,
      cumulativeMetrics: state?.metrics ?? null,
      creeps: summarizeCreeps(roomObjects),
      localServerCpu: localCpu ?? null,
    });

    if (state?.phase === "complete" || state?.phase === "failed") break;
    if (state === null && index + 1 >= STARTUP_TICK_LIMIT) {
      startupFailure = `scenario runtime did not initialize within ${STARTUP_TICK_LIMIT} engine ticks`;
      break;
    }
  }

  const analysis = analyzeTimeline(timeline);
  const assertions = finalAssertions(state);
  const passed = assertions.every((assertion) => assertion.passed);
  const serverLogs = startupFailure ? await captureServerLogs() : undefined;
  const result = {
    name: scenario,
    status: startupFailure
      ? "infrastructure-failed"
      : passed
        ? "passed"
        : "failed",
    error: startupFailure,
    engine: {
      serverMockup: mockupPackage.version,
      node: process.version,
      note: "Local/private-server CPU is diagnostic only and is not comparable to PTR/MMO CPU.",
    },
    world: {
      room: ROOM_NAME,
      fixture: "canonical-stub-world+traffic-v1-terrain",
      terrain: "one-tile cross with east-side funnel bays",
      spawn: { name: "ScenarioSpawn", x: 12, y: 25 },
    },
    preflight,
    ticksObserved: timeline.length,
    finalState: state,
    analysis,
    assertions,
    consoleEvents,
    ...(serverLogs ? { serverLogs } : {}),
    timeline,
  };

  await writeResult(result);
  exitCode = scenarioExitCode(result.status);
  if (startupFailure && serverLogs) {
    console.error(
      `[headless:${scenario}:engine-logs] ${JSON.stringify(serverLogs)}`,
    );
  }
  console.log(
    `[headless:${scenario}] ${result.status} after ${timeline.length} engine ticks; nativeExchanges=${analysis.nativeTileExchangeCount}`,
  );
} catch (error) {
  const serverLogs = await captureServerLogs();
  await writeResult({
    name: scenario,
    status: "infrastructure-failed",
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    preflight,
    serverLogs,
  });
  exitCode = scenarioExitCode("infrastructure-failed");
  console.error(`[headless:${scenario}] infrastructure failure`, error);
} finally {
  if (server) server.stop();
  await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  // screeps-server-mockup intentionally leaves storage handles around after stop().
  process.exit(exitCode);
}
