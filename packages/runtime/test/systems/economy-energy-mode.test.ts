import { describe, expect, it } from "vitest";
import {
  resolveEnergyMode,
  sourceBufferLogisticsActive,
} from "../../src/systems/economy/plan";

describe("economy energy mode", () => {
  it("collects from empty until capacity is reached", () => {
    expect(resolveEnergyMode(undefined, 0, 50)).toBe("collect");
    expect(resolveEnergyMode("collect", 2, 50)).toBe("collect");
    expect(resolveEnergyMode("collect", 49, 50)).toBe("collect");
    expect(resolveEnergyMode("collect", 50, 50)).toBe("deliver");
  });

  it("continues delivering through partial unloads until empty", () => {
    expect(resolveEnergyMode("deliver", 50, 50)).toBe("deliver");
    expect(resolveEnergyMode("deliver", 48, 50)).toBe("deliver");
    expect(resolveEnergyMode("deliver", 2, 50)).toBe("deliver");
    expect(resolveEnergyMode("deliver", 0, 50)).toBe("collect");
  });

  it("defaults partially loaded legacy creeps to collection", () => {
    expect(resolveEnergyMode(undefined, 25, 50)).toBe("collect");
  });

  it("ignores stale source buffers until the colony is ready for specialization", () => {
    expect(sourceBufferLogisticsActive(1, 6, 2)).toBe(false);
    expect(sourceBufferLogisticsActive(2, 3, 2)).toBe(false);
    expect(sourceBufferLogisticsActive(2, 4, 2)).toBe(true);
  });
});
