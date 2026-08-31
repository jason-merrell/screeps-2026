import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { scenarioExitCode } from "./verdict-policy.mjs";

const require = createRequire(import.meta.url);
const { ScreepsServer, TerrainMatrix } = require("screeps-server-mockup");
const mockupPackage = require("screeps-server-mockup/package.json");

const resultPath = process.env.SCENARIO_RESULT_PATH;
const ROOM_NAME = "W0N0";
const SOURCE_ENERGY = 3000;
const SPAWN_START_ENERGY = 300;
const MAX_ENGINE_TICKS = Number(process.env.BOOTSTRAP_TICK_BUDGET || 400);
const runRoot = path.resolve(
  "scenario",
  ".bootstrap-runtime",
  `${process.pid}`,
);
const serverPath = path.join(runRoot, "server");
const logdir = path.join(runRoot, "logs");
const port = 25000 + (process.pid % 1000);
let server;
let exitCode = 1;

if (!resultPath) throw new Error("SCENARIO_RESULT_PATH is required");

function createTerrain() {
  const terrain = new TerrainMatrix();
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      terrain.set(
        x,
        y,
        x === 0 || y === 0 || x === 49 || y === 49 ? "wall" : "plain",
      );
    }
  }
  return terrain;
}

async function writeResult(result) {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function snapshot(objects) {
  const controller = objects.find((object) => object.type === "controller");
  const source = objects.find((object) => object.type === "source");
  const spawn = objects.find((object) => object.type === "spawn");
  const creeps = objects.filter((object) => object.type === "creep");
  const liveWorkers = creeps.filter((creep) => !creep.spawning);
  return {
    controllerLevel: controller?.level ?? null,
    controllerProgress: controller?.progress ?? null,
    sourceEnergy: source?.energy ?? null,
    spawnEnergy: spawn?.store?.energy ?? null,
    workers: liveWorkers.length,
    creeps: creeps.length,
    constructionSites: objects.filter(
      (object) => object.type === "constructionSite",
    ).length,
    extensions: objects.filter((object) => object.type === "extension").length,
  };
}

try {
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });

  const bundle = await readFile("scenario/dist/bootstrap-main.js", "utf8");
  server = new ScreepsServer({ path: serverPath, logdir, port });
  server.on("error", (message) =>
    console.error(`[bootstrap-headless] ${message}`),
  );

  await server.world.stubWorld();
  const { db } = await server.world.load();
  await db["rooms.objects"].removeWhere({ room: ROOM_NAME });
  await server.world.setTerrain(ROOM_NAME, createTerrain());
  await Promise.all([
    server.world.addRoomObject(ROOM_NAME, "controller", 35, 25, { level: 0 }),
    server.world.addRoomObject(ROOM_NAME, "source", 10, 25, {
      energy: SOURCE_ENERGY,
      energyCapacity: SOURCE_ENERGY,
      ticksToRegeneration: 300,
    }),
    server.world.addRoomObject(ROOM_NAME, "mineral", 40, 40, {
      mineralType: "H",
      density: 3,
      mineralAmount: 70000,
    }),
  ]);

  const bot = await server.world.addBot({
    username: "bootstrap-benchmark",
    room: ROOM_NAME,
    x: 20,
    y: 25,
    spawnName: "BootstrapSpawn",
    cpu: 100,
    cpuAvailable: 10000,
    modules: { main: bundle },
  });

  const consoleEvents = [];
  bot.on("console", (log = [], results = []) => {
    if (log.length > 0 || results.length > 0) {
      consoleEvents.push({ log, results });
      if (consoleEvents.length > 50) consoleEvents.shift();
    }
  });

  await server.start();
  const milestones = {
    firstWorker: null,
    firstHarvest: null,
    firstSpawnRefill: null,
    rcl2: null,
  };
  const milestoneSnapshots = {};
  let lowSpawnEnergy = SPAWN_START_ENERGY;
  let observedSpawnSpend = false;
  let final = null;
  let ticksObserved = 0;

  for (let index = 0; index < MAX_ENGINE_TICKS; index += 1) {
    await server.tick();
    ticksObserved = index + 1;
    const objects = await server.world.roomObjects(ROOM_NAME);
    const state = snapshot(objects);
    final = state;

    if (typeof state.spawnEnergy === "number") {
      if (state.spawnEnergy < lowSpawnEnergy) {
        lowSpawnEnergy = state.spawnEnergy;
        observedSpawnSpend = true;
      }
    }

    if (milestones.firstWorker === null && state.workers > 0) {
      milestones.firstWorker = ticksObserved;
      milestoneSnapshots.firstWorker = state;
    }
    if (
      milestones.firstHarvest === null &&
      typeof state.sourceEnergy === "number" &&
      state.sourceEnergy < SOURCE_ENERGY
    ) {
      milestones.firstHarvest = ticksObserved;
      milestoneSnapshots.firstHarvest = state;
    }
    if (
      milestones.firstSpawnRefill === null &&
      observedSpawnSpend &&
      typeof state.spawnEnergy === "number" &&
      state.spawnEnergy > lowSpawnEnergy
    ) {
      milestones.firstSpawnRefill = ticksObserved;
      milestoneSnapshots.firstSpawnRefill = state;
    }
    if (milestones.rcl2 === null && (state.controllerLevel ?? 0) >= 2) {
      milestones.rcl2 = ticksObserved;
      milestoneSnapshots.rcl2 = state;
      break;
    }
  }

  const passed = milestones.rcl2 !== null;
  const result = {
    name: "bootstrap",
    status: passed ? "passed" : "failed",
    error: passed
      ? null
      : `RCL2 not reached within ${MAX_ENGINE_TICKS} engine ticks`,
    engine: {
      serverMockup: mockupPackage.version,
      node: process.version,
      note: "Local/private-server CPU and wall-clock timing are diagnostic only and excluded from comparison.",
    },
    world: {
      room: ROOM_NAME,
      fixture: "bootstrap-v1",
      source: { x: 10, y: 25, energy: SOURCE_ENERGY },
      spawn: {
        name: "BootstrapSpawn",
        x: 20,
        y: 25,
        energy: SPAWN_START_ENERGY,
      },
      controller: { x: 35, y: 25, initialLevel: 1 },
    },
    tickBudget: MAX_ENGINE_TICKS,
    ticksObserved,
    milestones,
    milestoneSnapshots,
    final,
    localServerCpu: (await bot.lastUsedCpu) ?? null,
    consoleEvents,
  };
  await writeResult(result);
  exitCode = scenarioExitCode(result.status);
  console.log(
    `[bootstrap-headless] ${result.status}; ticks=${ticksObserved}; milestones=${JSON.stringify(milestones)}`,
  );
} catch (error) {
  await writeResult({
    name: "bootstrap",
    status: "infrastructure-failed",
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  exitCode = scenarioExitCode("infrastructure-failed");
  console.error("[bootstrap-headless] infrastructure failure", error);
} finally {
  if (server) server.stop();
  await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  process.exit(exitCode);
}
