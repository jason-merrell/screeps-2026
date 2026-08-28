import { beforeEach, describe, expect, it } from "vitest";
import { migrateMemory } from "../../src/memory/migrate";
import { MEMORY_VERSION } from "../../src/memory/schema";
import { ensureColonyPortfolio, ensureProcedure, ensureTask } from "../../src/planning/fspm";

const TASK_KEY = "maintain-colony-energy-service";
const PROCEDURE_KEY = "extract-source-energy";

function installGlobals(): void {
  Object.assign(globalThis, {
    Game: { time: 100 },
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

describe("Memory migration", () => {
  beforeEach(() => installGlobals());

  it("resets contaminated v4 Activity evidence while preserving Tasks and Procedures", () => {
    const task = ensureTask("W1N1", "economy", TASK_KEY);
    const procedure = ensureProcedure("W1N1", "economy", TASK_KEY, PROCEDURE_KEY);
    const portfolio = ensureColonyPortfolio("W1N1");

    portfolio.activities = {
      contaminated: {
        id: "contaminated",
        taskId: task.id,
        assignee: "worker-1",
        status: "completed",
        currentProcedureId: procedure.id,
        qualityDescription: task.qualityDescription,
        qualityMetric: task.qualityMetric,
        kpiMetric: { ...task.kpiMetric },
        kpiScore: "unsatisfactory",
        createdAt: 90,
        updatedAt: 99,
        completedAt: 99,
        metrics: {
          inProgressTicks: 42,
          onHoldTicks: 10,
          productiveTicks: 0,
          travelTicks: 32,
          idleTicks: 0,
          holdCount: 1,
          resumeCount: 0,
          taskPreemptions: 1,
          procedureTransitions: 0,
        },
      },
    };
    portfolio.activityKpiHistory = {
      [task.id]: [
        {
          tick: 99,
          activityId: "contaminated",
          activityType: task.taskKey,
          actor: "worker-1",
          rating: "unsatisfactory",
          value: 0.5,
          evidence: "false closeout from unrelated assignee state",
        },
      ],
    };
    task.qi = {
      score: 50,
      measuredAt: 99,
      ratedActivities: 1,
      totalActivities: 1,
      exceptional: 0,
      satisfactory: 0,
      unsatisfactory: 1,
    };

    const evidencePortfolio = portfolio as typeof portfolio & {
      activityEvents?: unknown[];
      activityEventSequence?: number;
    };
    evidencePortfolio.activityEvents = [{ type: "activity_completed" }];
    evidencePortfolio.activityEventSequence = 7;

    migrateMemory();

    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(Memory.version).toBe(5);
    expect(portfolio.activities).toEqual({});
    expect(portfolio.activityKpiHistory).toEqual({});
    expect(evidencePortfolio.activityEvents).toEqual([]);
    expect(evidencePortfolio.activityEventSequence).toBe(0);
    expect(portfolio.tasks[task.id]?.qi).toBeUndefined();
    expect(portfolio.tasks[task.id]?.procedures).toEqual([procedure]);
  });
});
