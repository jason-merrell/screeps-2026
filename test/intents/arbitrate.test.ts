import { describe, expect, it } from "vitest";
import { arbitrate } from "../../src/intents/arbitrate";
import type { Intent } from "../../src/intents/types";

describe("arbitrate", () => {
  it("keeps the highest-priority intent for each actor", () => {
    const intents: Intent[] = [
      {
        type: "harvest",
        creepName: "worker-1",
        sourceId: "source" as Id<Source>,
        priority: 10,
        reason: "low priority",
      },
      {
        type: "upgrade",
        creepName: "worker-1",
        controllerId: "controller" as Id<StructureController>,
        priority: 20,
        reason: "higher priority",
      },
      {
        type: "spawn",
        spawnName: "Spawn1",
        body: [],
        name: "worker-2",
        priority: 100,
        reason: "bootstrap",
      },
    ];

    expect(arbitrate(intents).map((intent) => intent.type)).toEqual(["spawn", "upgrade"]);
  });
});
