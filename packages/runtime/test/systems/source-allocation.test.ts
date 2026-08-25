import { describe, expect, it } from "vitest";
import { assignRecoveryHarvesters } from "../../src/systems/economy/source-allocation";

describe("recovery source allocation", () => {
  it("spreads overflow harvesting across under-covered sources", () => {
    const assignments = assignRecoveryHarvesters(
      [
        { id: "source-a", assignedWork: 4 },
        { id: "source-b", assignedWork: 4 },
      ],
      [
        { name: "alpha", work: 1, rangeBySource: { "source-a": 1, "source-b": 8 } },
        { name: "bravo", work: 1, rangeBySource: { "source-a": 2, "source-b": 3 } },
        { name: "charlie", work: 1, rangeBySource: { "source-a": 1, "source-b": 2 } },
      ],
    );

    expect(assignments.get("alpha")).toBe("source-a");
    expect(assignments.get("bravo")).toBe("source-b");
    expect(assignments.has("charlie")).toBe(false);
  });

  it("does not supplement a source whose producer work already covers demand", () => {
    const assignments = assignRecoveryHarvesters(
      [
        { id: "source-a", assignedWork: 5 },
        { id: "source-b", assignedWork: 3 },
      ],
      [{ name: "alpha", work: 1, rangeBySource: { "source-a": 1, "source-b": 5 } }],
    );

    expect(assignments.get("alpha")).toBe("source-b");
  });
});
