import { describe, expect, it } from "vitest";

import type { RuntimeRoomDevelopmentSummary, Snapshot } from "./control-plane";
import {
  CANONICAL_ROOM_DEVELOPMENT_STAGES,
  deriveRoomDevelopment,
} from "./room-development";

const fingerprint = "rpf1-aaaaaaaaaaaaaaaa";

function development(
  overrides: Partial<RuntimeRoomDevelopmentSummary> = {},
): RuntimeRoomDevelopmentSummary {
  const missing = [
    {
      plannedStructureId: "terminal-1",
      stageId: "advanced-operations" as const,
      structureType: "terminal",
      x: 23,
      y: 20,
      minRcl: 6,
      priority: 500,
      strategicWeight: 10,
      underConstruction: false,
      blocked: false,
      blockerReasons: [],
    },
    {
      plannedStructureId: "factory-1",
      stageId: "mature-rcl8" as const,
      structureType: "factory",
      x: 24,
      y: 20,
      minRcl: 8,
      priority: 400,
      strategicWeight: 10,
      underConstruction: false,
      blocked: false,
      blockerReasons: [],
    },
  ];
  return {
    source: "runtime_room_development_evaluator",
    evaluatedAt: 100,
    horizonStatus: "v4_rcl8",
    validationIssues: [],
    activeStageId: "advanced-operations",
    nextStageId: "mature-rcl8",
    realizationPercentage: 55,
    missingStructures: 2,
    blockedStructures: 0,
    stages: CANONICAL_ROOM_DEVELOPMENT_STAGES.map((stage, index) => ({
      id: stage.id,
      title: stage.title,
      minRcl: stage.minRcl,
      stageWeight: stage.weight,
      status:
        index < 3
          ? "realized"
          : index === 3
            ? "in_progress"
            : "prerequisite_blocked",
      controllerEligible: true,
      prerequisitesSatisfied: index < 4,
      realizationPercentage: index < 3 ? 100 : 0,
      realizedStructures: index < 3 ? 1 : 0,
      eligibleStructures: 1,
      missingStructures: index < 3 ? 0 : 1,
      blockedStructures: 0,
    })),
    missingCriticalStructures: missing,
    nextMilestone: {
      kind: "realize_structure",
      stageId: "advanced-operations",
      plannedStructureId: "terminal-1",
      reason: "Build the highest-value missing advanced structure.",
    },
    ...overrides,
  };
}

function currentSnapshot(
  developmentOverrides: Partial<RuntimeRoomDevelopmentSummary> = {},
  snapshotOverrides: Partial<Snapshot> = {},
): Snapshot {
  const runtimeDevelopment = development(developmentOverrides);
  return {
    room: "E52N38",
    colony: {
      controller: { level: 8 },
      structures: [],
      constructionSites: [],
    },
    roomPlan: {
      plannerRevision: 2,
      projectionRevision: 7,
      projectionFingerprint: fingerprint,
      version: 4,
      horizonRcl: 8,
      defense: { strategy: "terrain-mincut-v1", perimeter: [] },
    },
    runtimeTrace: {
      tick: 100,
      settlement: {
        plans: [
          {
            roomName: "E52N38",
            projectionUsability: {
              usable: true,
              status: "current",
              reason:
                "Room-plan projection epoch is current and fingerprint-valid",
            },
            plannerRevision: 2,
            projectionRevision: 7,
            projectionFingerprint: fingerprint,
            controllerLevel: 8,
            horizonStatus: runtimeDevelopment.horizonStatus,
            activeStageId: runtimeDevelopment.activeStageId,
            nextStageId: runtimeDevelopment.nextStageId,
            realizationPercentage: runtimeDevelopment.realizationPercentage,
            missingStructures: runtimeDevelopment.missingStructures,
            blockedStructures: runtimeDevelopment.blockedStructures,
            development: runtimeDevelopment,
            defense: {
              strategy: "terrain-mincut-v1",
              perimeterPlanned: 4,
              perimeterBuilt: 3,
              perimeterAtTarget: 2,
              targetHits: 5_000_000,
              underAttack: false,
              nextMissingTile: { x: 10, y: 10 },
            },
            energyTopology: {
              status: "authorization-debt",
              reason:
                "approved colony energy-service Task has no linkTransfer-authorized Procedure; container hauling remains active",
              sourceLinks: 2,
              controllerLinkPlanId: "link-controller",
              coreLinkPlanId: "link-core",
            },
          },
        ],
      },
    },
    ...snapshotOverrides,
  };
}

