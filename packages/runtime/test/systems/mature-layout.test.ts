import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import { assessMatureLinkTopology } from "../../src/systems/economy/mature-energy";
import { extendRoomPlanToRcl8 } from "../../src/systems/settlement/mature-layout";

const ROOM_NAME = "W1N1";

const keyOf = (point: { x: number; y: number }): string =>
  `${point.x}:${point.y}`;

const LAB_STAMP_OFFSETS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -2 },
  { x: 0, y: -1 },
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: 2 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
] as const;

const LAB_SERVICE_GAP_OFFSET = { x: 1, y: -1 } as const;

function transformLabOffset(
  point: { x: number; y: number },
  orientation: number,
): { x: number; y: number } {
  let transformed =
    orientation >= 4 ? { x: -point.x, y: point.y } : { ...point };
  for (let index = 0; index < orientation % 4; index += 1) {
    transformed = { x: -transformed.y, y: transformed.x };
  }
  return transformed;
}

const LAB_ORIENTATIONS = Array.from({ length: 8 }, (_, orientation) => ({
  offsets: LAB_STAMP_OFFSETS.map((point) =>
    transformLabOffset(point, orientation),
  ),
  serviceGap: transformLabOffset(LAB_SERVICE_GAP_OFFSET, orientation),
}));

const ADJACENT_OFFSETS = [-1, 0, 1].flatMap((x) =>
  [-1, 0, 1].filter((y) => x !== 0 || y !== 0).map((y) => ({ x, y })),
);

function plannedLabServiceGap(plan: RoomPlan): { x: number; y: number } {
  const center = plan.structures.find(
    (structure) => structure.id === "lab-output-4",
  );
  if (!center) throw new Error("fixture has no central output lab");
  const labKeys = new Set(
    plan.structures
      .filter((structure) => structure.structureType === "lab")
      .map(keyOf),
  );
  const gaps = ADJACENT_OFFSETS.map((offset) => ({
    x: center.x + offset.x,
    y: center.y + offset.y,
  })).filter((point) => !labKeys.has(keyOf(point)));
  expect(gaps).toHaveLength(1);
  const gap = gaps[0];
  if (!gap) throw new Error("fixture has no lab service gap");
  return gap;
}

function expectEveryLabReachableFromServiceGap(
  plan: RoomPlan,
  expectedGap: { x: number; y: number },
): void {
  expect(plannedLabServiceGap(plan)).toEqual(expectedGap);
  expect(
    plan.structures.some(
      (structure) => keyOf(structure) === keyOf(expectedGap),
    ),
  ).toBe(false);
  expect(plan.reservations).toContainEqual({
    id: "mature-lab-service-gap",
    ...expectedGap,
    kind: "soft",
    reason:
      "walkable reaction-laboratory service gap reserved from structure placement",
  });
  expect(plan.roads.some((road) => keyOf(road) === keyOf(expectedGap))).toBe(
    true,
  );
  expect(plan.roadGraph.nodes).toContainEqual({
    id: "mature-service-lab-cluster",
    kind: "lab",
    ...expectedGap,
  });
  const edge = plan.roadGraph.edges.find(
    (candidate) => candidate.id === "mature-service-hub-to-lab-cluster",
  );
  expect(edge).toBeDefined();
  expect(edge?.tiles.at(-1)).toEqual(expectedGap);

  const blockingStructureKeys = new Set(
    plan.structures
      .filter(
        (structure) =>
          structure.structureType !== "container" &&
          structure.structureType !== "rampart",
      )
      .map(keyOf),
  );
  const reachable = new Set([keyOf(expectedGap)]);
  const frontier = [{ ...expectedGap }];
  for (let index = 0; index < frontier.length; index += 1) {
    const current = frontier[index];
    if (!current) continue;
    for (const offset of ADJACENT_OFFSETS) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      const key = keyOf(next);
      if (
        next.x < 2 ||
        next.x > 47 ||
        next.y < 2 ||
        next.y > 47 ||
        blockingStructureKeys.has(key) ||
        reachable.has(key)
      ) {
        continue;
      }
      reachable.add(key);
      frontier.push(next);
    }
  }
  for (const lab of plan.structures.filter(
    (structure) => structure.structureType === "lab",
  )) {
    expect(
      ADJACENT_OFFSETS.some((offset) =>
        reachable.has(keyOf({ x: lab.x + offset.x, y: lab.y + offset.y })),
      ),
      `${lab.id} has a range-one service position reachable from the lab gap`,
    ).toBe(true);
  }
}

