import { describe, expect, it } from "vitest";

import type { Snapshot } from "./control-plane";
import type { RoomDevelopmentSummary } from "./room-development";
import {
  blueprintAuthority,
  buildStrategicRoomMapModel,
  decodeRoomTerrain,
  markersAt,
  rampartCondition,
  runtimeRoomPlanFingerprint,
  snapshotRoomPlanDigest,
  structureKey,
  terrainAt,
} from "./strategic-room-map";

const planFixture = {
  plannerRevision: 1,
  projectionRevision: 7,
  version: 4,
  horizonRcl: 8,
  anchors: {
    spawn: { x: 10, y: 10 },
    hub: { x: 10, y: 11 },
    controller: { x: 20, y: 20, service: { x: 19, y: 20 } },
  },
  structures: [
    { id: "spawn:10:10", structureType: "spawn", x: 10, y: 10 },
    {
      id: "extension:11:10",
      structureType: "extension",
      x: 11,
      y: 10,
    },
    {
      id: "rampart:12:10",
      structureType: "rampart",
      x: 12,
      y: 10,
    },
  ],
  defense: {
    strategy: "terrain-mincut-v1" as const,
    perimeter: [{ x: 12, y: 10 }],
  },
};

const projectionFingerprint = runtimeRoomPlanFingerprint(planFixture) ?? "";

const development = (
  overrides: {
    usable?: boolean;
    status?: "current" | "invalidated" | "generation_fault";
    traceAlignment?: "matched" | "mismatch" | "unavailable";
    state?: RoomDevelopmentSummary["state"];
  } = {},
): RoomDevelopmentSummary =>
  ({
    state: overrides.state ?? "developing",
    projection: {
      plannerRevision: 1,
      projectionRevision: 7,
      projectionFingerprint,
      traceAlignment: overrides.traceAlignment ?? "matched",
      runtimeUsability: {
        usable: overrides.usable ?? true,
        status: overrides.status ?? "current",
        reason:
          overrides.status === "generation_fault"
            ? "Planner regeneration is backing off after a topology fault."
            : "Runtime accepted the current projection epoch.",
      },
    },
    defense: { targetHits: 100 },
    missingStructureCount: 2,
    missingCriticalStructures: [
      {
        id: "extension:11:10",
        stageId: "logistics",
        structureType: "extension",
        x: 11,
        y: 10,
        minRcl: 2,
        priority: 80,
        strategicWeight: 4,
        controllerEligible: true,
        realized: false,
        underConstruction: true,
        blockers: [],
      },
      {
        id: "rampart:12:10",
        stageId: "core-economy",
        structureType: "rampart",
        x: 12,
        y: 10,
        minRcl: 4,
        priority: 70,
        strategicWeight: 3,
        controllerEligible: true,
        realized: false,
        underConstruction: false,
        blockers: [
          {
            plannedStructureId: "rampart:12:10",
            stageId: "core-economy",
            plannedStructureType: "rampart",
            x: 12,
            y: 10,
            kind: "runtime-evaluated",
            occupantType: "runtime-evaluated obstruction",
            reason: "Hostile construction site occupies the perimeter tile.",
          },
        ],
      },
    ],
  }) as RoomDevelopmentSummary;

const snapshot = (): Snapshot => ({
  room: "E52N38",
  terrain: {
    encoding: "screeps-terrain-mask/v1",
    width: 50,
    height: 50,
    cells: "0".repeat(2_500),
  },
  captureConsistency: {
    status: "matched",
    initialTick: 100,
    finalTick: 100,
    reason:
      "Trace fence held at tick 100 for one exact settlement projection epoch.",
  },
  roomPlan: { ...planFixture, projectionFingerprint },
  roomPlanIntegrity: {
    projectionScheme: "room-plan-fingerprint/v1",
    declaredFingerprint: projectionFingerprint,
    runtimeComputedFingerprint: projectionFingerprint,
    runtimeVerified: true,
    snapshotDigestScheme: "screeps-lab-room-plan-digest/v1",
    snapshotDigest: snapshotRoomPlanDigest({
      ...planFixture,
      projectionFingerprint,
    }),
  },
  colony: {
    controller: { x: 20, y: 20, level: 8 },
    sources: [{ x: 5, y: 6 }],
    minerals: [{ x: 42, y: 42 }],
    structures: [
      { type: "spawn", x: 10, y: 10, owned: true },
      { type: "tower", x: 11, y: 10, owned: true },
      { type: "container", x: 15, y: 15, owned: null },
      { type: "rampart", x: 12, y: 10, owned: true, hits: 40, hitsMax: 100 },
    ],
    constructionSites: [
      {
        structureType: "extension",
        x: 11,
        y: 10,
        owned: true,
        progress: 25,
        progressTotal: 100,
      },
      { structureType: "lab", x: 16, y: 16, owned: false },
    ],
  },
});

describe("strategic room map terrain", () => {
  it("decodes terrain masks and identifies unique walkable edge exits", () => {
    const cells = Array.from({ length: 2_500 }, () => "0");
    cells[0] = "1";
    cells[51] = "2";
    const terrain = decodeRoomTerrain({
      encoding: "screeps-terrain-mask/v1",
      width: 50,
      height: 50,
      cells: cells.join(""),
    });

    expect(terrain?.walls).toEqual([{ x: 0, y: 0 }]);
    expect(terrain?.swamps).toEqual([{ x: 1, y: 1 }]);
    expect(terrain?.exits).toHaveLength(195);
    expect(terrainAt(terrain ?? null, { x: 1, y: 1 })).toBe("swamp");
  });

  it("rejects malformed or unsupported terrain without inventing cells", () => {
    expect(
      decodeRoomTerrain({
        encoding: "screeps-terrain-mask/v1",
        width: 50,
        height: 50,
        cells: "0".repeat(2_499),
      }),
    ).toBeNull();
    expect(
      decodeRoomTerrain({
        encoding: "screeps-terrain-mask/v1",
        width: 50,
        height: 50,
        cells: `${"0".repeat(2_499)}4`,
      }),
    ).toBeNull();
  });
});

