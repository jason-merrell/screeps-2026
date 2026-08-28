import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FSPM_ACTIVITY_MEMORY_LIMIT,
  FSPM_ACTIVITY_TRACE_LIMIT,
  FSPM_EVENT_TRACE_LIMIT,
  OBSERVABILITY_SEGMENT,
  OBSERVABILITY_SEGMENT_TARGET_CHARS,
  fitObservabilityPayload,
  pruneFspmActivityHistory,
  writeObservabilitySegment,
} from "../../src/memory/segments";

type TestActivityStatus = "completed" | "in_progress" | "on_hold";

const activity = (
  index: number,
  status: TestActivityStatus = "completed",
  updatedAt = index,
) => ({
  id: `activity-${index}`,
  taskId: "task:test",
  assignee: `worker-${index % 4}`,
  status,
  currentProcedureId: "procedure:test",
  createdAt: index,
  updatedAt,
  ...(status === "completed" ? { completedAt: updatedAt } : {}),
  ...(status === "on_hold" ? { holdReason: "test held work" } : {}),
  metrics: {
    inProgressTicks: index,
    onHoldTicks: status === "on_hold" ? index : 0,
    productiveTicks: 1,
    travelTicks: index,
    idleTicks: 0,
    holdCount: status === "on_hold" ? 1 : 0,
    resumeCount: 0,
    taskPreemptions: 0,
    procedureTransitions: 0,
    targetRetargets: index,
  },
});

function installGlobals(): void {
  Object.assign(globalThis, {
    Memory: {
      version: 4,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
          fspm: {
            activities: Object.fromEntries(
              Array.from({ length: 72 }, (_, index) => [
                `activity-${index}`,
                activity(index, index >= 70 ? "in_progress" : "completed"),
              ]),
            ),
          },
        },
      },
    },
    RawMemory: {
      segments: { [OBSERVABILITY_SEGMENT]: "{}" },
      setActiveSegments: vi.fn(),
    },
  });
}

function oversizedTrace(): string {
  return JSON.stringify({
    version: 1,
    tick: 12345,
    cpu: { limit: 20, bucket: 10_000 },
    settlement: { plans: [] },
    fspm: {
      colonies: [
        {
          roomName: "W1N1",
          contractHistory: Array.from({ length: 20 }, (_, tick) => ({
            tick,
            evidence: "x".repeat(300),
          })),
          tasks: Array.from({ length: 20 }, (_, index) => ({
            id: `task-${index}`,
            title: `Task ${index}`,
            status: "active",
            qualityDescription: "quality ".repeat(80),
            qualityMetric: "metric ".repeat(80),
            kpiMetric: {
              metric: "rubric ".repeat(80),
              exceptional: "exceptional ".repeat(40),
              satisfactory: "satisfactory ".repeat(40),
              unsatisfactory: "unsatisfactory ".repeat(40),
            },
            procedures: [],
            recentActivities: Array.from({ length: 8 }, (_, tick) => ({
              tick,
              evidence: "e".repeat(300),
            })),
          })),
          activities: Array.from({ length: 100 }, (_, index) => activity(index)),
          activityEvents: Array.from({ length: 200 }, (_, index) => ({
            id: `event-${index}`,
            sequence: index,
            tick: index,
            type: "target_changed",
            activityId: `activity-${index % 100}`,
            taskId: "task:test",
            actor: "worker-1",
            procedureId: "procedure:test",
            targetKey: `target-${index}`,
            previousTargetKey: `target-${index - 1}`,
            reason: "planner selected a different concrete target ".repeat(6),
          })),
        },
      ],
      assignments: [],
    },
    spatial: {},
    movement: {},
    intents: {
      proposed: 100,
      accepted: 100,
      rejected: 0,
      proposedByPlanner: {},
      proposedByType: {},
      acceptedByType: {},
      acceptedSample: Array.from({ length: 40 }, (_, index) => ({
        index,
        reason: "intent ".repeat(100),
      })),
      rejectedSample: Array.from({ length: 40 }, (_, index) => ({
        index,
        reason: "reject ".repeat(100),
      })),
    },
  });
}

