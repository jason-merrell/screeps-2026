import { describe, expect, it } from "vitest";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomPlan,
} from "../../src/planning/room-plan";
import {
  advanceRoomPlanProjection,
  hasRoomPlanProjectionEpoch,
  migrateRoomPlanProjection,
  recordSettlementProjectionFault,
  roomPlanProjectionFingerprint,
  roomPlanProjectionMatches,
  settlementRetryDue,
  supersedeSettlementProjectionFault,
  usableRoomPlanProjection,
} from "../../src/planning/room-plan-projection";
import { normalizeRoomPlanProjection } from "../../src/systems/settlement/normalize";
import { canonicalRoomPlanInventoryFixture } from "../fixtures/current-room-plan";

function plan(): RoomPlan {
  return canonicalRoomPlanInventoryFixture({
    planId: "plan:W1N1:construction:room-plan:v4",
    deliverableId: "deliverable:W1N1:construction",
    version: 4,
    horizonRcl: 8,
    roomName: "W1N1",
    generatedAt: 100,
    generatedReason: "fixture",
    stages: ROOM_DEVELOPMENT_STAGES.map((stage) => ({
      ...stage,
      prerequisiteStageIds: [...stage.prerequisiteStageIds],
    })),
    anchors: {
      spawn: { name: "Spawn1", x: 25, y: 25 },
      hub: { x: 26, y: 25 },
      controller: null,
      sources: [],
    },
    reservations: [],
    structures: [
      {
        id: "spawn-1",
        x: 25,
        y: 25,
        structureType: "spawn",
        minRcl: 1,
        priority: 2_000,
        activation: "automatic",
        reservation: "hard",
        phase: "bootstrap-capacity",
        reason: "founding spawn",
        stage: "bootstrap",
        strategicWeight: 20,
        requiredForStage: true,
      },
      {
        id: "container-1",
        x: 26,
        y: 25,
        structureType: "container",
        minRcl: 2,
        priority: 1_900,
        activation: "automatic",
        reservation: "hard",
        phase: "source-logistics",
        reason: "source buffer",
        stage: "logistics",
        strategicWeight: 20,
        requiredForStage: true,
      },
      {
        id: "storage-1",
        x: 27,
        y: 25,
        structureType: "storage",
        minRcl: 4,
        priority: 1_800,
        activation: "automatic",
        reservation: "hard",
        phase: "core-economy",
        reason: "core storage",
        stage: "core-economy",
        strategicWeight: 20,
        requiredForStage: true,
      },
      {
        id: "terminal-1",
        x: 28,
        y: 25,
        structureType: "terminal",
        minRcl: 6,
        priority: 1_700,
        activation: "automatic",
        reservation: "hard",
        phase: "advanced-operations",
        reason: "terminal",
        stage: "advanced-operations",
        strategicWeight: 20,
        requiredForStage: true,
      },
      {
        id: "factory-1",
        x: 29,
        y: 25,
        structureType: "factory",
        minRcl: 7,
        priority: 1_600,
        activation: "automatic",
        reservation: "hard",
        phase: "advanced-operations",
        reason: "factory",
        stage: "advanced-operations",
        strategicWeight: 20,
        requiredForStage: true,
      },
    ],
    roads: [],
    roadGraph: { nodes: [], edges: [] },
    defense: {
      strategy: "terrain-mincut-v1",
      protectedTiles: [{ x: 25, y: 25 }],
      perimeter: [{ x: 24, y: 25 }],
    },
  });
}

