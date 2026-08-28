import { beforeEach, describe, expect, it } from "vitest";
import type { BuildIntent } from "../../src/intents/types";
import { ensureFspmWorkIdentity } from "../../src/planning/work-identity";

function installGlobals(): void {
  Object.assign(globalThis, {
    Game: {
      getObjectById: (id: string) =>
        id === "site-1"
          ? {
              id,
              pos: { roomName: "W1N1", x: 20, y: 21 },
              structureType: "extension",
            }
          : null,
    },
  });
}

describe("FSPM work identity", () => {
  beforeEach(() => installGlobals());

  it("derives the same infrastructure key for a live ConstructionSite build intent", () => {
    const intent: BuildIntent = {
      type: "build",
      creepName: "builder-1",
      targetId: "site-1" as Id<ConstructionSite>,
      priority: 100,
      reason: "build planned infrastructure",
      trace: {
        contractId: "contract",
        requirementId: "requirement",
        deliverableId: "deliverable",
        taskId: "task",
        procedureId: "procedure",
      },
    };

    ensureFspmWorkIdentity(intent);

    expect(intent.trace?.workKey).toBe("infrastructure:W1N1:20:21:extension");
  });

  it("does not overwrite a planner-provided work key", () => {
    const intent: BuildIntent = {
      type: "build",
      creepName: "builder-1",
      targetId: "site-1" as Id<ConstructionSite>,
      priority: 100,
      reason: "build planned infrastructure",
      trace: {
        contractId: "contract",
        requirementId: "requirement",
        deliverableId: "deliverable",
        taskId: "task",
        procedureId: "procedure",
        workKey: "predefined",
      },
    };

    ensureFspmWorkIdentity(intent);

    expect(intent.trace?.workKey).toBe("predefined");
  });
});
