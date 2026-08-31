import { beforeEach, describe, expect, it, vi } from "vitest";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import {
  ROOM_DEVELOPMENT_STAGES,
  type RoomPlan,
} from "../../src/planning/room-plan";
import type { WorldSnapshot } from "../../src/runtime/context";
import { planEconomy } from "../../src/systems/economy/plan";
import { currentRoomPlanFixture } from "../fixtures/current-room-plan";

for (const [name, value] of Object.entries({
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
  FIND_MY_CREEPS: "my_creeps",
  LOOK_STRUCTURES: "structure",
  HARVEST_POWER: 2,
})) {
  vi.stubGlobal(name, value);
}

let producerEnergy = 0;
let upgraderEnergy = 0;
let controllerLinkEnergy = 50;

function store(
  used: () => number,
  capacity: number,
): Store<ResourceConstant, false> {
  return {
    getUsedCapacity: () => used(),
    getCapacity: () => capacity,
    getFreeCapacity: () => capacity - used(),
  } as unknown as Store<ResourceConstant, false>;
}

function plan(): RoomPlan {
  const common = {
    minRcl: 5,
    priority: 1,
    activation: "automatic" as const,
    reservation: "hard" as const,
    phase: "energy-distribution" as const,
    reason: "mature energy fixture",
    strategicWeight: 5,
    requiredForStage: true,
  };
  return currentRoomPlanFixture({
    version: 4,
    horizonRcl: 8,
    roomName: "W1N1",
    generatedAt: 1,
    generatedReason: "source link integration",
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
      {
        id: "spawn-1",
        x: 20,
        y: 20,
        structureType: "spawn",
        ...common,
        minRcl: 1,
        phase: "bootstrap-capacity",
        stage: "bootstrap",
      },
      {
        id: "source-container-1",
        x: 11,
        y: 10,
        structureType: "container",
        ...common,
        minRcl: 2,
        phase: "source-logistics",
        stage: "logistics",
      },
      {
        id: "storage-1",
        x: 25,
        y: 25,
        structureType: "storage",
        ...common,
        minRcl: 4,
        phase: "core-economy",
        stage: "core-economy",
      },
      {
        id: "link-source",
        x: 12,
        y: 10,
        structureType: "link",
        ...common,
        stage: "core-economy",
      },
      {
        id: "link-controller",
        x: 36,
        y: 40,
        structureType: "link",
        ...common,
        minRcl: 6,
        stage: "advanced-operations",
      },
      {
        id: "link-core",
        x: 24,
        y: 25,
        structureType: "link",
        ...common,
        stage: "core-economy",
      },
      {
        id: "observer-1",
        x: 30,
        y: 25,
        structureType: "observer",
        ...common,
        minRcl: 8,
        phase: "mature-operations",
        stage: "mature-rcl8",
      },
    ],
    roads: [],
    roadGraph: { nodes: [], edges: [] },
    defense: { strategy: "pending-mincut", protectedTiles: [], perimeter: [] },
  });
}

