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
vi.stubGlobal("LOOK_STRUCTURES", "structure");
vi.stubGlobal("STRUCTURE_CONTAINER", "container");

let containerEnergy = 0;

function installWorld(): WorldSnapshot {
  containerEnergy = 0;
  const source = {
    id: "source-1",
    energy: 3000,
  } as unknown as Source;
  const container = {
    id: "container-1",
    structureType: STRUCTURE_CONTAINER,
    store: {
      getUsedCapacity: () => containerEnergy,
    },
  } as unknown as StructureContainer;
  const room = {
    name: "W1N1",
    lookForAt: () => [container],
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
      getObjectById: (id: string) => (id === "source-1" ? source : null),
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

  it("withdraws available buffered energy instead of falling through with no intent", () => {
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

  it("never competes with a primary economy assignment", () => {
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
});
