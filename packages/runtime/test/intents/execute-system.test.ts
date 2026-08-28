import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, intentActorKey } from "../../src/intents/execute";
import type {
  CreateConstructionSiteIntent,
  SpawnIntent,
  TowerAttackIntent,
} from "../../src/intents/types";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_BUSY", -4);
vi.stubGlobal("ERR_INVALID_TARGET", -7);

const spawnCreep = vi.fn(() => OK);
const createConstructionSite = vi.fn(() => OK);
const towerAttack = vi.fn(() => OK);

function installGlobals(): void {
  spawnCreep.mockReset().mockReturnValue(OK);
  createConstructionSite.mockReset().mockReturnValue(OK);
  towerAttack.mockReset().mockReturnValue(OK);

  const tower = { id: "tower-1", attack: towerAttack };
  const hostile = { id: "hostile-1" };
  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: {},
      spawns: {
        Spawn1: { name: "Spawn1", spawning: null, spawnCreep },
      },
      rooms: {
        W1N1: { createConstructionSite },
      },
      getObjectById: (id: string) => {
        if (id === "tower-1") return tower;
        if (id === "hostile-1") return hostile;
        return null;
      },
    },
  });
}

function spawnIntent(): SpawnIntent {
  return {
    type: "spawn",
    spawnName: "Spawn1",
    body: [],
    name: "worker-W1N1-100",
    priority: 100,
    reason: "governed workforce staffing",
  };
}

function siteIntent(): CreateConstructionSiteIntent {
  return {
    type: "createConstructionSite",
    roomName: "W1N1",
    x: 20,
    y: 21,
    structureType: "extension",
    priority: 100,
    reason: "governed infrastructure siting",
    trace: {
      contractId: "contract",
      requirementId: "requirement",
      deliverableId: "deliverable",
      taskId: "task",
      procedureId: "procedure",
      workKey: "infrastructure:W1N1:20:21:extension",
    },
  };
}

function towerIntent(): TowerAttackIntent {
  return {
    type: "towerAttack",
    towerId: "tower-1" as Id<StructureTower>,
    targetId: "hostile-1" as Id<Creep>,
    priority: 100,
    reason: "governed hostile response",
  };
}

describe("system intent execution evidence", () => {
  beforeEach(() => installGlobals());

  it("observes successful spawn, site, and tower execution", () => {
    const spawn = spawnIntent();
    const site = siteIntent();
    const tower = towerIntent();
    const result = execute([spawn, site, tower]);

    expect(result.activities).toHaveLength(3);
    expect(result.activities.map((observation) => observation.result)).toEqual([OK, OK, OK]);
    expect(result.activities.map((observation) => observation.intent.type)).toEqual([
      "spawn",
      "createConstructionSite",
      "towerAttack",
    ]);
    expect(intentActorKey(spawn)).toBe("spawn:Spawn1");
    expect(intentActorKey(site)).toBe(
      "construction:W1N1:infrastructure:W1N1:20:21:extension",
    );
    expect(intentActorKey(tower)).toBe("tower:tower-1");
    expect(spawnCreep).toHaveBeenCalledTimes(1);
    expect(createConstructionSite).toHaveBeenCalledWith(20, 21, "extension");
    expect(towerAttack).toHaveBeenCalledTimes(1);
  });

  it("records failed system execution instead of fabricating success", () => {
    const spawn = spawnIntent();
    (Game.spawns.Spawn1 as StructureSpawn).spawning = {} as Spawning;

    const result = execute([spawn]);

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({
      intent: spawn,
      result: ERR_BUSY,
      movementRequired: false,
    });
    expect(spawnCreep).not.toHaveBeenCalled();
  });
});
