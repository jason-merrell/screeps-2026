import { describe, expect, it } from "vitest";
import { evaluateProductionPublicationWindow } from "./production-publication-window.mjs";

const SHA = "a".repeat(40);

function phases(mode) {
  const malformed =
    mode === "malformed-fspm-authority" ||
    mode === "malformed-colony-authority";
  const statuses = {
    fspm_governance: malformed ? "failed" : "completed",
    defense: "completed",
    spawning: "completed",
    economy: "completed",
    settlement: "completed",
    construction: "completed",
    fspm_maintenance: mode === "normal" ? "completed" : "failed",
    fspm_authority: "completed",
    arbitration: "completed",
    execution: "completed",
    activity_evidence: "completed",
  };
  return Object.entries(statuses).map(([name, status]) => ({
    name,
    class: ["settlement", "construction"].includes(name)
      ? "deferrable"
      : "mandatory",
    status,
    skipReason: null,
    cpu: 1,
    error: null,
  }));
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

function bootTrace(tick, phase, memoryVersion) {
  return {
    schema: "screeps-runtime-boot-heartbeat/v1",
    version: 0,
    tick,
    runtimeSha: SHA,
    memoryVersion,
    boot: { phase },
    transport: { bootHeartbeat: true },
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

function stagedBootWindow(mode = "normal", ticks = 12) {
  const phases = new Map([
    [2, ["migration", 9]],
    [3, ["settlement", 10]],
    [4, ["ready", 10]],
  ]);
  return Array.from({ length: ticks }, (_, offset) => {
    const index = offset + 1;
    const boot = phases.get(index);
    return {
      index,
      gameTime: index + 1,
      publication: index >= 5 ? { tick: index, segmentWritten: true } : null,
      trace:
        index === 1
          ? null
          : boot
            ? bootTrace(index, boot[0], boot[1])
            : trace(index, mode),
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
      bootPublications: 0,
      firstFullObservationIndex: 2,
      minimumConsecutiveFullPublications: 3,
      trailingFullPublications: 11,
      freshPublications: 11,
      acceptedSegmentTicks: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      invalidObservations: [],
    });
  });

  it.each([
    "normal",
    "fspm-maintenance-fault",
    "malformed-fspm-authority",
    "malformed-colony-authority",
  ])(
    "accepts a bounded staged-boot prefix before complete %s traces",
    (mode) => {
      const result = evaluateProductionPublicationWindow({
        ticks: 12,
        mode,
        expectedRuntimeSha: SHA,
        observations: stagedBootWindow(mode),
      });

      expect(result).toMatchObject({
        passed: true,
        maxBootPrefixPublications: 4,
        bootPublications: 3,
        bootObservationIndexes: [2, 3, 4],
        bootSegmentTicks: [2, 3, 4],
        bootPhases: ["migration", "settlement", "ready"],
        firstFullObservationIndex: 5,
        trailingFullPublications: 8,
        freshPublications: 8,
        acceptedObservationIndexes: [5, 6, 7, 8, 9, 10, 11, 12],
        invalidObservations: [],
      });
    },
  );

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
      "final observation has 0 consecutive complete v1 publications; required at least 3",
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

  it("accepts a deferrable phase skipped for a governed admission reason", () => {
    const observations = healthyWindow();
    const settlement = observations[6].trace.runtime.phases.find(
      (phase) => phase.name === "settlement",
    );
    settlement.status = "skipped";
    settlement.skipReason = "admission";
    settlement.cpu = 0;

    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode: "normal",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(true);
  });

  it("rejects an unexplained deferrable skip", () => {
    const observations = healthyWindow();
    observations[6].trace.runtime.phases.find(
      (phase) => phase.name === "settlement",
    ).status = "skipped";

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
          index: 7,
          errors: expect.arrayContaining([
            "phase settlement skipped without a governed deferrable cadence/admission reason",
          ]),
        }),
      ]),
    );
  });

  it.each([
    [
      "error",
      "unexpected failure",
      "phase settlement skipped while reporting an error",
    ],
    ["cpu", 0.25, "phase settlement skipped with nonzero CPU"],
  ])(
    "rejects a deferrable skip carrying %s work evidence",
    (field, value, expectedError) => {
      const observations = healthyWindow();
      const settlement = observations[6].trace.runtime.phases.find(
        (phase) => phase.name === "settlement",
      );
      settlement.status = "skipped";
      settlement.skipReason = "admission";
      settlement.cpu = 0;
      settlement[field] = value;

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
            index: 7,
            errors: expect.arrayContaining([expectedError]),
          }),
        ]),
      );
    },
  );

  it.each([
    ["schema", "wrong-boot-schema/v1", "boot heartbeat schema"],
    ["version", 1, "boot heartbeat version"],
    ["runtimeSha", "b".repeat(40), "boot heartbeat runtime SHA"],
    ["tick", 1, "boot heartbeat tick"],
  ])("rejects a boot heartbeat with the wrong %s", (field, value, error) => {
    const observations = stagedBootWindow();
    observations[1].trace[field] = value;

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
          index: 2,
          errors: expect.arrayContaining([expect.stringContaining(error)]),
        }),
      ]),
    );
  });

  it("rejects a regressing or unknown boot phase", () => {
    const observations = stagedBootWindow();
    observations[2].trace.boot.phase = "deferred";
    observations[3].trace.boot.phase = "invented";

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
          index: 3,
          errors: expect.arrayContaining([
            expect.stringContaining("phase deferred regressed"),
          ]),
        }),
        expect.objectContaining({
          index: 4,
          errors: expect.arrayContaining([
            expect.stringContaining("not a governed boot phase"),
          ]),
        }),
      ]),
    );
  });

  it("rejects a boot heartbeat whose Memory schema version regresses", () => {
    const observations = stagedBootWindow();
    observations[2].trace.memoryVersion = 8;

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
          index: 3,
          errors: expect.arrayContaining([
            "boot heartbeat memoryVersion 8 regressed from 9",
          ]),
        }),
      ]),
    );
  });

  it("rejects a boot prefix beyond its explicit bound", () => {
    const observations = stagedBootWindow();
    for (let index = 2; index <= 7; index += 1) {
      observations[index - 1].publication = null;
      observations[index - 1].trace = bootTrace(index, "migration", 9);
    }

    const result = evaluateProductionPublicationWindow({
      ticks: 12,
      mode: "normal",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(false);
    expect(result.invalidObservations.at(-1)?.errors).toContain(
      "observed 6 boot heartbeats; maximum bounded prefix is 4",
    );
  });

  it("forbids a boot heartbeat after the first complete trace", () => {
    const observations = stagedBootWindow();
    observations[5].publication = null;
    observations[5].trace = bootTrace(6, "ready", 10);

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
          index: 6,
          errors: expect.arrayContaining([
            "boot heartbeat appeared after complete trace observation 5",
          ]),
        }),
      ]),
    );
  });

  it("requires three consecutive complete traces through the final observation", () => {
    const observations = [
      {
        index: 1,
        gameTime: 2,
        publication: null,
        trace: null,
      },
      ...[2, 3].map((index) => ({
        index,
        gameTime: index + 1,
        publication: null,
        trace: bootTrace(index, index === 2 ? "migration" : "ready", 10),
      })),
      ...[4, 5].map((index) => ({
        index,
        gameTime: index + 1,
        publication: { tick: index, segmentWritten: true },
        trace: trace(index),
      })),
    ];

    const result = evaluateProductionPublicationWindow({
      ticks: 5,
      mode: "normal",
      expectedRuntimeSha: SHA,
      observations,
    });

    expect(result.passed).toBe(false);
    expect(result.trailingFullPublications).toBe(2);
    expect(result.invalidObservations.at(-1)?.errors).toContain(
      "final observation has 2 consecutive complete v1 publications; required at least 3",
    );
  });

  it("keeps full-trace integrity checks strict after a valid boot prefix", () => {
    const observations = stagedBootWindow("malformed-colony-authority");
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
});