describe("strategic room map authority and evidence", () => {
  it("requires both current usability and exact trace alignment", () => {
    expect(blueprintAuthority(snapshot(), development()).active).toBe(true);
    expect(
      blueprintAuthority(
        snapshot(),
        development({ traceAlignment: "mismatch" }),
      ).active,
    ).toBe(false);
    expect(
      blueprintAuthority(
        snapshot(),
        development({ usable: false, status: "generation_fault" }),
      ),
    ).toMatchObject({
      active: false,
      status: "generation_fault",
      reason: "Planner regeneration is backing off after a topology fault.",
    });
  });

  it("requires a v4/RCL8 plan and a current operational development state", () => {
    const legacy = snapshot();
    if (!legacy.roomPlan) throw new Error("fixture plan missing");
    legacy.roomPlan.version = 3;

    expect(blueprintAuthority(legacy, development())).toMatchObject({
      active: false,
      status: "version-horizon-mismatch",
    });
    expect(
      blueprintAuthority(
        snapshot(),
        development({ state: "runtime-evidence-unavailable" }),
      ),
    ).toMatchObject({
      active: false,
      status: "development-runtime-evidence-unavailable",
    });
  });

  it("classifies exact matches, wrong-type assets, sites, foreign objects, blockers, and rampart condition", () => {
    const model = buildStrategicRoomMapModel(snapshot(), development());
    const byKey = new Map(
      model.structures.map((marker) => [marker.key, marker]),
    );

    expect(byKey.get(structureKey("spawn", { x: 10, y: 10 }))).toMatchObject({
      planned: true,
      built: true,
      offPlan: false,
    });
    expect(byKey.get(structureKey("tower", { x: 11, y: 10 }))).toMatchObject({
      planned: false,
      built: true,
      offPlan: true,
    });
    expect(
      byKey.get(structureKey("extension", { x: 11, y: 10 })),
    ).toMatchObject({ planned: true, constructionSite: true, offPlan: false });
    expect(
      byKey.get(structureKey("container", { x: 15, y: 15 })),
    ).toMatchObject({
      built: true,
      offPlan: true,
      ownership: "neutral",
    });
    expect(byKey.get(structureKey("lab", { x: 16, y: 16 }))).toMatchObject({
      constructionSite: true,
      offPlan: true,
      owned: false,
    });
    expect(byKey.get(structureKey("rampart", { x: 12, y: 10 }))).toMatchObject({
      blockerReasons: [
        "Hostile construction site occupies the perimeter tile.",
      ],
      rampartCondition: { state: "critical", ratio: 0.4, targetHits: 100 },
    });
    expect(model.missingQueue).toHaveLength(2);
    expect(model.counts).toMatchObject({
      planned: 3,
      built: 4,
      constructionSites: 2,
      offPlan: 3,
      blocked: 1,
    });
    expect(markersAt(model, { x: 11, y: 10 }).structures).toHaveLength(2);
  });

  it("fails closed by removing retained plan semantics while preserving live-world evidence", () => {
    const model = buildStrategicRoomMapModel(
      snapshot(),
      development({ usable: false, status: "invalidated" }),
    );

    expect(model.blueprint.active).toBe(false);
    expect(model.retainedPlanPresent).toBe(true);
    expect(model.missingQueue).toEqual([]);
    expect(model.anchors).toEqual([]);
    expect(model.structures.some((marker) => marker.planned)).toBe(false);
    expect(model.structures.filter((marker) => marker.built)).toHaveLength(4);
    expect(model.structures.some((marker) => marker.offPlan)).toBe(false);
    expect(model.diagnosticStructures).toHaveLength(3);
    expect(model.diagnosticAnchors).toHaveLength(2);
    expect(model.counts.planned).toBe(0);
  });

  it("withholds a declared-current blueprint after coordinate tampering without an epoch change", () => {
    const tampered = snapshot();
    const structure = tampered.roomPlan?.structures?.[0];
    if (!structure) throw new Error("fixture structure missing");
    structure.x = 9;

    expect(blueprintAuthority(tampered, development())).toMatchObject({
      active: false,
      status: "content-integrity-mismatch",
    });
    const model = buildStrategicRoomMapModel(tampered, development());
    expect(model.structures.some((marker) => marker.planned)).toBe(false);
    expect(model.diagnosticStructures.length).toBeGreaterThan(0);
  });

  it("withholds exact-overlay claims when the publisher trace fence is mixed", () => {
    const mixed = snapshot();
    mixed.captureConsistency = {
      status: "mixed",
      initialTick: 100,
      finalTick: 101,
      reason: "Snapshot requests crossed an observability tick.",
    };

    expect(blueprintAuthority(mixed, development())).toMatchObject({
      active: false,
      status: "capture-mixed",
      reason: "Snapshot requests crossed an observability tick.",
    });
  });

  it("rates ramparts only against a finite positive runtime target", () => {
    expect(rampartCondition(100, 100).state).toBe("at-target");
    expect(rampartCondition(75, 100).state).toBe("strengthening");
    expect(rampartCondition(20, 100).state).toBe("critical");
    expect(rampartCondition(20, 0)).toEqual({
      state: "unverified",
      ratio: null,
      targetHits: null,
    });
  });
});
