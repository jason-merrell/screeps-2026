import { beforeEach, describe, expect, it } from "vitest";
import { createIntentTrace } from "../../src/intents/trace";
import { migrateMemory } from "../../src/memory/migrate";
import { MEMORY_VERSION } from "../../src/memory/schema";
import {
  activateApprovedColonyGovernance,
  type ColonyFspmPortfolio,
  ensureDomainHierarchy,
} from "../../src/planning/fspm";

function installFreshColony(): void {
  Object.assign(globalThis, {
    Game: { time: 500 },
    Memory: {
      version: 5,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 100,
        },
      },
    },
  });
}

function installLegacyColony(): void {
  const legacy = {
    program: {
      id: "program:service:W1N1",
      type: "program",
      subType: "service_program",
      roomName: "W1N1",
      title: "Operate room W1N1",
      status: "active",
    },
    contract: {
      kind: "contract",
      id: "contract:colony:W1N1",
      roomName: "W1N1",
      programId: "program:service:W1N1",
      title: "Operate colony W1N1",
      status: "active",
      completionCriterion: "close only by explicit colony decommission",
      statusReason: "owned colony is operational",
      createdAt: 100,
      updatedAt: 100,
    },
    requirements: {
      spawning: {
        kind: "requirement",
        id: "requirement:W1N1:spawning",
        contractId: "contract:colony:W1N1",
        domain: "spawning",
        title: "Spawning capability",
        status: "active",
        completionCriterion: "legacy criterion",
        createdAt: 100,
        updatedAt: 100,
      },
    },
    deliverables: {},
    tasks: {},
    activities: {
      "activity:legacy": {
        id: "activity:legacy",
        taskId: "task:W1N1:spawning:legacy-task",
        assignee: "worker-old",
        status: "on_hold",
        currentProcedureId: "procedure:legacy",
        qualityDescription: "legacy quality",
        qualityMetric: "legacy metric",
        kpiMetric: {
          metric: "legacy KPI",
          exceptional: "exceptional",
          satisfactory: "satisfactory",
          unsatisfactory: "unsatisfactory",
        },
        createdAt: 120,
        updatedAt: 130,
        holdReason: "legacy hold",
        metrics: {
          inProgressTicks: 4,
          onHoldTicks: 3,
          productiveTicks: 2,
          travelTicks: 1,
          idleTicks: 0,
          holdCount: 1,
          resumeCount: 0,
          taskPreemptions: 0,
          procedureTransitions: 0,
        },
      },
    },
    qualityHistory: {},
    activityKpiHistory: {},
  } as unknown as ColonyFspmPortfolio;

  Object.assign(globalThis, {
    Game: { time: 500 },
    Memory: {
      version: 5,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 100,
          fspm: legacy,
        },
      },
    },
  });
}

describe("FSPM colony P3 authority", () => {
  beforeEach(() => installFreshColony());

  it("initializes new colony work under subordinate Portfolio authority without a synthetic contract", () => {
    migrateMemory();
    activateApprovedColonyGovernance("W1N1");
    const { portfolio, requirement } = ensureDomainHierarchy(
      "W1N1",
      "spawning",
    );

    expect(Memory.empireFspm?.p3).toMatchObject({
      id: "portfolio:empire:operations",
      type: "portfolio",
      subType: "ou_portfolio",
      parentP3Id: null,
      temporalBasis: "game_tick",
      startTick: 100,
    });
    expect(portfolio.p3).toMatchObject({
      id: "portfolio:colony:W1N1",
      type: "portfolio",
      subType: "ou_portfolio",
      parentP3Id: "portfolio:empire:operations",
      temporalBasis: "game_tick",
      startTick: 100,
      status: "active",
    });
    expect(portfolio.program).toBeUndefined();
    expect(portfolio.contract).toBeUndefined();
    expect(requirement.p3Id).toBe(portfolio.p3.id);
    expect(requirement.contractId).toBeUndefined();

    const trace = createIntentTrace({
      roomName: "W1N1",
      domain: "spawning",
      task: "maintain-workforce-capacity",
      procedure: "maintain-general-workforce",
    });
    expect(trace.p3Id).toBe("portfolio:colony:W1N1");
    expect(trace.contractId).toBeUndefined();
  });

  it("retires legacy P3 authority and quarantines its placeholder execution spine", () => {
    installLegacyColony();
    const before = structuredClone(
      Memory.colonies.W1N1?.fspm?.activities?.["activity:legacy"],
    );

    migrateMemory();
    const portfolio = Memory.colonies.W1N1?.fspm;
    if (!portfolio) throw new Error("expected migrated colony portfolio");

    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(Memory.runtimeSupervisor).toEqual({ version: 1, phases: {} });
    expect(portfolio.p3).toMatchObject({
      id: "portfolio:colony:W1N1",
      type: "portfolio",
      subType: "ou_portfolio",
      parentP3Id: "portfolio:empire:operations",
      temporalBasis: "game_tick",
      startTick: 100,
      status: "active",
    });
    expect(portfolio.program).toMatchObject({
      status: "retired",
      retiredAt: 500,
    });
    expect(portfolio.contract).toMatchObject({
      id: "contract:colony:W1N1",
      status: "retired",
    });
    expect(portfolio.requirements).toEqual({});
    expect(portfolio.activities).toEqual({});
    const quarantine = portfolio.authorityQuarantine?.[0];
    expect(quarantine?.requirements.spawning).toMatchObject({
      p3Id: "portfolio:colony:W1N1",
      contractId: "contract:colony:W1N1",
    });
    expect(quarantine?.activities["activity:legacy"]).toEqual(before);
  });
});
