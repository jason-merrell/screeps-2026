import { describe, expect, it } from "vitest";
import { arbitrateDetailed } from "../../src/intents/arbitrate";
import type { Intent } from "../../src/intents/types";

describe("arbitrateDetailed", () => {
  it("reports the final winner and rejected competing intent", () => {
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

    const result = arbitrateDetailed(intents);

    expect(result.accepted.map((intent) => intent.type)).toEqual(["spawn", "upgrade"]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      conflictKey: "creep:worker-1",
      winner: { type: "upgrade", priority: 20 },
      loser: { type: "harvest", priority: 10 },
    });
  });
});
