import { beforeEach, describe, expect, it } from "vitest";
import { migrateMemory } from "../src/memory/migrate";

describe("FSPM Activity memory migration", () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      Memory: {
        version: 2,
        colonies: {
          W1N1: {
            roomName: "W1N1",
            discoveredAt: 1,
            fspm: {
              contract: {
                kind: "contract",
                id: "contract:colony:W1N1",
                roomName: "W1N1",
                title: "Operate colony W1N1",
                status: "active",
                completionCriterion: "test",
                createdAt: 1,
                updatedAt: 1,
              },
              requirements: {},
              deliverables: {},
              tasks: {
                "task:W1N1:economy:test": {
                  kind: "task",
                  id: "task:W1N1:economy:test",
                  title: "Test",
                  status: "active",
                  deliverableId: "deliverable:W1N1:economy",
                  domain: "economy",
                  taskKey: "test",
                  qualityDescription: "test",
                  qualityMetric: "test",
                  kpiMetric: {
                    metric: "test",
                    exceptional: "test",
                    satisfactory: "test",
                    unsatisfactory: "test",
                  },
                  procedures: [],
                  qi: {
                    score: 1,
                    measuredAt: 10,
                    ratedActivities: 1,
                    totalActivities: 1,
                    exceptional: 0,
                    satisfactory: 1,
                    unsatisfactory: 0,
                  },
                  createdAt: 1,
                  updatedAt: 1,
                },
              },
              activities: {
                legacy: {
                  id: "legacy",
                  taskId: "task:W1N1:economy:test",
                  assignee: "worker-1",
                  status: "in_progress",
                  currentProcedureId: "legacy",
                  qualityDescription: "legacy",
                  qualityMetric: "legacy",
                  kpiMetric: {
                    metric: "legacy",
                    exceptional: "legacy",
                    satisfactory: "legacy",
                    unsatisfactory: "legacy",
                  },
                  createdAt: 1,
                  updatedAt: 1,
                  metrics: {
                    inProgressTicks: 1,
                    onHoldTicks: 0,
                    productiveTicks: 1,
                    travelTicks: 0,
                    idleTicks: 0,
                    holdCount: 0,
                    resumeCount: 0,
                    taskPreemptions: 0,
                    procedureTransitions: 0,
                  },
                },
              },
              activityKpiHistory: {
                "task:W1N1:economy:test": [
                  {
                    tick: 10,
                    activityId: "old-tick-command",
                    activityType: "transfer",
                    actor: "worker-1",
                    rating: "satisfactory",
                    value: 1,
                    evidence: "legacy command-level score",
                  },
                ],
              },
            },
          },
        },
      },
    });
  });

  it("clears command-level quality evidence while preserving Task definitions", () => {
    migrateMemory();

    expect(Memory.version).toBe(3);
    const portfolio = Memory.colonies.W1N1?.fspm;
    expect(portfolio?.tasks["task:W1N1:economy:test"]).toBeDefined();
    expect(portfolio?.tasks["task:W1N1:economy:test"]?.qi).toBeUndefined();
    expect(portfolio?.activities).toEqual({});
    expect(portfolio?.activityKpiHistory).toEqual({});
  });
});
