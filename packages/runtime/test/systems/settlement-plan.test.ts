import { describe, expect, it } from "vitest";
import { ROOM_PLAN_VERSION, type RoomPlan } from "../../src/planning/room-plan";
import { eligiblePlannedStructures } from "../../src/systems/construction/plan";
import { shouldRegenerateRoomPlan } from "../../src/systems/settlement/plan";
import {
  RAPID_FILL_EXTENSION_OFFSETS,
  RAPID_FILL_ROAD_OFFSETS,
} from "../../src/systems/settlement/stamps";

const key = (point: { x: number; y: number }): string => `${point.x}:${point.y}`;

const basePlan = (): RoomPlan => ({
  version: ROOM_PLAN_VERSION,
  horizonRcl: 3,
  roomName: "W1N1",
  generatedAt: 100,
  generatedReason: "test",
  anchors: {
    spawn: { name: "Spawn1", x: 25, y: 25 },
    hub: { x: 27, y: 25 },
    controller: null,
    sources: [],
  },
  reservations: [],
  structures: [
    {
      id: "rcl2-extension",
      x: 23,
      y: 24,
      structureType: "extension",
      minRcl: 2,
      priority: 1000,
      activation: "automatic",
      reservation: "hard",
      phase: "bootstrap-capacity",
      reason: "test",
    },
    {
      id: "rcl3-tower",
      x: 27,
      y: 27,
      structureType: "tower",
      minRcl: 3,
      priority: 1200,
      activation: "automatic",
      reservation: "hard",
      phase: "bootstrap-defense",
      reason: "test",
    },
    {
      id: "demand-container",
      x: 10,
      y: 10,
      structureType: "container",
      minRcl: 2,
      priority: 2000,
      activation: "demand",
      reservation: "hard",
      phase: "source-logistics",
      reason: "test",
    },
  ],
  roads: [],
  roadGraph: { nodes: [], edges: [] },
  defense: { strategy: "pending-mincut", protectedTiles: [], perimeter: [] },
});

describe("settlement planning foundation", () => {
  it("keeps the rapid-fill extension stamp unique and off its preferred road lanes", () => {
    const extensionKeys = new Set(RAPID_FILL_EXTENSION_OFFSETS.map(key));
    const roadKeys = new Set(RAPID_FILL_ROAD_OFFSETS.map(key));

    expect(extensionKeys.size).toBe(10);
    expect(roadKeys.size).toBe(RAPID_FILL_ROAD_OFFSETS.length);
    expect([...extensionKeys].some((value) => roadKeys.has(value))).toBe(false);
  });

  it("builds only automatic structures unlocked by the current RCL", () => {
    const plan = basePlan();

    expect(eligiblePlannedStructures(plan, 2).map((entry) => entry.id)).toEqual([
      "rcl2-extension",
    ]);
    expect(eligiblePlannedStructures(plan, 3).map((entry) => entry.id)).toEqual([
      "rcl3-tower",
      "rcl2-extension",
    ]);
  });

  it("reuses stable plans and regenerates only explicit invalidation or version changes", () => {
    const stable = basePlan();
    expect(shouldRegenerateRoomPlan(stable)).toBe(false);

    const invalidated = { ...stable, invalidatedAt: 101, invalidationReason: "test" };
    expect(shouldRegenerateRoomPlan(invalidated)).toBe(true);

    const oldVersion = { ...stable, version: ROOM_PLAN_VERSION - 1 };
    expect(shouldRegenerateRoomPlan(oldVersion)).toBe(true);
    expect(shouldRegenerateRoomPlan(undefined)).toBe(true);
  });
});
