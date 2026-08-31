import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateRoomDevelopment,
  evaluateRoomDevelopmentForRoom,
  roomDevelopmentBlockersForRoom,
  validateCanonicalRoomPlanInventory,
  type ObservedRoomStructure,
} from "../../src/planning/room-development";
import {
  ROOM_DEVELOPMENT_STAGES,
  ROOM_PLAN_HORIZON_RCL,
  ROOM_PLAN_VERSION,
  type RoomDevelopmentStageId,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import { canonicalRoomPlanInventoryFixture } from "../fixtures/current-room-plan";

const STAGE_MIN_RCL: Readonly<Record<RoomDevelopmentStageId, number>> = {
  bootstrap: 1,
  logistics: 2,
  "core-economy": 4,
  "advanced-operations": 6,
  "mature-rcl8": 8,
};

function requiredStructure(
  id: string,
  stage: RoomDevelopmentStageId,
  structureType: BuildableStructureConstant,
  x: number,
  y: number,
  strategicWeight = 1,
  minRcl = STAGE_MIN_RCL[stage],
): RoomPlanStructure {
  return {
    id,
    stage,
    structureType,
    x,
    y,
    minRcl,
    strategicWeight,
    requiredForStage: true,
    priority: 1_000 - x,
    activation: "automatic",
    reservation: "hard",
    phase: "core-economy",
    reason: "test outcome evidence",
  };
}

function validPlan(): RoomPlan {
  return {
    version: ROOM_PLAN_VERSION,
    horizonRcl: ROOM_PLAN_HORIZON_RCL,
    roomName: "W1N1",
    generatedAt: 100,
    generatedReason: "test",
    stages: ROOM_DEVELOPMENT_STAGES.map((stage) => ({
      ...stage,
      prerequisiteStageIds: [...stage.prerequisiteStageIds],
    })),
    anchors: {
      spawn: { name: "Spawn1", x: 10, y: 10 },
      hub: { x: 12, y: 10 },
      controller: null,
      sources: [],
    },
    reservations: [],
    structures: [
      requiredStructure("bootstrap-spawn", "bootstrap", "spawn", 10, 10, 3),
      requiredStructure(
        "bootstrap-extension",
        "bootstrap",
        "extension",
        11,
        10,
        1,
        2,
      ),
      requiredStructure("source-container", "logistics", "container", 12, 10),
      requiredStructure("core-storage", "core-economy", "storage", 13, 10),
      requiredStructure(
        "advanced-terminal",
        "advanced-operations",
        "terminal",
        14,
        10,
      ),
      requiredStructure("mature-observer", "mature-rcl8", "observer", 15, 10),
    ],
    roads: [
      {
        id: "logistics-road",
        stage: "logistics",
        x: 12,
        y: 11,
        minRcl: 2,
        strategicWeight: 1,
        requiredForStage: true,
        activation: "automatic",
        phase: "strategic-roads",
        reason: "test logistics evidence",
      },
    ],
    roadGraph: { nodes: [], edges: [] },
    defense: { strategy: "pending-mincut", protectedTiles: [], perimeter: [] },
  };
}

function observed(
  structureType: StructureConstant,
  x: number,
  y: number,
): ObservedRoomStructure {
  return { structureType, x, y };
}

describe("room development realization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares exact mature inventory and intermediate-RCL progression invariants", () => {
    const canonical = canonicalRoomPlanInventoryFixture(validPlan());
    expect(validateCanonicalRoomPlanInventory(canonical)).toEqual([]);

    const truncated = {
      ...canonical,
      structures: canonical.structures.filter(
        (structure) => structure.structureType !== "extension",
      ),
    };
    expect(validateCanonicalRoomPlanInventory(truncated)).toContain(
      "canonical RCL8 inventory requires exactly 60 extension structures; received 0",
    );

    const premature = structuredClone(canonical);
    const firstExtension = premature.structures.find(
      (structure) => structure.structureType === "extension",
    );
    if (!firstExtension) throw new Error("canonical fixture lost extensions");
    firstExtension.minRcl = 1;
    expect(validateCanonicalRoomPlanInventory(premature)).toContain(
      "canonical extension progression at RCL1 requires exactly 0 structures; received 1",
    );
  });

  it("reports a legacy horizon gap instead of manufacturing a healthy score", () => {
    const result = evaluateRoomDevelopment({
      controllerLevel: 3,
      plan: { version: 3, horizonRcl: 3, structures: [] },
      structures: [],
    });

    expect(result.horizonStatus).toBe("legacy_horizon_gap");
    expect(result.overallEligibleRealizationPercentage).toBeNull();
    expect(result.activeStageId).toBeNull();
    expect(result.nextStageId).toBeNull();
    expect(result.stages).toHaveLength(5);
    expect(result.stages.every((stage) => stage.status === "horizon_gap")).toBe(
      true,
    );
    expect(result.nextMilestone.kind).toBe("replace_legacy_plan");
    expect(result.nextMilestone.reason).toContain(
      "cannot evidence the five-stage v4/RCL8",
    );
  });

  it("requires exact coordinates and composes structure and stage weights", () => {
    const result = evaluateRoomDevelopment({
      controllerLevel: 4,
      plan: validPlan(),
      structures: [
        observed("spawn", 10, 10),
        observed("extension", 10, 11), // right type, wrong coordinate
        observed("tower", 11, 10), // right coordinate, wrong type
        observed("container", 12, 10),
        observed("road", 12, 11),
      ],
    });

    const bootstrap = result.stages.find((stage) => stage.id === "bootstrap");
    const logistics = result.stages.find((stage) => stage.id === "logistics");

    expect(result.horizonStatus).toBe("v4_rcl8");
    expect(bootstrap?.realizationPercentage).toBe(75);
    expect(
      bootstrap?.missingStructures.map(
        (structure) => structure.plannedStructureId,
      ),
    ).toEqual(["bootstrap-extension"]);
    expect(bootstrap?.status).toBe("in_progress");
    expect(logistics?.realizationPercentage).toBe(100);
    expect(logistics?.status).toBe("prerequisite_blocked");
    expect(result.eligibleStageWeight).toBe(55);
    expect(result.realizedStageWeight).toBe(26.25);
    expect(result.overallEligibleRealizationPercentage).toBe(47.727);
    expect(result.activeStageId).toBe("bootstrap");
    expect(result.nextStageId).toBe("logistics");
    expect(
      result.missingStructures.map((structure) => structure.plannedStructureId),
    ).toEqual(["bootstrap-extension", "core-storage"]);
    expect(result.nextMilestone).toMatchObject({
      kind: "realize_structure",
      stageId: "bootstrap",
      plannedStructureId: "bootstrap-extension",
    });
  });

  it("surfaces explicit blockers without treating them as realized evidence", () => {
    const result = evaluateRoomDevelopment({
      controllerLevel: 1,
      plan: validPlan(),
      structures: [],
      blockedStructures: [
        {
          plannedStructureId: "bootstrap-spawn",
          reason: "the tile is occupied by an incompatible construction site",
        },
      ],
    });

    const bootstrap = result.stages[0];
    expect(bootstrap?.status).toBe("blocked");
    expect(bootstrap?.blockedStructures).toHaveLength(1);
    expect(
      bootstrap?.futureStructures.map(
        (structure) => structure.plannedStructureId,
      ),
    ).toEqual(["bootstrap-extension"]);
    expect(result.nextMilestone).toEqual({
      kind: "resolve_structure_blocker",
      stageId: "bootstrap",
      plannedStructureId: "bootstrap-spawn",
      reason:
        "Bootstrap Base requires spawn at (10, 10), but it is blocked: the tile is occupied by an incompatible construction site.",
    });
  });

  it("reports an owned exact construction site as progress, never realization", () => {
    const result = evaluateRoomDevelopment({
      controllerLevel: 8,
      plan: validPlan(),
      structures: [
        observed("spawn", 10, 10),
        observed("extension", 11, 10),
        observed("container", 12, 10),
        observed("road", 12, 11),
        observed("storage", 13, 10),
      ],
      constructionSites: [{ structureType: "terminal", x: 14, y: 10 }],
    });

    expect(result.activeStageId).toBe("advanced-operations");
    expect(result.nextMilestone).toMatchObject({
      kind: "complete_structure_site",
      plannedStructureId: "advanced-terminal",
    });
    expect(result.missingStructures).toContainEqual(
      expect.objectContaining({
        plannedStructureId: "advanced-terminal",
        realized: false,
        underConstruction: true,
      }),
    );
  });

  it("withholds future-stage requirements until the controller makes them legal", () => {
    const result = evaluateRoomDevelopment({
      controllerLevel: 3,
      plan: validPlan(),
      structures: [
        observed("spawn", 10, 10),
        observed("extension", 11, 10),
        observed("container", 12, 10),
        observed("road", 12, 11),
      ],
    });

    expect(result.stages.map((stage) => stage.status)).toEqual([
      "realized",
      "realized",
      "controller_ineligible",
      "controller_ineligible",
      "controller_ineligible",
    ]);
    expect(result.overallEligibleRealizationPercentage).toBe(100);
    expect(result.activeStageId).toBeNull();
    expect(result.nextStageId).toBe("core-economy");
    expect(result.nextMilestone).toEqual({
      kind: "reach_controller_level",
      stageId: "core-economy",
      plannedStructureId: null,
      reason:
        "Core Economy Base becomes controller-eligible at RCL4; the room is currently RCL3.",
    });
  });

  it("recognizes the complete five-stage RCL8 outcome", () => {
    const plan = validPlan();
    const result = evaluateRoomDevelopment({
      controllerLevel: 8,
      plan,
      structures: plan.structures
        .map((structure) =>
          observed(structure.structureType, structure.x, structure.y),
        )
        .concat(plan.roads.map((road) => observed("road", road.x, road.y))),
    });

    expect(result.stages.every((stage) => stage.status === "realized")).toBe(
      true,
    );
    expect(result.overallEligibleRealizationPercentage).toBe(100);
    expect(result.activeStageId).toBeNull();
    expect(result.nextStageId).toBeNull();
    expect(result.nextMilestone.kind).toBe("mature_outcome_realized");
  });

  it("counts neutral road and container evidence but rejects unowned ownable structures", () => {
    vi.stubGlobal("FIND_STRUCTURES", 1);
    vi.stubGlobal("FIND_MY_CONSTRUCTION_SITES", 2);
    const structures = [
      { structureType: "spawn", my: true, pos: { x: 10, y: 10 } },
      { structureType: "extension", my: false, pos: { x: 11, y: 10 } },
      { structureType: "container", pos: { x: 12, y: 10 } },
      { structureType: "road", pos: { x: 12, y: 11 } },
    ] as unknown as Structure[];
    const room = {
      controller: { level: 4 },
      find: (constant: number) => (constant === 1 ? structures : []),
    } as unknown as Room;

    const result = evaluateRoomDevelopmentForRoom(room, validPlan(), []);

    expect(result.stages[0]?.realizationPercentage).toBe(75);
    expect(result.stages[0]?.missingStructures).toEqual([
      expect.objectContaining({
        plannedStructureId: "bootstrap-extension",
        realized: false,
      }),
    ]);
    expect(result.stages[1]?.realizationPercentage).toBe(100);
  });

  it("derives deterministic blockers from incompatible visible occupancy", () => {
    vi.stubGlobal("FIND_STRUCTURES", 1);
    vi.stubGlobal("FIND_CONSTRUCTION_SITES", 2);
    vi.stubGlobal("FIND_SOURCES", 3);
    vi.stubGlobal("FIND_MINERALS", 4);
    vi.stubGlobal("TERRAIN_MASK_WALL", 1);
    vi.stubGlobal("CONTROLLER_STRUCTURES", { storage: { 4: 1 } });
    const room = {
      controller: { level: 4, pos: { x: 40, y: 40 } },
      find: (constant: number) =>
        constant === 1
          ? [
              {
                structureType: "constructedWall",
                pos: { x: 13, y: 10 },
              },
            ]
          : [],
      getTerrain: () => ({ get: () => 0 }),
    } as unknown as Room;
    const plan = {
      version: ROOM_PLAN_VERSION,
      horizonRcl: ROOM_PLAN_HORIZON_RCL,
      structures: [
        requiredStructure("core-storage", "core-economy", "storage", 13, 10),
      ],
    };

    expect(roomDevelopmentBlockersForRoom(room, plan)).toEqual([
      {
        plannedStructureId: "core-storage",
        reason:
          "incompatible constructedWall structure occupies the planned coordinate",
      },
    ]);
  });

  it("treats an unowned same-type construction site as a blocker, never progress", () => {
    vi.stubGlobal("FIND_STRUCTURES", 1);
    vi.stubGlobal("FIND_CONSTRUCTION_SITES", 2);
    vi.stubGlobal("FIND_SOURCES", 3);
    vi.stubGlobal("FIND_MINERALS", 4);
    vi.stubGlobal("TERRAIN_MASK_WALL", 1);
    vi.stubGlobal("CONTROLLER_STRUCTURES", { storage: { 4: 1 } });
    const room = {
      controller: { level: 4, pos: { x: 40, y: 40 } },
      find: (constant: number) =>
        constant === 2
          ? [
              {
                structureType: "storage",
                my: false,
                pos: { x: 13, y: 10 },
              },
            ]
          : [],
      getTerrain: () => ({ get: () => 0 }),
    } as unknown as Room;
    const plan = {
      version: ROOM_PLAN_VERSION,
      horizonRcl: ROOM_PLAN_HORIZON_RCL,
      structures: [
        requiredStructure("core-storage", "core-economy", "storage", 13, 10),
      ],
    };

    expect(roomDevelopmentBlockersForRoom(room, plan)).toEqual([
      {
        plannedStructureId: "core-storage",
        reason:
          "unowned storage construction site occupies the planned coordinate",
      },
    ]);
  });

  it("fails closed when a nominal v4 plan lacks stage evidence", () => {
    const plan = validPlan();
    plan.structures = plan.structures.filter(
      (structure) => structure.stage === "bootstrap",
    );
    plan.roads = [];

    const result = evaluateRoomDevelopment({
      controllerLevel: 8,
      plan,
      structures: [],
    });

    expect(result.horizonStatus).toBe("invalid_v4_plan");
    expect(result.overallEligibleRealizationPercentage).toBeNull();
    expect(result.validationIssues).toContain(
      "stage logistics has no required structure evidence",
    );
    expect(result.nextMilestone.kind).toBe("repair_v4_plan");
  });

  it("reports no eligible score before controller ownership", () => {
    const result = evaluateRoomDevelopment({
      controllerLevel: 0,
      plan: validPlan(),
      structures: [],
    });

    expect(result.overallEligibleRealizationPercentage).toBeNull();
    expect(result.activeStageId).toBeNull();
    expect(result.nextStageId).toBe("bootstrap");
    expect(result.nextMilestone.kind).toBe("reach_controller_level");
  });
});
