import { describe, expect, it } from "vitest";
import { evaluateProductionPublicationWindow } from "./production-publication-window.mjs";

const SHA = "a".repeat(40);

function phases(mode) {
  const malformed =
    mode === "malformed-fspm-authority" ||
    mode === "malformed-colony-authority";
  const statuses = {
    defense: "completed",
    spawning: malformed ? "failed" : "completed",
    economy: "completed",
    settlement: malformed ? "failed" : "completed",
    construction: "completed",
    fspm_maintenance: mode === "normal" ? "completed" : "failed",
    fspm_authority: "completed",
    arbitration: "completed",
    execution: "completed",
    activity_evidence: "completed",
  };
  return Object.entries(statuses).map(([name, status]) => ({ name, status }));
}

function trace(tick, mode = "normal") {
  const integrityCode =
    mode === "malformed-colony-authority"
      ? "colony_p3_missing"
      : "empire_p3_missing";
  const malformed =
    mode === "malformed-fspm-authority" ||
    mode === "malformed-colony-authority";
  return {
    version: 1,
    tick,
    runtimeSha: SHA,
    runtime: { phases: phases(mode) },
    fspm: {
      integrity: malformed
        ? {
            authoritative: false,
            total: 1,
            byCode: { [integrityCode]: 1 },
            sampleLimit: 4,
            omittedSamples: 0,
            samples: [
              {
                code: integrityCode,
                scope: "authority:test",
                reason: "adversarial malformed authority fixture",
              },
            ],
          }
        : {
            authoritative: true,
            total: 0,
            byCode: {},
            sampleLimit: 4,
            omittedSamples: 0,
            samples: [],
          },
    },
  };
}

function healthyWindow(mode = "normal", ticks = 12) {
  return Array.from({ length: ticks }, (_, offset) => {
    const index = offset + 1;
    return {
      index,
      gameTime: index + 1,
      publication: {
        tick: index,
        segmentWritten: index > 1,
      },
      trace: index === 1 ? null : trace(index, mode),
    };
  });
}

describe("production Segment 99 publication window", () => {
  it.each([
    "normal",
    "fspm-maintenance-fault",
    "malformed-fspm-authority",
    "malformed-colony-authority",
  ])("accepts a complete fresh %s window", (mode) => {
    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode,
      expectedRuntimeSha: SHA,
      observations: healthyWindow(mode),
    });

    expect(result).toMatchObject({
      passed: true,
      expectedFreshPublications: 11,
      freshPublications: 11,
      acceptedSegmentTicks: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      invalidObservations: [],
    });
  });

  it("rejects a stale Segment replay even while Memory publication ticks advance", () => {
    const observations = healthyWindow();
    for (const observation of observations.slice(2)) {
      observation.trace = trace(2);
    }

    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode: "normal",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(false);
    expect(result.freshPublications).toBe(1);
    expect(result.invalidObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 3,
          errors: expect.arrayContaining([
            expect.stringContaining("does not match Segment 99 tick"),
          ]),
        }),
      ]),
    );
  });

  it("rejects one successful publication followed by repeated failed ticks", () => {
    const observations = healthyWindow();
    for (const observation of observations.slice(2)) {
      observation.publication = { tick: 2, segmentWritten: true };
      observation.trace = trace(2);
    }

    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode: "normal",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(false);
    expect(result.freshPublications).toBe(1);
    expect(result.invalidObservations.at(-1)?.errors).toContain(
      "accepted 1 fresh publications; expected 11",
    );
  });

  it("rejects a missing tick-1 publication marker despite a fresh later window", () => {
    const observations = healthyWindow();
    observations[0].publication = null;

    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode: "normal",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(false);
    expect(result.invalidObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 1,
          errors: expect.arrayContaining([
            "tick 1 did not reach the runtime publication boundary",
          ]),
        }),
      ]),
    );
  });

  it("rejects malformed integrity evidence without an explicit bound", () => {
    const observations = healthyWindow("malformed-colony-authority");
    delete observations[4].trace.fspm.integrity.sampleLimit;

    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode: "malformed-colony-authority",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(false);
    expect(result.invalidObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 5,
          errors: expect.arrayContaining([
            "FSPM integrity evidence is missing its exact sample bound",
          ]),
        }),
      ]),
    );
  });

  it("rejects a fresh tick carrying the wrong mode-specific phase result", () => {
    const observations = healthyWindow("fspm-maintenance-fault");
    observations[6].trace.runtime.phases.find(
      (phase) => phase.name === "fspm_maintenance",
    ).status = "completed";

    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode: "fspm-maintenance-fault",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(false);
    expect(result.invalidObservations).toEqual(
      expect.arrayContaining([expect.objectContaining({ index: 7 })]),
    );
  });
});
