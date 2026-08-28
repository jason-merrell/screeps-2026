import { describe, expect, it } from "vitest";
import type { FspmAssignmentState } from "../src/planning/activity-lifecycle";
import type { FspmActivityRecord } from "../src/planning/fspm";
import { activityTraceDisposition } from "../src/observability/trace";

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

describe("observability Activity disposition", () => {
  it("reports On Hold authoritatively even when cached execution disposition is stale", () => {
    expect(activityTraceDisposition(activity("on_hold", "executing"))).toBe("on_hold");
  });

  it("preserves the reconciled disposition for current work", () => {
    expect(activityTraceDisposition(activity("in_progress", "traveling"))).toBe("traveling");
  });
});
