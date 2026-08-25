import { beforeEach, describe, expect, it } from "vitest";
import type { Intent } from "../../src/intents/types";
import {
  ensureTask,
  reconcileFspmLifecycle,
  type ColonyFspmPortfolio,
} from "../../src/planning/fspm";

function installGlobals(time = 100): void {
  Object.assign(globalThis, {
    Game: { time },
    Memory: {
      version: 2,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
        },
      },
    },
  });
}

function portfolio(): ColonyFspmPortfolio {
  const value = Memory.colonies.W1N1?.fspm;
  if (!value) throw new Error("expected test portfolio");
  return value;
}

function tracedIntent(taskId: string): Intent {
  return {
    type: "spawn",
    spawnName: "Spawn1",
    body: [],
    name: "worker-1",
    priority: 100,
    reason: "test demand",
    trace: {
      contractId: "contract:colony:W1N1",
      requirementId: "requirement:W1N1:spawning",
      deliverableId: "deliverable:W1N1:spawning",
      taskId,
      activityId: "activity:100:W1N1:spawning:Spawn1:spawn-worker",
    },
  };
}

describe("FSPM lifecycle reconciliation", () => {
  beforeEach(() => installGlobals());

  it("completes idle tasks and rolls completion through deliverable and requirement", () => {
    const task = ensureTask("W1N1", "spawning", "maintain-workforce");

    reconcileFspmLifecycle([]);

    expect(task.status).toBe("completed");
    expect(task.completedAt).toBe(100);
    expect(portfolio().deliverables.spawning?.status).toBe("completed");
    expect(portfolio().requirements.spawning?.status).toBe("completed");
    expect(portfolio().contract.status).toBe("active");
  });

  it("reopens completed work when planner demand returns", () => {
    const task = ensureTask("W1N1", "spawning", "maintain-workforce");
    reconcileFspmLifecycle([]);

    Game.time = 101;
    reconcileFspmLifecycle([tracedIntent(task.id)]);

    expect(task.status).toBe("active");
    expect(task.completedAt).toBeUndefined();
    expect(task.reopenedAt).toBe(101);
    expect(portfolio().deliverables.spawning?.status).toBe("active");
    expect(portfolio().requirements.spawning?.status).toBe("active");
  });

  it("does not churn lifecycle timestamps while state and reason remain unchanged", () => {
    const task = ensureTask("W1N1", "spawning", "maintain-workforce");
    reconcileFspmLifecycle([]);
    const updatedAt = task.updatedAt;

    Game.time = 101;
    reconcileFspmLifecycle([]);

    expect(task.updatedAt).toBe(updatedAt);
    expect(task.completedAt).toBe(100);
  });

  it("preserves explicit cancellation against derived demand", () => {
    const task = ensureTask("W1N1", "spawning", "maintain-workforce");
    task.status = "cancelled";
    task.statusReason = "operator cancelled test task";

    reconcileFspmLifecycle([tracedIntent(task.id)]);

    expect(task.status).toBe("cancelled");
    expect(task.statusReason).toBe("operator cancelled test task");
  });
});
