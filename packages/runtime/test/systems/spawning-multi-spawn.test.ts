import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnIntent } from "../../src/intents/types";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import type { WorldSnapshot } from "../../src/runtime/context";
import {
  assessWorkforceReadiness,
  planSpawning,
} from "../../src/systems/spawning/plan";
import {
  bodyCost,
  generalistBodyForDemand,
} from "../../src/systems/spawning/workforce";
import { currentRoomPlanFixture } from "../fixtures/current-room-plan";

const ROOM = "W1N1";

function logisticsPlan(routeLength = 5): RoomPlan {
  const requirement = (
    id: string,
    x: number,
    y: number,
    structureType: BuildableStructureConstant,
    minRcl: number,
    stage: NonNullable<RoomPlanStructure["stage"]>,
    phase: RoomPlanStructure["phase"],
  ): RoomPlanStructure => ({
    id,
    x,
    y,
    structureType,
    minRcl,
    priority: 1_000 - minRcl,
    activation: "automatic",
    reservation: "hard",
    phase,
    reason: `${stage} projection evidence`,
    stage,
    strategicWeight: 5,
    requiredForStage: true,
  });
  return currentRoomPlanFixture({
    version: 4,
    horizonRcl: 8,
    roomName: ROOM,
    generatedAt: 1,
    generatedReason: "test",
    stages: ROOM_DEVELOPMENT_STAGES.map((stage) => ({
      ...stage,
      prerequisiteStageIds: [...stage.prerequisiteStageIds],
    })),
    anchors: {
      spawn: { name: "SpawnA", x: 25, y: 25 },
      hub: { x: 24, y: 25 },
      controller: null,
      sources: [
        {
          sourceId: "source-1",
          x: 5,
          y: 5,
          container: { x: 6, y: 5 },
        },
        {
          sourceId: "source-2",
          x: 40,
          y: 40,
          container: { x: 39, y: 40 },
        },
      ],
    },
    reservations: [],
    structures: [
      requirement(
        "spawn-1",
        25,
        25,
        "spawn",
        1,
        "bootstrap",
        "bootstrap-capacity",
      ),
      requirement(
        "source-container-1",
        6,
        5,
        "container",
        2,
        "logistics",
        "source-logistics",
      ),
      requirement(
        "storage-1",
        24,
        25,
        "storage",
        4,
        "core-economy",
        "core-economy",
      ),
      requirement(
        "terminal-1",
        23,
        25,
        "terminal",
        6,
        "advanced-operations",
        "advanced-operations",
      ),
      requirement(
        "observer-1",
        22,
        25,
        "observer",
        8,
        "mature-rcl8",
        "mature-operations",
      ),
    ],
    roads: [],
    roadGraph: {
      nodes: [
        { id: "spawn", kind: "spawn", x: 25, y: 25 },
        { id: "hub", kind: "hub", x: 24, y: 25 },
        { id: "source-0", kind: "source", x: 6, y: 5 },
        { id: "source-1", kind: "source", x: 39, y: 40 },
      ],
      edges: [
        { id: "spawn->hub", from: "spawn", to: "hub", tiles: [] },
        {
          id: "hub->source-0",
          from: "hub",
          to: "source-0",
          tiles: Array.from({ length: routeLength }, (_, index) => ({
            x: index + 2,
            y: 10,
          })),
        },
        {
          id: "hub->source-1",
          from: "hub",
          to: "source-1",
          tiles: Array.from({ length: routeLength }, (_, index) => ({
            x: index + 2,
            y: 20,
          })),
        },
      ],
    },
    defense: {
      strategy: "terrain-mincut-v1",
      protectedTiles: [],
      perimeter: [],
    },
  });
}

