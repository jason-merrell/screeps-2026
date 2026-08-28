import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityExecutionObservation } from "../../src/intents/execute";
import { createIntentTrace } from "../../src/intents/trace";
import type { UpgradeIntent, WithdrawIntent } from "../../src/intents/types";
import {
  bindFspmActivities,
  fspmActivityEvents,
  reconcileFspmActivityEvidence,
} from "../../src/planning/activity-lifecycle";
import { ensureColonyPortfolio } from "../../src/planning/fspm";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_NOT_IN_RANGE", -9);
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");

let creepEnergy = 0;

function installGlobals(): void {
  creepEnergy = 0;
  const creep = {
    name: "worker-1",
    spawning: false,
    memory: {},
    store: {
      getUsedCapacity: () => creepEnergy,
      getCapacity: () => 50,
    },
  } as unknown as Creep;

  const container = {
    id: "container-1",
    store: {
      getUsedCapacity: () => 500,
      getFreeCapacity: () => 1500,
      getCapacity: () => 2000,
    },
  } as unknown as StructureContainer;

  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: { "worker-1": creep },
      spawns: {},
      rooms: {},
      getObjectById: (id: string) => (id === "container-1" ? container : null),
    },
    Memory: {
      version: 5,
      colonies: {
        W1N1: { roomName: "W1N1", discoveredAt: 1 },
      },
    },
  });
}

function withdrawIntent(): WithdrawIntent {
  return {
    type: "withdraw",
    creepName: "worker-1",
    targetId: "container-1" as Id<StructureContainer>,
    resource: RESOURCE_ENERGY,
    priority: 1000,
    reason: "collect buffered energy for governed downstream work",
    trace: createIntentTrace({
      roomName: "W1N1",
      domain: "economy",
      task: "maintain-colony-energy-service",
      procedure: "withdraw-buffered-energy",
    }),
  };
}

function controllerIntent(): UpgradeIntent {
  return {
    type: "upgrade",
    creepName: "worker-1",
    controllerId: "controller-1" as Id<StructureController>,
    priority: 100,
    reason: "invest available energy in controller capability",
    trace: createIntentTrace({
      roomName: "W1N1",
      domain: "economy",
      task: "advance-controller-capability",
      procedure: "upgrade-controller",
    }),
  };
}

describe("FSPM energy-service handoff", () => {
  beforeEach(() => installGlobals());

  it("completes productive collection when usable energy is handed to a downstream governed Task", () => {
    const withdraw = withdrawIntent();
    bindFspmActivities([withdraw]);
    const energyActivityId = withdraw.trace?.activityId;
    const energyTaskId = withdraw.trace?.taskId;
    if (!energyActivityId || !energyTaskId) throw new Error("expected energy-service Activity");

    creepEnergy = 50;
    reconcileFspmActivityEvidence([
      {
        intent: withdraw,
        result: OK,
        movementRequired: false,
        evidence: "buffered energy collected successfully",
        outcome: { metric: "energy collected", actual: 50, target: 50, unit: "energy" },
      } satisfies ActivityExecutionObservation,
    ]);

    const portfolio = ensureColonyPortfolio("W1N1");
    expect(portfolio.activities?.[energyActivityId]).toMatchObject({
      status: "in_progress",
      metrics: { productiveTicks: 1 },
    });
    expect(portfolio.activityKpiHistory?.[energyTaskId]).toBeUndefined();

    Game.time = 101;
    const controller = controllerIntent();
    bindFspmActivities([controller]);

    expect(portfolio.activities?.[energyActivityId]).toMatchObject({
      status: "completed",
      completedAt: 101,
      kpiScore: "satisfactory",
      metrics: { taskPreemptions: 0, holdCount: 0 },
    });
    expect(portfolio.activityKpiHistory?.[energyTaskId]).toHaveLength(1);
    expect(controller.trace?.activityId).not.toBe(energyActivityId);
    expect(portfolio.activities?.[controller.trace?.activityId ?? ""]?.status).toBe("in_progress");

    const energyEvents = fspmActivityEvents(portfolio).filter(
      (event) => event.activityId === energyActivityId,
    );
    expect(energyEvents.map((event) => event.type)).toContain("activity_completed");
    expect(energyEvents.map((event) => event.type)).toContain("kpi_scored");
    expect(energyEvents.map((event) => event.type)).not.toContain("activity_held");
    expect(
      energyEvents.find((event) => event.type === "activity_completed")?.reason,
    ).toContain("handed usable energy");
  });
});