function installWorld(): WorldSnapshot {
  producerEnergy = 0;
  upgraderEnergy = 0;
  controllerLinkEnergy = 50;
  const room = {
    name: "W1N1",
    controller: { id: "controller", my: true, level: 8 },
    energyAvailable: 1_800,
    energyCapacityAvailable: 1_800,
    find: (type: FindConstant) =>
      type === FIND_MY_CREEPS ? [{}, {}, {}, {}] : [],
    lookForAt: (_type: LookConstant, x: number, y: number) => {
      if (x === 11 && y === 10) return [container];
      if (x === 12 && y === 10) return [sourceLink];
      if (x === 36 && y === 40) return [controllerLink];
      if (x === 24 && y === 25) return [coreLink];
      return [];
    },
  } as unknown as Room;
  const pos = (x: number, y: number) =>
    ({
      x,
      y,
      roomName: "W1N1",
      getRangeTo: (target: RoomObject) =>
        Math.max(Math.abs(x - target.pos.x), Math.abs(y - target.pos.y)),
    }) as unknown as RoomPosition;
  const source = {
    id: "source-1",
    energy: 3_000,
    room,
    pos: pos(10, 10),
  } as unknown as Source;
  const container = {
    id: "container-1",
    structureType: "container",
    room,
    pos: pos(11, 10),
    store: store(() => 0, 2_000),
  } as unknown as StructureContainer;
  const sourceLink = {
    id: "source-link",
    my: true,
    structureType: "link",
    room,
    pos: pos(12, 10),
    cooldown: 0,
    store: store(() => 0, 800),
  } as unknown as StructureLink;
  const controllerLink = {
    id: "controller-link",
    my: true,
    structureType: "link",
    room,
    pos: pos(36, 40),
    cooldown: 0,
    store: store(() => controllerLinkEnergy, 800),
  } as unknown as StructureLink;
  const coreLink = {
    id: "core-link",
    my: true,
    structureType: "link",
    room,
    pos: pos(24, 25),
    cooldown: 0,
    store: store(() => 0, 800),
  } as unknown as StructureLink;
  const creep = (
    name: string,
    x: number,
    y: number,
    used: () => number,
    workParts: number,
    carryParts: number,
    moveParts: number,
  ) =>
    ({
      name,
      spawning: false,
      ticksToLive: 1_400,
      room,
      pos: pos(x, y),
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
      store: store(used, carryParts * 50),
      getActiveBodyparts: (part: BodyPartConstant) =>
        part === WORK
          ? workParts
          : part === CARRY
            ? carryParts
            : part === MOVE
              ? moveParts
              : 0,
    }) as unknown as Creep;
  const producer = creep("producer", 11, 10, () => producerEnergy, 6, 2, 4);
  const upgrader = creep("upgrader", 36, 40, () => upgraderEnergy, 1, 1, 1);

  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: { producer, upgrader },
      getObjectById: (id: string) => (id === source.id ? source : null),
    },
    Memory: {
      version: 6,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
          roomPlan: plan(),
        },
      },
    },
  });

  const myStructures = [sourceLink, controllerLink, coreLink];
  return {
    tick: 100,
    rooms: [room],
    creeps: [producer, upgrader],
    spawns: [],
    spatial: {
      byRoom: {
        W1N1: {
          roomName: "W1N1",
          sources: [source],
          structures: [container, ...myStructures],
          myStructures,
          constructionSites: [],
          hostiles: [],
          salvage: [],
        },
      },
      nearest: () => null,
    } as unknown as WorldSnapshot["spatial"],
    budget: { limit: 20, bucket: 10_000, used: 0, mode: "surplus" },
  };
}

describe("mature source/controller link economy integration", () => {
  let world: WorldSnapshot;

  beforeEach(() => {
    world = installWorld();
    activateApprovedColonyGovernance("W1N1");
  });

  it("keeps producing but fails closed to the approved container buffer while link authority is debt", () => {
    expect(planEconomy(world)).toContainEqual(
      expect.objectContaining({
        type: "harvest",
        creepName: "producer",
        sourceId: "source-1",
      }),
    );

    producerEnergy = 100;
    expect(planEconomy(world)).toContainEqual(
      expect.objectContaining({
        type: "transfer",
        creepName: "producer",
        targetId: "container-1",
        reason: "buffer completed producer load at the source edge",
      }),
    );
  });

  it("withdraws a partial controller-link load once, then spends it on controller service", () => {
    const withdrawal = planEconomy(world).find(
      (intent) => "creepName" in intent && intent.creepName === "upgrader",
    );
    expect(withdrawal).toMatchObject({
      type: "withdraw",
      targetId: "controller-link",
      amount: 50,
      trace: {
        procedureId:
          "procedure:W1N1:economy:maintain-colony-energy-service:withdraw-buffered-energy",
      },
    });

    upgraderEnergy = 50;
    controllerLinkEnergy = 0;
    const delivery = planEconomy(world).find(
      (intent) => "creepName" in intent && intent.creepName === "upgrader",
    );
    expect(delivery).toMatchObject({
      type: "upgrade",
      controllerId: "controller",
      reason:
        "convert the governed controller-link load into controller progress",
    });
  });
});
