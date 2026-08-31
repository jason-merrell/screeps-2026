import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Intent } from "../../src/intents/types";
import type { WorldSnapshot } from "../../src/runtime/context";
import { planSurplusLaborUtilization } from "../../src/systems/economy/surplus-utilization";

vi.stubGlobal("WORK", "work");
vi.stubGlobal("CARRY", "carry");
vi.stubGlobal("ATTACK", "attack");
vi.stubGlobal("RANGED_ATTACK", "ranged_attack");
vi.stubGlobal("HEAL", "heal");
vi.stubGlobal("CLAIM", "claim");
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("FIND_MY_CREEPS", "my_creeps");
vi.stubGlobal("LOOK_STRUCTURES", "structure");
vi.stubGlobal("STRUCTURE_CONTAINER", "container");

let containerEnergy = 0;
let secondContainerEnergy = 0;

function installWorld(): WorldSnapshot {
  containerEnergy = 0;
  secondContainerEnergy = 0;
  const sources = [
    { id: "source-1", energy: 3000 },
    { id: "source-2", energy: 3000 },
  ] as unknown as Source[];
  const containers = [
    {
      id: "container-1",
      structureType: STRUCTURE_CONTAINER,
      store: { getUsedCapacity: () => containerEnergy },
    },
    {
      id: "container-2",
      structureType: STRUCTURE_CONTAINER,
      store: { getUsedCapacity: () => secondContainerEnergy },
    },
  ] as unknown as StructureContainer[];
  const room = {
    name: "W1N1",
    controller: { level: 6 },
    find: (type: FindConstant) =>
      type === FIND_MY_CREEPS ? Array.from({ length: 6 }, () => ({})) : [],
    lookForAt: (_look: LookConstant, x: number) =>
      x === 10 ? [containers[0]] : x === 20 ? [containers[1]] : [],
  } as unknown as Room;
  const creep = {
    name: "worker-1",
    spawning: false,
    room,
    pos: {
      getRangeTo: () => 5,
    },
    store: {
      getUsedCapacity: () => 0,
    },
    getActiveBodyparts: (part: BodyPartConstant) =>
      part === WORK || part === CARRY ? 1 : 0,
  } as unknown as Creep;

  Object.assign(globalThis, {
    Game: {
      time: 100,
      getObjectById: (id: string) =>
        sources.find((source) => source.id === id) ?? null,
    },
    Memory: {
      version: 5,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
          roomPlan: {
            anchors: {
              sources: [
                {
                  sourceId: "source-1",
                  container: { x: 10, y: 11 },
                },
                {
                  sourceId: "source-2",
                  container: { x: 20, y: 21 },
                },
              ],
            },
          },
        },
      },
    },
  });

  return {
    tick: 100,
    rooms: [room],
    creeps: [creep],
    spawns: [],
    spatial: {} as WorldSnapshot["spatial"],
    budget: { limit: 20, bucket: 10000, used: 0, mode: "surplus" },
  };
}

describe("surplus hybrid labor utilization", () => {
  let world: WorldSnapshot;

  beforeEach(() => {
    world = installWorld();
  });

  it("withdraws unclaimed buffered energy instead of falling through with no intent", () => {
    containerEnergy = 500;

    const intents = planSurplusLaborUtilization(world, []);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: "withdraw",
      creepName: "worker-1",
      targetId: "container-1",
      priority: 300,
      trace: {
        taskId: "task:W1N1:economy:maintain-colony-energy-service",
        procedureId:
          "procedure:W1N1:economy:maintain-colony-energy-service:withdraw-buffered-energy",
      },
    });
  });

  it("stages near a source buffer as intentional waiting when no buffered energy is available", () => {
    const intents = planSurplusLaborUtilization(world, []);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: "move",
      creepName: "worker-1",
      targetId: "container-1",
      range: 2,
      priority: 150,
      trace: {
        taskId: "task:W1N1:economy:maintain-colony-energy-service",
        procedureId:
          "procedure:W1N1:economy:maintain-colony-energy-service:stage-source-transport",
      },
    });
  });

  it("never competes with a primary economy assignment for the same performer", () => {
    const primary: Intent[] = [
      {
        type: "move",
        creepName: "worker-1",
        targetId: "container-1" as Id<StructureContainer>,
        range: 1,
        priority: 1000,
        reason: "primary assignment",
      },
    ];

    expect(planSurplusLaborUtilization(world, primary)).toEqual([]);
  });

  it("does not steal buffered energy already reserved by a primary hauler", () => {
    containerEnergy = 500;
    const primary: Intent[] = [
      {
        type: "withdraw",
        creepName: "transport-1",
        targetId: "container-1" as Id<StructureContainer>,
        resource: RESOURCE_ENERGY,
        priority: 1050,
        reason: "primary source-buffer reservation",
      },
    ];

    expect(planSurplusLaborUtilization(world, primary)).toMatchObject([
      {
        type: "move",
        creepName: "worker-1",
        targetId: "container-1",
        range: 2,
        priority: 150,
      },
    ]);
  });

  it("distributes multiple surplus performers across available staging buffers", () => {
    const first = world.creeps[0];
    if (!first) throw new Error("expected the fixture's first worker");
    world.creeps.push({ ...first, name: "worker-2" } as Creep);

    const intents = planSurplusLaborUtilization(world, []);

    expect(intents).toHaveLength(2);
    expect(
      intents.map((intent) =>
        "targetId" in intent ? String(intent.targetId) : null,
      ),
    ).toEqual(["container-1", "container-2"]);
  });

  it("inherits the primary source-buffer activation gate", () => {
    const room = world.rooms[0];
    if (!room?.controller)
      throw new Error("expected the fixture's owned controller");
    (room.controller as StructureController).level = 1;

    expect(planSurplusLaborUtilization(world, [])).toEqual([]);
  });
});
