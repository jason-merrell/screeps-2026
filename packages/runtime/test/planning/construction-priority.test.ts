import { describe, expect, it } from "vitest";
import {
  compareConstructionTargets,
  plannedConstructionPriority,
} from "../../src/planning/construction-priority";
import type { RoomPlan } from "../../src/planning/room-plan";

const plan: RoomPlan = {
  version: 3,
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
      id: "tower-1",
      x: 30,
      y: 30,
      structureType: "tower",
      minRcl: 3,
      priority: 1200,
      activation: "automatic",
      reservation: "hard",
      phase: "bootstrap-defense",
      reason: "test",
    },
    {
      id: "extension-1",
      x: 24,
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
      id: "source-container-1",
      x: 15,
      y: 25,
      structureType: "container",
      minRcl: 2,
      priority: 700,
      activation: "demand",
      reservation: "hard",
      phase: "source-logistics",
      reason: "test",
    },
    {
      id: "perimeter-rampart-1",
      x: 40,
      y: 40,
      structureType: "rampart",
      minRcl: 4,
      priority: 600,
      activation: "defense",
      reservation: "hard",
      phase: "defense-envelope",
      reason: "close the defensive cut",
      strategicWeight: 4,
    },
  ],
  roads: [
    {
      id: "road-26-25",
      x: 26,
      y: 25,
      minRcl: 2,
      activation: "demand",
      phase: "strategic-roads",
      reason: "test",
    },
  ],
  roadGraph: {
    nodes: [],
    edges: [
      {
        id: "spawn->hub",
        from: "spawn",
        to: "hub",
        tiles: [{ x: 26, y: 25 }],
      },
    ],
  },
  defense: {
    strategy: "terrain-mincut-v1",
    protectedTiles: [{ x: 25, y: 25 }],
    perimeter: [{ x: 40, y: 40 }],
  },
};

describe("construction priority", () => {
  it("preserves room-plan value ahead of proximity", () => {
    const ranked = [
      { id: "near-road", x: 26, y: 25, structureType: "road" as const, range: 1 },
      { id: "far-tower", x: 30, y: 30, structureType: "tower" as const, range: 12 },
      { id: "extension", x: 24, y: 24, structureType: "extension" as const, range: 5 },
      { id: "container", x: 15, y: 25, structureType: "container" as const, range: 3 },
      { id: "adaptive-road", x: 20, y: 20, structureType: "road" as const, range: 0 },
    ].sort((left, right) => compareConstructionTargets(plan, left, right));

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      "far-tower",
      "extension",
      "container",
      "near-road",
      "adaptive-road",
    ]);
  });

  it("uses distance only after plan priorities tie", () => {
    const localPlan: RoomPlan = {
      ...plan,
      structures: [
        ...plan.structures,
        {
          id: "extension-2",
          x: 23,
          y: 23,
          structureType: "extension",
          minRcl: 2,
          priority: 1000,
          activation: "automatic",
          reservation: "hard",
          phase: "bootstrap-capacity",
          reason: "test",
        },
      ],
    };
    const farther = {
      id: "extension-far",
      x: 24,
      y: 24,
      structureType: "extension" as const,
      range: 6,
    };
    const nearer = {
      id: "extension-near",
      x: 23,
      y: 23,
      structureType: "extension" as const,
      range: 2,
    };

    expect(compareConstructionTargets(localPlan, farther, nearer)).toBeGreaterThan(0);
    expect(plannedConstructionPriority(localPlan, farther)).toBe(1000);
    expect(plannedConstructionPriority(localPlan, nearer)).toBe(1000);
  });

  it("closes a far perimeter breach before nearby high-priority growth during an attack", () => {
    const perimeter = {
      id: "far-perimeter",
      x: 40,
      y: 40,
      structureType: "rampart" as const,
      range: 30,
    };
    const extension = {
      id: "near-extension",
      x: 24,
      y: 24,
      structureType: "extension" as const,
      range: 1,
    };
    const tower = {
      id: "far-tower",
      x: 30,
      y: 30,
      structureType: "tower" as const,
      range: 12,
    };

    const ranked = [extension, tower, perimeter].sort((left, right) =>
      compareConstructionTargets(plan, left, right, { underAttack: true }),
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      "far-perimeter",
      "far-tower",
      "near-extension",
    ]);
  });
});
