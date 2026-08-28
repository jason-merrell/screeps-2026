import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityExecutionObservation } from "../../src/intents/execute";
import { createIntentTrace } from "../../src/intents/trace";
import type { HarvestIntent } from "../../src/intents/types";
import {
  activityContinuityRatio,
  activityWorkConversionRatio,
  bindFspmActivities,
  fspmActivityEvents,
  reconcileFspmActivityEvidence,
} from "../../src/planning/activity-lifecycle";
import { ensureColonyPortfolio, ensureProcedure, ensureTask } from "../../src/planning/fspm";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_NOT_IN_RANGE", -9);
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");

let creepEnergy = 0;
let creepCapacity = 50;
let objectById = new Map<string, RoomObject>();

function testCreep(): Creep {
  return {
    name: "worker-1",
    spawning: false,
    memory: {},
    store: {
      getUsedCapacity: () => creepEnergy,
      getCapacity: () => creepCapacity,
    },
  } as unknown as Creep;
}

function installGlobals(time = 100): void {
  creepEnergy = 0;
  creepCapacity = 50;
  objectById = new Map();
  const creep = testCreep();
  Object.assign(globalThis, {
    Game: {
      time,
      creeps: { "worker-1": creep },
      getObjectById: (id: string) => objectById.get(id) ?? null,
    },
    Memory: {
      version: 4,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
        },
      },
    },
  });
}

