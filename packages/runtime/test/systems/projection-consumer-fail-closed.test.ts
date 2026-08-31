import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Intent } from "../../src/intents/types";
import { MEMORY_VERSION } from "../../src/memory/schema";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomDevelopmentStageId,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import {
  advanceRoomPlanProjection,
  roomPlanProjectionFingerprint,
  type SettlementProjectionFault,
  usableRoomPlanProjection,
} from "../../src/planning/room-plan-projection";
import type { WorldSnapshot } from "../../src/runtime/context";
import { planConstruction } from "../../src/systems/construction/plan";
import { planDefense } from "../../src/systems/defense/plan";
import { planMatureEnergyCore } from "../../src/systems/economy/mature-energy";
import { planEconomy } from "../../src/systems/economy/plan";
import { planSurplusLaborUtilization } from "../../src/systems/economy/surplus-utilization";
import { planSpawning } from "../../src/systems/spawning/plan";
import { currentRoomPlanFixture } from "../fixtures/current-room-plan";

const ROOM = "W1N1";

type ProjectionCase = {
  readonly name: string;
  readonly plan: RoomPlan;
  readonly fault?: SettlementProjectionFault;
};

const ADVERSARIAL_CASE_NAMES = [
  "self-fingerprinted wrong-room",
  "self-fingerprinted schema-invalid",
  "active generation fault over a current retained epoch",
] as const;

function position(x: number, y: number): RoomPosition {
  return {
    x,
    y,
    roomName: ROOM,
    getRangeTo: (target: RoomObject) =>
      Math.max(Math.abs(x - target.pos.x), Math.abs(y - target.pos.y)),
  } as unknown as RoomPosition;
}

function energyStore(
  energy: number,
  capacity: number,
): Store<ResourceConstant, false> {
  return {
    getUsedCapacity: () => energy,
    getCapacity: () => capacity,
    getFreeCapacity: () => capacity - energy,
  } as unknown as Store<ResourceConstant, false>;
}

function requiredStructure(
  id: string,
  stage: RoomDevelopmentStageId,
  structureType: BuildableStructureConstant,
  x: number,
  y: number,
  minRcl: number,
  phase: RoomPlanStructure["phase"],
): RoomPlanStructure {
  return {
    id,
    stage,
    structureType,
    x,
    y,
    minRcl,
    priority: 1_200 - minRcl,
    strategicWeight: 5,
    requiredForStage: true,
    activation: structureType === "container" ? "demand" : "automatic",
    reservation: "hard",
    phase,
    reason: `${id} projection-gate fixture`,
  };
}

function automaticSurvivalStructure(
  id: string,
  structureType: "spawn" | "tower",
  x: number,
  y: number,
  priority: number,
): RoomPlanStructure {
  const ordinal = Number(id.split("-").at(-1));
  const minRcl =
    structureType === "spawn"
      ? ordinal === 2
        ? 7
        : 8
      : ordinal === 1
        ? 3
        : ordinal === 2
          ? 5
          : ordinal === 3
            ? 7
            : 8;
  const stage: RoomDevelopmentStageId =
    minRcl <= 3
      ? "bootstrap"
      : minRcl <= 5
        ? "core-economy"
        : minRcl <= 7
          ? "advanced-operations"
          : "mature-rcl8";
  return {
    id,
    stage,
    structureType,
    x,
    y,
    minRcl,
    priority,
    strategicWeight: structureType === "spawn" ? 16 : ordinal === 1 ? 8 : 9,
    requiredForStage: true,
    activation: "automatic",
    reservation: "hard",
    phase:
      structureType === "spawn"
        ? stage === "advanced-operations"
          ? "advanced-operations"
          : "mature-operations"
        : ordinal === 1
          ? "bootstrap-defense"
          : "defense-envelope",
    reason: `${id} production-faithful missing survival-asset canary`,
  };
}

