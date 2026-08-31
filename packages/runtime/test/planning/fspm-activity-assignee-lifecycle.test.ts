import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarvestIntent } from "../../src/intents/types";
import {
  bindFspmActivities,
  fspmActivityEvents,
} from "../../src/planning/activity-lifecycle";
import {
  activateApprovedColonyGovernance,
  ensureColonyPortfolio,
  ensureProcedure,
  ensureTask,
} from "../../src/planning/fspm";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_NOT_IN_RANGE", -9);
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");

const TASK_KEY = "maintain-colony-energy-service";
const PROCEDURE_KEY = "extract-source-energy";

function testCreep(name: string): Creep {
  return {
    name,
    spawning: false,
    room: { name: "W1N1" },
    pos: { roomName: "W1N1" },
    memory: {},
    store: {
      getUsedCapacity: () => 0,
      getCapacity: () => 50,
    },
  } as unknown as Creep;
}

function installGlobals(time = 100): void {
  const worker = testCreep("worker-1");
  Object.assign(globalThis, {
    Game: {
      time,
      creeps: { "worker-1": worker },
      getObjectById: (id: string) => ({ id, pos: { roomName: "W1N1" } }),
    },
    Memory: {
      version: 5,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
        },
      },
    },
  });
}

function setCreep(name: string, creep: Creep | undefined): void {
  const creeps = Game.creeps as Record<string, Creep>;
  if (creep) creeps[name] = creep;
  else delete creeps[name];
}

function intent(creepName: string, sourceId = "source-1"): HarvestIntent {
  const task = ensureTask("W1N1", "economy", TASK_KEY);
  const procedure = ensureProcedure("W1N1", "economy", TASK_KEY, PROCEDURE_KEY);
  const portfolio = ensureColonyPortfolio("W1N1");
  const requirement = portfolio.requirements.economy;
  const deliverable = portfolio.deliverables.economy;
  if (!requirement || !deliverable)
    throw new Error("expected economy hierarchy");

  return {
    type: "harvest",
    creepName,
    sourceId: sourceId as Id<Source>,
    priority: 100,
    reason: "test governed energy-service work",
    trace: {
      p3Id: portfolio.p3.id,
      requirementId: requirement.id,
      deliverableId: deliverable.id,
      taskId: task.id,
      procedureId: procedure.id,
    },
  };
}

function activities() {
  return Object.values(ensureColonyPortfolio("W1N1").activities ?? {});
}

describe("FSPM Activity assignee lifecycle", () => {
  beforeEach(() => {
    installGlobals();
    activateApprovedColonyGovernance("W1N1");
  });

  it("puts unfinished work On Hold when its assignee creep disappears without scoring KPI", () => {
    const work = intent("worker-1");
    bindFspmActivities([work]);
    const activityId = work.trace?.activityId;
    const taskId = work.trace?.taskId ?? "";
    if (!activityId) throw new Error("expected bound Activity");

    setCreep("worker-1", undefined);
    Game.time = 101;
    bindFspmActivities([]);

    const portfolio = ensureColonyPortfolio("W1N1");
    const held = activities().find((activity) => activity.id === activityId);
    expect(held).toMatchObject({
      status: "on_hold",
      currentDisposition: "on_hold",
      metrics: { holdCount: 1, taskPreemptions: 0 },
    });
    expect(held?.holdReason).toContain("worker-1 is unavailable");
    expect(held?.completedAt).toBeUndefined();
    expect(held?.kpiScore).toBeUndefined();
    expect(portfolio.activityKpiHistory?.[taskId]).toBeUndefined();

    const events = fspmActivityEvents(portfolio).filter(
      (event) => event.activityId === activityId,
    );
    expect(
      events.filter((event) => event.type === "activity_held"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "activity_completed"),
    ).toHaveLength(0);
    expect(events.filter((event) => event.type === "kpi_scored")).toHaveLength(
      0,
    );
  });

  it("reassigns and resumes the same orphaned Activity for the same Task and concrete target", () => {
    const work = intent("worker-1", "source-1");
    bindFspmActivities([work]);
    const activityId = work.trace?.activityId;
    if (!activityId) throw new Error("expected bound Activity");

    setCreep("worker-1", undefined);
    Game.time = 101;
    bindFspmActivities([]);

    setCreep("worker-2", testCreep("worker-2"));
    Game.time = 102;
    const replacement = intent("worker-2", "source-1");
    bindFspmActivities([replacement]);

    expect(replacement.trace?.activityId).toBe(activityId);
    expect(activities()).toHaveLength(1);
    expect(activities()[0]).toMatchObject({
      id: activityId,
      assignee: "worker-2",
      status: "in_progress",
      currentTargetKey: "source-1",
      metrics: { holdCount: 1, resumeCount: 1, targetRetargets: 0 },
    });

    const reassignment = fspmActivityEvents(ensureColonyPortfolio("W1N1")).find(
      (event) =>
        event.activityId === activityId && event.type === "activity_reassigned",
    );
    expect(reassignment).toMatchObject({
      actor: "worker-2",
      previousAssignee: "worker-1",
      targetKey: "source-1",
    });
  });

  it("does not hijack an orphaned Activity when only the Task matches but the target differs", () => {
    const original = intent("worker-1", "source-1");
    bindFspmActivities([original]);
    const originalId = original.trace?.activityId;
    if (!originalId) throw new Error("expected bound Activity");

    setCreep("worker-1", undefined);
    Game.time = 101;
    bindFspmActivities([]);

    setCreep("worker-2", testCreep("worker-2"));
    Game.time = 102;
    const differentWork = intent("worker-2", "source-2");
    bindFspmActivities([differentWork]);

    expect(differentWork.trace?.activityId).not.toBe(originalId);
    expect(activities()).toHaveLength(2);
    expect(
      activities().find((activity) => activity.id === originalId),
    ).toMatchObject({
      assignee: "worker-1",
      status: "on_hold",
      currentTargetKey: "source-1",
    });
    expect(
      activities().find(
        (activity) => activity.id === differentWork.trace?.activityId,
      ),
    ).toMatchObject({
      assignee: "worker-2",
      status: "in_progress",
      currentTargetKey: "source-2",
    });
    expect(
      fspmActivityEvents(ensureColonyPortfolio("W1N1")).filter(
        (event) =>
          event.activityId === originalId &&
          event.type === "activity_reassigned",
      ),
    ).toHaveLength(0);
  });
});
