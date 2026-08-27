import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { ScreepsServer, TerrainMatrix } = require("screeps-server-mockup");

const profiles = ["default", "custom-options", "traffic-terrain"];
const profile = process.argv[2] ?? null;
const isChild = process.argv[3] === "--child";

function createTrafficTerrain() {
  const terrain = new TerrainMatrix();
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) terrain.set(x, y, "wall");
  }
  const carve = (x, y) => terrain.set(x, y, "plain");
  for (let x = 10; x <= 40; x += 1) carve(x, 25);
  for (let x = 10; x <= 14; x += 1) {
    for (let y = 24; y <= 26; y += 1) carve(x, y);
  }
  for (let y = 15; y <= 35; y += 1) carve(25, y);
  for (let x = 33; x <= 36; x += 1) {
    for (let y = 24; y <= 26; y += 1) carve(x, y);
  }
  for (let x = 10; x <= 13; x += 1) {
    for (let y = 10; y <= 13; y += 1) carve(x, y);
  }
  return terrain;
}

async function runChild(name) {
  if (!profiles.includes(name)) throw new Error(`Unsupported smoke profile '${name}'`);

  const repoRoot = process.cwd();
  const runRoot = path.resolve("scenario", ".smoke", `${name}-${process.pid}`);
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });

  let server;
  try {
    if (name === "default") {
      process.chdir(runRoot);
      server = new ScreepsServer();
    } else {
      const serverPath = path.join(runRoot, "server");
      const logdir = path.join(runRoot, "logs");
      const port = 24000 + (process.pid % 1000);
      server = new ScreepsServer({ path: serverPath, logdir, port });
    }

    await server.world.stubWorld();
    if (name === "traffic-terrain") {
      await server.world.setTerrain("W0N0", createTrafficTerrain());
    }

    const logs = [];
    const bot = await server.world.addBot({
      username: `smoke-${name}`,
      room: "W0N0",
      x: name === "traffic-terrain" ? 12 : 25,
      y: 25,
      spawnName: "SmokeSpawn",
      modules: {
        main: `module.exports.loop = function() {
          Memory.smokeTicks = (Memory.smokeTicks || 0) + 1;
          console.log('smoke', Game.time);
        }`,
      },
    });
    bot.on("console", (entries = []) => logs.push(...entries));

    await server.start();
    for (let index = 0; index < 5; index += 1) await server.tick();

    const memory = JSON.parse((await bot.memory) || "{}");
    const cpu = await bot.lastUsedCpu;
    const result = {
      profile: name,
      smokeTicks: memory.smokeTicks ?? null,
      cpu: cpu ?? null,
      logs,
    };

    if (result.smokeTicks !== 5) {
      throw new Error(`${name} smoke bot executed ${result.smokeTicks ?? 0}/5 loops`);
    }
    if (logs.length !== 5) {
      throw new Error(`${name} smoke bot emitted ${logs.length}/5 console ticks`);
    }

    console.log(JSON.stringify(result));
  } finally {
    if (server) server.stop();
    process.chdir(repoRoot);
    await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function runParent() {
  const results = [];
  for (const name of profiles) {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.resolve("scenario", "smoke-user-code.mjs"), name, "--child"],
      { cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    if (stderr.trim()) process.stderr.write(stderr);
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const result = JSON.parse(lines.at(-1));
    results.push(result);
    console.log(
      `[headless-smoke] ${name}: passed; loops=${result.smokeTicks}; cpu=${result.cpu ?? "?"}`,
    );
  }
  console.log(`[headless-smoke] all ${results.length} user-code profiles passed`);
}

if (isChild) {
  runChild(profile).catch((error) => {
    console.error(`[headless-smoke:${profile}]`, error);
    process.exit(1);
  });
} else {
  await runParent();
}
