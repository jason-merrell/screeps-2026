import { beforeEach, describe, expect, it, vi } from "vitest";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import {
  ROOM_DEVELOPMENT_STAGES,
  ROOM_PLAN_HORIZON_RCL,
  ROOM_PLAN_VERSION,
  type RoomDevelopmentStageId,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import type { WorldSnapshot } from "../../src/runtime/context";
import {
  eligiblePlannedStructures,
  planConstruction,
  shouldActivateFortifications,
} from "../../src/systems/construction/plan";
import {
  CANONICAL_FIXTURE_STRUCTURE_ID_PREFIX,
  currentRoomPlanFixture,
} from "../fixtures/current-room-plan";

const ROOM = "W1N1";

function requirement(
  id: string,
  stage: RoomDevelopmentStageId,
  structureType: BuildableStructureConstant,
  x: number,
  y: number,
  minRcl: number,
  priority: number,
  strategicWeight: number,
  activation: "automatic" | "demand" | "defense" = "automatic",
  phase:
    | "bootstrap-capacity"
    | "bootstrap-defense"
    | "source-logistics"
    | "controller-logistics"
    | "core-economy"
    | "capacity-expansion"
    | "advanced-operations"
    | "mature-operations"
    | "defense-envelope" = "core-economy",
): RoomPlanStructure {
  return {
    id,
    stage,
    structureType,
    x,
    y,
    minRcl,
    priority,
    strategicWeight,
    requiredForStage: true,
    activation,
    reservation: "hard",
    phase,
    reason: `test ${id}`,
  };
}

function maturePlan(roomName = ROOM): RoomPlan {
  return currentRoomPlanFixture({
    version: ROOM_PLAN_VERSION,
    horizonRcl: ROOM_PLAN_HORIZON_RCL,
    roomName,
    generatedAt: 100,
    generatedReason: "test",
    stages: ROOM_DEVELOPMENT_STAGES.map((stage) => ({
      ...stage,
      prerequisiteStageIds: [...stage.prerequisiteStageIds],
    })),
    anchors: {
      spawn: { name: "Spawn1", x: 10, y: 10 },
      hub: { x: 12, y: 10 },
      controller: {
        x: 40,
        y: 40,
        service: { x: 39, y: 40 },
      },
      sources: [
        {
          sourceId: "source-1",
          x: 5,
          y: 5,
          container: { x: 6, y: 5 },
        },
      ],
    },
    reservations: [],
    structures: [
      requirement(
        "spawn-1",
        "bootstrap",
        "spawn",
        10,
        10,
        1,
        2_000,
        20,
        "automatic",
        "bootstrap-capacity",
      ),
      requirement(
        "tower-1",
        "bootstrap",
        "tower",
        11,
        10,
        3,
        1_200,
        8,
        "automatic",
        "bootstrap-defense",
      ),
      requirement(
        "source-container-1",
        "logistics",
        "container",
        6,
        5,
        2,
        700,
        6,
        "demand",
        "source-logistics",
      ),
      requirement(
        "storage-1",
        "core-economy",
        "storage",
        12,
        10,
        4,
        1_400,
        20,
        "automatic",
        "core-economy",
      ),
      requirement(
        "capacity-extension-11",
        "core-economy",
        "extension",
        13,
        10,
        4,
        900,
        2,
        "automatic",
        "capacity-expansion",
      ),
      requirement(
        "terminal-1",
        "advanced-operations",
        "terminal",
        14,
        10,
        6,
        1_050,
        12,
        "automatic",
        "advanced-operations",
      ),
      requirement(
        "observer-1",
        "mature-rcl8",
        "observer",
        15,
        10,
        8,
        650,
        5,
        "automatic",
        "mature-operations",
      ),
      requirement(
        "defense-rampart-1",
        "mature-rcl8",
        "rampart",
        16,
        10,
        4,
        1_100,
        1,
        "defense",
        "defense-envelope",
      ),
    ],
    roads: [],
    roadGraph: { nodes: [], edges: [] },
    defense: {
      strategy: "terrain-mincut-v1",
      protectedTiles: [
        { x: 10, y: 10 },
        { x: 12, y: 10 },
      ],
      perimeter: [{ x: 16, y: 10 }],
    },
  });
}

function built(
  structureType: StructureConstant,
  x: number,
  y: number,
): Structure {
  return {
    structureType,
    my: true,
    pos: { x, y, roomName: ROOM },
  } as unknown as Structure;
}

function site(
  structureType: BuildableStructureConstant,
  x: number,
  y: number,
): ConstructionSite {
  return {
    structureType,
    my: true,
    pos: { x, y, roomName: ROOM },
  } as unknown as ConstructionSite;
}

function builtCanonicalFixtureStructures(): Structure[] {
  return maturePlan()
    .structures.filter((structure) =>
      structure.id.startsWith(CANONICAL_FIXTURE_STRUCTURE_ID_PREFIX),
    )
    .map((structure) =>
      built(structure.structureType, structure.x, structure.y),
    );
}

function roomWith(
  options: {
    structures?: Structure[];
    sites?: ConstructionSite[];
    workforce?: number;
    hostileCount?: number;
    level?: number;
  } = {},
): Room {
  const structures = [
    ...builtCanonicalFixtureStructures(),
    ...(options.structures ?? [
      built("spawn", 10, 10),
      built("tower", 11, 10),
      built("container", 6, 5),
    ]),
  ];
  const sites = options.sites ?? [];
  const workforce = Array.from(
    { length: options.workforce ?? 5 },
    (_, index) => ({ name: `creep-${index}` }) as Creep,
  );
  const hostiles = Array.from(
    { length: options.hostileCount ?? 0 },
    () => ({}) as Creep,
  );

  return {
    name: ROOM,
    controller: {
      level: options.level ?? 8,
      my: true,
      pos: { x: 40, y: 40, roomName: ROOM },
    },
    find: (constant: number) => {
      if (constant === FIND_MY_STRUCTURES) return structures;
      if (constant === FIND_STRUCTURES) return structures;
      if (constant === FIND_MY_CONSTRUCTION_SITES) return sites;
      if (constant === FIND_CONSTRUCTION_SITES) return sites;
      if (constant === FIND_MY_CREEPS) return workforce;
      if (constant === FIND_HOSTILE_CREEPS) return hostiles;
      if (constant === FIND_SOURCES) return [];
      if (constant === FIND_MINERALS) return [];
      return [];
    },
    lookForAt: (constant: string, x: number, y: number) => {
      if (constant === LOOK_STRUCTURES) {
        return structures.filter(
          (structure) => structure.pos.x === x && structure.pos.y === y,
        );
      }
      if (constant === LOOK_CONSTRUCTION_SITES) {
        return sites.filter((entry) => entry.pos.x === x && entry.pos.y === y);
      }
      return [];
    },
    getTerrain: () => ({ get: () => 0 }),
  } as unknown as Room;
}

function world(room: Room): WorldSnapshot {
  return { rooms: [room] } as unknown as WorldSnapshot;
}

function installGlobals(plan = maturePlan()): void {
  Object.assign(globalThis, {
    FIND_MY_STRUCTURES: 1,
    FIND_STRUCTURES: 2,
    FIND_MY_CONSTRUCTION_SITES: 3,
    FIND_CONSTRUCTION_SITES: 4,
    FIND_MY_CREEPS: 5,
    FIND_HOSTILE_CREEPS: 6,
    FIND_SOURCES: 7,
    FIND_MINERALS: 8,
    LOOK_STRUCTURES: "structure",
    LOOK_CONSTRUCTION_SITES: "constructionSite",
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_RAMPART: "rampart",
    STRUCTURE_ROAD: "road",
    STRUCTURE_TOWER: "tower",
    TERRAIN_MASK_WALL: 1,
    MAX_CONSTRUCTION_SITES: 100,
    CONTROLLER_STRUCTURES: {
      spawn: { 8: 3 },
      extension: { 8: 60 },
      tower: { 8: 6 },
      container: { 8: 5 },
      storage: { 8: 1 },
      terminal: { 8: 1 },
      observer: { 8: 1 },
      rampart: { 8: 2_500 },
      road: { 8: 2_500 },
    },
    Game: { time: 100, constructionSites: {} },
    Memory: {
      version: 5,
      colonies: {
        [plan.roomName]: {
          roomName: plan.roomName,
          discoveredAt: 1,
          roomPlan: plan,
        },
      },
    },
  });
}

describe("stage-aware construction activation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installGlobals();
    activateApprovedColonyGovernance(ROOM);
  });

  it("requires RCL4 and either an incursion or stable tower-backed workforce for fortifications", () => {
    expect(shouldActivateFortifications(3, 8, 2, true)).toBe(false);
    expect(shouldActivateFortifications(4, 3, 1, false)).toBe(false);
    expect(shouldActivateFortifications(4, 4, 0, false)).toBe(false);
    expect(shouldActivateFortifications(4, 4, 1, false)).toBe(true);
    expect(shouldActivateFortifications(4, 0, 0, true)).toBe(true);
  });

  it("activates source, controller, and defense demand only when their readiness evidence exists", () => {
    const plan = maturePlan();
    plan.structures.push({
      ...requirement(
        "controller-container",
        "logistics",
        "container",
        39,
        40,
        2,
        600,
        1,
        "demand",
        "controller-logistics",
      ),
      requiredForStage: false,
    });

    expect(
      eligiblePlannedStructures(plan, 4, 2, { towerCount: 1 }).map(
        (entry) => entry.id,
      ),
    ).not.toContain("controller-container");

    const eligible = eligiblePlannedStructures(plan, 4, 4, {
      towerCount: 1,
    }).map((entry) => entry.id);
    expect(eligible).toContain("source-container-1");
    expect(eligible).toContain("controller-container");
    expect(eligible).toContain("defense-rampart-1");
  });

  it("turns an RCL8 bootstrap footprint into immediate core-economy work without leaping stages", () => {
    const intents = planConstruction(world(roomWith()));
    const sites = intents.filter(
      (intent) => intent.type === "createConstructionSite",
    );

    expect(sites).toHaveLength(3);
    expect(sites[0]).toMatchObject({
      x: 12,
      y: 10,
      structureType: "storage",
      reason: "core-economy: test storage-1",
    });
    expect(sites.map((intent) => intent.structureType)).toEqual([
      "storage",
      "rampart",
      "extension",
    ]);
    expect(sites.some((intent) => intent.structureType === "terminal")).toBe(
      false,
    );
    expect(sites.some((intent) => intent.structureType === "observer")).toBe(
      false,
    );
  });

  it("never exceeds the per-room active-site budget", () => {
    const existingSites = Array.from({ length: 5 }, (_, index) =>
      site("road", 20 + index, 20),
    );
    const intents = planConstruction(world(roomWith({ sites: existingSites })));

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ structureType: "storage" });
  });

  it("honors the global construction-site limit before emitting intents", () => {
    Game.constructionSites = Object.fromEntries(
      Array.from({ length: 99 }, (_, index) => [
        `site-${index}`,
        {} as ConstructionSite,
      ]),
    );
    expect(planConstruction(world(roomWith()))).toHaveLength(1);

    Game.constructionSites = {
      ...Game.constructionSites,
      "site-99": {} as ConstructionSite,
    };
    expect(planConstruction(world(roomWith()))).toEqual([]);
  });

  it("is idempotent for an already-created site and skips incompatible occupancy", () => {
    const intents = planConstruction(
      world(
        roomWith({
          sites: [site("storage", 12, 10)],
          structures: [
            built("spawn", 10, 10),
            built("tower", 11, 10),
            built("container", 6, 5),
            built("constructedWall", 13, 10),
          ],
        }),
      ),
    );

    expect(
      intents.some(
        (intent) =>
          intent.type === "createConstructionSite" &&
          intent.x === 12 &&
          intent.y === 10,
      ),
    ).toBe(false);
    expect(
      intents.some(
        (intent) =>
          intent.type === "createConstructionSite" &&
          intent.x === 13 &&
          intent.y === 10,
      ),
    ).toBe(false);
  });
});
