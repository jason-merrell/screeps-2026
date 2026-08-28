import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Intent } from "../../src/intents/types";
import {
  allowsRoutineControllerProgress,
  enforceRoutineControllerProgress,
} from "../../src/planning/controller-policy";

vi.stubGlobal("RESOURCE_ENERGY", "energy");

function upgradeIntent(controllerId: string, creepName = "worker-1"): Intent {
  return {
    type: "upgrade",
    creepName,
    controllerId: controllerId as Id<StructureController>,
    priority: 100,
    reason: "routine room progression",
  };
}

describe("routine controller progression policy", () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      Game: {
        getObjectById: (id: string) => {
          if (id === "rcl7") return { id, my: true, level: 7 } as StructureController;
          if (id === "rcl8") return { id, my: true, level: 8 } as StructureController;
          return null;
        },
      },
    });
  });

  it("allows normal room progression below RCL8", () => {
    expect(allowsRoutineControllerProgress(1)).toBe(true);
    expect(allowsRoutineControllerProgress(7)).toBe(true);
  });

  it("fails closed for capped or unresolved controllers", () => {
    expect(allowsRoutineControllerProgress(8)).toBe(false);
    expect(allowsRoutineControllerProgress(undefined)).toBe(false);
    expect(allowsRoutineControllerProgress(0)).toBe(false);
  });

  it("suppresses RCL8 upgrade intents while preserving sub-RCL8 progression", () => {
    const intents = enforceRoutineControllerProgress([
      upgradeIntent("rcl7", "worker-7"),
      upgradeIntent("rcl8", "worker-8"),
    ]);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: "upgrade",
      creepName: "worker-7",
      controllerId: "rcl7",
    });
  });

  it("preserves non-controller intents unchanged", () => {
    const move: Intent = {
      type: "move",
      creepName: "worker-1",
      targetId: "container-1" as Id<StructureContainer>,
      range: 1,
      priority: 200,
      reason: "stage elsewhere",
    };

    expect(enforceRoutineControllerProgress([move])).toEqual([move]);
  });
});
