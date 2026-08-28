import { describe, expect, it } from "vitest";
import {
  bootstrapEnergyActivity,
  evaluateBootstrapWindow,
} from "../../../scripts/lib/bootstrap-window.mjs";

const stableRcl3State = () => ({
  controller: { level: 3, progress: 100, owned: true },
  spawn: { name: "Spawn1", energy: 300, capacity: 300, spawning: null },
  workforce: { target: 5, total: 5 },
  energy: {
    harvestedTotal: 1000,
    creepSpendTotal: 800,
    constructionSpendTotal: 500,
    controllerSpendTotal: 300,
    sourceEnergy: 6000,
    sourceCapacity: 6000,
  },
  structures: {
    extensions: 10,
    towers: 1,
    towerEnergy: 400,
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
    expect(evaluateBootstrapWindow(first, current).milestones.energyLoopActive).toBe(false);
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
});