function heldBacklogTrace(): string {
  const inProgress = Array.from({ length: 3 }, (_, index) =>
    activity(1_000 + index, "in_progress", 20_000 + index),
  );
  const onHold = Array.from({ length: 50 }, (_, index) =>
    activity(2_000 + index, "on_hold", 10_000 + index),
  );
  const completed = Array.from({ length: 10 }, (_, index) =>
    activity(3_000 + index, "completed", 15_000 + index),
  );

  return JSON.stringify({
    version: 1,
    tick: 25_000,
    cpu: { limit: 20, bucket: 10_000 },
    settlement: { plans: [] },
    fspm: {
      colonies: [
        {
          roomName: "W1N1",
          contractHistory: [],
          tasks: [],
          activities: [...completed, ...onHold, ...inProgress],
          activityEvents: [],
        },
      ],
      assignments: inProgress.map((row) => ({
        tick: 25_000,
        assignee: row.assignee,
        state: "executing",
        activityId: row.id,
        taskId: row.taskId,
        procedureId: row.currentProcedureId,
        targetKey: null,
        reason: "test live work",
      })),
    },
    spatial: {},
    movement: {},
    intents: {
      proposed: 3,
      accepted: 3,
      rejected: 0,
      proposedByPlanner: {},
      proposedByType: {},
      acceptedByType: {},
      acceptedSample: [],
      rejectedSample: [],
    },
  });
}

describe("RawMemory observability retention", () => {
  beforeEach(() => installGlobals());

  it("drops the oldest completed Activities while preserving live work", () => {
    const removed = pruneFspmActivityHistory();
    const activities = Memory.colonies.W1N1?.fspm?.activities ?? {};

    expect(removed).toBe(72 - FSPM_ACTIVITY_MEMORY_LIMIT);
    expect(Object.keys(activities)).toHaveLength(FSPM_ACTIVITY_MEMORY_LIMIT);
    expect(activities["activity-70"]?.status).toBe("in_progress");
    expect(activities["activity-71"]?.status).toBe("in_progress");
    expect(activities["activity-0"]).toBeUndefined();
    expect(activities["activity-8"]).toBeDefined();
  });

  it("bounds held backlog while preserving all current work and freshest resumable evidence", () => {
    const fitted = fitObservabilityPayload(heldBacklogTrace());
    const parsed = JSON.parse(fitted);
    const retained = parsed.fspm.colonies[0].activities;
    const retainedIds = new Set(retained.map((row: { id: string }) => row.id));

    expect(retained).toHaveLength(FSPM_ACTIVITY_TRACE_LIMIT);
    expect(retained.filter((row: { status: string }) => row.status === "in_progress")).toHaveLength(3);
    expect(retained.filter((row: { status: string }) => row.status === "on_hold")).toHaveLength(37);
    expect(retained.filter((row: { status: string }) => row.status === "completed")).toHaveLength(0);

    for (let index = 0; index < 3; index += 1) {
      expect(retainedIds.has(`activity-${1_000 + index}`)).toBe(true);
    }
    for (let index = 13; index < 50; index += 1) {
      expect(retainedIds.has(`activity-${2_000 + index}`)).toBe(true);
    }
    for (let index = 0; index < 13; index += 1) {
      expect(retainedIds.has(`activity-${2_000 + index}`)).toBe(false);
    }

    expect(parsed.transport).toMatchObject({
      activityRetentionVersion: 2,
      activityTraceLimit: FSPM_ACTIVITY_TRACE_LIMIT,
      omittedActivities: 23,
      omittedInProgressActivities: 0,
      omittedOnHoldActivities: 13,
      omittedOtherNonterminalActivities: 0,
      omittedCompletedActivities: 10,
    });
  });

  it("fits an oversized trace into a valid bounded transport payload", () => {
    const source = oversizedTrace();
    expect(source.length).toBeGreaterThan(OBSERVABILITY_SEGMENT_TARGET_CHARS);

    const fitted = fitObservabilityPayload(source);
    const parsed = JSON.parse(fitted);
    const colony = parsed.fspm.colonies[0];

    expect(fitted.length).toBeLessThanOrEqual(OBSERVABILITY_SEGMENT_TARGET_CHARS);
    if (colony) {
      expect(colony.activities.length).toBeLessThanOrEqual(FSPM_ACTIVITY_TRACE_LIMIT);
      expect(colony.activityEvents.length).toBeLessThanOrEqual(FSPM_EVENT_TRACE_LIMIT);
    } else {
      expect(parsed.transport?.truncated).toBe(true);
    }
  });

  it("never writes an oversized string into segment 99", () => {
    expect(writeObservabilitySegment(oversizedTrace())).toBe(true);
    const payload = RawMemory.segments[OBSERVABILITY_SEGMENT];
    expect(payload).toBeDefined();
    expect(payload?.length).toBeLessThanOrEqual(OBSERVABILITY_SEGMENT_TARGET_CHARS);
    expect(() => JSON.parse(payload ?? "")).not.toThrow();
  });
});