function admittedPlan(): RoomPlan {
  return currentRoomPlanFixture({
    version: 4,
    horizonRcl: 8,
    roomName: ROOM,
    generatedAt: 100,
    generatedReason: "projection consumer positive control",
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
          sourceId: "source-1",
          x: 10,
          y: 10,
          container: { x: 11, y: 10 },
        },
      ],
    },
    reservations: [],
    structures: [
      requiredStructure(
        "spawn-1",
        "bootstrap",
        "spawn",
        20,
        20,
        1,
        "bootstrap-capacity",
      ),
      requiredStructure(
        "source-container-1",
        "logistics",
        "container",
        11,
        10,
        2,
        "source-logistics",
      ),
      automaticSurvivalStructure("spawn-2", "spawn", 18, 20, 1_990),
      automaticSurvivalStructure("spawn-3", "spawn", 22, 20, 1_980),
      ...Array.from({ length: 6 }, (_, index) =>
        automaticSurvivalStructure(
          `tower-${index + 1}`,
          "tower",
          17 + index,
          18,
          1_500 - index,
        ),
      ),
      requiredStructure(
        "storage-1",
        "core-economy",
        "storage",
        25,
        25,
        4,
        "core-economy",
      ),
      requiredStructure(
        "terminal-1",
        "advanced-operations",
        "terminal",
        26,
        25,
        6,
        "advanced-operations",
      ),
      requiredStructure(
        "observer-1",
        "mature-rcl8",
        "observer",
        27,
        25,
        8,
        "mature-operations",
      ),
      {
        id: "source-link-1",
        x: 12,
        y: 10,
        structureType: "link",
        minRcl: 5,
        priority: 700,
        activation: "automatic",
        reservation: "hard",
        phase: "energy-distribution",
        reason: "source-link specialization canary",
        strategicWeight: 5,
      },
      {
        id: "core-link-1",
        x: 24,
        y: 25,
        structureType: "link",
        minRcl: 5,
        priority: 700,
        activation: "automatic",
        reservation: "hard",
        phase: "energy-distribution",
        reason: "core-link specialization canary",
        strategicWeight: 5,
      },
      {
        id: "controller-link-1",
        x: 36,
        y: 40,
        structureType: "link",
        minRcl: 6,
        priority: 700,
        activation: "automatic",
        reservation: "hard",
        phase: "energy-distribution",
        reason: "controller-link specialization canary",
        strategicWeight: 5,
      },
      {
        id: "perimeter-rampart",
        x: 30,
        y: 30,
        structureType: "rampart",
        minRcl: 4,
        priority: 600,
        activation: "defense",
        reservation: "hard",
        phase: "defense-envelope",
        reason: "perimeter-repair specialization canary",
        stage: "mature-rcl8",
        strategicWeight: 4,
        requiredForStage: true,
      },
    ],
    roads: [],
    roadGraph: { nodes: [], edges: [] },
    defense: {
      strategy: "terrain-mincut-v1",
      protectedTiles: [
        { x: 20, y: 20 },
        { x: 25, y: 25 },
      ],
      perimeter: [{ x: 30, y: 30 }],
    },
  });
}

function adversarialCases(valid: RoomPlan): ProjectionCase[] {
  const wrongRoom = { ...structuredClone(valid), roomName: "W9N9" };
  wrongRoom.projectionFingerprint = roomPlanProjectionFingerprint(wrongRoom);

  const malformed = {
    ...structuredClone(valid),
    roadGraph: { ...valid.roadGraph, edges: undefined },
  } as unknown as RoomPlan;
  malformed.projectionFingerprint = roomPlanProjectionFingerprint(malformed);

  return [
    { name: "self-fingerprinted wrong-room", plan: wrongRoom },
    { name: "self-fingerprinted schema-invalid", plan: malformed },
    {
      name: "active generation fault over a current retained epoch",
      plan: structuredClone(valid),
      fault: {
        kind: "room-plan-generation",
        status: "active",
        firstTick: 95,
        lastTick: 100,
        attemptCount: 2,
        retryDelayTicks: 10,
        nextRetryTick: 110,
        reason: "adversarial retained projection fault",
        remediation: "regenerate from visible room evidence",
        retainedPlannerRevision: valid.plannerRevision ?? null,
        targetPlannerRevision: valid.plannerRevision ?? 1,
        retainedProjectionRevision: valid.projectionRevision ?? null,
        retainedProjectionFingerprint: valid.projectionFingerprint ?? null,
      },
    },
  ];
}