function room(
  options: {
    level?: number;
    energyAvailable?: number;
    energyCapacityAvailable?: number;
    liveBuffers?: boolean;
  } = {},
): Room {
  const liveBuffers = options.liveBuffers ?? false;
  return {
    name: ROOM,
    controller: { level: options.level ?? 3, my: true },
    energyAvailable: options.energyAvailable ?? 1_800,
    energyCapacityAvailable: options.energyCapacityAvailable ?? 1_800,
    find: (constant: number) => {
      if (constant === FIND_SOURCES) return [{ id: "s1" }, { id: "s2" }];
      if (constant === FIND_MY_CONSTRUCTION_SITES) return [];
      return [];
    },
    lookForAt: (constant: string) =>
      constant === LOOK_STRUCTURES && liveBuffers
        ? [{ structureType: STRUCTURE_CONTAINER }]
        : [],
  } as unknown as Room;
}

function creep(
  creepRoom: Room,
  name: string,
  body: BodyPartConstant[] = ["work", "carry", "move"],
  spawning = false,
  ticksToLive = 1_400,
): Creep {
  return {
    name,
    room: creepRoom,
    pos: { getRangeTo: () => 1 } as unknown as RoomPosition,
    spawning,
    ticksToLive: spawning ? undefined : ticksToLive,
    body: body.map((type) => ({ type, hits: 100 })),
    getActiveBodyparts: (part: BodyPartConstant) =>
      body.filter((type) => type === part).length,
  } as unknown as Creep;
}

function spawn(spawnRoom: Room, name: string): StructureSpawn {
  return {
    name,
    room: spawnRoom,
    spawning: null,
  } as unknown as StructureSpawn;
}

function world(
  spawnRoom: Room,
  creeps: Creep[],
  spawnNames = ["SpawnC", "SpawnA", "SpawnB"],
): WorldSnapshot {
  return {
    tick: 100,
    rooms: [spawnRoom],
    creeps,
    spawns: spawnNames.map((name) => spawn(spawnRoom, name)),
  } as unknown as WorldSnapshot;
}

function plannedSpawns(snapshot: WorldSnapshot): SpawnIntent[] {
  return planSpawning(snapshot).filter(
    (intent): intent is SpawnIntent => intent.type === "spawn",
  );
}

function installGlobals(plan?: RoomPlan): void {
  Object.assign(globalThis, {
    WORK: "work",
    CARRY: "carry",
    MOVE: "move",
    CREEP_LIFE_TIME: 1_500,
    CREEP_SPAWN_TIME: 3,
    FIND_SOURCES: 1,
    FIND_MY_CONSTRUCTION_SITES: 2,
    LOOK_STRUCTURES: "structure",
    STRUCTURE_CONTAINER: "container",
    Game: { time: 100, creeps: {} },
    Memory: {
      version: 5,
      colonies: {
        [ROOM]: {
          roomName: ROOM,
          discoveredAt: 1,
          ...(plan ? { roomPlan: plan } : {}),
        },
      },
    },
  });
}

