import { describe, expect, it } from "vitest";
import type { RoomPlan } from "../../src/planning/room-plan";
import {
  assessMatureLinkTopology,
  deriveMatureLinkRoles,
  planLinkTransfers,
  planMatureBufferLogistics,
} from "../../src/systems/economy/mature-energy";

function roomPlan(
  linkPoints?: Array<{ id: string; x: number; y: number }>,
): RoomPlan {
  const links = linkPoints ?? [
    { id: "link-source-a", x: 11, y: 11 },
    { id: "link-source-b", x: 39, y: 11 },
    { id: "link-controller", x: 36, y: 40 },
    { id: "link-core", x: 27, y: 24 },
    { id: "link-aux-a", x: 25, y: 25 },
    { id: "link-aux-b", x: 29, y: 25 },
  ];
  return {
    version: 4,
    horizonRcl: 8,
    roomName: "W1N1",
    generatedAt: 1,
    generatedReason: "mature energy policy fixture",
    anchors: {
      spawn: { name: "Spawn1", x: 20, y: 25 },
      hub: { x: 27, y: 25 },
      controller: { x: 40, y: 40, service: { x: 37, y: 40 } },
      sources: [
        {
          sourceId: "source-a",
          x: 10,
          y: 10,
          container: { x: 11, y: 10 },
        },
        {
          sourceId: "source-b",
          x: 40,
          y: 10,
          container: { x: 39, y: 10 },
        },
      ],
    },
    reservations: [],
    structures: [
      {
        id: "storage-1",
        x: 27,
        y: 25,
        structureType: "storage",
        minRcl: 4,
        priority: 1,
        activation: "automatic",
        reservation: "hard",
        phase: "core-economy",
        reason: "core",
      },
      ...links.map((link) => ({
        ...link,
        structureType: "link" as const,
        minRcl: 5,
        priority: 1,
        activation: "automatic" as const,
        reservation: "hard" as const,
        phase: "energy-distribution" as const,
        reason: "link",
      })),
    ],
    roads: [],
    roadGraph: { nodes: [], edges: [] },
    defense: { strategy: "pending-mincut", protectedTiles: [], perimeter: [] },
  };
}

describe("mature link topology", () => {
  it("derives exact source, controller, and core roles from serviceable geometry", () => {
    const roles = deriveMatureLinkRoles(roomPlan());

    expect(roles).toEqual({
      sources: [
        { sourceId: "source-a", planId: "link-source-a" },
        { sourceId: "source-b", planId: "link-source-b" },
      ],
      controllerPlanId: "link-controller",
      corePlanId: "link-core",
    });
    expect(assessMatureLinkTopology(roomPlan())).toMatchObject({
      status: "ready",
      roles,
    });
  });

  it("surfaces central legacy links as a topology fault instead of guessing roles", () => {
    const legacy = roomPlan(
      Array.from({ length: 6 }, (_, index) => ({
        id: `legacy-link-${index + 1}`,
        x: 24 + (index % 3),
        y: 23 + Math.floor(index / 3),
      })),
    );

    expect(deriveMatureLinkRoles(legacy)).toBeNull();
    expect(assessMatureLinkTopology(legacy)).toMatchObject({
      status: "fault",
      roles: null,
    });
  });
});

