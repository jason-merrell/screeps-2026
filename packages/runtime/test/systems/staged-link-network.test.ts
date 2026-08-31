import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Intent } from "../../src/intents/types";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomDevelopmentStageId,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import type { WorldSnapshot } from "../../src/runtime/context";
import {
  assessMatureLinkService,
  matureSourceLinkRouting,
  planMatureEnergyCore,
} from "../../src/systems/economy/mature-energy";
import { planEconomy } from "../../src/systems/economy/plan";
import {
  planSpawning,
  requiredSourceTransportCarry,
} from "../../src/systems/spawning/plan";
import { currentRoomPlanFixture } from "../fixtures/current-room-plan";

const ROOM = "W1N1";

interface NetworkOptions {
  rcl: 5 | 6;
  coreEnergy?: number;
  sourceACooldown?: number;
  topologyFault?: boolean;
  transporterCount?: number;
}

interface NetworkFixture {
  plan: RoomPlan;
  room: Room;
  world: WorldSnapshot;
}

const position = (x: number, y: number): RoomPosition =>
  ({
    x,
    y,
    roomName: ROOM,
    getRangeTo: (target: RoomObject) =>
      Math.max(Math.abs(x - target.pos.x), Math.abs(y - target.pos.y)),
  }) as unknown as RoomPosition;

function store(
  energy: number,
  capacity: number,
): Store<ResourceConstant, false> {
  return {
    getUsedCapacity: () => energy,
    getCapacity: () => capacity,
    getFreeCapacity: () => capacity - energy,
  } as unknown as Store<ResourceConstant, false>;
}

function plannedStructure(
  id: string,
  x: number,
  y: number,
  structureType: BuildableStructureConstant,
  minRcl: number,
): RoomPlanStructure {
  const stage: RoomDevelopmentStageId =
    minRcl <= 1
      ? "bootstrap"
      : minRcl <= 2
        ? "logistics"
        : minRcl <= 5
          ? "core-economy"
          : minRcl <= 7
            ? "advanced-operations"
            : "mature-rcl8";
  const phase: RoomPlanStructure["phase"] =
    stage === "bootstrap"
      ? "bootstrap-capacity"
      : stage === "logistics"
        ? "source-logistics"
        : structureType === "storage"
          ? "core-economy"
          : stage === "advanced-operations"
            ? "advanced-operations"
            : stage === "mature-rcl8"
              ? "mature-operations"
              : "energy-distribution";
  return {
    id,
    x,
    y,
    structureType,
    minRcl,
    priority: 1_000 - minRcl,
    activation: "automatic",
    reservation: "hard",
    phase,
    reason: `${id} staged-network fixture`,
    stage,
    strategicWeight: 5,
    requiredForStage: true,
  };
}

function stagedPlan(topologyFault = false): RoomPlan {
  return currentRoomPlanFixture({
    version: 4,
    horizonRcl: 8,
    roomName: ROOM,
    generatedAt: 1,
    generatedReason: "staged mature-link integration fixture",
    stages: ROOM_DEVELOPMENT_STAGES.map((stage) => ({
      ...stage,
      prerequisiteStageIds: [...stage.prerequisiteStageIds],
    })),
    anchors: {
      spawn: { name: "Spawn1", x: 20, y: 20 },
      hub: { x: 25, y: 25 },
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
      plannedStructure("spawn-1", 20, 20, "spawn", 1),
      plannedStructure("source-container-a", 11, 10, "container", 2),
      plannedStructure("source-container-b", 39, 10, "container", 2),
      plannedStructure("storage-1", 25, 25, "storage", 4),
      plannedStructure("link-source-a", 12, 10, "link", 5),
      plannedStructure("link-core", 24, 25, "link", 5),
      plannedStructure("link-source-b", 38, 10, "link", 6),
      plannedStructure(
        "link-controller",
        topologyFault ? 30 : 36,
        topologyFault ? 30 : 40,
        "link",
        7,
      ),
      plannedStructure("link-aux-a", 21, 22, "link", 8),
      plannedStructure("link-aux-b", 22, 22, "link", 8),
    ],
    roads: [],
    roadGraph: {
      nodes: [
        { id: "spawn", kind: "spawn", x: 20, y: 20 },
        { id: "hub", kind: "hub", x: 25, y: 25 },
        { id: "source-0", kind: "source", x: 11, y: 10 },
        { id: "source-1", kind: "source", x: 39, y: 10 },
      ],
      edges: [
        {
          id: "spawn->hub",
          from: "spawn",
          to: "hub",
          tiles: [
            { x: 21, y: 21 },
            { x: 22, y: 22 },
          ],
        },
        {
          id: "hub->source-0",
          from: "hub",
          to: "source-0",
          tiles: [
            { x: 20, y: 20 },
            { x: 19, y: 19 },
            { x: 18, y: 18 },
          ],
        },
        {
          id: "hub->source-1",
          from: "hub",
          to: "source-1",
          tiles: [
            { x: 30, y: 20 },
            { x: 31, y: 19 },
            { x: 32, y: 18 },
            { x: 33, y: 17 },
          ],
        },
      ],
    },
    defense: { strategy: "pending-mincut", protectedTiles: [], perimeter: [] },
  });
}

