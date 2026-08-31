import { describe, expect, it } from "vitest";
import {
  logisticsCoverage,
  requiredCarryParts,
  reserveTransportCapacity,
  shouldActivateSourceBuffers,
} from "../../src/systems/economy/logistics";

describe("source buffer logistics", () => {
  it("waits for RCL2 and a stable workforce before activating source buffers", () => {
    expect(shouldActivateSourceBuffers(1, 6, 2)).toBe(false);
    expect(shouldActivateSourceBuffers(2, 3, 2)).toBe(false);
    expect(shouldActivateSourceBuffers(2, 4, 2)).toBe(true);
  });

  it("sizes carry throughput from source production and round-trip distance", () => {
    expect(requiredCarryParts(10)).toBe(4);
    expect(requiredCarryParts(20)).toBe(8);
    expect(requiredCarryParts(0)).toBe(0);
  });

  it("reports bounded transport coverage", () => {
    expect(logisticsCoverage(8, 4)).toBe(0.5);
    expect(logisticsCoverage(8, 12)).toBe(1);
    expect(logisticsCoverage(0, 0)).toBe(1);
  });

  it("reserves only enough nearby transport capacity for each source", () => {
    const reservations = reserveTransportCapacity(
      [
        { id: "source-a", requiredCarry: 4 },
        { id: "source-b", requiredCarry: 2 },
      ],
      [
        {
          name: "alpha",
          carry: 4,
          rangeByNode: { "source-a": 2, "source-b": 8 },
        },
        {
          name: "bravo",
          carry: 4,
          rangeByNode: { "source-a": 7, "source-b": 1 },
        },
        {
          name: "surplus",
          carry: 8,
          rangeByNode: { "source-a": 3, "source-b": 3 },
        },
      ],
    );

    expect(reservations.get("alpha")).toBe("source-a");
    expect(reservations.get("bravo")).toBe("source-b");
    expect(reservations.has("surplus")).toBe(false);
  });

  it("globally assigns indivisible bodies without manufacturing route debt", () => {
    const candidates = [
      { name: "nine", carry: 9, rangeByNode: { a: 1, b: 9 } },
      { name: "five-a", carry: 5, rangeByNode: { a: 2, b: 1 } },
      { name: "five-b", carry: 5, rangeByNode: { a: 3, b: 2 } },
    ];
    const expected = {
      "five-a": "a",
      "five-b": "a",
      nine: "b",
    };

    for (const nodes of [
      [
        { id: "a", requiredCarry: 10 },
        { id: "b", requiredCarry: 9 },
      ],
      [
        { id: "b", requiredCarry: 9 },
        { id: "a", requiredCarry: 10 },
      ],
    ]) {
      expect(
        Object.fromEntries(reserveTransportCapacity(nodes, candidates)),
      ).toEqual(expected);
      expect(
        Object.fromEntries(
          reserveTransportCapacity(nodes, [...candidates].reverse()),
        ),
      ).toEqual(expected);
    }
  });

  it("keeps a large exact body for the large source regardless of proximity", () => {
    const reservations = reserveTransportCapacity(
      [
        { id: "small", requiredCarry: 1 },
        { id: "large", requiredCarry: 33 },
      ],
      [
        {
          name: "large-near-small",
          carry: 33,
          rangeByNode: { small: 1, large: 9 },
        },
        {
          name: "small-near-large",
          carry: 1,
          rangeByNode: { small: 9, large: 1 },
        },
      ],
    );

    expect(Object.fromEntries(reservations)).toEqual({
      "large-near-small": "large",
      "small-near-large": "small",
    });
  });

  it("fails closed when duplicate candidate identities could double-count carry", () => {
    const reservations = reserveTransportCapacity(
      [{ id: "source", requiredCarry: 8 }],
      [
        { name: "duplicate", carry: 4, rangeByNode: { source: 1 } },
        { name: "duplicate", carry: 4, rangeByNode: { source: 2 } },
        { name: "unique", carry: 3, rangeByNode: { source: 3 } },
      ],
    );

    expect(Object.fromEntries(reservations)).toEqual({ unique: "source" });
  });
});