describe("mature link transfer battery", () => {
  it("operates an RCL5 source-to-core route before the controller link exists", () => {
    expect(
      planLinkTransfers([
        {
          id: "source-rcl5",
          planId: "link-source-rcl5",
          role: "source",
          energy: 800,
          capacity: 800,
          cooldown: 0,
        },
        {
          id: "core-rcl5",
          planId: "link-core-rcl5",
          role: "core",
          energy: 0,
          capacity: 800,
          cooldown: 0,
        },
      ]),
    ).toEqual([
      {
        sourceId: "source-rcl5",
        sourcePlanId: "link-source-rcl5",
        targetId: "core-rcl5",
        targetPlanId: "link-core-rcl5",
        targetRole: "core",
        amount: 800,
        usableAmount: 776,
      },
    ]);
  });

  it("operates a source-to-controller route when the core is temporarily unavailable", () => {
    expect(
      planLinkTransfers([
        {
          id: "source-rcl6",
          planId: "link-source-rcl6",
          role: "source",
          energy: 800,
          capacity: 800,
          cooldown: 0,
        },
        {
          id: "controller-rcl6",
          planId: "link-controller-rcl6",
          role: "controller",
          energy: 0,
          capacity: 800,
          cooldown: 0,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        sourceId: "source-rcl6",
        targetId: "controller-rcl6",
        targetRole: "controller",
        amount: 619,
        usableAmount: 600,
      }),
    ]);
  });

  it("treats sink free capacity as post-loss usable energy", () => {
    expect(
      planLinkTransfers([
        {
          id: "source",
          planId: "link-source",
          role: "source",
          energy: 800,
          capacity: 800,
          cooldown: 0,
        },
        {
          id: "core",
          planId: "link-core",
          role: "core",
          energy: 100,
          capacity: 800,
          cooldown: 0,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        sourceId: "source",
        targetId: "core",
        amount: 722,
        usableAmount: 700,
      }),
    ]);
  });

  it("admits the minimum legal debit when exactly 97 usable sink energy remains", () => {
    expect(
      planLinkTransfers([
        {
          id: "source",
          planId: "link-source",
          role: "source",
          energy: 800,
          capacity: 800,
          cooldown: 0,
        },
        {
          id: "core",
          planId: "link-core",
          role: "core",
          energy: 703,
          capacity: 800,
          cooldown: 0,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        sourceId: "source",
        targetId: "core",
        amount: 100,
        usableAmount: 97,
      }),
    ]);
  });

  it("does not spend cooldown when usable sink demand requires a sub-minimum debit", () => {
    expect(
      planLinkTransfers([
        {
          id: "source",
          planId: "link-source",
          role: "source",
          energy: 800,
          capacity: 800,
          cooldown: 0,
        },
        {
          id: "core",
          planId: "link-core",
          role: "core",
          energy: 704,
          capacity: 800,
          cooldown: 0,
        },
      ]),
    ).toEqual([]);
  });

  it("fills the controller reserve first, then the core, without sink overcommit", () => {
    const decisions = planLinkTransfers([
      {
        id: "source-a",
        planId: "link-source-a",
        role: "source",
        energy: 800,
        capacity: 800,
        cooldown: 0,
      },
      {
        id: "source-b",
        planId: "link-source-b",
        role: "source",
        energy: 800,
        capacity: 800,
        cooldown: 0,
      },
      {
        id: "source-cooling",
        planId: "link-source-cooling",
        role: "source",
        energy: 800,
        capacity: 800,
        cooldown: 2,
      },
      {
        id: "controller",
        planId: "link-controller",
        role: "controller",
        energy: 0,
        capacity: 800,
        cooldown: 0,
      },
      {
        id: "core",
        planId: "link-core",
        role: "core",
        energy: 700,
        capacity: 800,
        cooldown: 0,
      },
    ]);

    expect(decisions).toEqual([
      expect.objectContaining({
        sourceId: "source-a",
        targetId: "controller",
        targetRole: "controller",
        amount: 619,
        usableAmount: 600,
      }),
      expect.objectContaining({
        sourceId: "source-b",
        targetId: "core",
        targetRole: "core",
        amount: 104,
        usableAmount: 100,
      }),
    ]);
    expect(
      decisions
        .filter((decision) => decision.targetId === "controller")
        .reduce((sum, decision) => sum + decision.usableAmount, 0),
    ).toBeLessThanOrEqual(600);
    expect(
      decisions
        .filter((decision) => decision.targetId === "core")
        .reduce((sum, decision) => sum + decision.usableAmount, 0),
    ).toBeLessThanOrEqual(100);
    expect(
      decisions.some((decision) => decision.sourceId === "source-cooling"),
    ).toBe(false);
  });

  it("does not spend cooldown on sub-threshold fragments", () => {
    expect(
      planLinkTransfers([
        {
          id: "source",
          planId: "source-plan",
          role: "source",
          energy: 99,
          capacity: 800,
          cooldown: 0,
        },
        {
          id: "controller",
          planId: "controller-plan",
          role: "controller",
          energy: 0,
          capacity: 800,
          cooldown: 0,
        },
        {
          id: "core",
          planId: "core-plan",
          role: "core",
          energy: 0,
          capacity: 800,
          cooldown: 0,
        },
      ]),
    ).toEqual([]);
  });
});

