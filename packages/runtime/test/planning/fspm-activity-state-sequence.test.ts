import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIntentTrace } from "../../src/intents/trace";
import type { HarvestIntent } from "../../src/intents/types";
import {
  bindFspmActivities,
  fspmActivityEvents,
} from "../../src/planning/activity-lifecycle";
import { ensureColonyPortfolio } from "../../src/planning/fspm";

vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");

function installGlobals(): void {
  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: {
        "worker-1": {
          name: "worker-1",
          spawning: false,
          memory: {},
          store: {
            getUsedCapacity: () => 0,
            getCapacity: () => 50,
          },
        },
      },
      getObjectById: () => null,
    },
    Memory: {
      version: 5,
      colonies: {
        W1N1: { roomName: "W1N1", discoveredAt: 1 },
      },
    },
  });
}

describe("FSPM Activity state sequence", () => {
  beforeEach(() => installGlobals());

  it("records creation before commencement and finishes binding In Progress", () => {
    const intent: HarvestIntent = {
      type: "harvest",
      creepName: "worker-1",
      sourceId: "source-1" as Id<Source>,
      priority: 100,
      reason: "begin governed source extraction",
      trace: createIntentTrace({
        roomName: "W1N1",
        domain: "economy",
        task: "maintain-colony-energy-service",
        procedure: "extract-source-energy",
      }),
    };

    bindFspmActivities([intent]);

    const portfolio = ensureColonyPortfolio("W1N1");
    const activity = portfolio.activities?.[intent.trace?.activityId ?? ""];
    expect(activity).toMatchObject({ status: "in_progress", startedAt: 100 });
    const events = fspmActivityEvents(portfolio).filter(
      (event) => event.activityId === intent.trace?.activityId,
    );
    expect(events.slice(0, 2).map((event) => event.type)).toEqual([
      "activity_opened",
      "activity_started",
    ]);
    expect(events[0]?.reason).toContain("Not Started");
    expect(events[1]?.reason).toContain("In Progress");
  });
});
