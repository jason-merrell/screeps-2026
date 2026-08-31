import { beforeEach, describe, expect, it } from "vitest";
import { migrateMemory } from "../../src/memory/migrate";
import { MEMORY_VERSION } from "../../src/memory/schema";
import {
  activateApprovedColonyGovernance,
  ensureColonyPortfolio,
  ensureProcedure,
  ensureTask,
} from "../../src/planning/fspm";

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

  it("initializes a fresh Memory atomically at the current schema", () => {
    Object.assign(globalThis, { Memory: {} });

    migrateMemory();

    expect(Memory).toMatchObject({
      version: MEMORY_VERSION,
      colonies: {},
      runtimeSupervisor: { version: 1, phases: {} },
      empireFspm: {
        p3: {
          id: "portfolio:empire:operations",
          status: "active",
        },
      },
    });
  });

  it("resets contaminated v4 evidence and quarantines the unapproved legacy spine", () => {
    activateApprovedColonyGovernance("W1N1");
    const task = ensureTask("W1N1", "economy", TASK_KEY);
    const procedure = ensureProcedure(
      "W1N1",
      "economy",
      TASK_KEY,
      PROCEDURE_KEY,
    );
    const portfolio = ensureColonyPortfolio("W1N1");
    portfolio.p3.quality = {
      score: 100,
      state: "healthy",
      trend: "stable",
      measuredAt: 99,
      evidence: ["legacy placeholder roll-up"],
    };

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
    expect(Memory.version).toBe(8);
    expect(Memory.runtimeSupervisor).toEqual({ version: 1, phases: {} });
    expect(Memory.empireFspm?.p3).toMatchObject({
      id: "portfolio:empire:operations",
      parentP3Id: null,
      startTick: 1,
    });
    expect(portfolio.p3).toMatchObject({
      id: "portfolio:colony:W1N1",
      parentP3Id: "portfolio:empire:operations",
      startTick: 1,
    });
    expect(portfolio.p3.quality).toBeUndefined();
    expect(portfolio.activities).toEqual({});
    expect(portfolio.activityKpiHistory).toEqual({});
    expect(evidencePortfolio.activityEvents).toEqual([]);
    expect(evidencePortfolio.activityEventSequence).toBe(0);
    expect(portfolio.tasks).toEqual({});
    const quarantine = portfolio.authorityQuarantine?.[0];
    const quarantinedTask = quarantine?.tasks[task.id] as
      | typeof task
      | undefined;
    expect(quarantine).toMatchObject({
      schema: "screeps-fspm-authority-quarantine/v1",
      migratedFromVersion: 7,
    });
    expect(quarantinedTask?.qi).toBeUndefined();
    expect(quarantinedTask?.procedures).toContainEqual(procedure);
    expect(
      quarantinedTask?.procedures.map((entry) => entry.procedureKey),
    ).toEqual([
      "extract-source-energy",
      "buffer-source-energy",
      "withdraw-buffered-energy",
      "recover-salvage-energy",
      "stage-source-transport",
      "park-surplus-transport",
      "fund-workforce-energy",
    ]);
  });

  it("quarantines and clears Activity event evidence when migrating directly from v7", () => {
    activateApprovedColonyGovernance("W1N1");
    const portfolio = ensureColonyPortfolio("W1N1") as ReturnType<
      typeof ensureColonyPortfolio
    > & {
      activityEvents?: unknown[];
      activityEventSequence?: number;
    };
    const legacyEvent = {
      id: "activity-event:legacy:9",
      sequence: 9,
      type: "activity_completed",
    };
    portfolio.activityEvents = [legacyEvent];
    portfolio.activityEventSequence = 9;
    Memory.version = 7;

    migrateMemory();

    expect(Memory.version).toBe(8);
    expect(portfolio.activityEvents).toEqual([]);
    expect(portfolio.activityEventSequence).toBe(0);
    expect(portfolio.authorityQuarantine?.at(-1)).toMatchObject({
      migratedFromVersion: 7,
      activityEvents: [legacyEvent],
      activityEventSequence: 9,
    });
  });

  it("preserves a malformed existing Empire container for governed quarantine", () => {
    Object.assign(globalThis, {
      Memory: {
        version: MEMORY_VERSION,
        colonies: {},
        empireFspm: {},
        runtimeSupervisor: { version: 1, phases: {} },
      },
    });
    const before = structuredClone(Memory);

    expect(() => migrateMemory()).not.toThrow();
    expect(Memory).toEqual(before);
  });
});