function installProjection(
  projection: RoomPlan,
  fault: SettlementProjectionFault | undefined,
  creeps: readonly Creep[] = [],
  objects: ReadonlyMap<string, RoomObject> = new Map(),
): void {
  Object.assign(globalThis, {
    Game: {
      time: 100,
      constructionSites: {},
      creeps: Object.fromEntries(creeps.map((creep) => [creep.name, creep])),
      getObjectById: (id: string) => objects.get(id) ?? null,
    },
    Memory: {
      version: MEMORY_VERSION,
      colonies: {
        [ROOM]: {
          roomName: ROOM,
          discoveredAt: 1,
          roomPlan: projection,
          ...(fault ? { settlementProjectionFault: fault } : {}),
        },
      },
    },
  });
  activateApprovedColonyGovernance(ROOM);
}

function structureAt(
  structureType: StructureConstant,
  id: string,
  x: number,
  y: number,
): AnyStructure {
  return {
    id,
    my: true,
    structureType,
    pos: position(x, y),
  } as unknown as AnyStructure;
}

function constructionWorld(
  underThreat = false,
  activeSiteCount = 0,
): WorldSnapshot {
  const spawn = structureAt("spawn", "spawn-built", 20, 20);
  const workforce = Array.from(
    { length: 5 },
    (_, index) => ({ name: `builder-${index}` }) as Creep,
  );
  const hostiles = underThreat ? ([{ id: "invader" }] as Creep[]) : [];
  const sites = Array.from(
    { length: activeSiteCount },
    (_, index) =>
      ({
        id: `backpressure-site-${index}`,
        my: true,
        structureType: "road",
        pos: position(2 + index, 2),
      }) as ConstructionSite,
  );
  const room = {
    name: ROOM,
    controller: { my: true, level: 8, pos: position(40, 40) },
    find: (constant: FindConstant) => {
      if (constant === FIND_MY_STRUCTURES || constant === FIND_STRUCTURES)
        return [spawn];
      if (
        constant === FIND_MY_CONSTRUCTION_SITES ||
        constant === FIND_CONSTRUCTION_SITES
      )
        return sites;
      if (constant === FIND_MY_CREEPS) return workforce;
      if (constant === FIND_HOSTILE_CREEPS) return hostiles;
      if (constant === FIND_SOURCES || constant === FIND_MINERALS) return [];
      return [];
    },
    lookForAt: (constant: LookConstant, x: number, y: number) => {
      if (
        constant === LOOK_STRUCTURES &&
        spawn.pos.x === x &&
        spawn.pos.y === y
      ) {
        return [spawn];
      }
      if (constant === LOOK_CONSTRUCTION_SITES) {
        return sites.filter((site) => site.pos.x === x && site.pos.y === y);
      }
      return [];
    },
    getTerrain: () => ({ get: () => 0 }),
  } as unknown as Room;
  return {
    tick: 100,
    rooms: [room],
    creeps: workforce,
    spawns: [],
  } as unknown as WorldSnapshot;
}

interface SpawnFixture {
  readonly world: WorldSnapshot;
  readonly creeps: readonly Creep[];
}

