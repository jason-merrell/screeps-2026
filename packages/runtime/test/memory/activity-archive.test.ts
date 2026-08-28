import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FSPM_ACTIVITY_ARCHIVE_RECORD_LIMIT,
  FSPM_ACTIVITY_ARCHIVE_SEGMENT,
  FSPM_ACTIVITY_ARCHIVE_VERSION,
  FSPM_ACTIVITY_STALE_ON_HOLD_TICKS,
  fspmActivityArchiveSummary,
  readFspmActivityArchive,
  reconcileFspmActivityRetention,
} from "../../src/memory/activity-archive";
import { fitObservabilityPayload } from "../../src/memory/segments";

vi.stubGlobal("RESOURCE_ENERGY", "energy");

const legacyTaskId = "task:W1N1:economy:produce-source-energy";
const canonicalTaskId = "task:W1N1:economy:maintain-colony-energy-service";

const activity = (
  index: number,
  taskId = legacyTaskId,
  status: "on_hold" | "in_progress" = "on_hold",
  updatedAt = 1_000 + index,
  extra: Record<string, unknown> = {},
) => ({
  id: `activity-${index}`,
  taskId,
  assignee: `worker-${index}`,
  status,
  currentProcedureId: "procedure:test",
  qualityDescription: "governed test quality",
  qualityMetric: "governed test metric",
  kpiMetric: {
    metric: "governed test KPI",
    exceptional: "exceptional",
    satisfactory: "satisfactory",
    unsatisfactory: "unsatisfactory",
  },
  createdAt: index,
  updatedAt,
  ...(status === "on_hold" ? { holdReason: "test held work" } : {}),
  metrics: {
    inProgressTicks: 1,
    onHoldTicks: status === "on_hold" ? 1 : 0,
    productiveTicks: 0,
    travelTicks: 0,
    idleTicks: 0,
    holdCount: status === "on_hold" ? 1 : 0,
    resumeCount: 0,
    taskPreemptions: 0,
    procedureTransitions: 0,
  },
  ...extra,
});

const legacyTask = {
  kind: "task",
  id: legacyTaskId,
  title: "Produce Source Energy",
  status: "active",
  deliverableId: "deliverable:W1N1:economy",
  domain: "economy",
  taskKey: "produce-source-energy",
  qualityDescription: "legacy",
  qualityMetric: "legacy",
  kpiMetric: {
    metric: "legacy",
    exceptional: "legacy",
    satisfactory: "legacy",
    unsatisfactory: "legacy",
  },
  procedures: [],
  createdAt: 1,
  updatedAt: 1,
};

const canonicalTask = {
  ...legacyTask,
  id: canonicalTaskId,
  taskKey: "maintain-colony-energy-service",
};

function installGlobals({ archiveActive = true } = {}): void {
  Object.assign(globalThis, {
    Game: {
      time: 5_000,
      creeps: {},
    },
    Memory: {
      version: 5,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
          fspm: {
            tasks: {
              [legacyTaskId]: { ...legacyTask },
              [canonicalTaskId]: { ...canonicalTask },
            },
            activities: {},
            activityKpiHistory: {},
          },
        },
      },
    },
    RawMemory: {
      segments: {
        ...(archiveActive ? { [FSPM_ACTIVITY_ARCHIVE_SEGMENT]: "" } : {}),
        99: "{}",
      },
      setActiveSegments: vi.fn(),
    },
  });
}

function activities(): Record<string, ReturnType<typeof activity>> {
  return Memory.colonies.W1N1?.fspm?.activities as Record<string, ReturnType<typeof activity>>;
}

