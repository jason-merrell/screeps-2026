import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityExecutionObservation } from "../../src/intents/execute";
import { createIntentTrace } from "../../src/intents/trace";
import type { HarvestIntent, TransferIntent, UpgradeIntent } from "../../src/intents/types";
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

const ENERGY_TASK = "maintain-colony-energy-service";
const CONTROLLER_TASK = "advance-controller-capability";

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

function traceFor(taskKey: string, procedureKey: string) {
  const task = ensureTask("W1N1", "economy", taskKey);
  const procedure = ensureProcedure("W1N1", "economy", taskKey, procedureKey);
  const portfolio = ensureColonyPortfolio("W1N1");
  const requirement = portfolio.requirements.economy;
  const deliverable = portfolio.deliverables.economy;
  if (!requirement || !deliverable) throw new Error("expected economy hierarchy");
  return {
    contractId: portfolio.contract.id,
    requirementId: requirement.id,
    deliverableId: deliverable.id,
    taskId: task.id,
    procedureId: procedure.id,
  };
}

function harvestIntent(
  procedureKey = "extract-source-energy",
  sourceId = "source-1",
): HarvestIntent {
  return {
    type: "harvest",
    creepName: "worker-1",
    sourceId: sourceId as Id<Source>,
    priority: 100,
    reason: "test energy-service extraction",
    trace: traceFor(ENERGY_TASK, procedureKey),
  };
}

function transferIntent(
  procedureKey = "buffer-source-energy",
  targetId = "container-1",
): TransferIntent {
  return {
    type: "transfer",
    creepName: "worker-1",
    targetId: targetId as Id<StructureContainer>,
    resource: RESOURCE_ENERGY,
    priority: 100,
    reason: "test energy-service delivery",
    trace: traceFor(ENERGY_TASK, procedureKey),
  };
}

