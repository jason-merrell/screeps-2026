import { beforeEach, describe, expect, it } from "vitest";
import {
  activityTraceDisposition,
  type PublishTickTraceInput,
  publishTickTrace,
} from "../src/observability/trace";
import type { FspmAssignmentState } from "../src/planning/activity-lifecycle";
import {
  createEmpirePortfolioP3,
  type FspmActivityRecord,
  reconcileFspmLifecycle,
} from "../src/planning/fspm";

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

function installTraceGlobals(memoryVersion = 7): void {
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

function emptyTraceInput(): PublishTickTraceInput {
  return {
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
    authorityDenials: { total: 0, byCode: {}, samples: [] },
    assignments: [],
    supervisor: {
      mode: "normal",
      deadline: 45,
      headroom: 5,
      scopeUnits: 1,
      phases: [],
      metrics: {
        settlement: { samples: 0, p50: null, p95: null, p99: null },
        defense: { samples: 0, p50: null, p95: null, p99: null },
        spawning: { samples: 0, p50: null, p95: null, p99: null },
        construction: { samples: 0, p50: null, p95: null, p99: null },
        economy: { samples: 0, p50: null, p95: null, p99: null },
        fspm_maintenance: { samples: 0, p50: null, p95: null, p99: null },
        fspm_authority: { samples: 0, p50: null, p95: null, p99: null },
        activity_evidence: { samples: 0, p50: null, p95: null, p99: null },
        arbitration: { samples: 0, p50: null, p95: null, p99: null },
        execution: { samples: 0, p50: null, p95: null, p99: null },
      },
    },
    plannerByIntent: new Map(),
    conflictKey: () => "none",
  };
}

describe("observability Activity disposition", () => {
  it("reports On Hold authoritatively even when cached execution disposition is stale", () => {
    expect(activityTraceDisposition(activity("on_hold", "executing"))).toBe(
      "on_hold",
    );
  });

  it("preserves the reconciled disposition for current work", () => {
    expect(activityTraceDisposition(activity("in_progress", "traveling"))).toBe(
      "traveling",
    );
  });
});

describe("observability schema evidence", () => {
  beforeEach(() => installTraceGlobals());

  it("distinguishes the trace schema from the active persistent Memory schema", () => {
    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.version).toBe(1);
    expect(trace.memoryVersion).toBe(7);
    expect(trace.runtimeSha).toBeNull();
    expect(trace.runtime).toMatchObject({
      mode: "normal",
      deadline: 45,
      headroom: 5,
      phases: [],
    });
    expect(trace.cpu).toMatchObject({
      measurementBoundary: "before_segment_fit_and_write",
      previousTickFinal: null,
    });
    expect(Memory.runtimeSupervisor?.lastPublication).toEqual({
      tick: 1234,
      observability: 0,
      total: 1,
      segmentWritten: false,
    });
  });

  it("reconciles the previous tick's complete publication cost without claiming it for the current pre-write total", () => {
    Memory.runtimeSupervisor = {
      version: 1,
      phases: {},
      lastPublication: {
        tick: 1233,
        observability: 2.75,
        total: 8.5,
        segmentWritten: true,
      },
    };

    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.cpu.previousTickFinal).toEqual({
      tick: 1233,
      observability: 2.75,
      total: 8.5,
      segmentWritten: true,
    });
  });

  it("publishes bounded authority-denial counts and evidence samples", () => {
    const input = emptyTraceInput();
    input.authorityDenials = {
      total: 3,
      byCode: { trace_missing: 2, intent_type_mismatch: 1 },
      samples: [
        {
          code: "trace_missing",
          reason: "harvest intent has no FSPM authority trace",
          intentType: "harvest",
          trace: null,
        },
      ],
    };

    const trace = publishTickTrace(input);

    expect(trace.intents.authorityDenied).toEqual(input.authorityDenials);
    expect(trace.intents.proposed).toBe(0);
    expect(trace.intents.accepted).toBe(0);
  });

  it("quarantines a malformed Empire root while publishing bounded integrity evidence", () => {
    (Memory as unknown as { empireFspm: object }).empireFspm = {};
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.fspm.rootP3).toBeNull();
    expect(trace.fspm.integrity).toEqual({
      authoritative: false,
      total: 1,
      byCode: { empire_p3_missing: 1 },
      sampleLimit: 4,
      omittedSamples: 0,
      samples: [
        {
          code: "empire_p3_missing",
          scope: "empire",
          reason:
            "Empire authority container is present but its required root P3 is missing",
        },
      ],
    });
    expect(
      JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity,
    ).toEqual(trace.fspm.integrity);
  });

  it("quarantines a malformed colony P3 without aborting publication", () => {
    Memory.empireFspm = { p3: createEmpirePortfolioP3(1, Game.time) };
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      fspm: {
        requirements: {},
        deliverables: {},
        tasks: {},
        activities: {},
        activityKpiHistory: {},
        qualityHistory: {},
      } as never,
    };
    RawMemory.segments[99] = "{}";

    const beforeReconciliation = structuredClone(Memory);
    expect(() => reconcileFspmLifecycle([])).toThrow(/missing.*required.*P3/i);
    expect(Memory).toEqual(beforeReconciliation);

    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.fspm.colonies).toEqual([
      expect.objectContaining({ roomName: "W1N1", p3: null }),
    ]);
    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      total: 1,
      byCode: { colony_p3_missing: 1 },
      omittedSamples: 0,
      samples: [
        {
          code: "colony_p3_missing",
          scope: "colony:W1N1",
          reason: "Colony W1N1 authority portfolio is missing its required P3",
        },
      ],
    });
    expect(
      JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity,
    ).toEqual(trace.fspm.integrity);
  });
});