function createNetwork(options: NetworkOptions): NetworkFixture {
  const plan = stagedPlan(options.topologyFault);
  let room: Room;
  let creeps: Creep[] = [];
  let structures: AnyStructure[] = [];

  const ownedLink = (
    id: string,
    x: number,
    y: number,
    energy: number,
    cooldown = 0,
  ): StructureLink =>
    ({
      id,
      my: true,
      structureType: "link",
      room,
      pos: position(x, y),
      cooldown,
      store: store(energy, 800),
    }) as unknown as StructureLink;
  const container = (id: string, x: number, y: number): StructureContainer =>
    ({
      id,
      structureType: "container",
      room,
      pos: position(x, y),
      store: store(200, 2_000),
    }) as unknown as StructureContainer;

  const sourceA = {
    id: "source-a",
    energy: 3_000,
    get room() {
      return room;
    },
    pos: position(10, 10),
  } as unknown as Source;
  const sourceB = {
    id: "source-b",
    energy: 3_000,
    get room() {
      return room;
    },
    pos: position(40, 10),
  } as unknown as Source;

  const containerA = container("container-a", 11, 10);
  const containerB = container("container-b", 39, 10);
  const sourceLinkA = ownedLink(
    "source-link-a",
    12,
    10,
    400,
    options.sourceACooldown ?? 0,
  );
  const sourceLinkB = ownedLink("source-link-b", 38, 10, 400);
  const coreLink = ownedLink("core-link", 24, 25, options.coreEnergy ?? 0);

  const creep = (
    name: string,
    x: number,
    y: number,
    energy: number,
    workParts: number,
    carryParts: number,
    moveParts = Math.ceil((workParts + carryParts) / 2),
  ): Creep =>
    ({
      name,
      spawning: false,
      ticksToLive: 1_400,
      get room() {
        return room;
      },
      pos: position(x, y),
      memory: {},
      body: [
        ...Array.from({ length: workParts }, () => ({
          type: "work",
          hits: 100,
        })),
        ...Array.from({ length: carryParts }, () => ({
          type: "carry",
          hits: 100,
        })),
        ...Array.from({ length: moveParts }, () => ({
          type: "move",
          hits: 100,
        })),
      ],
      store: store(energy, Math.max(50, carryParts * 50)),
      getActiveBodyparts: (part: BodyPartConstant) =>
        part === WORK
          ? workParts
          : part === CARRY
            ? carryParts
            : part === MOVE
              ? moveParts
              : 0,
    }) as unknown as Creep;

  const transporters = Array.from(
    { length: options.transporterCount ?? 2 },
    (_, index) =>
      creep(
        `transporter-${String.fromCharCode(97 + index)}`,
        index % 2 === 0 ? 11 : 39,
        10,
        0,
        0,
        10,
      ),
  );
  const guards = Array.from(
    { length: Math.max(0, 5 - 2 - transporters.length) },
    (_, index) => creep(`guard-${index + 1}`, 20, 20, 0, 0, 0),
  );
  creeps = [
    creep("producer-a", 11, 10, 100, 6, 2),
    creep("producer-b", 39, 10, 100, 6, 2),
    ...transporters,
    ...guards,
  ];
  structures = [
    containerA,
    containerB,
    sourceLinkA,
    coreLink,
    ...(options.rcl >= 6 ? [sourceLinkB] : []),
  ];
  room = {
    name: ROOM,
    controller: { id: "controller", my: true, level: options.rcl },
    energyAvailable: 1_800,
    energyCapacityAvailable: 1_800,
    find: (type: FindConstant) => {
      if (type === FIND_MY_CREEPS) return creeps;
      if (type === FIND_SOURCES) return [sourceA, sourceB];
      return [];
    },
    lookForAt: (_type: LookConstant, x: number, y: number) =>
      structures.filter(
        (structure) => structure.pos.x === x && structure.pos.y === y,
      ),
  } as unknown as Room;

  const myStructures = structures.filter(
    (structure): structure is AnyOwnedStructure =>
      "my" in structure && structure.my === true,
  );
  const world = {
    tick: 100,
    rooms: [room],
    creeps,
    spawns: [
      { name: "Spawn1", room, spawning: null } as unknown as StructureSpawn,
    ],
    spatial: {
      byRoom: {
        [ROOM]: {
          roomName: ROOM,
          sources: [sourceA, sourceB],
          structures,
          myStructures,
          constructionSites: [],
          hostiles: [],
          salvage: [],
        },
      },
      nearest: () => null,
    },
    budget: { limit: 20, bucket: 10_000, used: 0, mode: "surplus" },
  } as unknown as WorldSnapshot;

  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: Object.fromEntries(
        creeps.map((candidate) => [candidate.name, candidate]),
      ),
      getObjectById: (id: string) =>
        id === "source-a" ? sourceA : id === "source-b" ? sourceB : null,
    },
    Memory: {
      version: 6,
      colonies: {
        [ROOM]: { roomName: ROOM, discoveredAt: 1, roomPlan: plan },
      },
    },
  });

  return { plan, room, world };
}

