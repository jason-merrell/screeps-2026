import { describe, expect, it } from "vitest";
import {
  RCL8_DOWNGRADE_MAINTENANCE_THRESHOLD,
  controllerMaintenanceSatisfied,
  controllerSpendMode,
  selectControllerMaintenanceAssignee,
} from "../../src/planning/controller-policy";

describe("controller spend policy", () => {
  it("keeps normal room progression active below RCL8", () => {
    expect(controllerSpendMode(1, 19_000)).toBe("progress");
    expect(controllerSpendMode(7, 149_000)).toBe("progress");
  });

  it("does not use a healthy RCL8 controller as an implicit surplus-energy sink", () => {
    expect(controllerSpendMode(8, 200_000)).toBe("none");
    expect(controllerSpendMode(8, RCL8_DOWNGRADE_MAINTENANCE_THRESHOLD)).toBe("none");
  });

  it("activates bounded downgrade maintenance only below the governed RCL8 threshold", () => {
    expect(controllerSpendMode(8, RCL8_DOWNGRADE_MAINTENANCE_THRESHOLD - 1)).toBe(
      "maintenance",
    );
  });

  it("fails closed when capped-room downgrade evidence is unavailable", () => {
    expect(controllerSpendMode(8, undefined)).toBe("none");
    expect(controllerSpendMode(undefined, undefined)).toBe("none");
  });

  it("selects one minimal-capacity maintenance performer deterministically", () => {
    expect(
      selectControllerMaintenanceAssignee([
        { name: "worker-c", work: 3, energy: 50, range: 1 },
        { name: "worker-b", work: 1, energy: 50, range: 8 },
        { name: "worker-a", work: 1, energy: 50, range: 8 },
        { name: "empty", work: 1, energy: 0, range: 1 },
      ]),
    ).toBe("worker-a");
  });

  it("completes maintenance from the controller safety outcome, not creep carry state", () => {
    const controller = {
      level: 8,
      ticksToDowngrade: RCL8_DOWNGRADE_MAINTENANCE_THRESHOLD - 1,
    } as StructureController;

    expect(controllerMaintenanceSatisfied(controller)).toBe(false);
    controller.ticksToDowngrade = RCL8_DOWNGRADE_MAINTENANCE_THRESHOLD;
    expect(controllerMaintenanceSatisfied(controller)).toBe(true);
  });
});
