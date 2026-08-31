const CORE_PHASE_STATUS = {
  defense: "completed",
  economy: "completed",
  fspm_authority: "completed",
  arbitration: "completed",
  execution: "completed",
  activity_evidence: "completed",
};
const DEFERRABLE_PHASE_STATUS = ["completed", "skipped"];
const VALID_SKIP_REASONS = new Set(["cadence", "admission"]);

function phaseStatus(trace) {
  return Object.fromEntries(
    (Array.isArray(trace?.runtime?.phases) ? trace.runtime.phases : []).map(
      (phase) => [phase?.name, phase?.status],
    ),
  );
}

function expectedPhaseStatus(mode) {
  const malformed =
    mode === "malformed-fspm-authority" ||
    mode === "malformed-colony-authority";
  if (mode === "fspm-maintenance-fault") {
    return {
      ...CORE_PHASE_STATUS,
      fspm_governance: "completed",
      spawning: "completed",
      settlement: DEFERRABLE_PHASE_STATUS,
      construction: DEFERRABLE_PHASE_STATUS,
      fspm_maintenance: "failed",
    };
  }
  if (malformed) {
    return {
      ...CORE_PHASE_STATUS,
      fspm_governance: "failed",
      spawning: "completed",
      settlement: DEFERRABLE_PHASE_STATUS,
      construction: DEFERRABLE_PHASE_STATUS,
      fspm_maintenance: "failed",
    };
  }
  return {
    ...CORE_PHASE_STATUS,
    fspm_governance: "completed",
    spawning: "completed",
    settlement: DEFERRABLE_PHASE_STATUS,
    construction: DEFERRABLE_PHASE_STATUS,
    fspm_maintenance: "completed",
  };
}

function expectedFailedPhases(mode) {
  if (mode === "fspm-maintenance-fault") return ["fspm_maintenance"];
  if (
    mode === "malformed-fspm-authority" ||
    mode === "malformed-colony-authority"
  ) {
    return ["fspm_governance", "fspm_maintenance"];
  }
  return [];
}

function publicationErrors(observation, input) {
  const errors = [];
  const { trace, publication, gameTime } = observation;
  const expectedTick = gameTime - 1;
  if (!trace || typeof trace !== "object") {
    return ["Segment 99 trace is missing"];
  }
  if (!Number.isInteger(trace.tick)) {
    errors.push("Segment 99 tick is not an integer");
  } else if (trace.tick !== expectedTick) {
    errors.push(
      `Segment 99 tick ${trace.tick} is stale for engine observation tick ${expectedTick}`,
    );
  }
  if (!publication || typeof publication !== "object") {
    errors.push("runtimeSupervisor.lastPublication is missing");
  } else {
    if (publication.tick !== trace.tick) {
      errors.push(
        `lastPublication tick ${String(publication.tick)} does not match Segment 99 tick ${String(trace.tick)}`,
      );
    }
    if (publication.segmentWritten !== true) {
      errors.push("lastPublication does not confirm a Segment 99 write");
    }
  }
  if (trace.runtimeSha !== input.expectedRuntimeSha) {
    errors.push(
      `Segment 99 runtime SHA ${String(trace.runtimeSha)} does not match ${input.expectedRuntimeSha}`,
    );
  }

  const phaseRecords = Array.isArray(trace?.runtime?.phases)
    ? trace.runtime.phases
    : [];
  const actualStatus = phaseStatus(trace);
  for (const [name, expected] of Object.entries(
    expectedPhaseStatus(input.mode),
  )) {
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(actualStatus[name])) {
      errors.push(
        `phase ${name} is ${String(actualStatus[name])}; expected ${allowed.join(" or ")}`,
      );
    }
    if (actualStatus[name] === "skipped") {
      const record = phaseRecords.find((phase) => phase?.name === name);
      if (
        record?.class !== "deferrable" ||
        !VALID_SKIP_REASONS.has(record?.skipReason)
      ) {
        errors.push(
          `phase ${name} skipped without a governed deferrable cadence/admission reason`,
        );
      }
      if (record?.error !== null) {
        errors.push(`phase ${name} skipped while reporting an error`);
      }
      if (record?.cpu !== 0) {
        errors.push(`phase ${name} skipped with nonzero CPU`);
      }
    }
  }
  const failed = Object.entries(actualStatus)
    .filter(([, status]) => status === "failed")
    .map(([name]) => name)
    .sort();
  const expectedFailed = expectedFailedPhases(input.mode).sort();
  if (JSON.stringify(failed) !== JSON.stringify(expectedFailed)) {
    errors.push(
      `failed phase set ${JSON.stringify(failed)} does not match ${JSON.stringify(expectedFailed)}`,
    );
  }

  const integrity = trace.fspm?.integrity;
  const boundedIntegrity =
    Number.isInteger(integrity?.sampleLimit) &&
    integrity.sampleLimit >= 0 &&
    Array.isArray(integrity?.samples) &&
    integrity.samples.length <= integrity.sampleLimit &&
    Number.isInteger(integrity?.omittedSamples) &&
    integrity.omittedSamples >= 0 &&
    integrity.samples.length + integrity.omittedSamples === integrity.total;
  if (!boundedIntegrity) {
    errors.push("FSPM integrity evidence is missing its exact sample bound");
  }
  if (
    input.mode === "malformed-fspm-authority" ||
    input.mode === "malformed-colony-authority"
  ) {
    const integrityCode =
      input.mode === "malformed-colony-authority"
        ? "colony_p3_missing"
        : "empire_p3_missing";
    if (
      integrity?.authoritative !== false ||
      integrity?.total !== 1 ||
      integrity?.byCode?.[integrityCode] !== 1 ||
      integrity?.samples?.length !== 1 ||
      integrity.samples[0]?.code !== integrityCode ||
      typeof integrity.samples[0]?.scope !== "string" ||
      !integrity.samples[0].scope ||
      typeof integrity.samples[0]?.reason !== "string" ||
      !integrity.samples[0].reason
    ) {
      errors.push(
        "malformed authority integrity evidence is absent or unbounded",
      );
    }
  } else if (integrity?.authoritative !== true || integrity?.total !== 0) {
    errors.push("healthy authority was not published as authoritative");
  }
  return errors;
}

