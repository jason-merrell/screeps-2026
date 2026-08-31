import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityExecutionObservation } from "../../src/intents/execute";
import {
  createIntentTrace,
  infrastructureWorkKey,
} from "../../src/intents/trace";
import type {
  BuildIntent,
  CreateConstructionSiteIntent,
  SpawnIntent,
} from "../../src/intents/types";
import {
  bindFspmActivities,
  fspmActivityEvents,
  reconcileFspmActivityEvidence,
} from "../../src/planning/activity-lifecycle";
import { ensureColonyPortfolio } from "../../src/planning/fspm";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_NOT_IN_RANGE", -9);
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");

const ROOM = "W1N1";
const WORK_KEY = infrastructureWorkKey(ROOM, 20, 21, "extension");

function installGlobals(): void {
  const builder = {
    name: "builder-1",
    spawning: false,
    room: { name: ROOM },
    pos: { roomName: ROOM },
    memory: {},
    store: {
      getUsedCapacity: () => 50,
      getCapacity: () => 50,
    },
  } as unknown as Creep;

  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: { "builder-1": builder },
      spawns: {
        Spawn1: {
          name: "Spawn1",
          room: { name: ROOM },
          pos: { roomName: ROOM },
        },
      },
      rooms: {
        [ROOM]: { name: ROOM, controller: { my: true } },
      },
      getObjectById: () => ({
        id: "site-1",
        pos: { x: 20, y: 21, roomName: ROOM },
        structureType: "extension",
      }),
    },
    Memory: {
      version: 5,
      colonies: {
        [ROOM]: { roomName: ROOM, discoveredAt: 1 },
      },
    },
  });
}

function siteIntent(): CreateConstructionSiteIntent {
  return {
    type: "createConstructionSite",
    roomName: ROOM,
    x: 20,
    y: 21,
    structureType: "extension",
    priority: 100,
    reason: "site governed planned extension",
    trace: createIntentTrace({
      roomName: ROOM,
      domain: "construction",
      task: "realize-planned-infrastructure",
      procedure: "site-planned-structure",
      workKey: WORK_KEY,
    }),
  };
}

function buildIntent(): BuildIntent {
  return {
    type: "build",
    creepName: "builder-1",
    targetId: "site-1" as Id<ConstructionSite>,
    priority: 100,
    reason: "build governed planned extension",
    trace: createIntentTrace({
      roomName: ROOM,
      domain: "construction",
      task: "realize-planned-infrastructure",
      procedure: "build-planned-infrastructure",
      workKey: WORK_KEY,
    }),
  };
}

function spawnIntent(): SpawnIntent {
  return {
    type: "spawn",
    spawnName: "Spawn1",
    body: [] as BodyPartConstant[],
    name: "worker-W1N1-100",
    priority: 1200,
    reason: "workforce demand 1/2",
    trace: createIntentTrace({
      roomName: ROOM,
      domain: "spawning",
      task: "maintain-workforce-capacity",
      procedure: "maintain-general-workforce",
    }),
  };
}

describe("FSPM system Activity lifecycle", () => {
  beforeEach(() => installGlobals());

  it("holds successful site creation and hands the same Activity to its builder", () => {
    const site = siteIntent();
    bindFspmActivities([site]);
    const activityId = site.trace?.activityId;
    if (!activityId) throw new Error("expected site Activity");

    const portfolio = ensureColonyPortfolio(ROOM);
    expect(portfolio.activities?.[activityId]).toMatchObject({
      taskId: site.trace?.taskId,
      status: "in_progress",
      currentProcedureId: site.trace?.procedureId,
    });

    const systemAssignments = reconcileFspmActivityEvidence([
      {
        intent: site,
        result: OK,
        movementRequired: false,
        evidence: "construction site created",
      } satisfies ActivityExecutionObservation,
    ]);

    expect(systemAssignments).toContainEqual(
      expect.objectContaining({ activityId, state: "executing" }),
    );
    expect(portfolio.activities?.[activityId]).toMatchObject({
      status: "on_hold",
      metrics: { productiveTicks: 1, holdCount: 1 },
    });
    expect(portfolio.activities?.[activityId]?.kpiScore).toBeUndefined();
    expect(
      portfolio.activityKpiHistory?.[site.trace?.taskId ?? ""],
    ).toBeUndefined();

    Game.time = 101;
    const build = buildIntent();
    bindFspmActivities([build]);

    expect(build.trace?.activityId).toBe(activityId);
    expect(Object.keys(portfolio.activities ?? {})).toHaveLength(1);
    expect(portfolio.activities?.[activityId]).toMatchObject({
      assignee: "builder-1",
      status: "in_progress",
      currentProcedureId: build.trace?.procedureId,
      currentTargetKey: "site-1",
      metrics: {
        resumeCount: 1,
        procedureTransitions: 1,
        targetRetargets: 0,
      },
    });

    const events = fspmActivityEvents(portfolio).filter(
      (event) => event.activityId === activityId,
    );
    expect(events.map((event) => event.type)).toContain("activity_reassigned");
    expect(events.map((event) => event.type)).toContain("activity_resumed");
    expect(events.map((event) => event.type)).not.toContain(
      "activity_completed",
    );
  });

  it("keeps staffing In Progress until the spawned creep becomes viable", () => {
    const spawn = spawnIntent();
    bindFspmActivities([spawn]);
    const activityId = spawn.trace?.activityId;
    if (!activityId) throw new Error("expected staffing Activity");

    const spawned = {
      name: spawn.name,
      spawning: true,
      memory: {},
    } as unknown as Creep;
    Game.creeps[spawn.name] = spawned;

    reconcileFspmActivityEvidence([
      {
        intent: spawn,
        result: OK,
        movementRequired: false,
        evidence: "spawn accepted staffing prescription",
      } satisfies ActivityExecutionObservation,
    ]);

    const portfolio = ensureColonyPortfolio(ROOM);
    expect(portfolio.activities?.[activityId]).toMatchObject({
      status: "in_progress",
      currentTargetKey: `creep:${spawn.name}`,
      metrics: { productiveTicks: 1 },
    });
    expect(portfolio.activities?.[activityId]?.completedAt).toBeUndefined();
    expect(portfolio.activities?.[activityId]?.kpiScore).toBeUndefined();
    expect(
      portfolio.activityKpiHistory?.[spawn.trace?.taskId ?? ""],
    ).toBeUndefined();

    Game.time = 101;
    reconcileFspmActivityEvidence([]);
    expect(portfolio.activities?.[activityId]).toMatchObject({
      status: "in_progress",
      metrics: { waitTicks: 1 },
    });

    Game.time = 102;
    spawned.spawning = false;
    reconcileFspmActivityEvidence([]);

    expect(portfolio.activities?.[activityId]).toMatchObject({
      status: "completed",
      completedAt: 102,
      kpiScore: "satisfactory",
    });
    expect(
      portfolio.activityKpiHistory?.[spawn.trace?.taskId ?? ""],
    ).toHaveLength(1);
    expect(
      fspmActivityEvents(portfolio)
        .filter((event) => event.activityId === activityId)
        .map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "activity_opened",
        "activity_started",
        "activity_completed",
        "kpi_scored",
      ]),
    );
  });
});