function creepIntent(
  intents: readonly Intent[],
  name: string,
): Intent | undefined {
  return intents.find(
    (intent) => "creepName" in intent && intent.creepName === name,
  );
}

function appendCreep(
  fixture: NetworkFixture,
  name: string,
  x: number,
  y: number,
  workParts: number,
  carryParts: number,
  moveParts: number,
  energy = 0,
): Creep {
  const candidate = {
    name,
    spawning: false,
    ticksToLive: 1_400,
    room: fixture.room,
    pos: position(x, y),
    memory: {},
    body: [
      ...Array.from({ length: workParts }, () => ({
        type: "work",
        hits: 100,
      })),
      ...Array.from({ length: carryParts }, () => ({
        type: "carry",
        hits: 100,
      })),
      ...Array.from({ length: moveParts }, () => ({
        type: "move",
        hits: 100,
      })),
    ],
    store: store(energy, Math.max(50, carryParts * 50)),
    getActiveBodyparts: (part: BodyPartConstant) =>
      part === WORK
        ? workParts
        : part === CARRY
          ? carryParts
          : part === MOVE
            ? moveParts
            : 0,
  } as unknown as Creep;
  (fixture.world.creeps as Creep[]).push(candidate);
  Game.creeps[name] = candidate;
  return candidate;
}

