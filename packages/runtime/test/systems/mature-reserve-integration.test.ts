import { beforeEach, describe, expect, it, vi } from "vitest";
import { arbitrate } from "../../src/intents/arbitrate";
import type { Intent } from "../../src/intents/types";
import { MEMORY_VERSION } from "../../src/memory/schema";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomPlan,
  type RoomPlanStructure,
} from "../../src/planning/room-plan";
import { usableRoomPlanProjection } from "../../src/planning/room-plan-projection";
import type { WorldSnapshot } from "../../src/runtime/context";
import { planMatureEnergyCore } from "../../src/systems/economy/mature-energy";
import { planEconomy } from "../../src/systems/economy/plan";
import { currentRoomPlanFixture } from "../fixtures/current-room-plan";

const ROOM = "W1N1";

const position = (x: number, y: number): RoomPosition =>
  ({
    x,
    y,
    roomName: ROOM,
    getRangeTo: (target: RoomObject) =>
      Math.max(Math.abs(x - target.pos.x), Math.abs(y - target.pos.y)),
  }) as unknown as RoomPosition;

const store = (
  energy: number,
  capacity: number,
): Store<ResourceConstant, false> =>
  ({
    getUsedCapacity: () => energy,
    getCapacity: () => capacity,
    getFreeCapacity: () => capacity - energy,
  }) as unknown as Store<ResourceConstant, false>;

function planned(
  id: string,
  structureType: BuildableStructureConstant,
  x: number,
  y: number,
  minRcl: number,
  phase: RoomPlanStructure["phase"],
): RoomPlanStructure {
  return {
    id,
    structureType,
    x,
    y,
    minRcl,
    priority: 1_000 - minRcl,
    activation: structureType === "container" ? "demand" : "automatic",
    reservation: "hard",
    phase,
    reason: `${id} mature-reserve integration fixture`,
    stage:
      phase === "source-logistics"
        ? "logistics"
        : minRcl <= 3
          ? "bootstrap"
          : minRcl <= 5
            ? "core-economy"
            : minRcl <= 7
              ? "advanced-operations"
              : "mature-rcl8",
    strategicWeight: 5,
    requiredForStage: true,
  };
}

function roomPlan(): RoomPlan {
  return currentRoomPlanFixture({
    version: 4,
    horizonRcl: 8,
    roomName: ROOM,
    generatedAt: 100,
    generatedReason: "mature reserve arbitration integration fixture",
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
      planned("spawn-1", "spawn", 20, 20, 1, "bootstrap-capacity"),
      planned("tower-1", "tower", 21, 20, 3, "bootstrap-defense"),
      planned("source-container-1", "container", 11, 10, 2, "source-logistics"),
      planned("storage-1", "storage", 25, 25, 4, "core-economy"),
    ],
    roads: [],
    roadGraph: {
      nodes: [
        { id: "spawn", kind: "spawn", x: 20, y: 20 },
        { id: "hub", kind: "hub", x: 25, y: 25 },
        { id: "source-0", kind: "source", x: 11, y: 10 },
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
      ],
    },
    defense: { strategy: "pending-mincut", protectedTiles: [], perimeter: [] },
  });
}

interface ReserveFixture {
  world: WorldSnapshot;
  plan: RoomPlan;
}