describe("competitive multi-spawn scheduling", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installGlobals();
  });

  it("spawns exactly once for a one-creep viable workforce deficit", () => {
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room();
    const targetBody = generalistBodyForDemand(1_800, 2, 5);
    const creeps = Array.from({ length: 4 }, (_, index) =>
      creep(spawnRoom, `worker-${index}`, targetBody),
    );

    const intents = plannedSpawns(world(spawnRoom, creeps));
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: "spawn",
      spawnName: "SpawnA",
      name: `worker-${ROOM}-100-1`,
      reason: "workforce demand 4/5",
      trace: {
        procedureId: `procedure:${ROOM}:spawning:maintain-workforce-capacity:maintain-general-workforce`,
      },
    });
  });

  it("allocates globally unique deterministic names across concurrent same-room spawns", () => {
    Game.creeps[`worker-${ROOM}-100-1`] = {} as Creep;
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room();
    const creeps = [
      creep(spawnRoom, "worker-existing-1"),
      creep(spawnRoom, "worker-existing-2"),
    ];

    const intents = plannedSpawns(world(spawnRoom, creeps));
    expect(intents.map((intent) => intent.spawnName)).toEqual([
      "SpawnA",
      "SpawnB",
      "SpawnC",
    ]);
    expect(intents.map((intent) => intent.name)).toEqual([
      `worker-${ROOM}-100-2`,
      `worker-${ROOM}-100-3`,
      `worker-${ROOM}-100-4`,
    ]);
    expect(new Set(intents.map((intent) => intent.name)).size).toBe(3);
  });

  it("reserves the shared room energy pool before scheduling later spawns", () => {
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      energyAvailable: 1_000,
      energyCapacityAvailable: 1_800,
    });
    const creeps = [
      creep(spawnRoom, "worker-existing-1"),
      creep(spawnRoom, "worker-existing-2"),
    ];

    const intents = plannedSpawns(world(spawnRoom, creeps));
    expect(intents).toHaveLength(3);
    expect(
      intents.reduce((total, intent) => total + bodyCost(intent.body), 0),
    ).toBe(1_000);
    expect(intents.map((intent) => intent.body.length)).toEqual([6, 6, 3]);
  });

  it("emits one emergency recovery before projecting ordinary follow-on workforce", () => {
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room();
    const intents = plannedSpawns(world(spawnRoom, []));

    expect(intents).toHaveLength(3);
    expect(intents.map((intent) => intent.priority)).toEqual([
      2_000, 1_200, 1_200,
    ]);
    expect(intents[0]?.trace?.procedureId).toBe(
      `procedure:${ROOM}:spawning:maintain-workforce-capacity:recover-emergency-workforce`,
    );
    expect(
      intents
        .slice(1)
        .every(
          (intent) =>
            intent.trace?.procedureId ===
            `procedure:${ROOM}:spawning:maintain-workforce-capacity:maintain-general-workforce`,
        ),
    ).toBe(true);
  });

  it("does not let reserved roles or single-capability bodies mask a generalist deficit", () => {
    const plan = logisticsPlan();
    installGlobals(plan);
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 1_800,
      energyCapacityAvailable: 1_800,
    });
    const producerBody: BodyPartConstant[] = [
      "work",
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ];
    const transportBody: BodyPartConstant[] = [
      "carry",
      "carry",
      "carry",
      "move",
      "move",
    ];
    const creeps = [
      creep(spawnRoom, "producer-a", producerBody),
      creep(spawnRoom, "producer-b", producerBody),
      creep(spawnRoom, "transport-a", transportBody),
      creep(spawnRoom, "transport-b", transportBody),
      creep(spawnRoom, "work-only-a", [
        "work",
        "work",
        "work",
        "work",
        "work",
        "work",
        "move",
        "move",
        "move",
      ]),
      creep(spawnRoom, "guard-b", ["move"]),
    ];

    expect(assessWorkforceReadiness(spawnRoom, creeps)).toEqual({
      desiredGeneralists: 7,
      generalistCarryCoverage: { available: 0, required: 42 },
      generalistMoveCoverage: { available: 0, required: 42 },
      generalistWorkCoverage: { available: 0, required: 42 },
      logisticsStatus: "required",
      producerCoverage: { available: 2, required: 2 },
      recurringReplacementEnergy: 10_700,
      replacementBudgetEnergy: 12_000,
      replacementBudgetStatus: "within-budget",
      transportCarryCoverage: { available: 6, required: 6 },
      viableGeneralists: 0,
      viablePopulation: 6,
    });
    const intents = plannedSpawns(world(spawnRoom, creeps));

    expect(intents.map((intent) => intent.name)).toEqual([
      `worker-${ROOM}-100-1`,
      `worker-${ROOM}-100-2`,
      `worker-${ROOM}-100-3`,
    ]);
    expect(intents.map((intent) => intent.reason)).toEqual([
      "workforce demand 0/7",
      "workforce demand 1/7",
      "workforce demand 2/7",
    ]);
    expect(
      intents.every(
        (intent) =>
          intent.body.includes("work") && intent.body.includes("carry"),
      ),
    ).toBe(true);
    expect(
      intents.every(
        (intent) =>
          intent.trace?.procedureId ===
          `procedure:${ROOM}:spawning:maintain-workforce-capacity:maintain-general-workforce`,
      ),
    ).toBe(true);
  });

  it("fills one real producer deficit and one transport deficit without blind parallel duplication", () => {
    const plan = logisticsPlan();
    installGlobals(plan);
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 1_800,
      energyCapacityAvailable: 1_800,
    });
    const producerBody: BodyPartConstant[] = [
      "work",
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ];
    const creeps = [
      // A producer still in its spawn pipeline counts toward future source coverage.
      creep(spawnRoom, "producer-pipeline", producerBody, true),
      ...Array.from({ length: 4 }, (_, index) =>
        creep(spawnRoom, `guard-${index}`, ["move"]),
      ),
    ];

    const intents = plannedSpawns(world(spawnRoom, creeps));
    expect(intents).toHaveLength(3);
    expect(intents.map((intent) => intent.name)).toEqual([
      `producer-${ROOM}-100-1`,
      `transport-${ROOM}-100-1`,
      `transport-${ROOM}-100-2`,
    ]);
    expect(intents.map((intent) => intent.trace?.procedureId)).toEqual([
      `procedure:${ROOM}:spawning:maintain-workforce-capacity:staff-source-production`,
      `procedure:${ROOM}:spawning:maintain-workforce-capacity:staff-transport-capacity`,
      `procedure:${ROOM}:spawning:maintain-workforce-capacity:staff-transport-capacity`,
    ]);
    expect(intents.map((intent) => intent.reason)).toEqual([
      "source production coverage 1/2",
      "transport throughput 0/6 CARRY parts",
      "transport throughput 3/6 CARRY parts",
    ]);
  });

  it("sizes general capacity against current and long-route logistics replacement", () => {
    const shortPlan = logisticsPlan(5);
    installGlobals(shortPlan);
    const shortRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 12_900,
      energyCapacityAvailable: 12_900,
    });
    const short = assessWorkforceReadiness(shortRoom, []);

    expect(short.transportCarryCoverage).toEqual({ available: 0, required: 6 });
    expect(short.generalistWorkCoverage.required).toBe(42);
    expect(short.recurringReplacementEnergy).toBe(10_700);
    expect(short.replacementBudgetEnergy).toBe(12_000);
    expect(short.replacementBudgetStatus).toBe("within-budget");

    const longPlan = logisticsPlan(40);
    installGlobals(longPlan);
    const longRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 12_900,
      energyCapacityAvailable: 12_900,
    });
    const long = assessWorkforceReadiness(longRoom, []);

    expect(long.transportCarryCoverage).toEqual({ available: 0, required: 40 });
    expect(long.generalistWorkCoverage.required).toBe(35);
    expect(long.generalistCarryCoverage.required).toBe(35);
    expect(long.generalistMoveCoverage.required).toBe(35);
    expect(long.recurringReplacementEnergy).toBe(11_800);
    expect(long.replacementBudgetEnergy).toBe(12_000);
    expect(long.replacementBudgetStatus).toBe("within-budget");

    activateApprovedColonyGovernance(ROOM);
    const producerBody: BodyPartConstant[] = [
      "work",
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ];
    const longTransport: BodyPartConstant[] = [
      ...Array.from({ length: 32 }, () => "carry" as const),
      ...Array.from({ length: 16 }, () => "move" as const),
    ];
    const routeStaff = [
      creep(longRoom, "producer-viable", producerBody),
      creep(longRoom, "producer-expiring", producerBody, false, 100),
      creep(longRoom, "transport-long", longTransport),
    ];
    expect(plannedSpawns(world(longRoom, routeStaff))[0]).toMatchObject({
      name: `producer-${ROOM}-100-1`,
      reason: "source production coverage 1/2",
    });
  });

  it("independently staffs both long source routes with road-balanced haulers", () => {
    const plan = logisticsPlan(42);
    installGlobals(plan);
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 12_900,
      energyCapacityAvailable: 12_900,
    });
    const producerBody: BodyPartConstant[] = [
      "work",
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ];
    const creeps = [
      creep(spawnRoom, "producer-a", producerBody),
      creep(spawnRoom, "producer-b", producerBody),
      ...Array.from({ length: 5 }, (_, index) =>
        creep(spawnRoom, `guard-${index}`, ["move"]),
      ),
    ];

    const intents = plannedSpawns(world(spawnRoom, creeps));

    expect(intents.map((intent) => intent.name)).toEqual([
      `transport-${ROOM}-100-1`,
      `transport-${ROOM}-100-2`,
      `worker-${ROOM}-100-1`,
    ]);
    expect(intents.map((intent) => intent.reason)).toEqual([
      "transport throughput 0/42 CARRY parts",
      "transport throughput 21/42 CARRY parts",
      "workforce demand 0/7",
    ]);
    expect(
      intents
        .slice(0, 2)
        .map((intent) => intent.body.filter((part) => part === "carry").length),
    ).toEqual([21, 21]);
  });

  it("replaces seven bootstrap bodies until mature WORK/CARRY/MOVE throughput exists", () => {
    const plan = logisticsPlan();
    installGlobals(plan);
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 1_800,
      energyCapacityAvailable: 1_800,
    });
    const producerBody: BodyPartConstant[] = [
      "work",
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ];
    const transporterBody: BodyPartConstant[] = [
      ...Array.from({ length: 10 }, () => "carry" as const),
      ...Array.from({ length: 5 }, () => "move" as const),
    ];
    const specialists = [
      creep(spawnRoom, "producer-a", producerBody),
      creep(spawnRoom, "producer-b", producerBody),
      creep(spawnRoom, "transport-a", transporterBody),
      creep(spawnRoom, "transport-b", transporterBody),
    ];
    const tiny = Array.from({ length: 7 }, (_, index) =>
      creep(spawnRoom, `tiny-${index}`),
    );

    const tinyReadiness = assessWorkforceReadiness(spawnRoom, [
      ...specialists,
      ...tiny,
    ]);
    expect(tinyReadiness).toMatchObject({
      desiredGeneralists: 7,
      generalistCarryCoverage: { available: 7, required: 42 },
      generalistMoveCoverage: { available: 7, required: 42 },
      generalistWorkCoverage: { available: 7, required: 42 },
      viableGeneralists: 7,
    });
    expect(
      plannedSpawns(world(spawnRoom, [...specialists, ...tiny])).map(
        (intent) => intent.reason,
      ),
    ).toEqual([
      "workforce capability demand WORK 7/42, CARRY 7/42, MOVE 7/42",
      "workforce capability demand WORK 10/42, CARRY 10/42, MOVE 10/42",
      "workforce capability demand WORK 13/42, CARRY 13/42, MOVE 13/42",
    ]);

    const targetBody = generalistBodyForDemand(1_800, 2, 7, 2_300);
    const mature = Array.from({ length: 7 }, (_, index) =>
      creep(spawnRoom, `mature-${index}`, targetBody),
    );
    expect(
      assessWorkforceReadiness(spawnRoom, [...specialists, ...mature]),
    ).toMatchObject({
      generalistCarryCoverage: { available: 42, required: 42 },
      generalistMoveCoverage: { available: 42, required: 42 },
      generalistWorkCoverage: { available: 42, required: 42 },
      viableGeneralists: 7,
    });
    expect(
      plannedSpawns(world(spawnRoom, [...specialists, ...mature])),
    ).toEqual([]);
  });

  it("rejects immobile producers, WORK-heavy haulers, and MOVE laundering", () => {
    const plan = logisticsPlan();
    installGlobals(plan);
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 12_900,
      energyCapacityAvailable: 12_900,
    });
    const producerBody: BodyPartConstant[] = [
      "work",
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ];
    const immobileProducer = producerBody.filter((part) => part !== "move");
    const workHeavyHauler: BodyPartConstant[] = [
      ...Array.from({ length: 10 }, () => "work" as const),
      ...Array.from({ length: 10 }, () => "carry" as const),
      ...Array.from({ length: 5 }, () => "move" as const),
    ];
    const guards = Array.from({ length: 3 }, (_, index) =>
      creep(spawnRoom, `guard-${index}`, ["move"]),
    );
    const invalidSpecialists = [
      creep(spawnRoom, "producer-a", producerBody),
      creep(spawnRoom, "producer-immobile", immobileProducer),
      creep(spawnRoom, "hauler-work-heavy", workHeavyHauler),
      ...guards,
    ];

    expect(
      plannedSpawns(world(spawnRoom, invalidSpecialists))[0],
    ).toMatchObject({
      name: `producer-${ROOM}-100-1`,
      reason: "source production coverage 1/2",
    });

    const mobileProducers = [
      creep(spawnRoom, "producer-a", producerBody),
      creep(spawnRoom, "producer-b", producerBody),
      creep(spawnRoom, "hauler-work-heavy", workHeavyHauler),
      ...guards,
    ];
    expect(plannedSpawns(world(spawnRoom, mobileProducers))[0]).toMatchObject({
      name: `transport-${ROOM}-100-1`,
      reason: "transport throughput 0/6 CARRY parts",
    });

    const slowBody: BodyPartConstant[] = [
      ...Array.from({ length: 6 }, () => "work" as const),
      ...Array.from({ length: 6 }, () => "carry" as const),
      "move",
    ];
    const overMobileBody: BodyPartConstant[] = [
      ...Array.from({ length: 6 }, () => "work" as const),
      ...Array.from({ length: 6 }, () => "carry" as const),
      ...Array.from({ length: 36 }, () => "move" as const),
    ];
    const transportBody: BodyPartConstant[] = [
      ...Array.from({ length: 10 }, () => "carry" as const),
      ...Array.from({ length: 5 }, () => "move" as const),
    ];
    const skewed = [
      creep(spawnRoom, "producer-a", producerBody),
      creep(spawnRoom, "producer-b", producerBody),
      creep(spawnRoom, "transport-a", transportBody),
      creep(spawnRoom, "transport-b", transportBody),
      ...Array.from({ length: 6 }, (_, index) =>
        creep(spawnRoom, `slow-${index}`, slowBody),
      ),
      creep(spawnRoom, "over-mobile", overMobileBody),
    ];
    expect(assessWorkforceReadiness(spawnRoom, skewed)).toMatchObject({
      generalistCarryCoverage: { available: 6, required: 42 },
      generalistWorkCoverage: { available: 6, required: 42 },
      viableGeneralists: 1,
    });
  });

  it("schedules repeated logistics roles only when the measured deficit requires each one", () => {
    const plan = logisticsPlan();
    installGlobals(plan);
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      level: 8,
      liveBuffers: true,
      energyAvailable: 2_400,
      energyCapacityAvailable: 2_400,
    });
    const creeps = Array.from({ length: 5 }, (_, index) =>
      creep(spawnRoom, `guard-${index}`, ["move"]),
    );

    const intents = plannedSpawns(world(spawnRoom, creeps));
    expect(intents.map((intent) => intent.name)).toEqual([
      `producer-${ROOM}-100-1`,
      `producer-${ROOM}-100-2`,
      `transport-${ROOM}-100-1`,
    ]);
    expect(intents.map((intent) => intent.reason)).toEqual([
      "source production coverage 0/2",
      "source production coverage 1/2",
      "transport throughput 0/6 CARRY parts",
    ]);
  });

  it("starts three mature replacements inside their exact spawn lead window", () => {
    activateApprovedColonyGovernance(ROOM);
    const spawnRoom = room({
      level: 8,
      energyAvailable: 12_900,
      energyCapacityAvailable: 12_900,
    });
    const creeps = [
      ...Array.from({ length: 4 }, (_, index) =>
        creep(spawnRoom, `viable-${index}`),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        creep(
          spawnRoom,
          `expiring-${index}`,
          ["work", "carry", "move"],
          false,
          78,
        ),
      ),
    ];

    const intents = plannedSpawns(world(spawnRoom, creeps));

    expect(intents).toHaveLength(3);
    expect(intents.map((intent) => intent.spawnName)).toEqual([
      "SpawnA",
      "SpawnB",
      "SpawnC",
    ]);
    expect(intents.map((intent) => intent.body.length)).toEqual([18, 18, 18]);
    expect(
      intents.reduce((total, intent) => total + bodyCost(intent.body), 0),
    ).toBe(3_600);
    expect(intents.map((intent) => intent.reason)).toEqual([
      "workforce demand 4/7",
      "workforce demand 5/7",
      "workforce demand 6/7",
    ]);
  });
});
