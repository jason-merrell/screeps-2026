import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { ScreepsServer, TerrainMatrix } = require("screeps-server-mockup");
const screepsPackage = require("screeps/package.json");
const mockupPackage = require("screeps-server-mockup/package.json");

const scenario = process.argv[2];
const resultPath = process.env.SCENARIO_RESULT_PATH;
const ROOM_NAME = "W0N0";
const MAX_ENGINE_TICKS = 320;
const supported = new Set(["head-on", "funnel", "crossing"]);

if (!supported.has(scenario)) throw new Error(`Unsupported headless scenario '${scenario}'`);
if (!resultPath) throw new Error("SCENARIO_RESULT_PATH is required");

const runRoot = path.resolve("scenario", ".runtime", `${scenario}-${process.pid}`);
const serverPath = path.join(runRoot, "server");
const logdir = path.join(runRoot, "logs");
const port = 22000 + (process.pid % 1000);
let server;

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

  // Isolated controller pocket. It exists only so addBot can claim the room.
  for (let x = 10; x <= 13; x += 1) {
    for (let y = 10; y <= 13; y += 1) carve(x, y);
  }

  return terrain;
}

function summarizeCreeps(objects) {
  return objects
    .filter((object) => object.type === "creep" && typeof object.name === "string")
    .map((object) => ({
      name: object.name,
      x: object.x,
      y: object.y,
      fatigue: object.fatigue ?? 0,
      spawning: object.spawning ?? false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function finalAssertions(state) {
  const assertions = [
    {
      name: "scenario completed before deadline",
      passed: state?.phase === "complete",
      actual: state?.phase ?? "missing",
      expected: "complete",
    },
  ];

  if (scenario === "head-on") {
    assertions.push({
      name: "head-on congestion resolved by at least one swap",
      passed: (state?.metrics?.headOnSwaps ?? 0) >= 1,
      actual: state?.metrics?.headOnSwaps ?? 0,
      expected: ">=1",
    });
  }

  return assertions;
}

async function writeResult(result) {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

try {
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });

  const bundle = await readFile("scenario/dist/main.js", "utf8");
  server = new ScreepsServer({ path: serverPath, logdir, port });
  server.on("error", (message) => console.error(`[headless:${scenario}] ${message}`));

  await server.world.reset();
  await server.world.addRoom(ROOM_NAME);
  await server.world.setTerrain(ROOM_NAME, createTerrain());
  await server.world.addRoomObject(ROOM_NAME, "controller", 11, 11);

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

  const { env } = await server.world.load();
  await env.set(
    env.keys.MEMORY + bot.id,
    JSON.stringify({ headlessScenarioName: scenario }),
  );

  await server.start();

  const timeline = [];
  let state = null;
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
  }

  const assertions = finalAssertions(state);
  const passed = assertions.every((assertion) => assertion.passed);
  const result = {
    name: scenario,
    status: passed ? "passed" : "failed",
    engine: {
      screeps: screepsPackage.version,
      serverMockup: mockupPackage.version,
      note: "Local/private-server CPU is diagnostic only and is not comparable to PTR/MMO CPU.",
    },
    world: {
      room: ROOM_NAME,
      terrain: "one-tile cross with east-side funnel bays",
      spawn: { name: "ScenarioSpawn", x: 12, y: 25 },
    },
    ticksObserved: timeline.length,
    finalState: state,
    assertions,
    timeline,
  };

  await writeResult(result);
  console.log(`[headless:${scenario}] ${result.status} after ${timeline.length} engine ticks`);
} catch (error) {
  await writeResult({
    name: scenario,
    status: "infrastructure-failed",
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  console.error(`[headless:${scenario}] infrastructure failure`, error);
} finally {
  if (server) server.stop();
  await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  // screeps-server-mockup intentionally leaves storage handles around after stop().
  process.exit(0);
}
