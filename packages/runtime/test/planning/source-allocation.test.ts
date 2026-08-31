import { describe, expect, it } from "vitest";
import { assignSourceProducers } from "../../src/systems/economy/source-allocation";

describe("producer source allocation", () => {
  it("preserves governed source affinity even when current distance ranking flips", () => {
    const assignments = assignSourceProducers(
      ["source-a", "source-b"],
      [
        {
          name: "producer-a",
          work: 5,
          preferredSourceId: "source-a",
          rangeBySource: { "source-a": 9, "source-b": 1 },
        },
        {
          name: "producer-b",
          work: 5,
          preferredSourceId: "source-b",
          rangeBySource: { "source-a": 1, "source-b": 9 },
        },
      ],
    );

    expect(Object.fromEntries(assignments)).toEqual({
      "producer-a": "source-a",
      "producer-b": "source-b",
    });
  });

  it("rebalances deterministically when the preferred source is no longer valid", () => {
    const assignments = assignSourceProducers(
      ["source-a", "source-b"],
      [
        {
          name: "producer-a",
          work: 5,
          preferredSourceId: "missing-source",
          rangeBySource: { "source-a": 4, "source-b": 1 },
        },
        {
          name: "producer-b",
          work: 4,
          rangeBySource: { "source-a": 1, "source-b": 4 },
        },
      ],
    );

    expect(Object.fromEntries(assignments)).toEqual({
      "producer-a": "source-a",
      "producer-b": "source-b",
    });
  });

  it("resolves conflicting incumbents by work, range, then stable name", () => {
    const assignments = assignSourceProducers(
      ["source-a", "source-b"],
      [
        {
          name: "producer-a",
          work: 4,
          preferredSourceId: "source-a",
          rangeBySource: { "source-a": 1, "source-b": 8 },
        },
        {
          name: "producer-b",
          work: 5,
          preferredSourceId: "source-a",
          rangeBySource: { "source-a": 6, "source-b": 2 },
        },
      ],
    );

    expect(Object.fromEntries(assignments)).toEqual({
      "producer-b": "source-a",
      "producer-a": "source-b",
    });
  });

  it("retains the existing deterministic work/range policy when no affinity exists", () => {
    const assignments = assignSourceProducers(
      ["source-a", "source-b"],
      [
        {
          name: "producer-a",
          work: 4,
          rangeBySource: { "source-a": 1, "source-b": 2 },
        },
        {
          name: "producer-b",
          work: 5,
          rangeBySource: { "source-a": 9, "source-b": 1 },
        },
      ],
    );

    expect(Object.fromEntries(assignments)).toEqual({
      "producer-b": "source-a",
      "producer-a": "source-b",
    });
  });

  it("lets an exact specialist replace an overqualified incumbent", () => {
    const assignments = assignSourceProducers(
      ["source-a"],
      [
        {
          name: "generalist-incumbent",
          surplusParts: 15,
          work: 9,
          preferredSourceId: "source-a",
          rangeBySource: { "source-a": 1 },
        },
        {
          name: "producer-exact",
          surplusParts: 0,
          work: 6,
          rangeBySource: { "source-a": 9 },
        },
      ],
    );

    expect(Object.fromEntries(assignments)).toEqual({
      "producer-exact": "source-a",
    });
  });
});
