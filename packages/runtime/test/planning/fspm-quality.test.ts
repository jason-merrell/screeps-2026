import { describe, expect, it } from "vitest";
import type { FspmQuality, FspmQualitySample } from "../../src/planning/fspm";
import {
  qualityTrendFromSamples,
  rollupContractScore,
} from "../../src/planning/quality";

describe("FSPM quality contract", () => {
  it("keeps quality bounded and evidence explicit", () => {
    const quality: FspmQuality = {
      score: 85,
      state: "healthy",
      trend: "stable",
      measuredAt: 123,
      evidence: ["workforce 4/4"],
    };

    expect(quality.score).toBeGreaterThanOrEqual(0);
    expect(quality.score).toBeLessThanOrEqual(100);
    expect(["healthy", "watch", "degraded"]).toContain(quality.state);
    expect(["new", "improving", "stable", "declining"]).toContain(quality.trend);
    expect(quality.evidence).toEqual(["workforce 4/4"]);
  });

  it("rolls requirement scores into a rounded contract score", () => {
    expect(rollupContractScore([100, 80, 75])).toBe(85);
    expect(rollupContractScore([])).toBeNull();
  });

  it("derives direction only after a meaningful history window", () => {
    const sample = (tick: number, score: number): FspmQualitySample => ({
      tick,
      score,
      state: score >= 85 ? "healthy" : score >= 60 ? "watch" : "degraded",
    });

    expect(qualityTrendFromSamples([sample(100, 80)])).toBe("new");
    expect(qualityTrendFromSamples([sample(100, 80), sample(110, 95)])).toBe("new");
    expect(qualityTrendFromSamples([sample(100, 80), sample(125, 90)])).toBe("improving");
    expect(qualityTrendFromSamples([sample(100, 90), sample(125, 80)])).toBe("declining");
    expect(qualityTrendFromSamples([sample(100, 90), sample(125, 86)])).toBe("stable");
  });
});
