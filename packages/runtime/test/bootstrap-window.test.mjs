import { describe, expect, it } from "vitest";
import {
  bootstrapEnergyActivity,
  evaluateBootstrapWindow,
  matureEquilibriumAssessment,
} from "../../../scripts/lib/bootstrap-window.mjs";

const stableRcl3State = () => ({
  controller: {
    level: 3,
    progress: 100,
    owned: true,
    ticksToDowngrade: 150_000,
  },
  spawn: { name: "Spawn1", energy: 300, capacity: 300, spawning: null },
  workforce: {
    target: 5,
    total: 5,
    activeWorkParts: 5,
    activeCarryParts: 5,
    members: Array.from({ length: 5 }, () => ({
      spawning: false,
      ticksToLive: 1_000,
      workParts: 1,
      carryParts: 1,
      moveParts: 1,
    })),
  },
  energy: {
    harvestedTotal: 1000,
    creepSpendTotal: 800,
    constructionSpendTotal: 500,
    controllerSpendTotal: 300,
    sourceEnergy: 6000,
    sourceCapacity: 6000,
    sourceCount: 2,
    reserveEnergy: 100_000,
    sources: [
      {
        capacity: 3000,
        accessibleTiles: 3,
        connectedToSpawn: true,
      },
      {
        capacity: 3000,
        accessibleTiles: 2,
        connectedToSpawn: true,
      },
    ],
  },
  structures: {
    extensions: 10,
    towers: 1,
    towerEnergy: 400,
    towerCapacity: 1_000,
    constructionSites: 0,
    extensionSites: 0,
    towerSites: 0,
  },
  hostiles: 0,
  room: "W1N1",
});

