import { describe, expect, it } from "vitest";
import { infrastructureRepairThreshold } from "../../src/systems/economy/repair-policy";
import {
  energyDeliveryServiceOrder,
  infrastructureWorkServiceOrder,
  selectInfrastructureRepairTarget,
  shouldDeferRoutineBootstrapRepair,
} from "../../src/systems/economy/plan";

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

describe("mature infrastructure repair policy", () => {
  it("funds towers and repairs before growth work during an active threat", () => {
    expect(energyDeliveryServiceOrder(true)).toEqual(["tower", "reproduction"]);
    expect(infrastructureWorkServiceOrder(true)).toEqual(["repair", "build"]);
    expect(energyDeliveryServiceOrder(false)).toEqual([
      "reproduction",
      "tower",
    ]);
    expect(infrastructureWorkServiceOrder(false)).toEqual(["build", "repair"]);
  });

  it("repairs a failing planned rampart before a nearby road or strategic asset under attack", () => {
    const structure = (
      id: string,
      structureType: StructureConstant,
      x: number,
      y: number,
      hits: number,
      hitsMax: number,
      my = true,
    ) =>
      ({
        id,
        structureType,
        my,
        hits,
        hitsMax,
        pos: { x, y },
      }) as unknown as AnyStructure;
    const rampart = structure("rampart", "rampart", 20, 20, 1, 10_000_000);
    const spawn = structure("spawn", "spawn", 11, 10, 1_000, 5_000);
    const road = structure("road", "road", 10, 11, 499, 1_000, false);
    const hostileTower = structure(
      "hostile-tower",
      "tower",
      10,
      10,
      1,
      3_000,
      false,
    );
    const context = {
      controllerLevel: 8,
      underAttack: true,
      perimeter: [{ x: 20, y: 20 }],
      hostiles: [{ pos: { x: 21, y: 20 } }],
      origin: { x: 10, y: 10 },
    } as const;

    expect(
      selectInfrastructureRepairTarget(
        [road, hostileTower, spawn, rampart],
        context,
      ),
    ).toBe(rampart);

    rampart.hits = 10_000_000;
    expect(
      selectInfrastructureRepairTarget(
        [road, hostileTower, spawn, rampart],
        context,
      ),
    ).toBe(spawn);
  });

  it("raises the peacetime rampart target with controller capability", () => {
    expect(infrastructureRepairThreshold("rampart", 10_000_000, 3)).toBe(
      10_000,
    );
    expect(infrastructureRepairThreshold("rampart", 10_000_000, 8)).toBe(
      5_000_000,
    );
    expect(infrastructureRepairThreshold("rampart", 10_000_000, 8, true)).toBe(
      10_000_000,
    );
  });

  it.each([
    "spawn",
    "storage",
    "terminal",
    "link",
    "lab",
    "factory",
    "observer",
    "powerSpawn",
    "nuker",
    "extractor",
  ] as StructureConstant[])(
    "maintains critical %s infrastructure to 75%%",
    (structureType) => {
      expect(infrastructureRepairThreshold(structureType, 1_000_000, 8)).toBe(
        750_000,
      );
    },
  );

  it("keeps roads and containers on an economical 50% threshold", () => {
    expect(infrastructureRepairThreshold("road", 5_000, 8)).toBe(2_500);
    expect(infrastructureRepairThreshold("container", 250_000, 8)).toBe(
      125_000,
    );
  });

  it("ignores structures outside the governed maintenance envelope", () => {
    expect(infrastructureRepairThreshold("constructedWall", 1_000_000, 8)).toBe(
      0,
    );
  });
});
