import { beforeEach, describe, expect, it } from "vitest";
import type { Intent } from "../../src/intents/types";
import {
  ensureTask,
  reconcileFspmLifecycle,
  type ColonyFspmPortfolio,
} from "../../src/planning/fspm";

const WORKFORCE_TASK = "maintain-workforce-capacity";

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
      procedureId: `procedure:W1N1:spawning:${WORKFORCE_TASK}:maintain-general-workforce`,
    },
  };
}

describe("FSPM lifecycle reconciliation", () => {
  beforeEach(() => installGlobals());

  it("keeps Task definitions active when no Activity is demanded this tick", () => {
    const task = ensureTask("W1N1", "spawning", WORKFORCE_TASK);

    reconcileFspmLifecycle([]);

    expect(task.status).toBe("active");
    expect(portfolio().deliverables.spawning?.status).toBe("active");
    expect(portfolio().requirements.spawning?.status).toBe("active");
    expect(portfolio().contract.status).toBe("active");
  });

  it("does not reinterpret planner demand as Task lifecycle state", () => {
    const task = ensureTask("W1N1", "spawning", WORKFORCE_TASK);
    const createdAt = task.createdAt;

    reconcileFspmLifecycle([]);
    Game.time = 101;
    reconcileFspmLifecycle([tracedIntent(task.id)]);

    expect(task.status).toBe("active");
    expect(task.createdAt).toBe(createdAt);
  });

  it("preserves explicit Task retirement against derived demand", () => {
    const task = ensureTask("W1N1", "spawning", WORKFORCE_TASK);
    task.status = "retired";
    task.retiredAt = 100;
    task.statusReason = "operator retired test task";

    Game.time = 101;
    reconcileFspmLifecycle([tracedIntent(task.id)]);

    expect(task.status).toBe("retired");
    expect(task.retiredAt).toBe(100);
    expect(task.statusReason).toBe("operator retired test task");
  });
});
