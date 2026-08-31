import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateMemory } from "../../src/memory/migrate";
import { MEMORY_VERSION } from "../../src/memory/schema";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import { ensureRoomPlanOwnership } from "../../src/planning/ownership";
import {
  ROOM_DEVELOPMENT_STAGES,
  ROOM_PLAN_HORIZON_RCL,
  ROOM_PLAN_PLANNER_REVISION,
  ROOM_PLAN_VERSION,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import {
  migrateRoomPlanProjection,
  roomPlanProjectionFingerprint,
  roomPlanProjectionMatches,
  usableRoomPlanProjection,
} from "../../src/planning/room-plan-projection";
import { eligiblePlannedStructures } from "../../src/systems/construction/plan";
import {
  DEFENDED_CORE_PADDING,
  MAX_DEFENSIVE_PERIMETER_TILES,
} from "../../src/systems/settlement/defense-envelope";
import { normalizeFreshRoomPlans } from "../../src/systems/settlement/normalize";
import {
  commitSettlementPlanProposals,
  ensureSettlementPlans,
  generateRoomPlan,
  invalidateRoomPlan,
  proposeSettlementPlans,
  shouldRegenerateRoomPlan,
} from "../../src/systems/settlement/plan";
import {
  RAPID_FILL_EXTENSION_OFFSETS,
  RAPID_FILL_ROAD_OFFSETS,
} from "../../src/systems/settlement/stamps";

const key = (point: { x: number; y: number }): string =>
  `${point.x}:${point.y}`;

function expectSameGeometryAndFingerprint(
  actual: RoomPlan,
  expected: RoomPlan,
): void {
  expect({
    anchors: actual.anchors,
    reservations: actual.reservations,
    structures: actual.structures,
    roads: actual.roads,
    roadGraph: actual.roadGraph,
    defense: actual.defense,
  }).toEqual({
    anchors: expected.anchors,
    reservations: expected.reservations,
    structures: expected.structures,
    roads: expected.roads,
    roadGraph: expected.roadGraph,
    defense: expected.defense,
  });
  expect(actual.projectionFingerprint).toBe(expected.projectionFingerprint);
}

const basePlan = (): RoomPlan =>
  migrateRoomPlanProjection({
    version: ROOM_PLAN_VERSION,
    horizonRcl: ROOM_PLAN_HORIZON_RCL,
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

function legacyStructure(
  id: string,
  x: number,
  y: number,
  structureType: BuildableStructureConstant,
  minRcl: number,
  priority: number,
  phase: RoomPlanStructure["phase"],
): RoomPlanStructure {
  return {
    id,
    x,
    y,
    structureType,
    minRcl,
    priority,
    activation: structureType === "container" ? "demand" : "automatic",
    reservation: "hard",
    phase,
    reason: `legacy ${id}`,
  };
}

function legacyBootstrapPlan(): RoomPlan {
  const extensions = [
    [18, 23],
    [18, 27],
    [19, 22],
    [19, 28],
    [20, 22],
    [20, 28],
    [21, 22],
    [21, 28],
    [22, 23],
    [22, 27],
  ].map(([x, y], index) =>
    legacyStructure(
      `rapid-fill-extension-${index + 1}`,
      x ?? 0,
      y ?? 0,
      "extension",
      index < 5 ? 2 : 3,
      1_000 - index,
      "bootstrap-capacity",
    ),
  );
  const structures = [
    ...extensions,
    legacyStructure("tower-1", 23, 23, "tower", 3, 1_200, "bootstrap-defense"),
    legacyStructure(
      "tower-1-rampart",
      23,
      23,
      "rampart",
      3,
      500,
      "bootstrap-defense",
    ),
    legacyStructure(
      "spawn-rampart",
      20,
      25,
      "rampart",
      2,
      500,
      "bootstrap-defense",
    ),
    legacyStructure(
      "source-container-1",
      11,
      10,
      "container",
      2,
      700,
      "source-logistics",
    ),
    legacyStructure(
      "source-container-2",
      39,
      10,
      "container",
      2,
      700,
      "source-logistics",
    ),
    legacyStructure(
      "controller-container",
      37,
      40,
      "container",
      2,
      550,
      "controller-logistics",
    ),
  ];
  const roads = [
    {
      id: "road-21-25",
      x: 21,
      y: 25,
      minRcl: 2,
      activation: "demand" as const,
      phase: "strategic-roads" as const,
      reason: "legacy strategic road",
    },
    {
      id: "road-22-25",
      x: 22,
      y: 25,
      minRcl: 2,
      activation: "demand" as const,
      phase: "strategic-roads" as const,
      reason: "legacy strategic road",
    },
  ];
  return {
    planId: "legacy-plan-ownership",
    deliverableId: "legacy-deliverable-ownership",
    version: 3,
    horizonRcl: 3,
    roomName: "W1N1",
    generatedAt: 100,
    generatedReason: "legacy fixture",
    anchors: {
      spawn: { name: "Spawn1", x: 20, y: 25 },
      hub: { x: 27, y: 25 },
      controller: { x: 40, y: 40, service: { x: 37, y: 40 } },
      sources: [
        {
          sourceId: "source-1",
          x: 10,
          y: 10,
          container: { x: 11, y: 10 },
        },
        {
          sourceId: "source-2",
          x: 40,
          y: 10,
          container: { x: 39, y: 10 },
        },
      ],
    },
    reservations: [
      {
        id: "future-hub",
        x: 27,
        y: 25,
        kind: "hard",
        reason: "legacy storage reservation",
      },
      ...structures.map((structure) => ({
        id: `structure-${structure.id}`,
        x: structure.x,
        y: structure.y,
        kind: "hard" as const,
        reason: structure.reason,
      })),
      ...roads.map((road) => ({
        id: `reservation-${road.id}`,
        x: road.x,
        y: road.y,
        kind: "soft" as const,
        reason: road.reason,
      })),
    ],
    structures,
    roads,
    roadGraph: {
      nodes: [],
      edges: [
        {
          id: "spawn->hub",
          from: "spawn",
          to: "hub",
          tiles: roads.map(({ x, y }) => ({ x, y })),
        },
      ],
    },
    defense: {
      strategy: "pending-mincut",
      protectedTiles: [{ x: 20, y: 25 }],
      perimeter: [],
    },
  };
}

function migrationRoom(): Room {
  const sources = [
    { id: "source-1", pos: { x: 10, y: 10 } },
    { id: "source-2", pos: { x: 40, y: 10 } },
  ];
  const mineral = { id: "mineral-1", pos: { x: 10, y: 40 } };
  const spawn = {
    id: "spawn-1",
    name: "Spawn1",
    my: true,
    structureType: "spawn",
    pos: { x: 20, y: 25 },
  };
  return {
    name: "W1N1",
    controller: { pos: { x: 40, y: 40 } },
    getTerrain: () => ({ get: () => 0 }),
    find: (constant: FindConstant) => {
      if (constant === FIND_SOURCES) return sources;
      if (constant === FIND_MINERALS) return [mineral];
      if (constant === FIND_STRUCTURES) return [spawn];
      if (constant === FIND_CONSTRUCTION_SITES) return [];
      return [];
    },
  } as unknown as Room;
}

class TestRoomPosition {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly roomName: string,
  ) {}

  getRangeTo(target: number | { pos: { x: number; y: number } }, y?: number) {
    const point =
      typeof target === "number"
        ? { x: target, y: y ?? 0 }
        : "pos" in target
          ? target.pos
          : target;
    return Math.max(Math.abs(this.x - point.x), Math.abs(this.y - point.y));
  }
}

interface FreshPlanningRoomOptions {
  readonly includeSecondarySpawn?: boolean;
  readonly mineralVisible?: boolean;
  readonly reverseSources?: boolean;
  readonly reverseSpawns?: boolean;
  readonly roomName?: string;
}

function freshPlanningRoom(
  optionsOrMineralVisible: FreshPlanningRoomOptions | boolean = true,
): Room {
  const options: FreshPlanningRoomOptions =
    typeof optionsOrMineralVisible === "boolean"
      ? { mineralVisible: optionsOrMineralVisible }
      : optionsOrMineralVisible;
  const mineralVisible = options.mineralVisible ?? true;
  const roomName = options.roomName ?? "W1N1";
  const sources = [
    { id: "source-1", pos: new TestRoomPosition(10, 10, roomName) },
    { id: "source-2", pos: new TestRoomPosition(40, 10, roomName) },
  ];
  const mineral = {
    id: "mineral-1",
    pos: new TestRoomPosition(10, 40, roomName),
  };
  const spawn = {
    id: "spawn-1",
    name: "Spawn1",
    my: true,
    structureType: "spawn",
    pos: new TestRoomPosition(20, 25, roomName),
  };
  const secondarySpawn = {
    id: "spawn-2",
    name: "Spawn2",
    my: true,
    structureType: "spawn",
    pos: new TestRoomPosition(30, 25, roomName),
  };
  const spawns = options.includeSecondarySpawn
    ? [spawn, secondarySpawn]
    : [spawn];
  const structures = [...spawns];
  return {
    name: roomName,
    controller: {
      pos: new TestRoomPosition(40, 40, roomName),
    },
    getTerrain: () => ({ get: () => 0 }),
    find: (constant: FindConstant) => {
      if (constant === FIND_MY_SPAWNS)
        return options.reverseSpawns ? [...spawns].reverse() : [...spawns];
      if (constant === FIND_SOURCES)
        return options.reverseSources ? [...sources].reverse() : [...sources];
      if (constant === FIND_MINERALS) return mineralVisible ? [mineral] : [];
      if (constant === FIND_STRUCTURES) return structures;
      if (constant === FIND_CONSTRUCTION_SITES) return [];
      return [];
    },
    lookForAt: (constant: LookConstant, x: number, y: number) => {
      if (constant === LOOK_STRUCTURES) {
        return structures.filter(
          (structure) => structure.pos.x === x && structure.pos.y === y,
        );
      }
      return [];
    },
  } as unknown as Room;
}

function ensureGovernedSettlementPlans(room: Room): void {
  activateApprovedColonyGovernance(room.name);
  ensureSettlementPlans({ rooms: [room] } as never);
}

describe("settlement planning foundation", () => {
  beforeEach(() => {
    vi.stubGlobal("Game", { time: 500 });
    vi.stubGlobal("Memory", {
      version: MEMORY_VERSION,
      colonies: {},
    });
    vi.stubGlobal("TERRAIN_MASK_WALL", 1);
    vi.stubGlobal("TERRAIN_MASK_SWAMP", 2);
    vi.stubGlobal("FIND_SOURCES", 1);
    vi.stubGlobal("FIND_MINERALS", 2);
    vi.stubGlobal("FIND_STRUCTURES", 3);
    vi.stubGlobal("FIND_CONSTRUCTION_SITES", 4);
    vi.stubGlobal("FIND_MY_SPAWNS", 5);
    vi.stubGlobal("LOOK_STRUCTURES", "structure");
    vi.stubGlobal("LOOK_CONSTRUCTION_SITES", "constructionSite");
    vi.stubGlobal("STRUCTURE_EXTENSION", "extension");
    vi.stubGlobal("STRUCTURE_TOWER", "tower");
    vi.stubGlobal("STRUCTURE_STORAGE", "storage");
    vi.stubGlobal("STRUCTURE_ROAD", "road");
    vi.stubGlobal("STRUCTURE_RAMPART", "rampart");
    vi.stubGlobal("STRUCTURE_CONTAINER", "container");
    vi.stubGlobal("RoomPosition", TestRoomPosition);
    class CostMatrix {
      readonly values = new Map<string, number>();

      set(x: number, y: number, value: number): void {
        this.values.set(`${x}:${y}`, value);
      }

      get(x: number, y: number): number {
        return this.values.get(`${x}:${y}`) ?? 0;
      }
    }
    vi.stubGlobal("PathFinder", {
      CostMatrix,
      search: (
        origin: TestRoomPosition,
        goal: { pos: TestRoomPosition; range: number },
      ) => {
        const path: TestRoomPosition[] = [];
        let { x, y } = origin;
        while (
          Math.max(Math.abs(x - goal.pos.x), Math.abs(y - goal.pos.y)) >
          goal.range
        ) {
          x += Math.sign(goal.pos.x - x);
          y += Math.sign(goal.pos.y - y);
          path.push(new TestRoomPosition(x, y, origin.roomName));
        }
        return { path, incomplete: false, ops: path.length, cost: path.length };
      },
    });
  });

  it("keeps detached settlement proposals out of Memory without authority", () => {
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };

    const proposals = proposeSettlementPlans({
      rooms: [freshPlanningRoom()],
    } as never);

    expect(proposals).toHaveLength(1);
    expect(Memory.colonies.W1N1.roomPlan).toBeUndefined();
    expect(() => commitSettlementPlanProposals(proposals)).toThrow(
      /without active canonical Empire FSPM authority/i,
    );
    expect(Memory.colonies.W1N1.roomPlan).toBeUndefined();
    expect(Memory.colonies.W1N1.settlementProjectionFault).toBeUndefined();
  });

  it("rejects every detached settlement write beneath malformed governance", () => {
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    const portfolio = activateApprovedColonyGovernance("W1N1");
    const binding = portfolio.governanceBinding;
    if (!binding) throw new Error("expected governance binding");
    binding.authorityPackageHash = "forged-package-hash";

    const proposals = proposeSettlementPlans({
      rooms: [freshPlanningRoom()],
    } as never);

    expect(Memory.colonies.W1N1.roomPlan).toBeUndefined();
    expect(() => commitSettlementPlanProposals(proposals)).toThrow(
      /invalid FSPM governance/i,
    );
    expect(Memory.colonies.W1N1.roomPlan).toBeUndefined();
    expect(Memory.colonies.W1N1.settlementProjectionFault).toBeUndefined();
  });

  it("publishes a complete detached settlement proposal under valid authority", () => {
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    activateApprovedColonyGovernance("W1N1");

    const proposals = proposeSettlementPlans({
      rooms: [freshPlanningRoom()],
    } as never);

    expect(Memory.colonies.W1N1.roomPlan).toBeUndefined();
    commitSettlementPlanProposals(proposals);
    expect(Memory.colonies.W1N1.roomPlan).toMatchObject({
      version: ROOM_PLAN_VERSION,
      horizonRcl: ROOM_PLAN_HORIZON_RCL,
      roomName: "W1N1",
    });
  });

  it("publishes multi-colony plan and fault recovery through one root swap", () => {
    const retained = {
      ...basePlan(),
      invalidatedAt: 499,
      invalidationReason: "atomic publication fixture",
    };
    Memory.colonies = {
      W1N1: {
        roomName: "W1N1",
        discoveredAt: 1,
        roomPlan: retained,
      },
      W2N2: {
        roomName: "W2N2",
        discoveredAt: 2,
      },
    };
    activateApprovedColonyGovernance("W1N1");
    activateApprovedColonyGovernance("W2N2");

    commitSettlementPlanProposals(
      proposeSettlementPlans({
        rooms: [freshPlanningRoom({ mineralVisible: false })],
      } as never),
    );
    const faultedW1 = Memory.colonies.W1N1;
    if (!faultedW1) throw new Error("expected faulted W1N1 colony");
    expect(faultedW1.settlementProjectionFault).toMatchObject({
      status: "active",
      nextRetryTick: 505,
    });

    Game.time = 505;
    const oldRoot = Memory.colonies;
    const oldW1 = oldRoot.W1N1;
    const oldW2 = oldRoot.W2N2;
    if (!oldW1 || !oldW2) throw new Error("expected both retained colonies");
    const proposals = proposeSettlementPlans({
      rooms: [
        freshPlanningRoom(),
        freshPlanningRoom({ roomName: "W2N2" }),
      ],
    } as never);

    expect(Memory.colonies).toBe(oldRoot);
    expect(oldW1.roomPlan).toBe(retained);
    expect(oldW1.settlementProjectionFault?.status).toBe("active");
    expect(oldW2.roomPlan).toBeUndefined();

    commitSettlementPlanProposals(proposals);

    const nextW1 = Memory.colonies.W1N1;
    const nextW2 = Memory.colonies.W2N2;
    if (!nextW1 || !nextW2) throw new Error("expected both published colonies");
    expect(Memory.colonies).not.toBe(oldRoot);
    expect(nextW1).not.toBe(oldW1);
    expect(nextW2).not.toBe(oldW2);
    expect(nextW1.roomPlan).not.toBe(retained);
    expect(nextW1.settlementProjectionFault).toMatchObject({
      status: "superseded",
      resolvedAtTick: 505,
    });
    expect(nextW2.roomPlan).toMatchObject({
      roomName: "W2N2",
      version: ROOM_PLAN_VERSION,
      horizonRcl: ROOM_PLAN_HORIZON_RCL,
    });
    expect(oldW1.roomPlan).toBe(retained);
    expect(oldW1.settlementProjectionFault?.status).toBe("active");
    expect(oldW2.roomPlan).toBeUndefined();
  });

  it("keeps the rapid-fill extension stamp unique and off its preferred road lanes", () => {
    const extensionKeys = new Set(RAPID_FILL_EXTENSION_OFFSETS.map(key));
    const roadKeys = new Set(RAPID_FILL_ROAD_OFFSETS.map(key));

    expect(extensionKeys.size).toBe(10);
    expect(roadKeys.size).toBe(RAPID_FILL_ROAD_OFFSETS.length);
    expect([...extensionKeys].some((value) => roadKeys.has(value))).toBe(false);
  });

  it("publishes identical geometry and fingerprints when owned spawn enumeration is reversed", () => {
    const canonical = generateRoomPlan(
      freshPlanningRoom({ includeSecondarySpawn: true }),
      "spawn permutation fixture",
    );
    const permuted = generateRoomPlan(
      freshPlanningRoom({
        includeSecondarySpawn: true,
        reverseSpawns: true,
      }),
      "spawn permutation fixture",
    );
    if (!canonical || !permuted) {
      throw new Error("expected both spawn-permutation plans to generate");
    }

    expect(canonical.anchors.spawn.name).toBe("Spawn1");
    expect(permuted.anchors.spawn.name).toBe("Spawn1");
    expectSameGeometryAndFingerprint(permuted, canonical);
  });

  it("publishes identical geometry and fingerprints when source enumeration is reversed", () => {
    const canonical = generateRoomPlan(
      freshPlanningRoom(),
      "source permutation fixture",
    );
    const permuted = generateRoomPlan(
      freshPlanningRoom({ reverseSources: true }),
      "source permutation fixture",
    );
    if (!canonical || !permuted) {
      throw new Error("expected both source-permutation plans to generate");
    }

    expect(canonical.anchors.sources.map((source) => source.sourceId)).toEqual([
      "source-1",
      "source-2",
    ]);
    expect(permuted.anchors.sources.map((source) => source.sourceId)).toEqual([
      "source-1",
      "source-2",
    ]);
    expectSameGeometryAndFingerprint(permuted, canonical);
  });

  it("builds only automatic structures unlocked by the current RCL", () => {
    const plan = basePlan();

    expect(eligiblePlannedStructures(plan, 2).map((entry) => entry.id)).toEqual(
      ["rcl2-extension"],
    );
    expect(eligiblePlannedStructures(plan, 3).map((entry) => entry.id)).toEqual(
      ["rcl3-tower", "rcl2-extension"],
    );
  });

  it("reuses stable plans and regenerates only explicit invalidation or version changes", () => {
    const stable = generateRoomPlan(freshPlanningRoom(), "stable fixture");
    expect(stable).not.toBeNull();
    if (!stable) throw new Error("expected a generated stable plan");
    expect(shouldRegenerateRoomPlan(stable, "W1N1")).toBe(false);

    const {
      projectionRevision: _projectionRevision,
      projectionFingerprint: _projectionFingerprint,
      ...missingEpoch
    } = stable;
    expect(shouldRegenerateRoomPlan(missingEpoch, "W1N1")).toBe(true);
    expect(
      shouldRegenerateRoomPlan(
        {
          ...stable,
          projectionFingerprint: "rpf1-0000000000000000",
        },
        "W1N1",
      ),
    ).toBe(true);

    const oldPlanner = { ...stable, plannerRevision: 0 };
    const selfConsistentOldPlanner = {
      ...oldPlanner,
      projectionFingerprint: roomPlanProjectionFingerprint(oldPlanner),
    };
    expect(shouldRegenerateRoomPlan(selfConsistentOldPlanner, "W1N1")).toBe(
      true,
    );

    const invalidated = {
      ...stable,
      invalidatedAt: 101,
      invalidationReason: "test",
    };
    expect(shouldRegenerateRoomPlan(invalidated, "W1N1")).toBe(true);

    const oldVersion = { ...stable, version: ROOM_PLAN_VERSION - 1 };
    expect(shouldRegenerateRoomPlan(oldVersion, "W1N1")).toBe(true);

    const staleHorizon = {
      ...stable,
      horizonRcl: ROOM_PLAN_HORIZON_RCL - 1,
    };
    expect(shouldRegenerateRoomPlan(staleHorizon, "W1N1")).toBe(true);
    expect(shouldRegenerateRoomPlan(undefined, "W1N1")).toBe(true);
  });

  it("regenerates a truncated v8 mature projection instead of laundering it into a current epoch", () => {
    const {
      plannerRevision: _plannerRevision,
      projectionRevision: _projectionRevision,
      projectionFingerprint: _projectionFingerprint,
      ...truncated
    } = basePlan();
    truncated.planId = "plan:retained-truncated";
    truncated.deliverableId = "deliverable:W1N1:construction";
    Memory.version = 8;
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: truncated,
    };

    migrateMemory();

    expect(Memory.colonies.W1N1.roomPlan).not.toHaveProperty(
      "projectionFingerprint",
    );
    ensureGovernedSettlementPlans(freshPlanningRoom());

    const regenerated = Memory.colonies.W1N1.roomPlan;
    expect(regenerated).toMatchObject({
      version: ROOM_PLAN_VERSION,
      horizonRcl: ROOM_PLAN_HORIZON_RCL,
      plannerRevision: ROOM_PLAN_PLANNER_REVISION,
      projectionRevision: 1,
      deliverableId: "deliverable:W1N1:construction",
    });
    expect(
      regenerated?.structures.filter(
        (structure) => structure.structureType === "extension",
      ),
    ).toHaveLength(60);
    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: true, status: "current" });
  });

  it("upgrades persisted v3 geometry in place and attaches the governed mature defense envelope", () => {
    const legacy = legacyBootstrapPlan();
    const priorStructures = legacy.structures.map(({ id, x, y }) => ({
      id,
      x,
      y,
    }));
    const priorRoads = legacy.roads.map(({ id, x, y }) => ({ id, x, y }));
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: migrateRoomPlanProjection(legacy),
    };

    ensureGovernedSettlementPlans(migrationRoom());

    const upgraded = Memory.colonies.W1N1.roomPlan;
    expect(upgraded).toBeDefined();
    expect(upgraded?.version).toBe(ROOM_PLAN_VERSION);
    expect(upgraded?.horizonRcl).toBe(ROOM_PLAN_HORIZON_RCL);
    expect(upgraded?.stages).toEqual(ROOM_DEVELOPMENT_STAGES);
    expect(upgraded?.planId).toBe("legacy-plan-ownership");
    expect(upgraded?.deliverableId).toBe("legacy-deliverable-ownership");
    expect(upgraded?.generatedAt).toBe(500);
    expect(upgraded?.generatedReason).toBe(
      "Expected room plan v4/RCL8; retained v3/RCL3",
    );
    expect(upgraded?.projectionRevision).toBe(2);
    expect(upgraded?.projectionFingerprint).toMatch(/^rpf1-[0-9a-f]{16}$/);
    expect(
      priorStructures.map(({ id }) => {
        const structure = upgraded?.structures.find((entry) => entry.id === id);
        return { id: structure?.id, x: structure?.x, y: structure?.y };
      }),
    ).toEqual(priorStructures);
    expect(
      priorRoads.map(({ id }) => {
        const road = upgraded?.roads.find((entry) => entry.id === id);
        return { id: road?.id, x: road?.x, y: road?.y };
      }),
    ).toEqual(priorRoads);
    expect(upgraded?.defense.strategy).toBe("terrain-mincut-v1");
    expect(upgraded?.defense.perimeter.length).toBeGreaterThan(0);
    expect(
      upgraded?.structures
        .filter((structure) => structure.structureType === "rampart")
        .every((structure) => structure.activation === "defense"),
    ).toBe(true);

    for (const point of upgraded?.defense.perimeter ?? []) {
      const rampart = upgraded?.structures.find(
        (structure) =>
          structure.structureType === "rampart" &&
          structure.x === point.x &&
          structure.y === point.y,
      );
      expect(rampart).toMatchObject({
        activation: "defense",
        phase: "defense-envelope",
        stage: "mature-rcl8",
        requiredForStage: true,
      });
    }
  });

  it("bootstraps a missing plan into a complete canonical RCL8 horizon", () => {
    const plan = generateRoomPlan(freshPlanningRoom(), "missing room plan");

    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({
      version: ROOM_PLAN_VERSION,
      horizonRcl: ROOM_PLAN_HORIZON_RCL,
      plannerRevision: ROOM_PLAN_PLANNER_REVISION,
      projectionRevision: 1,
      generatedReason: "missing room plan",
      stages: ROOM_DEVELOPMENT_STAGES,
      defense: { strategy: "terrain-mincut-v1" },
    });
    const count = (structureType: BuildableStructureConstant): number =>
      plan?.structures.filter(
        (structure) => structure.structureType === structureType,
      ).length ?? 0;
    expect(count("extension")).toBe(60);
    expect(count("tower")).toBe(6);
    expect(count("spawn")).toBe(3);
    expect(count("lab")).toBe(10);
    expect(plan?.defense.perimeter.length).toBeGreaterThan(0);
    expect(plan?.defense.perimeter.length).toBeLessThanOrEqual(
      MAX_DEFENSIVE_PERIMETER_TILES,
    );

    const extractor = plan?.structures.find(
      (structure) => structure.structureType === "extractor",
    );
    expect(extractor).toMatchObject({ x: 10, y: 40 });
    expect(plan?.defense.protectedTiles).not.toContainEqual({ x: 10, y: 40 });

    const storage = plan?.structures.find(
      (structure) => structure.structureType === "storage",
    );
    expect(storage).toBeDefined();
    if (storage) {
      const protectedKeys = new Set(plan?.defense.protectedTiles.map(key));
      for (
        let dx = -DEFENDED_CORE_PADDING;
        dx <= DEFENDED_CORE_PADDING;
        dx += 1
      ) {
        for (
          let dy = -DEFENDED_CORE_PADDING;
          dy <= DEFENDED_CORE_PADDING;
          dy += 1
        ) {
          expect(protectedKeys.has(`${storage.x + dx}:${storage.y + dy}`)).toBe(
            true,
          );
        }
      }
    }

    const perimeterKeys = new Set(plan?.defense.perimeter.map(key));
    const gateRamparts = plan?.structures.filter(
      (structure) =>
        structure.structureType === "rampart" &&
        perimeterKeys.has(key(structure)) &&
        structure.reason ===
          "serviceable own-creep gate on the defensive envelope",
    );
    expect(gateRamparts?.length).toBeGreaterThan(0);
  });

  it("recovers self-fingerprinted wrong-room and malformed projections through the shared gate", () => {
    const valid = generateRoomPlan(freshPlanningRoom(), "adversarial seed");
    if (!valid) throw new Error("expected adversarial seed plan");
    const wrongRoom = { ...valid, roomName: "W2N2" };
    wrongRoom.projectionFingerprint = roomPlanProjectionFingerprint(wrongRoom);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: wrongRoom,
    };

    ensureGovernedSettlementPlans(freshPlanningRoom());

    const repairedRoom = Memory.colonies.W1N1.roomPlan;
    expect(repairedRoom?.roomName).toBe("W1N1");
    expect(repairedRoom?.projectionRevision).toBe(2);
    if (!repairedRoom) throw new Error("expected repaired room projection");
    expect(roomPlanProjectionMatches(repairedRoom)).toBe(true);
    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: true, status: "current" });

    const malformed = {
      ...repairedRoom,
      roadGraph: { ...repairedRoom.roadGraph, edges: undefined },
    } as unknown as RoomPlan;
    malformed.projectionFingerprint = roomPlanProjectionFingerprint(malformed);
    Memory.colonies.W1N1.roomPlan = malformed;
    Game.time += 1;

    ensureGovernedSettlementPlans(freshPlanningRoom());

    const repairedSchema = Memory.colonies.W1N1.roomPlan;
    expect(repairedSchema?.projectionRevision).toBe(3);
    if (!repairedSchema) throw new Error("expected repaired schema projection");
    expect(roomPlanProjectionMatches(repairedSchema)).toBe(true);
    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: true, status: "current" });
  });

  it("never launders published planner metadata into a new trusted fingerprint", () => {
    const published = generateRoomPlan(freshPlanningRoom(), "published plan");
    if (!published) throw new Error("expected published plan");
    (
      published.anchors.hub as typeof published.anchors.hub & { score: number }
    ).score = 999;
    published.projectionFingerprint = roomPlanProjectionFingerprint(published);
    const publishedFingerprint = published.projectionFingerprint;
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: published,
    };

    normalizeFreshRoomPlans();

    expect(Memory.colonies.W1N1.roomPlan).not.toBe(published);
    expect(Memory.colonies.W1N1.roomPlan?.projectionFingerprint).toBe(
      publishedFingerprint,
    );
    expect(Memory.colonies.W1N1.roomPlan?.invalidatedAt).toBe(Game.time);
    expect(Memory.colonies.W1N1.roomPlan?.invalidationReason).toContain(
      "planner-only score metadata",
    );
    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: false, status: "invalidated" });
  });

  it("keeps retained Memory writable across admission and publishes ownership links copy-on-write", () => {
    const generated = generateRoomPlan(
      freshPlanningRoom(),
      "ownership lifecycle",
    );
    if (!generated) throw new Error("expected generated ownership fixture");
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: generated,
    };

    const admitted = usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1");
    expect(admitted).toMatchObject({ usable: true, status: "current" });
    if (!admitted.usable)
      throw new Error("expected admitted ownership fixture");
    expect(admitted.plan).not.toBe(generated);
    expect(Object.isFrozen(admitted.plan)).toBe(true);
    expect(Object.isFrozen(generated)).toBe(false);

    activateApprovedColonyGovernance("W1N1");
    expect(() => ensureRoomPlanOwnership()).not.toThrow();
    const linked = Memory.colonies.W1N1.roomPlan;
    expect(linked).not.toBe(generated);
    if (!linked) throw new Error("expected ownership-linked room projection");
    expect(linked).toMatchObject({
      planId: "plan:W1N1:construction:room-plan:v4",
      deliverableId: "deliverable:W1N1:construction",
    });
    expect(Object.isFrozen(linked)).toBe(false);
    expect(Object.isFrozen(linked.structures)).toBe(false);
    expect(roomPlanProjectionMatches(linked)).toBe(true);
    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: true, status: "current" });
  });

  it("allows manual invalidation after admission and re-assesses the replacement in the same tick", () => {
    const generated = generateRoomPlan(
      freshPlanningRoom(),
      "manual invalidation lifecycle",
    );
    if (!generated) throw new Error("expected generated invalidation fixture");
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: generated,
    };

    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: true, status: "current" });
    expect(() =>
      invalidateRoomPlan("W1N1", "operator lifecycle test"),
    ).not.toThrow();
    expect(Memory.colonies.W1N1.roomPlan).not.toBe(generated);
    expect(Memory.colonies.W1N1.roomPlan).toMatchObject({
      invalidatedAt: Game.time,
      invalidationReason: "operator lifecycle test",
    });
    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: false, status: "invalidated", plan: null });
  });

  it("invalidates same-tick publication drift after admission without mutating the consumer snapshot", () => {
    const generated = generateRoomPlan(
      freshPlanningRoom(),
      "normalizer lifecycle",
    );
    if (!generated) throw new Error("expected generated normalizer fixture");
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: generated,
    };

    const admitted = usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1");
    if (!admitted.usable)
      throw new Error("expected admitted normalizer fixture");
    expect(Object.isFrozen(admitted.plan)).toBe(true);
    expect(admitted.plan.anchors.hub).not.toHaveProperty("score");

    (
      generated.anchors.hub as typeof generated.anchors.hub & { score: number }
    ).score = 999;
    expect(() => normalizeFreshRoomPlans()).not.toThrow();

    const invalidated = Memory.colonies.W1N1.roomPlan;
    expect(invalidated).not.toBe(generated);
    expect(invalidated).toMatchObject({
      invalidatedAt: Game.time,
      invalidationReason:
        "published room plan retained planner-only score metadata",
    });
    expect(admitted.plan.anchors.hub).not.toHaveProperty("score");
    expect(
      usableRoomPlanProjection(Memory.colonies.W1N1, "W1N1"),
    ).toMatchObject({ usable: false, status: "invalidated", plan: null });
  });

  it("retains the last projection, backs off failed settlement retries, and records recovery", () => {
    const retained = {
      ...basePlan(),
      planId: "plan:W1N1:construction:room-plan:v4",
      deliverableId: "deliverable:W1N1:construction",
      invalidatedAt: 499,
      invalidationReason: "exercise fault recovery",
    };
    const retainedStructures = structuredClone(retained.structures);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      roomPlan: retained,
    };

    ensureGovernedSettlementPlans(freshPlanningRoom(false));

    expect(Memory.colonies.W1N1.roomPlan?.structures).toEqual(
      retainedStructures,
    );
    expect(Memory.colonies.W1N1.roomPlan).toMatchObject({
      projectionRevision: 1,
      deliverableId: "deliverable:W1N1:construction",
      invalidatedAt: 499,
    });
    expect(Memory.colonies.W1N1.settlementProjectionFault).toMatchObject({
      status: "active",
      firstTick: 500,
      lastTick: 500,
      attemptCount: 1,
      retryDelayTicks: 5,
      nextRetryTick: 505,
      retainedProjectionRevision: 1,
    });

    Game.time = 501;
    ensureGovernedSettlementPlans(freshPlanningRoom(false));
    expect(Memory.colonies.W1N1.settlementProjectionFault).toMatchObject({
      lastTick: 500,
      attemptCount: 1,
      nextRetryTick: 505,
    });

    Game.time = 505;
    ensureGovernedSettlementPlans(freshPlanningRoom());
    expect(Memory.colonies.W1N1.roomPlan).toMatchObject({
      version: ROOM_PLAN_VERSION,
      horizonRcl: ROOM_PLAN_HORIZON_RCL,
      projectionRevision: 2,
      deliverableId: "deliverable:W1N1:construction",
      generatedReason:
        "Settlement projection generation fault is active: Cannot extend W1N1 to RCL8 without a visible mineral",
    });
    expect(Memory.colonies.W1N1.roomPlan?.invalidatedAt).toBeUndefined();
    expect(Memory.colonies.W1N1.settlementProjectionFault).toMatchObject({
      status: "superseded",
      firstTick: 500,
      lastTick: 500,
      attemptCount: 1,
      nextRetryTick: null,
      resolvedAtTick: 505,
      supersededByRevision: 2,
      supersededByFingerprint:
        Memory.colonies.W1N1.roomPlan?.projectionFingerprint,
    });
  });
});