function reserveFixture(underAttack: boolean): ReserveFixture {
  const plan = roomPlan();
  let room: Room;
  const source = {
    id: "source-1",
    energy: 0,
    get room() {
      return room;
    },
    pos: position(10, 10),
  } as unknown as Source;
  const container = {
    id: "source-container-built",
    structureType: "container",
    pos: position(11, 10),
    store: store(0, 2_000),
  } as unknown as StructureContainer;
  const spawn = {
    id: "spawn-built",
    name: "Spawn1",
    my: true,
    structureType: "spawn",
    pos: position(20, 20),
    spawning: null,
    store: store(0, 300),
  } as unknown as StructureSpawn;
  const tower = {
    id: "tower-built",
    my: true,
    structureType: "tower",
    pos: position(21, 20),
    store: store(0, 1_000),
  } as unknown as StructureTower;
  const storage = {
    id: "storage-built",
    my: true,
    structureType: "storage",
    pos: position(25, 25),
    store: store(20_100, 1_000_000),
  } as unknown as StructureStorage;

  const creep = (
    name: string,
    x: number,
    y: number,
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
      memory: { energyMode: "collect" },
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
      store: store(0, Math.max(50, carryParts * 50)),
      getActiveBodyparts: (part: BodyPartConstant) =>
        part === WORK
          ? workParts
          : part === CARRY
            ? carryParts
            : part === MOVE
              ? moveParts
              : 0,
    }) as unknown as Creep;

  const producer = creep("producer", 11, 10, 5, 1);
  const hauler = creep("hauler", 12, 10, 0, 4);
  const guards = Array.from({ length: 3 }, (_, index) =>
    creep(`guard-${index + 1}`, 20 + index, 22, 0, 0),
  );
  const creeps = [producer, hauler, ...guards];
  const hostiles = underAttack
    ? ([{ id: "hostile", pos: position(22, 20) }] as unknown as Creep[])
    : [];
  const structures = [container, spawn, tower, storage] as AnyStructure[];
  const myStructures = [spawn, tower, storage] as AnyOwnedStructure[];
  room = {
    name: ROOM,
    controller: {
      id: "controller",
      my: true,
      level: 8,
      pos: position(40, 40),
    },
    energyAvailable: 0,
    energyCapacityAvailable: 300,
    find: (constant: FindConstant) => {
      if (constant === FIND_MY_CREEPS) return creeps;
      if (constant === FIND_SOURCES) return [source];
      if (constant === FIND_HOSTILE_CREEPS) return hostiles;
      return [];
    },
    lookForAt: (constant: LookConstant, x: number, y: number) =>
      constant === LOOK_STRUCTURES
        ? structures.filter(
            (structure) => structure.pos.x === x && structure.pos.y === y,
          )
        : [],
  } as unknown as Room;

  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: Object.fromEntries(
        creeps.map((candidate) => [candidate.name, candidate]),
      ),
      getObjectById: (id: string) => (id === source.id ? source : null),
    },
    Memory: {
      version: MEMORY_VERSION,
      colonies: {
        [ROOM]: { roomName: ROOM, discoveredAt: 1, roomPlan: plan },
      },
    },
  });
  activateApprovedColonyGovernance(ROOM);

  return {
    plan,
    world: {
      tick: 100,
      rooms: [room],
      creeps,
      spawns: [spawn],
      spatial: {
        byRoom: {
          [ROOM]: {
            roomName: ROOM,
            sources: [source],
            structures,
            myStructures,
            constructionSites: [],
            hostiles,
            salvage: [],
          },
        },
        nearest: (origin: RoomPosition, candidates: RoomObject[]) =>
          [...candidates].sort(
            (left, right) =>
              origin.getRangeTo(left) - origin.getRangeTo(right) ||
              String((left as { id?: string }).id ?? "").localeCompare(
                String((right as { id?: string }).id ?? ""),
              ),
          )[0],
      },
      budget: { limit: 20, bucket: 10_000, used: 0, mode: "surplus" },
    } as unknown as WorldSnapshot,
  };
}

function creepIntent(intents: readonly Intent[], creepName: string) {
  return intents.find(
    (intent) => "creepName" in intent && intent.creepName === creepName,
  );
}

describe("mature reserve integration", () => {
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
      FIND_HOSTILE_CREEPS: "hostile_creeps",
      FIND_MY_CONSTRUCTION_SITES: "my_construction_sites",
      LOOK_STRUCTURES: "structure",
      HARVEST_POWER: 2,
    });
  });

  it.each([
    { underAttack: false, expectedAmount: 100 },
    { underAttack: true, expectedAmount: 200 },
  ])(
    "preempts idle source staging with reserve recovery when underAttack=$underAttack",
    ({ underAttack, expectedAmount }) => {
      const { world } = reserveFixture(underAttack);
      expect(
        usableRoomPlanProjection(Memory.colonies[ROOM], ROOM),
      ).toMatchObject({ usable: true, status: "current" });
      const economy = planEconomy(world);
      const staged = creepIntent(economy, "hauler");

      expect(staged).toMatchObject({
        type: "move",
        priority: 150,
      });
      expect(staged?.trace?.procedureId).toMatch(/:stage-source-transport$/);

      const mature = planMatureEnergyCore(world, economy);
      const recovery = creepIntent(mature, "hauler");
      expect(recovery).toMatchObject({
        type: "withdraw",
        targetId: "storage-built",
        amount: expectedAmount,
      });

      const accepted = arbitrate([...economy, ...mature]);
      expect(creepIntent(accepted, "hauler")).toBe(recovery);
      expect(
        accepted.some(
          (intent) =>
            intent.type === "move" &&
            intent.creepName === "hauler" &&
            intent.trace?.procedureId.endsWith(":stage-source-transport"),
        ),
      ).toBe(false);
    },
  );
});