function activationSlotErrors(observation) {
  const errors = [];
  const expectedTick = observation.gameTime - 1;
  if (observation.trace !== null) {
    errors.push("the activation-latency slot unexpectedly exposed Segment 99");
  }
  if (!observation.publication || typeof observation.publication !== "object") {
    errors.push("tick 1 did not reach the runtime publication boundary");
    return errors;
  }
  if (observation.publication.tick !== expectedTick) {
    errors.push(
      `activation publication tick ${String(observation.publication.tick)} does not match ${expectedTick}`,
    );
  }
  if (observation.publication.segmentWritten !== false) {
    errors.push(
      "activation publication must record the expected unavailable Segment 99 write",
    );
  }
  return errors;
}

/**
 * Evaluate the post-tick Segment 99 window. The first engine observation is
 * the documented active-segment latency slot; every later observation must
 * carry one distinct, current, SHA-correlated publication.
 */
export function evaluateProductionPublicationWindow(input) {
  const expectedFreshPublications = Math.max(0, input.ticks - 1);
  const acceptedObservationIndexes = [];
  const acceptedSegmentTicks = [];
  const invalidObservations = [];
  let previousSegmentTick = null;

  for (const observation of input.observations) {
    if (observation.index === 1) {
      const errors = activationSlotErrors(observation);
      if (errors.length > 0) {
        invalidObservations.push({
          index: observation.index,
          gameTime: observation.gameTime,
          segmentTick: null,
          errors,
        });
      }
      continue;
    }
    const errors = publicationErrors(observation, input);
    const segmentTick = observation.trace?.tick;
    if (
      Number.isInteger(segmentTick) &&
      previousSegmentTick !== null &&
      segmentTick <= previousSegmentTick
    ) {
      errors.push(
        `Segment 99 tick ${segmentTick} is not strictly newer than ${previousSegmentTick}`,
      );
    }
    if (errors.length === 0) {
      previousSegmentTick = segmentTick;
      acceptedObservationIndexes.push(observation.index);
      acceptedSegmentTicks.push(segmentTick);
    } else {
      invalidObservations.push({
        index: observation.index,
        gameTime: observation.gameTime,
        segmentTick: Number.isInteger(segmentTick) ? segmentTick : null,
        errors,
      });
    }
  }

  if (acceptedObservationIndexes.length !== expectedFreshPublications) {
    invalidObservations.push({
      index: null,
      gameTime: null,
      segmentTick: null,
      errors: [
        `accepted ${acceptedObservationIndexes.length} fresh publications; expected ${expectedFreshPublications}`,
      ],
    });
  }

  return {
    passed: invalidObservations.length === 0,
    expectedFreshPublications,
    freshPublications: acceptedObservationIndexes.length,
    acceptedObservationIndexes,
    acceptedSegmentTicks,
    invalidObservations,
  };
}
