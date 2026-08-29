import { beforeEach, describe, expect, it } from "vitest";
import type { FspmAssignmentState } from "../src/planning/activity-lifecycle";
import type { FspmActivityRecord } from "../src/planning/fspm";
import { activityTraceDisposition, publishTickTrace } from "../src/observability/trace";

function activity(
  status: FspmActivityRecord["status"],
  disposition?: FspmAssignmentState,
): FspmActivityRecord {
  return {
    id: "activity:test",
    taskId: "task:test",
    assignee: "worker-1",
    status,
    currentProcedureId: "procedure:test",
    qualityDescription: "test quality",
    qualityMetric: "test metric",
    kpiMetric: {
      metric: "test KPI",
      exceptional: "exceptional",
      satisfactory: "satisfactory",
      unsatisfactory: "unsatisfactory",
    },
    createdAt: 1,
    updatedAt: 2,
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
    ...(disposition ? { currentDisposition: disposition } : {}),
  } as FspmActivityRecord;
}

function installTraceGlobals(memoryVersion = 6): void {
  Object.assign(globalThis, {
    Game: {
      time: 1234,
      cpu: {
        limit: 50,
        bucket: 10_000,
        getUsed: () => 1,
      },
    },
    Memory: {
      version: memoryVersion,
      colonies: {},
    },
    RawMemory: {
      segments: {},
      setActiveSegments: () => undefined,
    },
  });
}

describe("observability Activity disposition", () => {
  it("reports On Hold authoritatively even when cached execution disposition is stale", () => {
    expect(activityTraceDisposition(activity("on_hold", "executing"))).toBe("on_hold");
  });

  it("preserves the reconciled disposition for current work", () => {
    expect(activityTraceDisposition(activity("in_progress", "traveling"))).toBe("traveling");
  });
});

describe("observability schema evidence", () => {
  beforeEach(() => installTraceGlobals());

  it("distinguishes the trace schema from the active persistent Memory schema", () => {
    const trace = publishTickTrace({
      tickStartCpu: 0,
      memoryCpu: 0,
      perceptionCpu: 0,
      settlementCpu: 0,
      plannerRuns: [],
      arbitrationCpu: 0,
      executionCpu: 0,
      spatial: {
        roomsIndexed: 0,
        distanceLookups: 0,
        distanceCacheHits: 0,
        distanceCacheMisses: 0,
      },
      movement: {
        requests: 0,
        cachedPathAttempts: 0,
        pathFinds: 0,
        congestionRepaths: 0,
        fatigueWaits: 0,
        stuckRequests: 0,
        contentionYields: 0,
        headOnSwapAttempts: 0,
        headOnSwaps: 0,
      },
      accepted: [],
      rejected: [],
      assignments: [],
      plannerByIntent: new Map(),
      conflictKey: () => "none",
    });

    expect(trace.version).toBe(1);
    expect(trace.memoryVersion).toBe(6);
  });
});