function spawningWorld(): SpawnFixture {
  const container = structureAt("container", "source-container", 11, 10);
  const room = {
    name: ROOM,
    controller: { my: true, level: 8 },
    energyAvailable: 800,
    energyCapacityAvailable: 800,
    find: (constant: FindConstant) => {
      if (constant === FIND_SOURCES) return [{ id: "source-1" }];
      if (constant === FIND_MY_CONSTRUCTION_SITES) return [];
      return [];
    },
    lookForAt: (constant: LookConstant, x: number, y: number) =>
      constant === LOOK_STRUCTURES && x === 11 && y === 10 ? [container] : [],
  } as unknown as Room;
  const creeps = Array.from(
    { length: 4 },
    (_, index) =>
      ({
        name: `guard-${index}`,
        room,
        spawning: false,
        ticksToLive: 1_400,
        body: [{ type: MOVE, hits: 100 }],
        getActiveBodyparts: () => 0,
      }) as unknown as Creep,
  );
  return {
    creeps,
    world: {
      tick: 100,
      rooms: [room],
      creeps,
      spawns: [{ name: "Spawn1", room, spawning: null } as StructureSpawn],
    } as unknown as WorldSnapshot,
  };
}

interface MatureFixture {
  readonly world: WorldSnapshot;
  readonly creeps: readonly Creep[];
}

function matureBufferWorld(): MatureFixture {
  let room: Room;
  const storage = {
    ...structureAt("storage", "storage-built", 25, 25),
    store: energyStore(50_000, 1_000_000),
  } as StructureStorage;
  const spawn = {
    ...structureAt("spawn", "spawn-built", 20, 20),
    store: energyStore(0, 300),
  } as StructureSpawn;
  const links = (
    [
      ["source-link", 12, 10],
      ["core-link", 24, 25],
      ["controller-link", 36, 40],
    ] as const
  ).map(
    ([id, x, y]) =>
      ({
        ...structureAt("link", id, x, y),
        cooldown: 0,
        store: energyStore(id === "core-link" ? 800 : 0, 800),
      }) as StructureLink,
  );
  const hauler = {
    name: "hauler",
    spawning: false,
    get room() {
      return room;
    },
    pos: position(25, 24),
    memory: {},
    store: energyStore(0, 100),
    getActiveBodyparts: (part: BodyPartConstant) => (part === CARRY ? 2 : 0),
  } as unknown as Creep;
  const structures = [storage, spawn, ...links] as AnyOwnedStructure[];
  room = {
    name: ROOM,
    controller: { my: true, level: 8 },
  } as Room;
  return {
    creeps: [hauler],
    world: {
      tick: 100,
      rooms: [room],
      creeps: [hauler],
      spawns: [spawn],
      spatial: {
        byRoom: {
          [ROOM]: {
            roomName: ROOM,
            sources: [],
            structures,
            myStructures: structures,
            constructionSites: [],
            hostiles: [],
            salvage: [],
          },
        },
        nearest: () => null,
      },
      budget: { limit: 20, bucket: 10_000, used: 0, mode: "surplus" },
    } as unknown as WorldSnapshot,
  };
}

interface SurplusFixture {
  readonly world: WorldSnapshot;
  readonly creeps: readonly Creep[];
  readonly objects: ReadonlyMap<string, RoomObject>;
}

function surplusWorld(): SurplusFixture {
  const source = {
    id: "source-1",
    energy: 3_000,
    pos: position(10, 10),
  } as Source;
  const container = {
    ...structureAt("container", "source-container", 11, 10),
    store: energyStore(500, 2_000),
  } as StructureContainer;
  const room = {
    name: ROOM,
    controller: { my: true, level: 8 },
    find: (constant: FindConstant) =>
      constant === FIND_MY_CREEPS ? Array.from({ length: 5 }, () => ({})) : [],
    lookForAt: (constant: LookConstant, x: number, y: number) =>
      constant === LOOK_STRUCTURES && x === 11 && y === 10 ? [container] : [],
  } as unknown as Room;
  const worker = {
    name: "surplus-worker",
    room,
    spawning: false,
    pos: position(11, 11),
    store: energyStore(0, 50),
    getActiveBodyparts: (part: BodyPartConstant) =>
      part === WORK || part === CARRY ? 1 : 0,
  } as unknown as Creep;
  return {
    creeps: [worker],
    objects: new Map([["source-1", source]]),
    world: {
      tick: 100,
      rooms: [room],
      creeps: [worker],
      spawns: [],
      spatial: {} as WorldSnapshot["spatial"],
      budget: { limit: 20, bucket: 10_000, used: 0, mode: "surplus" },
    },
  };
}

