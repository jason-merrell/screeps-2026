import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityExecutionObservation } from "../../src/intents/execute";
import {
  createIntentTrace,
  infrastructureWorkKey,
} from "../../src/intents/trace";
import type {
  BuildIntent,
  CreateConstructionSiteIntent,
} from "../../src/intents/types";
import {
  bindFspmActivities,
  fspmActivityEvents,
  reconcileFspmActivityEvidence,
} from "../../src/planning/activity-lifecycle";
import {
  activateApprovedColonyGovernance,
  ensureColonyPortfolio,
} from "../../src/planning/fspm";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_NOT_IN_RANGE", -9);
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");
vi.stubGlobal("LOOK_STRUCTURES", "structure");

const ROOM = "W1N1";
const WORK_KEY = infrastructureWorkKey(ROOM, 20, 21, "extension");
let objectById = new Map<string, RoomObject>();
let built = false;

function builder(): Creep {
  return {
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
}

function siteObject(id: string): ConstructionSite {
  return {
    id,
    pos: { x: 20, y: 21, roomName: ROOM },
    structureType: "extension",
  } as unknown as ConstructionSite;
}

function installGlobals(): void {
  objectById = new Map();
  built = false;
  const creep = builder();
  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: { "builder-1": creep },
      spawns: {},
      rooms: {
        [ROOM]: {
          name: ROOM,
          controller: { my: true },
          lookForAt: () =>
            built
              ? [{ structureType: "extension" } as unknown as Structure]
              : [],
        },
      },
      getObjectById: (id: string) => objectById.get(id) ?? null,
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
    reason: "site planned extension",
    trace: createIntentTrace({
      roomName: ROOM,
      domain: "construction",
      task: "realize-planned-infrastructure",
      procedure: "site-planned-structure",
      workKey: WORK_KEY,
    }),
  };
}

function buildIntent(siteId: string): BuildIntent {
  return {
    type: "build",
    creepName: "builder-1",
    targetId: siteId as Id<ConstructionSite>,
    priority: 100,
    reason: "build planned extension",
    trace: createIntentTrace({
      roomName: ROOM,
      domain: "construction",
      task: "realize-planned-infrastructure",
      procedure: "build-planned-infrastructure",
      workKey: WORK_KEY,
    }),
  };
}

function successfulObservation(
  intent: BuildIntent | CreateConstructionSiteIntent,
): ActivityExecutionObservation {
  return {
    intent,
    result: OK,
    movementRequired: false,
    evidence: `${intent.type} executed successfully`,
  };
}

describe("FSPM construction recovery", () => {
  beforeEach(() => {
    installGlobals();
    activateApprovedColonyGovernance("W1N1");
  });

  it("re-sites interrupted construction under the same Activity and verifies the built output", () => {
    const firstSite = siteIntent();
    bindFspmActivities([firstSite]);
    const activityId = firstSite.trace?.activityId;
    if (!activityId) throw new Error("expected construction Activity");
    reconcileFspmActivityEvidence([successfulObservation(firstSite)]);

    objectById.set("site-1", siteObject("site-1") as unknown as RoomObject);
    Game.time = 101;
    const firstBuild = buildIntent("site-1");
    bindFspmActivities([firstBuild]);
    expect(firstBuild.trace?.activityId).toBe(activityId);
    reconcileFspmActivityEvidence([successfulObservation(firstBuild)]);

    objectById.delete("site-1");
    Game.time = 102;
    bindFspmActivities([]);

    const portfolio = ensureColonyPortfolio(ROOM);
    expect(portfolio.activities?.[activityId]).toMatchObject({
      assignee: "builder-1",
      status: "on_hold",
      metrics: { blockedTicks: 1, holdCount: 2 },
    });
    expect(portfolio.activities?.[activityId]?.kpiScore).toBeUndefined();

    const replacementSite = siteIntent();
    bindFspmActivities([replacementSite]);
    expect(replacementSite.trace?.activityId).toBe(activityId);
    expect(Object.keys(portfolio.activities ?? {})).toHaveLength(1);
    expect(portfolio.activities?.[activityId]).toMatchObject({
      status: "in_progress",
      currentProcedureId: replacementSite.trace?.procedureId,
    });
    reconcileFspmActivityEvidence([successfulObservation(replacementSite)]);

    objectById.set("site-2", siteObject("site-2") as unknown as RoomObject);
    Game.time = 103;
    const resumedBuild = buildIntent("site-2");
    bindFspmActivities([resumedBuild]);
    expect(resumedBuild.trace?.activityId).toBe(activityId);
    reconcileFspmActivityEvidence([successfulObservation(resumedBuild)]);

    objectById.delete("site-2");
    built = true;
    Game.time = 104;
    bindFspmActivities([]);

    expect(portfolio.activities?.[activityId]).toMatchObject({
      status: "completed",
      completedAt: 104,
      kpiScore: "unsatisfactory",
      metrics: {
        blockedTicks: 1,
        procedureTransitions: 3,
      },
    });
    expect(
      portfolio.activityKpiHistory?.[firstSite.trace?.taskId ?? ""],
    ).toHaveLength(1);

    const events = fspmActivityEvents(portfolio).filter(
      (event) => event.activityId === activityId,
    );
    expect(
      events.filter((event) => event.type === "activity_reassigned"),
    ).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "activity_completed"),
    ).toHaveLength(1);
  });
});