describe("mature creep-buffer policy", () => {
  it("reserves projected withdrawals to critical demand and never assigns a WORK creep", () => {
    const decisions = planMatureBufferLogistics({
      underAttack: false,
      criticalEnergyDemand: 300,
      reservedCriticalDelivery: 0,
      creeps: [
        {
          name: "builder",
          x: 10,
          y: 10,
          energy: 0,
          capacity: 200,
          workParts: 2,
          carryParts: 4,
        },
        {
          name: "hauler-a",
          x: 11,
          y: 10,
          energy: 0,
          capacity: 200,
          workParts: 0,
          carryParts: 4,
        },
        {
          name: "hauler-b",
          x: 12,
          y: 10,
          energy: 0,
          capacity: 200,
          workParts: 0,
          carryParts: 4,
        },
      ],
      buffers: [
        {
          id: "storage",
          kind: "storage",
          x: 10,
          y: 10,
          energy: 1_000,
          capacity: 2_000,
        },
      ],
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        type: "withdraw",
        creepName: "hauler-a",
        amount: 200,
      }),
      expect.objectContaining({
        type: "withdraw",
        creepName: "hauler-b",
        amount: 100,
      }),
    ]);
    expect(decisions.reduce((sum, decision) => sum + decision.amount, 0)).toBe(
      300,
    );
  });

  it("deposits only pure-hauler surplus after spawn and tower demand is satisfied", () => {
    const decisions = planMatureBufferLogistics({
      underAttack: false,
      criticalEnergyDemand: 0,
      reservedCriticalDelivery: 0,
      creeps: [
        {
          name: "builder",
          x: 10,
          y: 10,
          energy: 200,
          capacity: 200,
          workParts: 2,
          carryParts: 4,
        },
        {
          name: "hauler",
          x: 11,
          y: 10,
          energy: 200,
          capacity: 200,
          workParts: 0,
          carryParts: 4,
        },
      ],
      buffers: [
        {
          id: "storage",
          kind: "storage",
          x: 10,
          y: 10,
          energy: 0,
          capacity: 2_000,
        },
        {
          id: "terminal",
          kind: "terminal",
          x: 12,
          y: 10,
          energy: 0,
          capacity: 2_000,
        },
      ],
    });

    expect(decisions).toEqual([
      {
        type: "deposit",
        creepName: "hauler",
        bufferId: "storage",
        bufferKind: "storage",
        amount: 200,
      },
    ]);
  });

  it("opens the smaller defense reserve only during a visible threat", () => {
    const input = {
      criticalEnergyDemand: 500,
      reservedCriticalDelivery: 0,
      creeps: [
        {
          name: "hauler",
          x: 10,
          y: 10,
          energy: 0,
          capacity: 500,
          workParts: 0,
          carryParts: 10,
        },
      ],
      buffers: [
        {
          id: "storage",
          kind: "storage" as const,
          x: 10,
          y: 10,
          energy: 10_000,
          capacity: 1_000_000,
        },
      ],
    };

    expect(planMatureBufferLogistics({ ...input, underAttack: false })).toEqual(
      [],
    );
    expect(planMatureBufferLogistics({ ...input, underAttack: true })).toEqual([
      expect.objectContaining({ type: "withdraw", amount: 500 }),
    ]);
  });
});