describe("bootstrap window activity", () => {
  it("does not credit historical energy totals as current activity", () => {
    const first = stableRcl3State();
    const current = structuredClone(first);

    expect(bootstrapEnergyActivity(first, current)).toEqual({
      active: false,
      delta: {
        harvested: 0,
        creepSpend: 0,
        constructionSpend: 0,
        controllerSpend: 0,
        controllerProgress: 0,
      },
    });
    expect(evaluateBootstrapWindow(first, current).status).toBe("progressing");
    expect(
      evaluateBootstrapWindow(first, current).milestones.energyLoopActive,
    ).toBe(false);
  });

  it("graduates stable RCL3 only after recent economic work is observed", () => {
    const first = stableRcl3State();
    const current = structuredClone(first);
    current.controller.progress += 4;
    current.energy.controllerSpendTotal += 4;

    const evaluation = evaluateBootstrapWindow(first, current);
    expect(evaluation.energyActivity).toMatchObject({
      active: true,
      delta: { controllerSpend: 4, controllerProgress: 4 },
    });
    expect(evaluation.milestones.energyLoopActive).toBe(true);
    expect(evaluation.milestones.stableRcl3).toBe(true);
    expect(evaluation.status).toBe("passed");
  });

  it("accepts harvesting, spawning, or construction spend as recent energy activity", () => {
    const first = stableRcl3State();
    for (const [field, amount] of [
      ["harvestedTotal", 2],
      ["creepSpendTotal", 50],
      ["constructionSpendTotal", 5],
    ]) {
      const current = structuredClone(first);
      current.energy[field] += amount;
      expect(bootstrapEnergyActivity(first, current).active).toBe(true);
    }
  });

  it("accepts a healthy RCL8 equilibrium without inventing recent energy activity", () => {
    const first = stableRcl3State();
    first.controller.level = 8;
    first.structures.towerEnergy = 750;
    first.workforce.alive = 5;
    const current = structuredClone(first);

    const evaluation = evaluateBootstrapWindow(first, current);

    expect(evaluation.status).toBe("passed");
    expect(evaluation.milestones).toMatchObject({
      energyLoopActive: false,
      matureEquilibrium: true,
      economyHealthy: true,
      stableRcl3: true,
    });
    expect(evaluation.activityExpectation).toMatchObject({
      classification: "healthy_equilibrium",
      recentActivityRequired: false,
      recentActivityObserved: false,
      acceptableInactivity: true,
      blockers: [],
    });
    expect(evaluation.activityExpectation.reasons).toContain(
      "controller is capped at RCL8",
    );
  });

  it("does not excuse inactivity for a mature colony with a dead economy", () => {
    const first = stableRcl3State();
    first.controller.level = 8;
    first.workforce.total = 0;
    first.workforce.alive = 0;
    const current = structuredClone(first);

    const evaluation = evaluateBootstrapWindow(first, current);

    expect(evaluation.status).toBe("progressing");
    expect(evaluation.milestones).toMatchObject({
      energyLoopActive: false,
      matureEquilibrium: false,
      economyHealthy: false,
      stableRcl3: false,
    });
    expect(evaluation.activityExpectation).toMatchObject({
      classification: "work_required",
      recentActivityRequired: true,
      recentActivityObserved: false,
      acceptableInactivity: false,
    });
    expect(evaluation.activityExpectation.blockers).toContain(
      "live workforce is 0/5",
    );
  });

  it("requires recent activity while a capped colony still has a legitimate sink", () => {
    const state = stableRcl3State();
    state.controller.level = 8;
    state.workforce.alive = 5;
    state.structures.constructionSites = 1;

    const equilibrium = matureEquilibriumAssessment(state);

    expect(equilibrium.acceptable).toBe(false);
    expect(equilibrium.blockers).toContain("construction demand is present");
    expect(evaluateBootstrapWindow(state, structuredClone(state)).status).toBe(
      "progressing",
    );
  });

  it.each([
    {
      name: "MOVE-only creeps",
      mutate: (state) => {
        state.workforce.activeWorkParts = 0;
        state.workforce.activeCarryParts = 0;
        for (const member of state.workforce.members) {
          member.workParts = 0;
          member.carryParts = 0;
        }
      },
      blocker: "productive workforce capability is WORK=0, CARRY=0",
    },
    {
      name: "TTL-one workforce",
      mutate: (state) => {
        for (const member of state.workforce.members) member.ticksToLive = 1;
      },
      blocker: "replacement-horizon workforce is 0/5 at 150 ticks",
    },
    {
      name: "missing sources",
      mutate: (state) => {
        state.energy.sourceCount = 0;
        state.energy.sources = [];
      },
      blocker: "no energy source is available",
    },
    {
      name: "terrain-isolated source",
      mutate: (state) => {
        state.energy.sources[0].connectedToSpawn = false;
      },
      blocker: "source 1 is not terrain-connected to the spawn",
    },
    {
      name: "source without an accessible harvest tile",
      mutate: (state) => {
        state.energy.sources[0].accessibleTiles = 0;
      },
      blocker: "source 1 has no accessible harvest tile",
    },
    {
      name: "one-energy tower",
      mutate: (state) => {
        state.structures.towerEnergy = 1;
      },
      blocker: "tower reserve is 1/1000; 500 required",
    },
    {
      name: "controller near downgrade",
      mutate: (state) => {
        state.controller.ticksToDowngrade = 1;
      },
      blocker: "controller downgrade headroom is 1/100000",
    },
    {
      name: "empty strategic reserve",
      mutate: (state) => {
        state.energy.reserveEnergy = 0;
      },
      blocker: "strategic energy reserve is 0/50000",
    },
  ])("fails closed for $name", ({ mutate, blocker }) => {
    const state = stableRcl3State();
    state.controller.level = 8;
    state.structures.towerEnergy = 750;
    state.workforce.alive = 5;
    mutate(state);

    const equilibrium = matureEquilibriumAssessment(state);

    expect(equilibrium.acceptable).toBe(false);
    expect(equilibrium.blockers).toContain(blocker);
    expect(evaluateBootstrapWindow(state, structuredClone(state)).status).toBe(
      "progressing",
    );
  });
});