function baseStructure(
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
    reason: `base ${id}`,
  };
}

function basePlan(): RoomPlan {
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
    baseStructure(
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
    baseStructure("tower-1", 23, 23, "tower", 3, 1_200, "bootstrap-defense"),
    baseStructure(
      "tower-1-rampart",
      23,
      23,
      "rampart",
      3,
      500,
      "bootstrap-defense",
    ),
    baseStructure(
      "spawn-rampart",
      20,
      25,
      "rampart",
      2,
      500,
      "bootstrap-defense",
    ),
    baseStructure(
      "source-container-1",
      11,
      10,
      "container",
      2,
      700,
      "source-logistics",
    ),
    baseStructure(
      "source-container-2",
      39,
      10,
      "container",
      2,
      700,
      "source-logistics",
    ),
    baseStructure(
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
      reason: "base road",
    },
    {
      id: "road-22-25",
      x: 22,
      y: 25,
      minRcl: 2,
      activation: "demand" as const,
      phase: "strategic-roads" as const,
      reason: "base road",
    },
  ];
  return {
    version: 3,
    horizonRcl: 3,
    roomName: ROOM_NAME,
    generatedAt: 100,
    generatedReason: "v3 fixture",
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
        reason: "future storage hub",
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

function roomFixture(
  options: {
    walls?: Array<{ x: number; y: number }>;
    structures?: Array<{
      x: number;
      y: number;
      structureType: StructureConstant;
      my?: boolean;
    }>;
    sites?: Array<{
      x: number;
      y: number;
      structureType: BuildableStructureConstant;
      my?: boolean;
    }>;
  } = {},
): Room {
  const walls = new Set((options.walls ?? []).map(keyOf));
  const sources = [
    { id: "source-1", pos: { x: 10, y: 10 } },
    { id: "source-2", pos: { x: 40, y: 10 } },
  ];
  const minerals = [{ id: "mineral-1", pos: { x: 10, y: 40 } }];
  const structures = [
    { x: 20, y: 25, structureType: "spawn" as const },
    ...(options.structures ?? []),
  ].map((structure, index) => ({
    id: `structure-${index}`,
    my: structure.my ?? true,
    structureType: structure.structureType,
    pos: { x: structure.x, y: structure.y },
  }));
  const sites = (options.sites ?? []).map((site, index) => ({
    id: `site-${index}`,
    my: site.my ?? true,
    structureType: site.structureType,
    pos: { x: site.x, y: site.y },
  }));
  return {
    name: ROOM_NAME,
    controller: { pos: { x: 40, y: 40 } },
    getTerrain: () => ({
      get: (x: number, y: number) => (walls.has(`${x}:${y}`) ? 1 : 0),
    }),
    find: (constant: FindConstant) => {
      if (constant === FIND_SOURCES) return sources;
      if (constant === FIND_MINERALS) return minerals;
      if (constant === FIND_STRUCTURES) return structures;
      if (constant === FIND_CONSTRUCTION_SITES) return sites;
      return [];
    },
  } as unknown as Room;
}

const expectedCounts: Record<string, number> = {
  extension: 60,
  tower: 6,
  spawn: 3,
  storage: 1,
  terminal: 1,
  link: 6,
  lab: 10,
  extractor: 1,
  factory: 1,
  observer: 1,
  powerSpawn: 1,
  nuker: 1,
};

describe("mature RCL8 room layout", () => {
  beforeEach(() => {
    vi.stubGlobal("FIND_SOURCES", 1);
    vi.stubGlobal("FIND_MINERALS", 2);
    vi.stubGlobal("FIND_STRUCTURES", 3);
    vi.stubGlobal("FIND_CONSTRUCTION_SITES", 4);
    vi.stubGlobal("TERRAIN_MASK_WALL", 1);
    vi.stubGlobal("TERRAIN_MASK_SWAMP", 2);
  });

  it("preserves the v3 footprint and extends it to the exact mature legal inventory", () => {
    const base = basePlan();
    const before = structuredClone(base);
    const plan = extendRoomPlanToRcl8(roomFixture(), base);

    expect(base).toEqual(before);
    expect(plan).toMatchObject({ version: 4, horizonRcl: 8 });
    expect(plan.stages).toEqual(
      ROOM_DEVELOPMENT_STAGES.map((stage) => ({
        ...stage,
        prerequisiteStageIds: [...stage.prerequisiteStageIds],
      })),
    );
    for (const record of before.structures) {
      expect(plan.structures).toContainEqual(
        expect.objectContaining({
          id: record.id,
          x: record.x,
          y: record.y,
          structureType: record.structureType,
        }),
      );
    }
    for (const road of before.roads) {
      expect(plan.roads).toContainEqual(
        expect.objectContaining({ id: road.id, x: road.x, y: road.y }),
      );
    }
    for (const [structureType, count] of Object.entries(expectedCounts)) {
      expect(
        plan.structures.filter(
          (structure) => structure.structureType === structureType,
        ),
        structureType,
      ).toHaveLength(count);
    }
    expect(
      plan.structures.every(
        (structure) =>
          structure.stage !== undefined &&
          (structure.strategicWeight ?? 0) > 0 &&
          structure.requiredForStage !== undefined,
      ),
    ).toBe(true);
    const baseRoadIds = new Set(before.roads.map((road) => road.id));
    const matureRoads = plan.roads.filter((road) => !baseRoadIds.has(road.id));
    expect(matureRoads.length).toBeGreaterThan(0);
    expect(new Set(plan.roads.map((road) => road.id)).size).toBe(
      plan.roads.length,
    );
    expect(new Set(plan.roads.map(keyOf)).size).toBe(plan.roads.length);
    expect(new Set(plan.roadGraph.nodes.map((node) => node.id)).size).toBe(
      plan.roadGraph.nodes.length,
    );
    expect(new Set(plan.roadGraph.edges.map((edge) => edge.id)).size).toBe(
      plan.roadGraph.edges.length,
    );
    expect(
      plan.roads.every(
        (road) =>
          road.stage !== undefined &&
          (road.strategicWeight ?? 0) > 0 &&
          road.requiredForStage === true,
      ),
    ).toBe(true);
    expect(
      before.roads.every(
        (road) =>
          plan.roads.find((candidate) => candidate.id === road.id)?.stage ===
          "logistics",
      ),
    ).toBe(true);
    expect(
      matureRoads.every(
        (road) =>
          road.id === `mature-service-road-${road.x}-${road.y}` &&
          road.activation === "demand" &&
          road.minRcl >= 3 &&
          road.minRcl <= 8,
      ),
    ).toBe(true);
    const topology = assessMatureLinkTopology(plan);
    expect(topology).toMatchObject({
      status: "ready",
      roles: {
        sources: [{ sourceId: "source-1" }, { sourceId: "source-2" }],
      },
    });
    const roles = topology.roles;
    expect(roles).not.toBeNull();
    if (!roles) return;
    const minRclById = new Map(
      plan.structures.map((structure) => [structure.id, structure.minRcl]),
    );
    expect(
      roles.sources.map((source) => ({
        sourceId: source.sourceId,
        minRcl: minRclById.get(source.planId),
      })),
    ).toEqual([
      { sourceId: "source-1", minRcl: 5 },
      { sourceId: "source-2", minRcl: 6 },
    ]);
    expect(minRclById.get(roles.corePlanId)).toBe(5);
    expect(minRclById.get(roles.controllerPlanId)).toBe(7);
    expect(
      [5, 6, 7, 8].map(
        (rcl) =>
          plan.structures.filter(
            (structure) =>
              structure.structureType === "link" && structure.minRcl <= rcl,
          ).length,
      ),
    ).toEqual([2, 3, 4, 6]);
  });

  it("connects every mature service consumer to the hub through explicit graph evidence", () => {
    const plan = extendRoomPlanToRcl8(roomFixture(), basePlan());
    const roadKeys = new Set(plan.roads.map(keyOf));
    const requiredTargets = [
      "spawn-2",
      "spawn-3",
      "tower-1",
      "tower-2",
      "tower-3",
      "tower-4",
      "tower-5",
      "tower-6",
      "storage-1",
      "terminal-1",
      "link-1",
      "link-2",
      "link-3",
      "link-4",
      "link-5",
      "link-6",
      "lab-cluster",
      "extractor-1",
      "factory-1",
      "observer-1",
      "power-spawn-1",
      "nuker-1",
    ];

    expect(plan.roadGraph.nodes).toContainEqual({
      id: "hub",
      kind: "hub",
      ...plan.anchors.hub,
    });
    for (const targetId of requiredTargets) {
      const node = plan.roadGraph.nodes.find(
        (candidate) => candidate.id === `mature-service-${targetId}`,
      );
      const edge = plan.roadGraph.edges.find(
        (candidate) => candidate.id === `mature-service-hub-to-${targetId}`,
      );
      expect(node, targetId).toBeDefined();
      expect(edge, targetId).toMatchObject({
        from: "hub",
        to: `mature-service-${targetId}`,
      });
      if (!node || !edge) continue;

      const route = [plan.anchors.hub, ...edge.tiles];
      for (let index = 1; index < route.length; index += 1) {
        expect(
          Math.max(
            Math.abs((route[index]?.x ?? 0) - (route[index - 1]?.x ?? 0)),
            Math.abs((route[index]?.y ?? 0) - (route[index - 1]?.y ?? 0)),
          ),
          `${targetId} discontinuity at ${index}`,
        ).toBe(1);
      }
      expect(
        Math.max(
          Math.abs((route.at(-1)?.x ?? 0) - node.x),
          Math.abs((route.at(-1)?.y ?? 0) - node.y),
        ),
        `${targetId} endpoint range`,
      ).toBeLessThanOrEqual(1);
      expect(
        edge.tiles.every((tile) => roadKeys.has(keyOf(tile))),
        `${targetId} edge tiles are planned roads`,
      ).toBe(true);
    }
  });

  it("assigns the scarce RCL5 source link to the highest avoided haul route", () => {
    const base = basePlan();
    base.anchors.sources = [
      {
        sourceId: "source-a-near",
        x: 40,
        y: 10,
        container: { x: 39, y: 10 },
      },
      {
        sourceId: "source-b-far",
        x: 10,
        y: 10,
        container: { x: 11, y: 10 },
      },
    ];
    base.roadGraph.edges.push(
      {
        id: "hub->source-0",
        from: "hub",
        to: "source-0",
        tiles: Array.from({ length: 3 }, (_, index) => ({
          x: 30 + index,
          y: 20,
        })),
      },
      {
        id: "hub->source-1",
        from: "hub",
        to: "source-1",
        tiles: Array.from({ length: 18 }, (_, index) => ({
          x: 25 - Math.min(index, 13),
          y: 24 - Math.max(0, index - 13),
        })),
      },
    );

    const plan = extendRoomPlanToRcl8(roomFixture(), base);
    const roles = assessMatureLinkTopology(plan).roles;
    expect(roles).not.toBeNull();
    const minRclById = new Map(
      plan.structures.map((structure) => [structure.id, structure.minRcl]),
    );
    expect(
      roles?.sources.map((source) => ({
        sourceId: source.sourceId,
        minRcl: minRclById.get(source.planId),
      })),
    ).toEqual([
      { sourceId: "source-a-near", minRcl: 6 },
      { sourceId: "source-b-far", minRcl: 5 },
    ]);
  });

  it("adopts safe live source-link infrastructure before scheduling new source links", () => {
    const base = basePlan();
    base.anchors.sources = [
      {
        sourceId: "source-a-live",
        x: 40,
        y: 10,
        container: { x: 39, y: 10 },
      },
      {
        sourceId: "source-b-longer",
        x: 10,
        y: 10,
        container: { x: 11, y: 10 },
      },
    ];
    base.roadGraph.edges.push(
      {
        id: "hub->source-0",
        from: "hub",
        to: "source-0",
        tiles: [{ x: 30, y: 20 }],
      },
      {
        id: "hub->source-1",
        from: "hub",
        to: "source-1",
        tiles: Array.from({ length: 18 }, (_, index) => ({
          x: 25 - Math.min(index, 13),
          y: 24 - Math.max(0, index - 13),
        })),
      },
    );

    const plan = extendRoomPlanToRcl8(
      roomFixture({
        structures: [{ x: 38, y: 10, structureType: "link", my: true }],
      }),
      base,
    );
    const roles = assessMatureLinkTopology(plan).roles;
    const liveRole = roles?.sources.find(
      (source) => source.sourceId === "source-a-live",
    );
    expect(liveRole).toBeDefined();
    expect(
      plan.structures.find((structure) => structure.id === liveRole?.planId),
    ).toMatchObject({ x: 38, y: 10, minRcl: 5 });
  });

  it("keeps every reaction output within range two of both input labs", () => {
    const plan = extendRoomPlanToRcl8(roomFixture(), basePlan());
    const inputOne = plan.structures.find(
      (entry) => entry.id === "lab-input-1",
    );
    const inputTwo = plan.structures.find(
      (entry) => entry.id === "lab-input-2",
    );
    const outputs = plan.structures.filter((entry) =>
      entry.id.startsWith("lab-output-"),
    );
    expect(inputOne).toBeDefined();
    expect(inputTwo).toBeDefined();
    expect(outputs).toHaveLength(8);
    const range = (left: RoomPlanStructure, right: RoomPlanStructure) =>
      Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
    for (const output of outputs) {
      expect(range(output, inputOne as RoomPlanStructure)).toBeLessThanOrEqual(
        2,
      );
      expect(range(output, inputTwo as RoomPlanStructure)).toBeLessThanOrEqual(
        2,
      );
    }
  });

  it("reserves the transformed service gap and proves range-one access for every lab in all eight orientations", () => {
    const center = { x: 32, y: 32 };

    for (const [orientationIndex, orientation] of LAB_ORIENTATIONS.entries()) {
      const existingLabs = orientation.offsets.map((offset) => ({
        x: center.x + offset.x,
        y: center.y + offset.y,
        structureType: "lab" as const,
        my: true,
      }));
      const expectedGap = {
        x: center.x + orientation.serviceGap.x,
        y: center.y + orientation.serviceGap.y,
      };
      const room = roomFixture({ structures: existingLabs });
      const first = extendRoomPlanToRcl8(room, basePlan());
      const second = extendRoomPlanToRcl8(room, basePlan());

      expect(
        second,
        `orientation ${orientationIndex} is deterministic`,
      ).toEqual(first);
      expect(
        new Set(
          first.structures
            .filter((structure) => structure.structureType === "lab")
            .map(keyOf),
        ),
        `orientation ${orientationIndex} preserves the live lab footprint`,
      ).toEqual(new Set(existingLabs.map(keyOf)));
      expectEveryLabReachableFromServiceGap(first, expectedGap);
    }
  });

  it("rejects a tempting blocked gap before adopting the lab orientation", () => {
    const baseline = extendRoomPlanToRcl8(roomFixture(), basePlan());
    const temptingGap = plannedLabServiceGap(baseline);

    const wallPlan = extendRoomPlanToRcl8(
      roomFixture({ walls: [temptingGap] }),
      basePlan(),
    );
    const wallGap = plannedLabServiceGap(wallPlan);
    expect(wallGap).not.toEqual(temptingGap);
    expect(
      wallPlan.roads.some((road) => keyOf(road) === keyOf(temptingGap)),
    ).toBe(false);
    expectEveryLabReachableFromServiceGap(wallPlan, wallGap);

    const occupiedPlan = extendRoomPlanToRcl8(
      roomFixture({
        structures: [
          {
            ...temptingGap,
            structureType: "extension",
            my: false,
          },
        ],
      }),
      basePlan(),
    );
    const occupiedGap = plannedLabServiceGap(occupiedPlan);
    expect(occupiedGap).not.toEqual(temptingGap);
    expect(
      occupiedPlan.structures.some(
        (structure) => keyOf(structure) === keyOf(temptingGap),
      ),
    ).toBe(false);
    expectEveryLabReachableFromServiceGap(occupiedPlan, occupiedGap);
  });

  describe.each(
    LAB_ORIENTATIONS.map((orientation, orientationIndex) => ({
      orientation,
      orientationIndex,
    })),
  )(
    "hostile occupancy at orientation $orientationIndex's exact service gap",
    ({ orientation }) => {
      const center = { x: 32, y: 32 };
      const existingLabs = orientation.offsets.map((offset) => ({
        x: center.x + offset.x,
        y: center.y + offset.y,
        structureType: "lab" as const,
        my: true,
      }));
      const exactGap = {
        x: center.x + orientation.serviceGap.x,
        y: center.y + orientation.serviceGap.y,
      };

      it("fails closed over a hostile structure", () => {
        expect(() =>
          extendRoomPlanToRcl8(
            roomFixture({
              structures: [
                ...existingLabs,
                {
                  ...exactGap,
                  structureType: "extension",
                  my: false,
                },
              ],
            }),
            basePlan(),
          ),
        ).toThrow(/No serviceable ten-lab reaction cluster remains/);
      });

      it("fails closed over a hostile construction site", () => {
        expect(() =>
          extendRoomPlanToRcl8(
            roomFixture({
              structures: existingLabs,
              sites: [
                {
                  ...exactGap,
                  structureType: "extension",
                  my: false,
                },
              ],
            }),
            basePlan(),
          ),
        ).toThrow(/No serviceable ten-lab reaction cluster remains/);
      });
    },
  );

  it("is deterministic and excludes walls, exits, natural objects, roads, and incompatible sites", () => {
    const walls = [
      { x: 24, y: 24 },
      { x: 24, y: 26 },
      { x: 26, y: 24 },
      { x: 26, y: 26 },
    ];
    const incompatibleSite = {
      x: 25,
      y: 24,
      structureType: "extension" as const,
      my: false,
    };
    const room = roomFixture({ walls, sites: [incompatibleSite] });
    const first = extendRoomPlanToRcl8(room, basePlan());
    const second = extendRoomPlanToRcl8(room, basePlan());
    expect(second).toEqual(first);

    const excluded = new Set([
      ...walls.map(keyOf),
      keyOf(incompatibleSite),
      "10:10",
      "40:10",
      "40:40",
      ...first.roads.map(keyOf),
    ]);
    const baseIds = new Set(basePlan().structures.map((entry) => entry.id));
    for (const entry of first.structures.filter(
      (candidate) => !baseIds.has(candidate.id),
    )) {
      expect(entry.x).toBeGreaterThanOrEqual(2);
      expect(entry.x).toBeLessThanOrEqual(47);
      expect(entry.y).toBeGreaterThanOrEqual(2);
      expect(entry.y).toBeLessThanOrEqual(47);
      if (entry.structureType !== "extractor") {
        expect(excluded.has(keyOf(entry)), entry.id).toBe(false);
        expect(keyOf(entry)).not.toBe("10:40");
      } else {
        expect(keyOf(entry)).toBe("10:40");
      }
    }

    const baseRoadIds = new Set(basePlan().roads.map((road) => road.id));
    const incompatibleStructureKeys = new Set(
      first.structures
        .filter(
          (structure) =>
            structure.structureType !== "container" &&
            structure.structureType !== "rampart",
        )
        .map(keyOf),
    );
    for (const road of first.roads.filter(
      (candidate) => !baseRoadIds.has(candidate.id),
    )) {
      expect(road.x).toBeGreaterThanOrEqual(2);
      expect(road.x).toBeLessThanOrEqual(47);
      expect(road.y).toBeGreaterThanOrEqual(2);
      expect(road.y).toBeLessThanOrEqual(47);
      expect(walls.map(keyOf)).not.toContain(keyOf(road));
      expect(["10:10", "40:10", "10:40", "40:40"]).not.toContain(keyOf(road));
      expect(keyOf(road)).not.toBe(keyOf(incompatibleSite));
      expect(incompatibleStructureKeys.has(keyOf(road))).toBe(false);
      expect(first.reservations).toContainEqual(
        expect.objectContaining({
          id: `reservation-${road.id}`,
          x: road.x,
          y: road.y,
          kind: "soft",
        }),
      );
    }
  });

  it("blocks hostile same-type structures without adopting them into the mature plan", () => {
    const hostileTower = {
      x: 26,
      y: 24,
      structureType: "tower" as const,
      my: false,
    };
    const plan = extendRoomPlanToRcl8(
      roomFixture({ structures: [hostileTower] }),
      basePlan(),
    );

    expect(
      plan.structures.some(
        (structure) =>
          structure.structureType === "tower" &&
          keyOf(structure) === keyOf(hostileTower),
      ),
    ).toBe(false);
    expect(plan.roads.some((road) => keyOf(road) === keyOf(hostileTower))).toBe(
      false,
    );
  });

  it("routes around a hostile source-link tile without adopting hostile infrastructure", () => {
    const hostileLink = {
      x: 12,
      y: 10,
      structureType: "link" as const,
      my: false,
    };
    const plan = extendRoomPlanToRcl8(
      roomFixture({ structures: [hostileLink] }),
      basePlan(),
    );

    expect(
      plan.structures.some(
        (structure) =>
          structure.structureType === "link" &&
          keyOf(structure) === keyOf(hostileLink),
      ),
    ).toBe(false);
    expect(assessMatureLinkTopology(plan).status).toBe("ready");
  });

  it("fails closed with a concrete topology fault when terrain seals a source buffer", () => {
    const sealed = [
      { x: 10, y: 9 },
      { x: 10, y: 11 },
      { x: 11, y: 9 },
      { x: 11, y: 11 },
      { x: 12, y: 9 },
      { x: 12, y: 10 },
      { x: 12, y: 11 },
    ];

    expect(() =>
      extendRoomPlanToRcl8(roomFixture({ walls: sealed }), basePlan()),
    ).toThrow(
      /Mature energy topology fault in W1N1: no legal adjacent link tile for source-link service for source-1/,
    );
  });
});
