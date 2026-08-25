import { describe, expect, it } from "vitest";
import type { FspmQuality } from "../../src/planning/fspm";

describe("FSPM quality contract", () => {
  it("keeps quality bounded and evidence explicit", () => {
    const quality: FspmQuality = {
      score: 85,
      state: "healthy",
      measuredAt: 123,
      evidence: ["workforce 4/4"],
    };

    expect(quality.score).toBeGreaterThanOrEqual(0);
    expect(quality.score).toBeLessThanOrEqual(100);
    expect(["healthy", "watch", "degraded"]).toContain(quality.state);
    expect(quality.evidence).toEqual(["workforce 4/4"]);
  });
});