describe("staged mature-link network", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Object.assign(globalThis, {
      WORK: "work",
      CARRY: "carry",
      MOVE: "move",
      ATTACK: "attack",
      RANGED_ATTACK: "ranged_attack",
      HEAL: "heal",
      CLAIM: "claim",
      RESOURCE_ENERGY: "energy",
      STRUCTURE_CONTAINER: "container",
      STRUCTURE_LINK: "link",
      STRUCTURE_SPAWN: "spawn",
      STRUCTURE_EXTENSION: "extension",
      STRUCTURE_TOWER: "tower",
      STRUCTURE_STORAGE: "storage",
      STRUCTURE_TERMINAL: "terminal",
      FIND_MY_CREEPS: "my_creeps",
      FIND_SOURCES: "sources",
      FIND_MY_CONSTRUCTION_SITES: "my_construction_sites",
      LOOK_STRUCTURES: "structure",
      HARVEST_POWER: 2,
      CREEP_LIFE_TIME: 1_500,
      CREEP_SPAWN_TIME: 3,
    });
  });

  it("keeps the RCL5 source/core geometry dark and preserves both hauling routes while authority is debt", () => {
    const fixture = createNetwork({ rcl: 5 });
    activateApprovedColonyGovernance(ROOM);

    expect(assessMatureLinkService(fixture.plan)).toMatchObject({
      status: "authorization-debt",
      roles: { corePlanId: "link-core" },
    });
    expect(matureSourceLinkRouting(fixture.room, fixture.plan)).toEqual([]);
    expect(
      requiredSourceTransportCarry(fixture.room, fixture.plan, [0, 1]),
    ).toBe(6);

    const economy = planEconomy(fixture.world);
    expect(creepIntent(economy, "producer-a")).toMatchObject({
      type: "transfer",
      targetId: "container-a",
    });
    expect(creepIntent(economy, "producer-b")).toMatchObject({
      type: "transfer",
      targetId: "container-b",
    });
    expect(creepIntent(economy, "transporter-b")).toMatchObject({
      type: "withdraw",
      targetId: "container-b",
    });
    expect(
      planMatureEnergyCore(fixture.world, economy).some(
        (intent) => intent.type === "linkTransfer",
      ),
    ).toBe(false);
  });

  it("does not claim operational RCL6 coverage without approved link-transfer authority", () => {
    const fixture = createNetwork({ rcl: 6 });
    activateApprovedColonyGovernance(ROOM);

    expect(matureSourceLinkRouting(fixture.room, fixture.plan)).toEqual([]);
    expect(
      requiredSourceTransportCarry(fixture.room, fixture.plan, [0, 1]),
    ).toBe(6);

    const economy = planEconomy(fixture.world);
    expect(creepIntent(economy, "producer-a")).toMatchObject({
      type: "transfer",
      targetId: "container-a",
    });
    expect(creepIntent(economy, "producer-b")).toMatchObject({
      type: "transfer",
      targetId: "container-b",
    });
    const transfers = planMatureEnergyCore(fixture.world, economy).filter(
      (intent) => intent.type === "linkTransfer",
    );
    expect(transfers).toEqual([]);
  });

  it("falls back to container production and hauling when the only sink is saturated", () => {
    const fixture = createNetwork({ rcl: 5, coreEnergy: 800 });
    activateApprovedColonyGovernance(ROOM);

    expect(matureSourceLinkRouting(fixture.room, fixture.plan)).toEqual([]);
    expect(
      requiredSourceTransportCarry(fixture.room, fixture.plan, [0, 1]),
    ).toBe(6);

    const economy = planEconomy(fixture.world);
    expect(creepIntent(economy, "producer-a")).toMatchObject({
      type: "transfer",
      targetId: "container-a",
    });
    expect(creepIntent(economy, "transporter-a")).toMatchObject({
      type: "withdraw",
      targetId: "container-a",
    });
    expect(
      planMatureEnergyCore(fixture.world, economy).some(
        (intent) => intent.type === "linkTransfer",
      ),
    ).toBe(false);
  });

  it("keeps live producer and per-source transport assignments aligned with readiness", () => {
    const fixture = createNetwork({ rcl: 5 });
    activateApprovedColonyGovernance(ROOM);
    appendCreep(fixture, "producer-immobile", 10, 10, 10, 2, 0, 100);
    appendCreep(fixture, "hauler-baggage-heavy", 11, 10, 10, 10, 5);
    appendCreep(fixture, "generalist-incumbent", 10, 10, 9, 9, 9, 100);

    const portfolio = Memory.colonies[ROOM]?.fspm;
    if (!portfolio) throw new Error("expected activated colony portfolio");
    portfolio.activities ??= {};
    portfolio.activities["activity:stale-producer-affinity"] = {
      id: "activity:stale-producer-affinity",
      taskId: `task:${ROOM}:economy:maintain-colony-energy-service`,
      assignee: "generalist-incumbent",
      status: "in_progress",
      currentProcedureId: `procedure:${ROOM}:economy:maintain-colony-energy-service:extract-source-energy`,
      currentTargetKey: "source-a",
      createdAt: 1,
      updatedAt: 99,
    } as never;

    const economy = planEconomy(fixture.world);
    expect(creepIntent(economy, "producer-a")).toMatchObject({
      type: "transfer",
      targetId: "container-a",
    });
    expect(creepIntent(economy, "producer-b")).toMatchObject({
      type: "transfer",
      targetId: "container-b",
    });
    expect(
      ["transporter-a", "transporter-b"]
        .map((name) => creepIntent(economy, name))
        .filter(
          (intent): intent is Extract<Intent, { type: "withdraw" }> =>
            intent?.type === "withdraw",
        )
        .map((intent) => intent.targetId)
        .sort(),
    ).toEqual(["container-a", "container-b"]);

    for (const name of [
      "producer-immobile",
      "hauler-baggage-heavy",
      "generalist-incumbent",
    ]) {
      const intent = creepIntent(economy, name);
      expect(
        intent !== undefined &&
          (intent.type === "withdraw" || intent.type === "transfer") &&
          (intent.targetId === "container-a" ||
            intent.targetId === "container-b"),
      ).toBe(false);
    }
  });

  it("keeps transport capacity staffed at RCL5 and RCL6 until authority is approved", () => {
    const rcl5 = createNetwork({ rcl: 5, transporterCount: 0 });
    activateApprovedColonyGovernance(ROOM);
    expect(
      planSpawning(rcl5.world).filter((intent) => intent.type === "spawn"),
    ).toEqual([
      expect.objectContaining({
        name: `transport-${ROOM}-100-1`,
        reason: "transport throughput 0/6 CARRY parts",
      }),
    ]);

    const rcl6 = createNetwork({ rcl: 6, transporterCount: 0 });
    activateApprovedColonyGovernance(ROOM);
    expect(
      planSpawning(rcl6.world).filter((intent) => intent.type === "spawn"),
    ).toEqual([
      expect.objectContaining({
        name: `transport-${ROOM}-100-1`,
        reason: "transport throughput 0/6 CARRY parts",
      }),
    ]);

    const saturated = createNetwork({
      rcl: 6,
      coreEnergy: 800,
      transporterCount: 0,
    });
    activateApprovedColonyGovernance(ROOM);
    expect(
      planSpawning(saturated.world).filter((intent) => intent.type === "spawn"),
    ).toEqual([
      expect.objectContaining({
        name: `transport-${ROOM}-100-1`,
        reason: "transport throughput 0/6 CARRY parts",
      }),
    ]);
  });

  it("uses complete container logistics during cooldown while authority remains debt", () => {
    const fixture = createNetwork({ rcl: 5, sourceACooldown: 2 });
    activateApprovedColonyGovernance(ROOM);

    expect(matureSourceLinkRouting(fixture.room, fixture.plan)).toEqual([]);
    expect(
      requiredSourceTransportCarry(fixture.room, fixture.plan, [0, 1]),
    ).toBe(6);

    const economy = planEconomy(fixture.world);
    expect(creepIntent(economy, "producer-a")).toMatchObject({
      type: "transfer",
      targetId: "container-a",
    });
    expect(creepIntent(economy, "transporter-a")).toMatchObject({
      type: "withdraw",
      targetId: "container-a",
    });
  });

  it("fails closed to complete container hauling when planned role geometry is invalid", () => {
    const fixture = createNetwork({ rcl: 6, topologyFault: true });
    activateApprovedColonyGovernance(ROOM);

    expect(matureSourceLinkRouting(fixture.room, fixture.plan)).toEqual([]);
    expect(
      requiredSourceTransportCarry(fixture.room, fixture.plan, [0, 1]),
    ).toBe(6);
    const economy = planEconomy(fixture.world);
    expect(creepIntent(economy, "producer-a")).toMatchObject({
      type: "transfer",
      targetId: "container-a",
    });
    expect(creepIntent(economy, "producer-b")).toMatchObject({
      type: "transfer",
      targetId: "container-b",
    });
    expect(
      planMatureEnergyCore(fixture.world, economy).some(
        (intent) => intent.type === "linkTransfer",
      ),
    ).toBe(false);
  });
});
