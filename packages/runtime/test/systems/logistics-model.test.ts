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
        { name: "alpha", carry: 4, rangeByNode: { "source-a": 2, "source-b": 8 } },
        { name: "bravo", carry: 4, rangeByNode: { "source-a": 7, "source-b": 1 } },
        { name: "surplus", carry: 8, rangeByNode: { "source-a": 3, "source-b": 3 } },
      ],
    );

    expect(reservations.get("alpha")).toBe("source-a");
    expect(reservations.get("bravo")).toBe("source-b");
    expect(reservations.has("surplus")).toBe(false);
  });
});