function intent(
  taskKey: string,
  procedureKey: string,
  sourceId = "source-1",
): HarvestIntent {
  const task = ensureTask("W1N1", "economy", taskKey);
  const procedure = ensureProcedure("W1N1", "economy", taskKey, procedureKey);
  const portfolio = ensureColonyPortfolio("W1N1");
  const requirement = portfolio.requirements.economy;
  const deliverable = portfolio.deliverables.economy;
  if (!requirement || !deliverable) throw new Error("expected economy hierarchy");

  return {
    type: "harvest",
    creepName: "worker-1",
    sourceId: sourceId as Id<Source>,
    priority: 100,
    reason: "test work",
    trace: {
      contractId: portfolio.contract.id,
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

describe("FSPM Activity lifecycle", () => {
  beforeEach(() => installGlobals());

  it("keeps concrete targets out of governed Procedure identity", () => {
    const first = createIntentTrace({
      roomName: "W1N1",
      domain: "economy",
      task: "produce-source-energy",
      activity: "worker-1:harvest:source-a",
    });
    const second = createIntentTrace({
      roomName: "W1N1",
      domain: "economy",
      task: "produce-source-energy",
      activity: "worker-1:harvest:source-b",
    });

    expect(second.procedureId).toBe(first.procedureId);
    expect(ensureTask("W1N1", "economy", "produce-source-energy").procedures).toHaveLength(1);
  });

  it("records target retargets separately from Procedure transitions", () => {
    const first = intent("sustain-energy", "collect-energy", "source-1");
    bindFspmActivities([first]);
    const firstId = first.trace?.activityId;

    Game.time = 101;
    const retargeted = intent("sustain-energy", "collect-energy", "source-2");
    bindFspmActivities([retargeted]);

    expect(retargeted.trace?.activityId).toBe(firstId);
    expect(activities()[0]).toMatchObject({
      currentTargetKey: "source-2",
      metrics: { targetRetargets: 1, procedureTransitions: 0 },
    });
    expect(
      fspmActivityEvents(ensureColonyPortfolio("W1N1")).filter(
        (event) => event.type === "target_changed",
      ),
    ).toHaveLength(1);
  });

  it("keeps one Activity while the assignee advances Procedures inside the same Task", () => {
    const collect = intent("sustain-energy", "collect-energy");
    bindFspmActivities([collect]);
    const firstId = collect.trace?.activityId;

    Game.time = 101;
    const deliver = intent("sustain-energy", "deliver-energy");
    bindFspmActivities([deliver]);

    expect(deliver.trace?.activityId).toBe(firstId);
    expect(activities()).toHaveLength(1);
    expect(activities()[0]).toMatchObject({
      status: "in_progress",
      currentProcedureId: deliver.trace?.procedureId,
      metrics: { procedureTransitions: 1, taskPreemptions: 0, targetRetargets: 0 },
    });
  });

  it("puts unfinished work On Hold when the assignee switches Tasks", () => {
    const economy = intent("sustain-energy", "collect-energy");
    bindFspmActivities([economy]);
    const economyId = economy.trace?.activityId;

    Game.time = 101;
    const construction = intent("build-infrastructure", "build-planned-structure");
    bindFspmActivities([construction]);

    const previous = activities().find((activity) => activity.id === economyId);
    const current = activities().find((activity) => activity.id === construction.trace?.activityId);
    expect(previous).toMatchObject({
      status: "on_hold",
      metrics: { holdCount: 1, taskPreemptions: 1 },
    });
    expect(current?.status).toBe("in_progress");
  });

  it("resumes the same held Activity when its Task becomes current again", () => {
    const economy = intent("sustain-energy", "collect-energy");
    bindFspmActivities([economy]);
    const economyId = economy.trace?.activityId;

    Game.time = 101;
    bindFspmActivities([intent("build-infrastructure", "build-planned-structure")]);

    Game.time = 102;
    const resumed = intent("sustain-energy", "deliver-energy");
    bindFspmActivities([resumed]);

    expect(resumed.trace?.activityId).toBe(economyId);
    expect(activities().find((activity) => activity.id === economyId)).toMatchObject({
      status: "in_progress",
      metrics: { resumeCount: 1, procedureTransitions: 1 },
    });
  });

  it("closes a completed work cycle and writes the KPI only at Activity completion", () => {
    const work = intent("maintain-energy-flow", "harvest", "source-1");
    objectById.set("source-1", { energy: 300 } as unknown as RoomObject);
    bindFspmActivities([work]);
    const activityId = work.trace?.activityId;

    reconcileFspmActivityEvidence([
      {
        intent: work,
        result: OK,
        movementRequired: false,
        evidence: "harvested full work quantum",
        outcome: { metric: "energy harvested", actual: 10, target: 10, unit: "energy" },
      } satisfies ActivityExecutionObservation,
    ]);
    expect(ensureColonyPortfolio("W1N1").activityKpiHistory?.[work.trace?.taskId ?? ""]).toBeUndefined();

    creepEnergy = creepCapacity;
    Game.time = 101;
    bindFspmActivities([]);

    const completed = activities().find((activity) => activity.id === activityId);
    const portfolio = ensureColonyPortfolio("W1N1");
    expect(completed).toMatchObject({
      status: "completed",
      completedAt: 101,
      kpiScore: "exceptional",
    });
    expect(portfolio.activityKpiHistory?.[work.trace?.taskId ?? ""]).toHaveLength(1);
    expect(portfolio.tasks[work.trace?.taskId ?? ""]?.qi).toMatchObject({
      ratedActivities: 1,
      exceptional: 1,
    });
    expect(fspmActivityEvents(portfolio).map((event) => event.type)).toContain("kpi_scored");
  });

  it("separates required travel from productive execution and assignment gaps", () => {
    const work = intent("sustain-energy", "collect-energy");
    bindFspmActivities([work]);
    const activityId = work.trace?.activityId;
    if (!activityId) throw new Error("expected bound activity");

    reconcileFspmActivityEvidence([
      {
        intent: work,
        result: ERR_NOT_IN_RANGE,
        movementRequired: true,
        evidence: "traveling",
      } satisfies ActivityExecutionObservation,
    ]);

    Game.time = 101;
    const continued = intent("sustain-energy", "collect-energy");
    bindFspmActivities([continued]);
    reconcileFspmActivityEvidence([
      {
        intent: continued,
        result: OK,
        movementRequired: false,
        evidence: "worked",
      } satisfies ActivityExecutionObservation,
    ]);

    Game.time = 102;
    bindFspmActivities([]);
    const assignments = reconcileFspmActivityEvidence({
      observations: [],
      proposed: [],
      accepted: [],
      rejected: [],
      creeps: [Game.creeps["worker-1"]],
    });

    const activity = activities().find((candidate) => candidate.id === activityId);
    expect(activity?.metrics).toMatchObject({
      inProgressTicks: 3,
      travelTicks: 1,
      productiveTicks: 1,
      assignmentGapTicks: 1,
      idleTicks: 1,
      maxTravelStreak: 1,
      currentTravelStreak: 0,
      firstProductiveAt: 101,
    });
    expect(assignments[0]).toMatchObject({ state: "planner_unassigned", activityId });
    expect(activity && activityContinuityRatio(activity)).toBeCloseTo(0.667, 3);
    expect(activity && activityWorkConversionRatio(activity)).toBeCloseTo(0.333, 3);
  });
});
