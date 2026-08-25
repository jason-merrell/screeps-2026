import { describe, expect, it } from "vitest";
import { shouldDeferRoutineBootstrapRepair } from "../../src/systems/economy/plan";

describe("RCL1 bootstrap repair policy", () => {
  it("defers routine road and container repair at RCL1", () => {
    expect(shouldDeferRoutineBootstrapRepair(1, "road")).toBe(true);
    expect(shouldDeferRoutineBootstrapRepair(1, "container")).toBe(true);
  });

  it("keeps critical structures repairable at RCL1", () => {
    expect(shouldDeferRoutineBootstrapRepair(1, "spawn")).toBe(false);
    expect(shouldDeferRoutineBootstrapRepair(1, "rampart")).toBe(false);
  });

  it("restores routine maintenance from RCL2 onward", () => {
    expect(shouldDeferRoutineBootstrapRepair(2, "road")).toBe(false);
    expect(shouldDeferRoutineBootstrapRepair(3, "container")).toBe(false);
  });
});
