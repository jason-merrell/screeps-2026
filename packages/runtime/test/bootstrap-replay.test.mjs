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
  controller: { level: 3, progress: 0, progressTotal: 0, safeMode: null, owned: true },
  spawn: { name: "Spawn1", energy: 300, capacity: 300, spawning: null },
  workforce: {
    target: 5,
    total: 5,
    alive: 5,
    spawning: 0,
    carriedEnergy: 100,
    carryCapacity: 250,
  },
  energy: {
    sourceCount: 2,
    sourceEnergy: 5000,
    sourceCapacity: 6000,
    harvestedTotal: 1000,
    creepSpendTotal: 800,
    constructionSpendTotal: 500,
    controllerSpendTotal: 300,
  },
  structures: {
    extensions: 10,
    towers: 1,
    containers: 2,
    roads: 10,
    ramparts: 2,
    towerEnergy: 400,
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