describe("room-plan projection epochs", () => {
  it("fingerprints material content without coupling to generation or authority metadata", () => {
    const original = plan();
    const sameContent = {
      ...original,
      planId: "plan:replacement-local-id",
      deliverableId: "deliverable:replacement-trace-link",
      generatedAt: 999,
      generatedReason: "manual regeneration",
      invalidatedAt: 998,
      invalidationReason: "test",
    };
    const changedGeometry = {
      ...original,
      anchors: { ...original.anchors, hub: { x: 27, y: 25 } },
    };

    expect(roomPlanProjectionFingerprint(sameContent)).toBe(
      roomPlanProjectionFingerprint(original),
    );
    expect(roomPlanProjectionFingerprint(changedGeometry)).not.toBe(
      roomPlanProjectionFingerprint(original),
    );
  });

  it("migrates a legacy projection and advances monotonically across replacements", () => {
    const migrated = migrateRoomPlanProjection(plan());
    const sameGeometryReplacement = advanceRoomPlanProjection(
      { ...plan(), generatedAt: 200 },
      migrated,
    );
    const changedGeometryReplacement = advanceRoomPlanProjection(
      {
        ...plan(),
        anchors: { ...plan().anchors, hub: { x: 27, y: 25 } },
      },
      sameGeometryReplacement,
    );

    expect(migrated.projectionRevision).toBe(1);
    expect(migrated.plannerRevision).toBe(1);
    expect(hasRoomPlanProjectionEpoch(migrated)).toBe(true);
    expect(roomPlanProjectionMatches(migrated)).toBe(true);
    expect(sameGeometryReplacement).toMatchObject({
      projectionRevision: 2,
      projectionFingerprint: migrated.projectionFingerprint,
    });
    expect(changedGeometryReplacement.projectionRevision).toBe(3);
    expect(changedGeometryReplacement.projectionFingerprint).not.toBe(
      sameGeometryReplacement.projectionFingerprint,
    );
  });

  it("bounds failure evidence, backs off attempts, and records recovery", () => {
    const retained = migrateRoomPlanProjection(plan());
    const first = recordSettlementProjectionFault(
      undefined,
      retained,
      100,
      new Error(`  impossible\ngeometry ${"x".repeat(400)}`),
    );
    const second = recordSettlementProjectionFault(
      first,
      retained,
      first.nextRetryTick ?? 0,
      new Error("still blocked"),
    );

    expect(first).toMatchObject({
      status: "active",
      firstTick: 100,
      lastTick: 100,
      attemptCount: 1,
      retryDelayTicks: 5,
      nextRetryTick: 105,
      retainedProjectionRevision: 1,
      retainedProjectionFingerprint: retained.projectionFingerprint,
      retainedPlannerRevision: 1,
      targetPlannerRevision: 1,
    });
    expect(first.reason.length).toBeLessThanOrEqual(180);
    expect(first.reason).not.toContain("\n");
    expect(settlementRetryDue(first, 104)).toBe(false);
    expect(settlementRetryDue(first, 105)).toBe(true);
    expect(second).toMatchObject({
      firstTick: 100,
      lastTick: 105,
      attemptCount: 2,
      retryDelayTicks: 10,
      nextRetryTick: 115,
    });

    const replacement = advanceRoomPlanProjection(plan(), retained);
    expect(
      supersedeSettlementProjectionFault(second, replacement, 115),
    ).toMatchObject({
      status: "superseded",
      resolvedAtTick: 115,
      nextRetryTick: null,
      supersededByRevision: 2,
      supersededByFingerprint: replacement.projectionFingerprint,
    });
  });

  it("is the single fail-closed authority gate for every retained projection state", () => {
    const current = migrateRoomPlanProjection(plan());
    const stalePlanner = {
      ...current,
      plannerRevision: 0,
    };
    stalePlanner.projectionFingerprint =
      roomPlanProjectionFingerprint(stalePlanner);
    const oldHorizon = {
      ...current,
      version: 3,
      horizonRcl: 3,
    };
    oldHorizon.projectionFingerprint =
      roomPlanProjectionFingerprint(oldHorizon);
    const invalidated = {
      ...current,
      invalidatedAt: 120,
      invalidationReason: "operator invalidation",
    };
    const {
      projectionRevision: _projectionRevision,
      projectionFingerprint: _projectionFingerprint,
      ...missingEpoch
    } = current;
    const tampered = {
      ...current,
      anchors: { ...current.anchors, hub: { x: 40, y: 40 } },
    };
    const fault = recordSettlementProjectionFault(
      undefined,
      current,
      130,
      new Error("regeneration failed"),
    );

    const admitted = usableRoomPlanProjection({ roomPlan: current }, "W1N1");
    expect(admitted).toMatchObject({
      usable: true,
      status: "current",
    });
    if (!admitted.usable) throw new Error("expected current plan admission");
    expect(admitted.plan).not.toBe(current);
    expect(admitted.plan).toEqual(current);
    expect(Object.isFrozen(admitted.plan)).toBe(true);
    expect(Object.isFrozen(admitted.plan.structures)).toBe(true);
    expect(Object.isFrozen(admitted.plan.structures[0])).toBe(true);
    expect(Object.isFrozen(current)).toBe(false);
    expect(() => {
      current.generatedReason = "authorized retained-plan metadata update";
    }).not.toThrow();
    expect(admitted.plan.generatedReason).toBe("fixture");
    current.generatedReason = "fixture";
    expect(
      usableRoomPlanProjection({ roomPlan: current }, "W1N1"),
    ).toMatchObject({ usable: true, status: "current" });
    expect(usableRoomPlanProjection(undefined, "W1N1")).toMatchObject({
      usable: false,
      status: "missing",
      plan: null,
    });
    expect(
      usableRoomPlanProjection({ roomPlan: oldHorizon }, "W1N1"),
    ).toMatchObject({
      usable: false,
      status: "version_horizon_mismatch",
      plan: null,
    });
    expect(
      usableRoomPlanProjection({ roomPlan: stalePlanner }, "W1N1"),
    ).toMatchObject({
      usable: false,
      status: "planner_stale",
      plan: null,
    });
    expect(
      usableRoomPlanProjection({ roomPlan: missingEpoch }, "W1N1"),
    ).toMatchObject({
      usable: false,
      status: "epoch_missing",
      plan: null,
    });
    expect(
      usableRoomPlanProjection({ roomPlan: tampered }, "W1N1"),
    ).toMatchObject({
      usable: false,
      status: "fingerprint_mismatch",
      plan: null,
    });
    expect(
      usableRoomPlanProjection({ roomPlan: invalidated }, "W1N1"),
    ).toMatchObject({
      usable: false,
      status: "invalidated",
      plan: null,
    });
    expect(
      usableRoomPlanProjection(
        {
          roomPlan: current,
          settlementProjectionFault: fault,
        },
        "W1N1",
      ),
    ).toMatchObject({
      usable: false,
      status: "generation_fault",
      plan: null,
    });
    expect(
      usableRoomPlanProjection({ roomPlan: current }, "W2N2"),
    ).toMatchObject({
      usable: false,
      status: "room_mismatch",
      plan: null,
    });
    const malformed = {
      ...current,
      roadGraph: { ...current.roadGraph, nodes: undefined },
    } as unknown as RoomPlan;
    malformed.projectionFingerprint = roomPlanProjectionFingerprint(malformed);
    expect(
      usableRoomPlanProjection({ roomPlan: malformed }, "W1N1"),
    ).toMatchObject({
      usable: false,
      status: "schema_invalid",
      plan: null,
    });
  });

  it("rejects a self-fingerprinted v4/RCL8 epoch with only token stage evidence", () => {
    const retained = plan();
    const tokenIds = new Set([
      "spawn-1",
      "container-1",
      "storage-1",
      "terminal-1",
      "factory-1",
      "canonical-fixture-observer-1",
    ]);
    const truncated = migrateRoomPlanProjection({
      ...retained,
      structures: retained.structures.filter((structure) =>
        tokenIds.has(structure.id),
      ),
    });

    expect(roomPlanProjectionMatches(truncated)).toBe(true);
    expect(
      usableRoomPlanProjection({ roomPlan: truncated }, "W1N1"),
    ).toMatchObject({
      usable: false,
      status: "schema_invalid",
      plan: null,
      reason: expect.stringContaining(
        "canonical RCL8 inventory requires exactly 60 extension structures; received 0",
      ),
    });
  });

  it("normalizes planner-only scores before re-fingerprinting the operational epoch", () => {
    const current = migrateRoomPlanProjection(plan());
    const scored = {
      ...current,
      anchors: {
        ...current.anchors,
        hub: { ...current.anchors.hub, score: 123 },
      },
    } as RoomPlan;
    scored.projectionFingerprint = roomPlanProjectionFingerprint(scored);

    const normalized = normalizeRoomPlanProjection(scored);

    expect(normalized.anchors.hub).not.toHaveProperty("score");
    expect(roomPlanProjectionMatches(normalized)).toBe(true);
    const first = usableRoomPlanProjection({ roomPlan: normalized }, "W1N1");
    const second = usableRoomPlanProjection({ roomPlan: normalized }, "W1N1");
    expect(first).toMatchObject({
      usable: true,
      status: "current",
    });
    expect(second).toBe(first);

    const replacement = advanceRoomPlanProjection(plan(), normalized);
    const replacementAssessment = usableRoomPlanProjection(
      { roomPlan: replacement },
      "W1N1",
    );
    expect(replacementAssessment).not.toBe(first);
    expect(replacementAssessment).toMatchObject({ usable: true });

    const fault = recordSettlementProjectionFault(
      undefined,
      replacement,
      200,
      new Error("forced failure"),
    );
    const faultAssessment = usableRoomPlanProjection(
      { roomPlan: replacement, settlementProjectionFault: fault },
      "W1N1",
    );
    expect(faultAssessment).not.toBe(replacementAssessment);
    expect(faultAssessment).toMatchObject({
      usable: false,
      status: "generation_fault",
    });
  });
});