describe("runtime-authoritative room development adapter", () => {
  it("distinguishes missing plans from measured legacy horizon debt", () => {
    const missing = deriveRoomDevelopment({
      colony: { controller: { level: 5 } },
    });
    const legacy = deriveRoomDevelopment({
      room: "E52N38",
      colony: { controller: { level: 8 } },
      roomPlan: { version: 3, horizonRcl: 3 },
    });

    expect(missing.state).toBe("plan-missing");
    expect(missing.nextMilestone.kind).toBe("publish-plan");
    expect(legacy.state).toBe("horizon-debt");
    expect(legacy.realizationPercentage).toBeNull();
    expect(legacy.nextMilestone.kind).toBe("replace-plan");
  });

  it("fails closed when a current plan has no runtime evaluation", () => {
    const snapshot = currentSnapshot();
    snapshot.runtimeTrace = { tick: 100, settlement: { plans: [] } };

    const result = deriveRoomDevelopment(snapshot);

    expect(result.state).toBe("runtime-evidence-unavailable");
    expect(result.health).toBe("critical");
    expect(result.realizationPercentage).toBeNull();
    expect(result.nextMilestone.kind).toBe("refresh-projection-evidence");
  });

  it("rejects mismatched projection identities before reading a score", () => {
    const snapshot = currentSnapshot();
    const tracePlan = snapshot.runtimeTrace?.settlement?.plans?.[0];
    if (tracePlan) tracePlan.projectionFingerprint = "rpf1-bbbbbbbbbbbbbbbb";

    const result = deriveRoomDevelopment(snapshot);

    expect(result.projection.traceAlignment).toBe("mismatch");
    expect(result.realizationPercentage).toBeNull();
    expect(result.nextMilestone.kind).toBe("refresh-projection-evidence");
  });

  it.each([
    ["schema_invalid", "retained projection schema is invalid"],
    ["room_mismatch", "retained projection belongs to W9N9"],
  ] as const)(
    "renders exact runtime %s gate evidence and withholds retained geometry scores",
    (status, reason) => {
      const snapshot = currentSnapshot();
      const tracePlan = snapshot.runtimeTrace?.settlement?.plans?.[0];
      if (tracePlan) {
        tracePlan.projectionUsability = { usable: false, status, reason };
      }

      const result = deriveRoomDevelopment(snapshot);

      expect(result.state).toBe("runtime-evidence-unavailable");
      expect(result.realizationPercentage).toBeNull();
      expect(result.projection.runtimeUsability).toEqual({
        usable: false,
        status,
        reason,
      });
      expect(result.nextMilestone.reason).toBe(reason);
    },
  );

  it("withholds retained-plan scores while the current projection fault is active", () => {
    const snapshot = currentSnapshot();
    if (snapshot.runtimeTrace?.settlement) {
      snapshot.runtimeTrace.settlement.faults = [
        {
          roomName: "E52N38",
          status: "active",
          reason: "generation failed",
          attemptCount: 3,
          nextRetryTick: 180,
          retainedPlannerRevision: 2,
          retainedProjectionRevision: 7,
          retainedProjectionFingerprint: fingerprint,
        },
      ];
    }

    const result = deriveRoomDevelopment(snapshot);

    expect(result.realizationPercentage).toBeNull();
    expect(result.projection.faultAlignment).toBe("current");
    expect(result.nextMilestone.kind).toBe("repair-projection");
  });

  it("maps only runtime evidence and ignores contradictory browser snapshot objects", () => {
    const first = deriveRoomDevelopment(currentSnapshot());
    const second = deriveRoomDevelopment(
      currentSnapshot(
        {},
        {
          colony: {
            controller: { level: 8 },
            structures: [{ type: "factory", x: 1, y: 1, owned: true }],
            constructionSites: [
              { structureType: "terminal", x: 23, y: 20, owned: true },
            ],
          },
        },
      ),
    );

    expect(first.realizationPercentage).toBe(55);
    expect(second.realizationPercentage).toBe(55);
    expect(second.missingCriticalStructures.map((item) => item.id)).toEqual([
      "terminal-1",
      "factory-1",
    ]);
    expect(second.nextMilestone.title).toBe("Build terminal");
  });

  it("preserves mature-link authorization debt without promoting geometry to readiness", () => {
    const result = deriveRoomDevelopment(currentSnapshot());

    expect(result.projection.matureEnergyService).toEqual({
      status: "authorization-debt",
      reason:
        "approved colony energy-service Task has no linkTransfer-authorized Procedure; container hauling remains active",
      sourceLinks: 2,
      controllerLinkPlanId: "link-controller",
      coreLinkPlanId: "link-core",
    });
  });

  it("preserves exact runtime site progress and blocker reasons", () => {
    const runtime = development();
    const [terminal, factory] = runtime.missingCriticalStructures;
    if (!terminal || !factory) throw new Error("fixture incomplete");
    terminal.underConstruction = true;
    terminal.blocked = true;
    terminal.blockerReasons = ["terminal tile is occupied by an unowned tower"];
    runtime.blockedStructures = 1;
    const advancedStage = runtime.stages[3];
    const blockerReason = terminal.blockerReasons[0];
    if (!advancedStage || !blockerReason) throw new Error("fixture incomplete");
    advancedStage.status = "blocked";
    advancedStage.blockedStructures = 1;
    runtime.nextMilestone = {
      kind: "resolve_structure_blocker",
      stageId: "advanced-operations",
      plannedStructureId: "terminal-1",
      reason: blockerReason,
    };
    const snapshot = currentSnapshot(runtime);

    const result = deriveRoomDevelopment(snapshot);

    expect(result.missingCriticalStructures[0]?.underConstruction).toBe(true);
    expect(result.blockedStructureCount).toBe(1);
    expect(result.firstBlocker?.reason).toContain("unowned tower");
    expect(result.nextMilestone.kind).toBe("resolve-blocker");
  });

  it("reports aggregate queue totals without pretending the bounded trace is complete", () => {
    const result = deriveRoomDevelopment(
      currentSnapshot({ missingStructures: 19 }),
    );

    expect(result.missingStructureCount).toBe(19);
    expect(result.missingCriticalStructures).toHaveLength(2);
  });

  it("rejects internally inconsistent runtime mirrors and stale tick evidence", () => {
    const mirrored = currentSnapshot();
    const mirroredPlan = mirrored.runtimeTrace?.settlement?.plans?.[0];
    if (mirroredPlan) mirroredPlan.realizationPercentage = 99;
    const stale = currentSnapshot({ evaluatedAt: 99 });
    const missingTick = currentSnapshot();
    if (missingTick.runtimeTrace) missingTick.runtimeTrace.tick = null;

    expect(deriveRoomDevelopment(mirrored).realizationPercentage).toBeNull();
    expect(deriveRoomDevelopment(mirrored).validationIssues[0]).toContain(
      "mirror",
    );
    expect(deriveRoomDevelopment(stale).validationIssues).toContain(
      "runtime development evaluation is not from the snapshot tick",
    );
    expect(deriveRoomDevelopment(missingTick).validationIssues).toContain(
      "runtime trace tick is missing or invalid",
    );
  });

  it("requires runtime-evidenced defensive readiness before declaring the footprint realized", () => {
    const mature = development({
      activeStageId: null,
      nextStageId: null,
      realizationPercentage: 100,
      missingStructures: 0,
      blockedStructures: 0,
      stages: CANONICAL_ROOM_DEVELOPMENT_STAGES.map((stage) => ({
        id: stage.id,
        title: stage.title,
        minRcl: stage.minRcl,
        stageWeight: stage.weight,
        status: "realized",
        controllerEligible: true,
        prerequisitesSatisfied: true,
        realizationPercentage: 100,
        realizedStructures: 1,
        eligibleStructures: 1,
        missingStructures: 0,
        blockedStructures: 0,
      })),
      missingCriticalStructures: [],
      nextMilestone: {
        kind: "mature_outcome_realized",
        stageId: null,
        plannedStructureId: null,
        reason: "All required structures are realized.",
      },
    });
    const snapshot = currentSnapshot(mature);
    const tracePlan = snapshot.runtimeTrace?.settlement?.plans?.[0];
    if (tracePlan?.defense) {
      tracePlan.defense.perimeterBuilt = 4;
      tracePlan.defense.perimeterAtTarget = 4;
      tracePlan.defense.nextMissingTile = null;
    }

    const result = deriveRoomDevelopment(snapshot);

    expect(result.state).toBe("footprint-realized");
    expect(result.health).toBe("healthy");
    expect(result.defense.state).toBe("ready");
    expect(result.nextMilestone.reason).toContain(
      "Advanced capability actuation is not evidenced by this footprint result",
    );
  });

  it("accepts a superseded fault only when its recovery epoch matches exactly", () => {
    const snapshot = currentSnapshot();
    if (snapshot.runtimeTrace?.settlement) {
      snapshot.runtimeTrace.settlement.faults = [
        {
          roomName: "E52N38",
          status: "superseded",
          targetPlannerRevision: 2,
          supersededByRevision: 7,
          supersededByFingerprint: fingerprint,
          resolvedAtTick: 99,
        },
      ];
    }

    const result = deriveRoomDevelopment(snapshot);

    expect(result.projection.faultAlignment).toBe("current");
    expect(result.realizationPercentage).toBe(55);
  });
});