function controllerIntent(): UpgradeIntent {
  return {
    type: "upgrade",
    creepName: "worker-1",
    controllerId: "controller-1" as Id<StructureController>,
    priority: 100,
    reason: "test controller advancement",
    trace: traceFor(CONTROLLER_TASK, "upgrade-controller"),
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
      task: ENERGY_TASK,
      activity: "worker-1:extract-source-energy:source-a",
    });
    const second = createIntentTrace({
      roomName: "W1N1",
      domain: "economy",
      task: ENERGY_TASK,
      activity: "worker-1:extract-source-energy:source-b",
    });

    expect(second.procedureId).toBe(first.procedureId);
    expect(
      ensureTask("W1N1", "economy", ENERGY_TASK).procedures.filter(
        (procedure) => procedure.procedureKey === "extract-source-energy",
      ),
    ).toHaveLength(1);
  });

  it("records same-Procedure target retargets separately from Procedure transitions", () => {
    const first = harvestIntent("extract-source-energy", "source-1");
    bindFspmActivities([first]);
    const firstId = first.trace?.activityId;

    Game.time = 101;
    const retargeted = harvestIntent("extract-source-energy", "source-2");
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

  it("keeps one Activity while the assignee advances Procedures and targets inside the same Task", () => {
    const collect = harvestIntent("extract-source-energy", "source-1");
    bindFspmActivities([collect]);
    const firstId = collect.trace?.activityId;

    Game.time = 101;
    const buffer = transferIntent("buffer-source-energy", "container-1");
    bindFspmActivities([buffer]);

    expect(buffer.trace?.activityId).toBe(firstId);
    expect(activities()).toHaveLength(1);
    expect(activities()[0]).toMatchObject({
      status: "in_progress",
      currentProcedureId: buffer.trace?.procedureId,
      currentTargetKey: "container-1",
      metrics: { procedureTransitions: 1, taskPreemptions: 0, targetRetargets: 0 },
    });
    expect(
      fspmActivityEvents(ensureColonyPortfolio("W1N1")).filter(
        (event) => event.type === "target_changed",
      ),
    ).toHaveLength(0);
  });

  it("puts unfinished work On Hold when the assignee switches Tasks", () => {
    const economy = harvestIntent();
    bindFspmActivities([economy]);
    const economyId = economy.trace?.activityId;

    Game.time = 101;
    const controller = controllerIntent();
    bindFspmActivities([controller]);

    const previous = activities().find((activity) => activity.id === economyId);
    const current = activities().find((activity) => activity.id === controller.trace?.activityId);
    expect(previous).toMatchObject({
      status: "on_hold",
      metrics: { holdCount: 1, taskPreemptions: 1 },
    });
    expect(current?.status).toBe("in_progress");
  });

  it("does not close held energy-service work when another Task becomes current", () => {
    const heldWork = harvestIntent("extract-source-energy", "source-1");
    objectById.set("source-1", { energy: 300 } as unknown as RoomObject);
    bindFspmActivities([heldWork]);
    const heldActivityId = heldWork.trace?.activityId;
    const heldTaskId = heldWork.trace?.taskId;

    creepEnergy = 10;
    Game.time = 101;
    const currentWork = controllerIntent();
    bindFspmActivities([currentWork]);
    const currentActivityId = currentWork.trace?.activityId;
    reconcileFspmActivityEvidence([
      {
        intent: currentWork,
        result: OK,
        movementRequired: false,
        evidence: "controller upgrade executed productively",
      } satisfies ActivityExecutionObservation,
    ]);

    creepEnergy = 0;
    Game.time = 102;
    bindFspmActivities([]);

    const portfolio = ensureColonyPortfolio("W1N1");
    const held = activities().find((activity) => activity.id === heldActivityId);
    const current = activities().find((activity) => activity.id === currentActivityId);

    expect(held).toMatchObject({ status: "on_hold" });
    expect(held?.completedAt).toBeUndefined();
    expect(held?.kpiScore).toBeUndefined();
    expect(current).toMatchObject({ status: "completed", completedAt: 102 });
    expect(portfolio.activityKpiHistory?.[heldTaskId ?? ""]).toBeUndefined();
    expect(
      fspmActivityEvents(portfolio).filter(
        (event) => event.activityId === heldActivityId && event.type === "activity_completed",
      ),
    ).toHaveLength(0);
  });

  it("resumes the same held Activity when its Task becomes current again", () => {
    const economy = harvestIntent();
    bindFspmActivities([economy]);
    const economyId = economy.trace?.activityId;

    Game.time = 101;
    bindFspmActivities([controllerIntent()]);

    Game.time = 102;
    const resumed = transferIntent("buffer-source-energy", "container-1");
    bindFspmActivities([resumed]);

    expect(resumed.trace?.activityId).toBe(economyId);
    expect(activities().find((activity) => activity.id === economyId)).toMatchObject({
      status: "in_progress",
      currentTargetKey: "container-1",
      metrics: { resumeCount: 1, procedureTransitions: 1, targetRetargets: 0 },
    });
  });

  it("closes a canonical energy-service cycle and writes KPI only after its terminal Procedure", () => {
    const collect = harvestIntent("extract-source-energy", "source-1");
    objectById.set("source-1", { energy: 300 } as unknown as RoomObject);
    bindFspmActivities([collect]);
    const activityId = collect.trace?.activityId;

    reconcileFspmActivityEvidence([
      {
        intent: collect,
        result: OK,
        movementRequired: false,
        evidence: "harvested full work quantum",
        outcome: { metric: "energy harvested", actual: 10, target: 10, unit: "energy" },
      } satisfies ActivityExecutionObservation,
    ]);
    expect(
      ensureColonyPortfolio("W1N1").activityKpiHistory?.[collect.trace?.taskId ?? ""],
    ).toBeUndefined();

    creepEnergy = creepCapacity;
    Game.time = 101;
    const buffer = transferIntent("buffer-source-energy", "container-1");
    bindFspmActivities([buffer]);
    expect(buffer.trace?.activityId).toBe(activityId);
    expect(activities().find((activity) => activity.id === activityId)?.status).toBe("in_progress");

    creepEnergy = 0;
    reconcileFspmActivityEvidence([
      {
        intent: buffer,
        result: OK,
        movementRequired: false,
        evidence: "buffered completed producer load",
        outcome: { metric: "energy delivered", actual: 10, target: 10, unit: "energy" },
      } satisfies ActivityExecutionObservation,
    ]);

    const completed = activities().find((activity) => activity.id === activityId);
    const portfolio = ensureColonyPortfolio("W1N1");
    expect(completed).toMatchObject({
      status: "completed",
      completedAt: 101,
      kpiScore: "exceptional",
      metrics: { procedureTransitions: 1, targetRetargets: 0 },
    });
    expect(portfolio.activityKpiHistory?.[collect.trace?.taskId ?? ""]).toHaveLength(1);
    expect(portfolio.tasks[collect.trace?.taskId ?? ""]?.qi).toMatchObject({
      ratedActivities: 1,
      exceptional: 1,
    });
    expect(fspmActivityEvents(portfolio).map((event) => event.type)).toContain("kpi_scored");
  });

  it("separates required travel from productive execution and assignment gaps", () => {
    const work = harvestIntent();
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
    const continued = harvestIntent();
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
    const creep = Game.creeps["worker-1"];
    if (!creep) throw new Error("expected worker-1 test creep");
    const assignments = reconcileFspmActivityEvidence({
      observations: [],
      proposed: [],
      accepted: [],
      rejected: [],
      creeps: [creep],
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
