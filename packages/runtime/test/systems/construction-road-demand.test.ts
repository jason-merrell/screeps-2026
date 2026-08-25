import { describe, expect, it } from "vitest";
import { shouldActivateStrategicRoads } from "../../src/systems/construction/plan";

describe("strategic road demand", () => {
  it("keeps roads dormant before RCL2", () => {
    expect(shouldActivateStrategicRoads(1, 6)).toBe(false);
  });

  it("keeps roads dormant before a stable bootstrap workforce exists", () => {
    expect(shouldActivateStrategicRoads(2, 2)).toBe(false);
  });

  it("activates planned corridors once RCL2 logistics demand is real", () => {
    expect(shouldActivateStrategicRoads(2, 3)).toBe(true);
    expect(shouldActivateStrategicRoads(3, 5)).toBe(true);
  });
});
