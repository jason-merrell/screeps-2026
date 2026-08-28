import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityExecutionObservation } from "../../src/intents/execute";
import type { HarvestIntent } from "../../src/intents/types";
import {
  activityContinuityRatio,
  bindFspmActivities,
  reconcileFspmActivityEvidence,
} from "../../src/planning/activity-lifecycle";
import { ensureColonyPortfolio, ensureProcedure, ensureTask } from "../../src/planning/fspm";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_NOT_IN_RANGE", -9);

function installGlobals(time = 100): void {
  Object.assign(globalThis, {
    Game: { time },
    Memory: {
      version: 2,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
        },
      },
    },
  });
}

function intent(taskKey: string, procedureKey: string): HarvestIntent {
  const task = ensureTask("W1N1", "economy", taskKey);
  const procedure = ensureProcedure("W1N1", "economy", taskKey, procedureKey);
  const portfolio = ensureColonyPortfolio("W1N1");
  const requirement = portfolio.requirements.economy;
  const deliverable = portfolio.deliverables.economy;
  if (!requirement || !deliverable) throw new Error("expected economy hierarchy");

  return {
    type: "harvest",
    creepName: "worker-1",
    sourceId: "source-1" as Id<Source>,
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
      metrics: { procedureTransitions: 1, taskPreemptions: 0 },
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
      metrics: { resumeCount: 1, procedureTransitions: 0 },
    });
  });

  it("separates required travel from productive execution in continuity evidence", () => {
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

    const activity = activities().find((candidate) => candidate.id === activityId);
    expect(activity?.metrics).toMatchObject({
      inProgressTicks: 2,
      travelTicks: 1,
      productiveTicks: 1,
      idleTicks: 0,
    });
    expect(activity && activityContinuityRatio(activity)).toBe(1);
  });
});