type EconomyMode = "harvest" | "build" | "repair" | "defend";

interface EconomyFixture {
  readonly world: WorldSnapshot;
  readonly creeps: readonly Creep[];
}

function economyWorld(mode: EconomyMode): EconomyFixture {
  let room: Room;
  const source = {
    id: "observed-source",
    energy: 3_000,
    get room() {
      return room;
    },
    pos: position(10, 10),
  } as unknown as Source;
  const fullEnergy = mode === "harvest" ? 0 : 50;
  const worker = {
    name: "generalist",
    spawning: false,
    get room() {
      return room;
    },
    pos: position(20, 20),
    memory: {},
    store: energyStore(fullEnergy, 50),
    body: [WORK, CARRY, MOVE].map((type) => ({ type, hits: 100 })),
    getActiveBodyparts: (part: BodyPartConstant) =>
      part === WORK || part === CARRY || part === MOVE ? 1 : 0,
  } as unknown as Creep;
  const storage = {
    ...structureAt("storage", "damaged-storage", 25, 25),
    hits: mode === "repair" ? 100 : 1_000_000,
    hitsMax: 1_000_000,
    store: energyStore(0, 1_000_000),
  } as StructureStorage;
  const rampart = {
    ...structureAt("rampart", "planned-perimeter", 30, 30),
    hits: mode === "repair" ? 100 : 5_000_000,
    hitsMax: 300_000_000,
  } as StructureRampart;
  const tower = {
    ...structureAt("tower", "tower-built", 22, 20),
    store: energyStore(1_000, 1_000),
  } as StructureTower;
  const hostile = {
    id: "hostile",
    hits: 1_000,
    hitsMax: 1_000,
    pos: position(24, 20),
    body: [{ type: ATTACK, hits: 100 }],
  } as Creep;
  const site = {
    id: "observed-site",
    my: true,
    structureType: "extension",
    pos: position(21, 20),
  } as ConstructionSite;
  const structures: AnyStructure[] =
    mode === "repair"
      ? [storage, rampart, tower]
      : mode === "defend"
        ? [tower]
        : [];
  const hostiles = mode === "repair" || mode === "defend" ? [hostile] : [];
  const sites = mode === "build" ? [site] : [];
  room = {
    name: ROOM,
    controller: { id: "controller", my: true, level: 8 },
    find: (constant: FindConstant) => {
      if (constant === FIND_MY_CREEPS) return [worker];
      if (constant === FIND_MY_STRUCTURES || constant === FIND_STRUCTURES)
        return structures;
      if (constant === FIND_HOSTILE_CREEPS) return hostiles;
      if (constant === FIND_SOURCES) return [source];
      return [];
    },
    lookForAt: () => [],
  } as unknown as Room;
  const myStructures = structures.filter(
    (structure): structure is AnyOwnedStructure =>
      "my" in structure && structure.my === true,
  );
  return {
    creeps: [worker],
    world: {
      tick: 100,
      rooms: [room],
      creeps: [worker],
      spawns: [],
      spatial: {
        byRoom: {
          [ROOM]: {
            roomName: ROOM,
            sources: [source],
            structures,
            myStructures,
            constructionSites: sites,
            hostiles,
            salvage: [],
          },
        },
        nearest: (_origin: RoomPosition, candidates: readonly RoomObject[]) =>
          candidates[0] ?? null,
      },
      budget: { limit: 20, bucket: 10_000, used: 0, mode: "surplus" },
    } as unknown as WorldSnapshot,
  };
}

function spawnNames(intents: readonly Intent[]): string[] {
  return intents.flatMap((intent) =>
    intent.type === "spawn" ? [intent.name] : [],
  );
}

