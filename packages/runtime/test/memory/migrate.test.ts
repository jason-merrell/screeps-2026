import { beforeEach, describe, expect, it } from "vitest";
import { migrateMemory, migrateMemoryStep } from "../../src/memory/migrate";
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

  it("advances a live v6 schema one durable hop per boot tick", () => {
    activateApprovedColonyGovernance("W1N1");
    Memory.version = 6;
    const versions: number[] = [];
    const states: string[] = [];

    for (let tick = 100; tick <= 103; tick += 1) {
      Game.time = tick;
      const result = migrateMemoryStep();
      versions.push(Memory.version);
      states.push(result.state);
      Object.assign(globalThis, {
        Memory: JSON.parse(JSON.stringify(Memory)) as Memory,
      });
    }

    expect(versions).toEqual([7, 8, 9, 10]);
    expect(states).toEqual([
      "migration",
      "migration",
      "migration",
      "settlement",
    ]);
    expect(Memory.runtimeBoot).toMatchObject({
      sourceMemoryVersion: 6,
      targetMemoryVersion: MEMORY_VERSION,
      phase: "settlement",
      lastFromVersion: 9,
      lastToVersion: 10,
    });
  });

  it("admits current-schema Memory without a boot marker into stabilization", () => {
    Memory.version = MEMORY_VERSION;
    delete Memory.runtimeBoot;

    const first = migrateMemoryStep();
    const second = migrateMemoryStep();

    expect(first).toMatchObject({
      state: "settlement",
      sourceVersion: MEMORY_VERSION,
      fromVersion: MEMORY_VERSION,
      toVersion: MEMORY_VERSION,
      progressed: true,
    });
    expect(second).toMatchObject({
      state: "settlement",
      progressed: false,
    });
    expect(Memory.runtimeBoot).toMatchObject({
      version: 1,
      sourceMemoryVersion: MEMORY_VERSION,
      targetMemoryVersion: MEMORY_VERSION,
      phase: "settlement",
      settlementAttempts: 0,
    });
  });

  it("defers a schema hop before mutation when boot headroom is exhausted", () => {
    Memory.version = 6;
    const before = structuredClone(Memory);

    const result = migrateMemoryStep({ shouldDefer: () => true });

    expect(result).toMatchObject({
      state: "migration",
      fromVersion: 6,
      toVersion: 6,
      progressed: false,
    });
    expect(Memory.version).toBe(6);
    expect(Memory.colonies).toEqual(before.colonies);
    expect(Memory.runtimeBoot).toMatchObject({
      sourceMemoryVersion: 6,
      phase: "migration",
    });
  });

  it("replays an interrupted v7 commit without duplicating quarantine evidence", () => {
    activateApprovedColonyGovernance("W1N1");
    Memory.version = 7;
    const legacyPortfolio = Memory.colonies.W1N1?.fspm;
    const legacyTaskIds = Object.keys(legacyPortfolio?.tasks ?? {});
    expect(legacyTaskIds.length).toBeGreaterThan(0);

    migrateMemoryStep();

    const migrated = Memory.colonies.W1N1?.fspm;
    expect(migrated).not.toBe(legacyPortfolio);
    expect(Object.keys(legacyPortfolio?.tasks ?? {})).toEqual(legacyTaskIds);
    expect(migrated?.authorityQuarantine).toHaveLength(1);
    expect(
      Object.keys(migrated?.authorityQuarantine?.[0]?.tasks ?? {}),
    ).toEqual(legacyTaskIds);

    // Model a normal CPU termination after the portfolio assignment but before
    // the schema commit marker becomes durable.
    Memory.version = 7;
    Object.assign(globalThis, {
      Memory: JSON.parse(JSON.stringify(Memory)) as Memory,
    });
    migrateMemoryStep();

    expect(Memory.version).toBe(8);
    expect(Memory.colonies.W1N1?.fspm?.authorityQuarantine).toHaveLength(1);
    expect(Memory.colonies.W1N1?.fspm?.tasks).toEqual({});
  });

  it("preserves linkage but withholds epoch identity from an incomplete v8 room projection", () => {
    Object.assign(globalThis, {
      Memory: {
        version: 8,
        colonies: {
          W1N1: {
            roomName: "W1N1",
            discoveredAt: 1,
            roomPlan: {
              planId: "plan:W1N1:construction:room-plan:v4",
              deliverableId: "deliverable:W1N1:construction",
              version: 4,
              horizonRcl: 8,
              roomName: "W1N1",
              generatedAt: 90,
              generatedReason: "pre-epoch projection",
              anchors: {
                spawn: { name: "Spawn1", x: 25, y: 25 },
                hub: { x: 26, y: 25 },
                controller: null,
                sources: [],
              },
              reservations: [],
              structures: [],
              roads: [],
              roadGraph: { nodes: [], edges: [] },
              defense: {
                strategy: "terrain-mincut-v1",
                protectedTiles: [{ x: 25, y: 25 }],
                perimeter: [{ x: 24, y: 25 }],
              },
            },
          },
        },
        runtimeSupervisor: { version: 1, phases: {} },
      },
    });

    migrateMemory();

    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(Memory.colonies.W1N1?.roomPlan).toMatchObject({
      planId: "plan:W1N1:construction:room-plan:v4",
      deliverableId: "deliverable:W1N1:construction",
    });
    expect(Memory.colonies.W1N1?.roomPlan).not.toHaveProperty(
      "plannerRevision",
    );
    expect(Memory.colonies.W1N1?.roomPlan).not.toHaveProperty(
      "projectionRevision",
    );
    expect(Memory.colonies.W1N1?.roomPlan).not.toHaveProperty(
      "projectionFingerprint",
    );
  });

  it("migrates v9 synthetic quality without promoting it into EQVM evidence", () => {
    activateApprovedColonyGovernance("W1N1");
    const portfolio = ensureColonyPortfolio("W1N1");
    const task = ensureTask("W1N1", "economy", TASK_KEY);
    const requirement = portfolio.requirements.economy;
    const deliverable = portfolio.deliverables.economy;
    if (!requirement || !deliverable) throw new Error("expected authority");

    const syntheticHealth = {
      score: 100,
      state: "healthy" as const,
      trend: "stable" as const,
      measuredAt: 99,
      evidence: ["room readiness incorrectly labeled quality"],
    };
    portfolio.p3.quality = syntheticHealth;
    requirement.quality = syntheticHealth;
    deliverable.quality = syntheticHealth;
    portfolio.qualityHistory = {
      [portfolio.p3.id]: [{ tick: 99, score: 100, state: "healthy" as const }],
    };
    portfolio.activityKpiHistory = {
      [task.id]: [
        {
          tick: 99,
          activityId: "legacy-unverified",
          activityType: task.taskKey,
          actor: "worker-1",
          rating: "satisfactory",
          value: 1,
          evidence: "legacy sample without terminal verification metadata",
        },
      ],
    };
    (task as unknown as { qi: unknown }).qi = {
      score: 1,
      measuredAt: 99,
    };
    Memory.version = 9;

    migrateMemory();

    const migrated = ensureColonyPortfolio("W1N1");
    const migratedTask = migrated.tasks[task.id];
    const migratedRequirement = migrated.requirements.economy;
    const migratedDeliverable = migrated.deliverables.economy;
    expect(Memory.version).toBe(10);
    expect(migrated.p3.quality).toBeUndefined();
    expect(migratedRequirement?.quality).toBeUndefined();
    expect(migratedDeliverable?.quality).toBeUndefined();
    expect(migrated.qualityHistory).toEqual({});
    expect(migrated.operationalHealthHistory).toEqual({});
    expect(migrated.activityKpiHistory).toEqual({});
    expect(migratedTask?.qi).toBeUndefined();
    expect(migratedTask).not.toHaveProperty("activityKpiAggregation");
    expect(migrated.authorityLedgerAnchors).toEqual({
      deliverableReceipts: { count: 0, headHash: null },
      deliverableReceiptDecisions: { count: 0, headHash: null },
      authorityLifecycle: { count: 0, headHash: null },
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
    (task as unknown as { qi: unknown }).qi = {
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

    const migrated = ensureColonyPortfolio("W1N1") as ReturnType<
      typeof ensureColonyPortfolio
    > & {
      activityEvents?: unknown[];
      activityEventSequence?: number;
    };
    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(Memory.runtimeSupervisor).toEqual({ version: 1, phases: {} });
    expect(Memory.empireFspm?.p3).toMatchObject({
      id: "portfolio:empire:operations",
      parentP3Id: null,
      startTick: 1,
    });
    expect(migrated.p3).toMatchObject({
      id: "portfolio:colony:W1N1",
      parentP3Id: "portfolio:empire:operations",
      startTick: 1,
    });
    expect(migrated.p3.quality).toBeUndefined();
    expect(migrated.activities).toEqual({});
    expect(migrated.activityKpiHistory).toEqual({});
    expect(migrated.activityEvents).toEqual([]);
    expect(migrated.activityEventSequence).toBe(0);
    expect(migrated.tasks).toEqual({});
    const quarantine = migrated.authorityQuarantine?.[0];
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

    const migrated = ensureColonyPortfolio("W1N1") as ReturnType<
      typeof ensureColonyPortfolio
    > & {
      activityEvents?: unknown[];
      activityEventSequence?: number;
    };
    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(migrated.activityEvents).toEqual([]);
    expect(migrated.activityEventSequence).toBe(0);
    expect(migrated.authorityQuarantine?.at(-1)).toMatchObject({
      migratedFromVersion: 7,
      activityEvents: [legacyEvent],
      activityEventSequence: 9,
    });
  });

  it("migrates a v7 colony with a missing P3 without fabricating authority", () => {
    Object.assign(globalThis, {
      Memory: {
        version: 7,
        colonies: {
          W1N1: {
            roomName: "W1N1",
            discoveredAt: 1,
            fspm: {
              requirements: {},
              deliverables: {},
              tasks: {},
              activities: {},
              qualityHistory: {},
              activityKpiHistory: {},
            },
          },
        },
        empireFspm: {
          p3: {
            id: "portfolio:empire:operations",
            type: "portfolio",
            subType: "ou_portfolio",
            name: "EMPIRE-PORTFOLIO-Empire Operations",
            description: "Governed Empire authority",
            parentP3Id: null,
            temporalBasis: "game_tick",
            startTick: 1,
            status: "active",
            statusReason: "governed Empire authority",
            createdAt: 1,
            updatedAt: 1,
          },
        },
        runtimeSupervisor: { version: 1, phases: {} },
      },
    });

    expect(() => migrateMemory()).not.toThrow();

    const portfolio = Memory.colonies.W1N1?.fspm;
    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(portfolio).toBeDefined();
    expect(Object.hasOwn(portfolio ?? {}, "p3")).toBe(false);
    expect(portfolio?.requirements).toEqual({});
    expect(portfolio?.authorityLedgerAnchors).toEqual({
      deliverableReceipts: { count: 0, headHash: null },
      deliverableReceiptDecisions: { count: 0, headHash: null },
      authorityLifecycle: { count: 0, headHash: null },
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
    expect(() => migrateMemory()).not.toThrow();
    expect(Memory).toMatchObject({
      version: MEMORY_VERSION,
      colonies: {},
      empireFspm: {},
      runtimeSupervisor: { version: 1, phases: {} },
      runtimeBoot: {
        version: 1,
        sourceMemoryVersion: MEMORY_VERSION,
        targetMemoryVersion: MEMORY_VERSION,
        phase: "settlement",
      },
    });
  });
});
