import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_STATE_VERSION,
  evaluateBootstrapState,
  projectBootstrapState,
} from "../../../scripts/lib/bootstrap-state.mjs";

const fixturePath = new URL("./fixtures/bootstrap/ptr-rcl1-self-reproducing.json", import.meta.url);

const loadFixture = async () => JSON.parse(await readFile(fixturePath, "utf8"));

const stableRcl3State = () => ({
  schemaVersion: BOOTSTRAP_STATE_VERSION,
  observedAt: "2026-08-24T23:20:00.000Z",
  target: "ptr",
  shard: "shard3",
  room: "W39S23",
  worldStatus: "normal",
  controller: {
    level: 3,
    progress: 0,
    progressTotal: 0,
    ticksToDowngrade: 10_000,
    safeMode: null,
    owned: true,
  },
  spawn: { name: "Spawn1", energy: 300, capacity: 300, spawning: null },
  workforce: {
    target: 5,
    total: 5,
    alive: 5,
    spawning: 0,
    carriedEnergy: 100,
    carryCapacity: 250,
    activeWorkParts: 5,
    activeCarryParts: 5,
    knownTtl: 5,
    members: Array.from({ length: 5 }, () => ({
      spawning: false,
      ticksToLive: 1_000,
      workParts: 1,
      carryParts: 1,
      moveParts: 1,
    })),
  },
  energy: {
    sourceCount: 2,
    sourceEnergy: 5000,
    sourceCapacity: 6000,
    harvestedTotal: 1000,
    creepSpendTotal: 800,
    constructionSpendTotal: 500,
    controllerSpendTotal: 300,
    reserveEnergy: 10_000,
    sources: [
      { capacity: 3_000, accessibleTiles: 3, connectedToSpawn: true },
      { capacity: 3_000, accessibleTiles: 3, connectedToSpawn: true },
    ],
  },
  structures: {
    extensions: 10,
    towers: 1,
    containers: 2,
    roads: 10,
    ramparts: 2,
    towerEnergy: 400,
    towerCapacity: 1_000,
    constructionSites: 0,
    extensionSites: 0,
    towerSites: 0,
    containerSites: 0,
  },
  hostiles: 0,
});

describe("bootstrap replay", () => {
  it("projects live telemetry into a stable serializable state", async () => {
    const state = projectBootstrapState(await loadFixture());

    expect(state.schemaVersion).toBe(BOOTSTRAP_STATE_VERSION);
    expect(state.room).toBe("W39S23");
    expect(state.controller.level).toBe(1);
    expect(state.workforce).toMatchObject({ target: 3, total: 3, alive: 2, spawning: 1 });
    expect(state.workforce.carriedEnergy).toBe(92);
    expect(state.spawn).toMatchObject({ energy: 8, capacity: 300 });
  });

  it("derives body, replacement, and terrain-connectivity evidence instead of trusting counts", () => {
    const terrain = Array.from({ length: 2_500 }, () => "0");
    for (let y = 0; y < 50; y += 1) terrain[y * 50 + 15] = "1";
    const state = projectBootstrapState({
      gameTime: 1_000,
      roomSnapshots: {
        W1N1: {
          shard: "shard3",
          terrain: {
            body: { terrain: [{ terrain: terrain.join("") }] },
          },
          overview: { body: { totals: {} } },
          objects: {
            body: {
              objects: [
                {
                  type: "controller",
                  user: "me",
                  level: 8,
                  downgradeTime: 151_000,
                },
                {
                  type: "spawn",
                  user: "me",
                  name: "Spawn1",
                  x: 20,
                  y: 25,
                  energy: 300,
                  energyCapacity: 300,
                },
                {
                  type: "source",
                  x: 10,
                  y: 25,
                  energy: 3_000,
                  energyCapacity: 3_000,
                },
                {
                  type: "creep",
                  user: "me",
                  ageTime: 2_000,
                  spawning: false,
                  body: [
                    { type: "work", hits: 100 },
                    { type: "carry", hits: 100 },
                    { type: "move", hits: 100 },
                  ],
                },
              ],
            },
          },
        },
      },
    });

    expect(state.controller.ticksToDowngrade).toBe(150_000);
    expect(state.workforce).toMatchObject({
      activeWorkParts: 1,
      activeCarryParts: 1,
      knownTtl: 1,
    });
    expect(state.workforce.members[0]).toMatchObject({ ticksToLive: 1_000 });
    expect(state.energy.sources[0]).toMatchObject({
      accessibleTiles: 8,
      connectedToSpawn: false,
    });
  });

  it("recognizes the observed PTR colony as self-reproducing but not yet RCL2", async () => {
    const evaluation = evaluateBootstrapState(projectBootstrapState(await loadFixture()));

    expect(evaluation.status).toBe("progressing");
    expect(evaluation.milestones.spawnPresent).toBe(true);
    expect(evaluation.milestones.energyLoopActive).toBe(true);
    expect(evaluation.milestones.workforceTargetMet).toBe(true);
    expect(evaluation.milestones.rcl2).toBe(false);
    expect(evaluation.milestones.stableRcl3).toBe(false);
  });

  it("can evaluate a projected stable RCL3 fixture directly without Screeps globals", () => {
    const evaluation = evaluateBootstrapState(stableRcl3State());

    expect(evaluation.status).toBe("passed");
    expect(evaluation.milestones.towerOnline).toBe(true);
    expect(evaluation.milestones.stableRcl3).toBe(true);
  });

  it("does not graduate an RCL3 colony with an empty tower", () => {
    const state = stableRcl3State();
    state.structures.towerEnergy = 0;
    const evaluation = evaluateBootstrapState(state);

    expect(evaluation.status).toBe("progressing");
    expect(evaluation.milestones.rcl3Infrastructure).toBe(true);
    expect(evaluation.milestones.towerOnline).toBe(false);
    expect(evaluation.milestones.stableRcl3).toBe(false);
  });

  it("does not graduate an RCL3 colony after its energy loop goes idle", () => {
    const state = stableRcl3State();
    state.energy.harvestedTotal = 0;
    state.energy.sourceEnergy = state.energy.sourceCapacity;
    const evaluation = evaluateBootstrapState(state);

    expect(evaluation.status).toBe("progressing");
    expect(evaluation.milestones.energyLoopActive).toBe(false);
    expect(evaluation.milestones.towerOnline).toBe(true);
    expect(evaluation.milestones.stableRcl3).toBe(false);
  });
});