describe("governed FSPM Activity archive", () => {
  beforeEach(() => installGlobals());

  it("archives >64 unresolved legacy Activities before removing them from active Memory", () => {
    const store = activities();
    for (let index = 0; index < 70; index += 1) {
      store[`activity-${index}`] = activity(index);
    }

    const report = reconcileFspmActivityRetention();
    const archived = readFspmActivityArchive();

    expect(report).toMatchObject({
      archiveAvailable: true,
      archived: 70,
      cancelled: 70,
      migrated: 0,
      archiveBlocked: 0,
      activeActivities: 0,
      overLimitActivities: 0,
      archiveRecords: 70,
    });
    expect(Object.keys(store)).toHaveLength(0);
    expect(archived).toHaveLength(70);
    expect(archived.every((record) => record.activity.status === "on_hold")).toBe(true);
    expect(archived.every((record) => record.activity.taskId === legacyTaskId)).toBe(true);
    expect(archived.every((record) => record.activity.kpiScore === undefined)).toBe(true);
    expect(archived.every((record) => record.resolution.disposition === "cancelled")).toBe(true);
    expect(Memory.colonies.W1N1?.fspm?.activityKpiHistory?.[legacyTaskId]).toBeUndefined();
  });

  it("fails closed when the archive segment is unavailable", () => {
    installGlobals({ archiveActive: false });
    const store = activities();
    for (let index = 0; index < 70; index += 1) {
      store[`activity-${index}`] = activity(index);
    }

    const report = reconcileFspmActivityRetention();

    expect(report.archiveAvailable).toBe(false);
    expect(report.archived).toBe(0);
    expect(report.activeActivities).toBe(70);
    expect(report.overLimitActivities).toBe(6);
    expect(Object.keys(store)).toHaveLength(70);
  });

  it("cancels stale canonical On Hold work only after the resumability horizon", () => {
    const store = activities();
    store.recent = activity(
      1,
      canonicalTaskId,
      "on_hold",
      Game.time - FSPM_ACTIVITY_STALE_ON_HOLD_TICKS + 1,
    );
    store.stale = activity(
      2,
      canonicalTaskId,
      "on_hold",
      Game.time - FSPM_ACTIVITY_STALE_ON_HOLD_TICKS,
    );

    const report = reconcileFspmActivityRetention();
    const archived = readFspmActivityArchive();

    expect(store.recent).toBeDefined();
    expect(store.stale).toBeUndefined();
    expect(report.cancelled).toBe(1);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.resolution.reason).toContain("one standard creep-lifetime horizon");
    expect(archived[0]?.activity.status).toBe("on_hold");
    expect(archived[0]?.activity.kpiScore).toBeUndefined();
  });

  it("migrates an older held duplicate when newer live work owns the same identity", () => {
    const store = activities();
    store.old = activity(1, canonicalTaskId, "on_hold", 4_000, {
      id: "old",
      assignee: "worker-old",
      currentTargetKey: "target-1",
    });
    store.current = activity(2, canonicalTaskId, "in_progress", 4_500, {
      id: "current",
      assignee: "worker-current",
      currentTargetKey: "target-1",
    });

    const report = reconcileFspmActivityRetention();
    const archived = readFspmActivityArchive();

    expect(store.old).toBeUndefined();
    expect(store.current).toBeDefined();
    expect(report.migrated).toBe(1);
    expect(archived[0]?.resolution).toMatchObject({
      disposition: "migrated",
      replacementActivityId: "current",
    });
    expect(archived[0]?.activity.taskId).toBe(canonicalTaskId);
    expect(archived[0]?.activity.kpiScore).toBeUndefined();
  });

  it("does not evict active authority when the persistent archive is at its record limit", () => {
    const archiveRecords = Array.from({ length: FSPM_ACTIVITY_ARCHIVE_RECORD_LIMIT }, (_, index) => ({
      roomName: "W1N1",
      activity: activity(10_000 + index),
      resolution: {
        disposition: "cancelled",
        resolvedAt: index,
        reason: "existing archived resolution",
      },
    }));
    RawMemory.segments[FSPM_ACTIVITY_ARCHIVE_SEGMENT] = JSON.stringify({
      version: FSPM_ACTIVITY_ARCHIVE_VERSION,
      updatedAt: Game.time,
      records: archiveRecords,
    });
    const store = activities();
    store.pending = activity(999, legacyTaskId, "on_hold", 1, { id: "pending" });

    const report = reconcileFspmActivityRetention();

    expect(report.archiveBlocked).toBe(1);
    expect(store.pending).toBeDefined();
    expect(readFspmActivityArchive()).toHaveLength(FSPM_ACTIVITY_ARCHIVE_RECORD_LIMIT);
  });

  it("publishes archive health into bounded observability transport", () => {
    const store = activities();
    store.legacy = activity(1, legacyTaskId, "on_hold", 1, { id: "legacy" });
    reconcileFspmActivityRetention();

    const fitted = fitObservabilityPayload(JSON.stringify({
      version: 1,
      tick: Game.time,
      fspm: { colonies: [], assignments: [] },
      intents: { acceptedSample: [], rejectedSample: [] },
    }));
    const parsed = JSON.parse(fitted);

    expect(parsed.transport.activityArchive).toMatchObject({
      archiveSegment: FSPM_ACTIVITY_ARCHIVE_SEGMENT,
      archiveAvailable: true,
      archiveRecords: 1,
      archived: 1,
      cancelled: 1,
      archiveBlocked: 0,
    });
    expect(fspmActivityArchiveSummary().latestResolution).toMatchObject({
      activityId: "legacy",
      disposition: "cancelled",
    });
  });
});