describe("projection-gated consumers", () => {
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
      CREEP_LIFE_TIME: 1_500,
      CREEP_SPAWN_TIME: 3,
      HARVEST_POWER: 2,
      TOWER_ENERGY_COST: 10,
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
      STRUCTURE_SPAWN: "spawn",
      STRUCTURE_EXTENSION: "extension",
      STRUCTURE_TOWER: "tower",
      STRUCTURE_CONTAINER: "container",
      STRUCTURE_LINK: "link",
      STRUCTURE_STORAGE: "storage",
      STRUCTURE_TERMINAL: "terminal",
      STRUCTURE_ROAD: "road",
      STRUCTURE_RAMPART: "rampart",
      TERRAIN_MASK_WALL: 1,
      MAX_CONSTRUCTION_SITES: 100,
      CONTROLLER_STRUCTURES: {
        spawn: { 8: 3 },
        extension: { 8: 60 },
        tower: { 8: 6 },
        container: { 8: 5 },
        link: { 8: 6 },
        storage: { 8: 1 },
        terminal: { 8: 1 },
        observer: { 8: 1 },
        rampart: { 8: 2_500 },
        road: { 8: 2_500 },
      },
    });
  });

  it("admits every projection-derived lane for the current projection epoch", () => {
    const valid = admittedPlan();

    const construction = constructionWorld(true);
    const productionFaithfulRampart = valid.structures.find(
      (structure) => structure.id === "perimeter-rampart",
    );
    expect(productionFaithfulRampart).toMatchObject({
      activation: "defense",
      priority: 600,
      strategicWeight: 4,
    });
    const activeStageCompetitors = valid.structures.filter(
      (structure) =>
        structure.activation !== "defense" &&
        (structure.strategicWeight ?? 0) > 4 &&
        structure.priority > 600 &&
        (structure.requiredForStage !== true ||
          structure.stage === "logistics"),
    );
    expect(activeStageCompetitors.length).toBeGreaterThanOrEqual(3);
    const missingSurvivalAssets = valid.structures.filter(
      (structure) =>
        (structure.structureType === "spawn" ||
          structure.structureType === "tower") &&
        structure.id !== "spawn-1",
    );
    expect(missingSurvivalAssets.length).toBeGreaterThan(6);
    expect(
      missingSurvivalAssets.every(
        (structure) =>
          structure.requiredForStage === true && structure.stage !== undefined,
      ),
    ).toBe(true);
    installProjection(valid, undefined, construction.creeps);
    const admittedConstruction = planConstruction(construction);
    expect(admittedConstruction).toHaveLength(3);
    expect(admittedConstruction[0]).toMatchObject({
      type: "createConstructionSite",
      x: 30,
      y: 30,
      structureType: "rampart",
      priority: 6_600,
    });
    expect(admittedConstruction).toContainEqual(
      expect.objectContaining({
        type: "createConstructionSite",
        x: 30,
        y: 30,
        structureType: "rampart",
      }),
    );
    expect(
      admittedConstruction.filter(
        (intent) =>
          intent.type === "createConstructionSite" &&
          (intent.structureType === "spawn" ||
            intent.structureType === "tower"),
      ),
    ).toHaveLength(2);

    const pressuredConstruction = constructionWorld(true, 5);
    installProjection(valid, undefined, pressuredConstruction.creeps);
    expect(planConstruction(pressuredConstruction)).toEqual([
      expect.objectContaining({
        type: "createConstructionSite",
        x: 30,
        y: 30,
        structureType: "rampart",
        priority: 6_600,
      }),
    ]);

    const mature = matureBufferWorld();
    installProjection(valid, undefined, mature.creeps);
    expect(planMatureEnergyCore(mature.world, [])).toContainEqual(
      expect.objectContaining({
        type: "withdraw",
        targetId: "core-link",
      }),
    );

    const specializedSpawn = spawningWorld();
    installProjection(valid, undefined, specializedSpawn.creeps);
    expect(spawnNames(planSpawning(specializedSpawn.world))[0]).toMatch(
      /^producer-/,
    );

    const surplus = surplusWorld();
    installProjection(valid, undefined, surplus.creeps, surplus.objects);
    expect(planSurplusLaborUtilization(surplus.world, [])).toContainEqual(
      expect.objectContaining({
        type: "withdraw",
        targetId: "source-container",
      }),
    );

    const governedRepair = economyWorld("repair");
    installProjection(valid, undefined, governedRepair.creeps);
    expect(planEconomy(governedRepair.world)).toContainEqual(
      expect.objectContaining({
        type: "repair",
        targetId: "planned-perimeter",
      }),
    );
  });

  for (const adversarialName of ADVERSARIAL_CASE_NAMES) {
    it(`withholds every projection-derived lane for ${adversarialName} while generic observed-world continuity remains live`, () => {
      const valid = admittedPlan();
      const adversarial = adversarialCases(valid).find(
        (candidate) => candidate.name === adversarialName,
      );
      if (!adversarial) {
        throw new Error(
          `missing adversarial projection fixture: ${adversarialName}`,
        );
      }
      const construction = constructionWorld(true);
      const mature = matureBufferWorld();
      const surplus = surplusWorld();

      installProjection(
        adversarial.plan,
        adversarial.fault,
        construction.creeps,
      );
      expect(
        planConstruction(construction),
        `${adversarial.name}: planned construction`,
      ).toEqual([]);

      installProjection(adversarial.plan, adversarial.fault, mature.creeps);
      expect(
        planMatureEnergyCore(mature.world, []),
        `${adversarial.name}: mature buffers and links`,
      ).toEqual([]);

      installProjection(
        adversarial.plan,
        adversarial.fault,
        surplus.creeps,
        surplus.objects,
      );
      expect(
        planSurplusLaborUtilization(surplus.world, []),
        `${adversarial.name}: source-buffer surplus specialization`,
      ).toEqual([]);

      const genericSpawn = spawningWorld();
      installProjection(
        adversarial.plan,
        adversarial.fault,
        genericSpawn.creeps,
      );
      const plannedSpawns = planSpawning(genericSpawn.world);
      expect(
        spawnNames(plannedSpawns),
        `${adversarial.name}: observed workforce recovery`,
      ).toEqual([`worker-${ROOM}-100-1`]);
      expect(
        plannedSpawns.some(
          (intent) =>
            intent.type === "spawn" &&
            (intent.name.startsWith("producer-") ||
              intent.name.startsWith("transport-")),
        ),
        `${adversarial.name}: logistics specialization`,
      ).toBe(false);

      const harvest = economyWorld("harvest");
      installProjection(adversarial.plan, adversarial.fault, harvest.creeps);
      expect(
        planEconomy(harvest.world),
        `${adversarial.name}: generic source collection`,
      ).toContainEqual(
        expect.objectContaining({
          type: "harvest",
          creepName: "generalist",
          sourceId: "observed-source",
        }),
      );

      const build = economyWorld("build");
      installProjection(adversarial.plan, adversarial.fault, build.creeps);
      expect(
        planEconomy(build.world),
        `${adversarial.name}: observed construction-site continuity`,
      ).toContainEqual(
        expect.objectContaining({
          type: "build",
          creepName: "generalist",
          targetId: "observed-site",
        }),
      );

      const repair = economyWorld("repair");
      installProjection(adversarial.plan, adversarial.fault, repair.creeps);
      const repairIntents = planEconomy(repair.world);
      expect(
        repairIntents,
        `${adversarial.name}: generic strategic repair`,
      ).toContainEqual(
        expect.objectContaining({
          type: "repair",
          targetId: "damaged-storage",
        }),
      );
      expect(
        repairIntents.some(
          (intent) =>
            intent.type === "repair" && intent.targetId === "planned-perimeter",
        ),
        `${adversarial.name}: retained perimeter semantics`,
      ).toBe(false);

      const defend = economyWorld("defend");
      installProjection(adversarial.plan, adversarial.fault, defend.creeps);
      expect(
        planDefense(defend.world),
        `${adversarial.name}: observed tower battery`,
      ).toContainEqual(
        expect.objectContaining({
          type: "towerAttack",
          towerId: "tower-built",
          targetId: "hostile",
        }),
      );
    });
  }

  it("resumes every projection-derived lane after a newly admitted recovery epoch", () => {
    const valid = admittedPlan();
    const construction = constructionWorld(true);
    const mature = matureBufferWorld();
    const recoverySeed = structuredClone(valid);
    recoverySeed.structures = recoverySeed.structures.map((structure) =>
      structure.id === "observer-1"
        ? { ...structure, priority: structure.priority + 1 }
        : structure,
    );
    const recovered = currentRoomPlanFixture(
      advanceRoomPlanProjection(recoverySeed, valid),
    );
    expect(recovered.projectionRevision).toBe(
      (valid.projectionRevision ?? 0) + 1,
    );
    expect(recovered.projectionFingerprint).not.toBe(
      valid.projectionFingerprint,
    );

    installProjection(recovered, undefined, construction.creeps);
    expect(
      planConstruction(construction).filter(
        (intent) =>
          intent.type === "createConstructionSite" &&
          intent.structureType === "rampart" &&
          intent.x === 30 &&
          intent.y === 30,
      ),
    ).toHaveLength(1);

    installProjection(recovered, undefined, mature.creeps);
    expect(planMatureEnergyCore(mature.world, [])).toEqual([
      expect.objectContaining({ type: "withdraw", targetId: "core-link" }),
    ]);

    const recoveredSpawn = spawningWorld();
    installProjection(recovered, undefined, recoveredSpawn.creeps);
    expect(spawnNames(planSpawning(recoveredSpawn.world))).toEqual([
      `producer-${ROOM}-100-1`,
    ]);

    const recoveredBuild = economyWorld("build");
    installProjection(recovered, undefined, recoveredBuild.creeps);
    expect(
      planEconomy(recoveredBuild.world).filter(
        (intent) =>
          intent.type === "build" && intent.targetId === "observed-site",
      ),
    ).toHaveLength(1);
  });

  it("prevents same-tick in-place drift and re-assesses a tampered replacement object", () => {
    const admitted = admittedPlan();
    const construction = constructionWorld(true);
    installProjection(admitted, undefined, construction.creeps);

    expect(planConstruction(construction)).not.toEqual([]);
    const admittedAssessment = usableRoomPlanProjection(
      Memory.colonies[ROOM],
      ROOM,
    );
    if (!admittedAssessment.usable) {
      throw new Error("expected current projection admission");
    }
    expect(admittedAssessment.plan).not.toBe(admitted);
    expect(Object.isFrozen(admitted)).toBe(false);
    expect(Object.isFrozen(admittedAssessment.plan)).toBe(true);
    expect(Object.isFrozen(admittedAssessment.plan.structures)).toBe(true);
    expect(Object.isFrozen(admittedAssessment.plan.structures[0])).toBe(true);
    expect(() => {
      const first = admittedAssessment.plan.structures[0];
      if (!first) throw new Error("fixture lost its bootstrap requirement");
      first.priority += 1;
    }).toThrow(TypeError);

    const tamperedReplacement = structuredClone(admitted);
    const first = tamperedReplacement.structures[0];
    if (!first) throw new Error("fixture lost its bootstrap requirement");
    first.priority += 1;
    expect(tamperedReplacement.projectionFingerprint).toBe(
      admitted.projectionFingerprint,
    );

    installProjection(tamperedReplacement, undefined, construction.creeps);
    expect(usableRoomPlanProjection(Memory.colonies[ROOM], ROOM)).toMatchObject(
      {
        usable: false,
        status: "fingerprint_mismatch",
      },
    );
    expect(planConstruction(construction)).toEqual([]);
  });
});
