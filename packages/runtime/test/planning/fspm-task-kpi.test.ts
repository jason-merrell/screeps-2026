import { describe, expect, it, vi } from "vitest";
import type { FspmActivityKpiSample } from "../../src/planning/fspm";
import { classifyActivityObservation, computeTaskQi } from "../../src/planning/task-kpi";

vi.stubGlobal("OK", 0);

const sample = (
  tick: number,
  rating: FspmActivityKpiSample["rating"],
  value: number | null,
): FspmActivityKpiSample => ({
  tick,
  activityId: `activity:${tick}`,
  activityType: "transfer",
  actor: "worker-1",
  rating,
  value,
  evidence: rating === "in_progress" ? "traveling" : "measured execution",
});

describe("FSPM Task QI", () => {
  it("rates near-capacity task outcomes as exceptional", () => {
    expect(classifyActivityObservation({ result: 0, movementRequired: false, outcome: { metric: "energy delivered", actual: 48, target: 50, unit: "energy" } })).toBe("exceptional");
    expect(classifyActivityObservation({ result: 0, movementRequired: false, outcome: { metric: "energy delivered", actual: 20, target: 50, unit: "energy" } })).toBe("satisfactory");
  });

  it("excludes in-progress travel from earned quality", () => {
    const qi = computeTaskQi(
      [sample(1, "in_progress", null), sample(2, "satisfactory", 1)],
      2,
    );

    expect(qi).toMatchObject({
      score: 1,
      ratedActivities: 1,
      totalActivities: 2,
      satisfactory: 1,
      unsatisfactory: 0,
    });
  });

  it("uses the FSPM KPI multipliers when aggregating Activities", () => {
    const qi = computeTaskQi(
      [
        sample(1, "exceptional", 1.5),
        sample(2, "satisfactory", 1),
        sample(3, "unsatisfactory", 0.5),
      ],
      3,
    );

    expect(qi).toEqual({
      score: 1,
      measuredAt: 3,
      ratedActivities: 3,
      totalActivities: 3,
      exceptional: 1,
      satisfactory: 1,
      unsatisfactory: 1,
    });
  });

  it("does not invent a Task QI before any Activity is measurable", () => {
    expect(computeTaskQi([sample(1, "in_progress", null)], 1)).toBeUndefined();
  });
});
