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
const BOOT_HEARTBEAT_SCHEMA = "screeps-runtime-boot-heartbeat/v1";
const BOOT_PHASE_ORDER = new Map([
  ["deferred", 0],
  ["migration", 1],
  ["settlement", 2],
  ["ready", 3],
]);

export const MAX_BOOT_PREFIX_PUBLICATIONS = 4;
export const MIN_CONSECUTIVE_FULL_PUBLICATIONS = 3;

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

function fullPublicationErrors(observation, input) {
  const errors = [];
  const { trace, publication, gameTime } = observation;
  const expectedTick = gameTime - 1;
  if (!trace || typeof trace !== "object") {
    return ["Segment 99 trace is missing"];
  }
  if (trace.version !== 1) {
    errors.push(
      `complete Segment 99 trace version is ${String(trace.version)}; expected 1`,
    );
  }
  if (
    trace.schema === BOOT_HEARTBEAT_SCHEMA ||
    trace?.transport?.bootHeartbeat === true
  ) {
    errors.push("complete Segment 99 trace impersonates a boot heartbeat");
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

function isBootHeartbeatCandidate(trace) {
  return Boolean(
    trace &&
      typeof trace === "object" &&
      (trace.version === 0 ||
        trace.schema === BOOT_HEARTBEAT_SCHEMA ||
        trace?.transport?.bootHeartbeat === true),
  );
}

function bootHeartbeatErrors(observation, input, previousBoot) {
  const errors = [];
  const { trace, gameTime } = observation;
  const expectedTick = gameTime - 1;
  if (!trace || typeof trace !== "object") {
    return ["Segment 99 boot heartbeat is missing"];
  }
  if (trace.schema !== BOOT_HEARTBEAT_SCHEMA) {
    errors.push(
      `boot heartbeat schema is ${String(trace.schema)}; expected ${BOOT_HEARTBEAT_SCHEMA}`,
    );
  }
  if (trace.version !== 0) {
    errors.push(
      `boot heartbeat version is ${String(trace.version)}; expected 0`,
    );
  }
  if (trace.runtimeSha !== input.expectedRuntimeSha) {
    errors.push(
      `boot heartbeat runtime SHA ${String(trace.runtimeSha)} does not match ${input.expectedRuntimeSha}`,
    );
  }
  if (!Number.isInteger(trace.tick)) {
    errors.push("boot heartbeat tick is not an integer");
  } else if (trace.tick !== expectedTick) {
    errors.push(
      `boot heartbeat tick ${trace.tick} is stale for engine observation tick ${expectedTick}`,
    );
  }
  if (trace?.transport?.bootHeartbeat !== true) {
    errors.push("boot heartbeat transport marker is absent");
  }

  const phase = trace?.boot?.phase;
  const phaseRank = BOOT_PHASE_ORDER.get(phase);
  if (phaseRank === undefined) {
    errors.push(
      `boot heartbeat phase ${String(phase)} is not a governed boot phase`,
    );
  } else if (
    previousBoot?.phaseRank !== undefined &&
    phaseRank < previousBoot.phaseRank
  ) {
    errors.push(
      `boot heartbeat phase ${phase} regressed from ${previousBoot.phase}`,
    );
  }

  const memoryVersion = trace.memoryVersion;
  if (memoryVersion !== null && !Number.isInteger(memoryVersion)) {
    errors.push("boot heartbeat memoryVersion is neither null nor an integer");
  } else if (
    Number.isInteger(memoryVersion) &&
    Number.isInteger(previousBoot?.memoryVersion) &&
    memoryVersion < previousBoot.memoryVersion
  ) {
    errors.push(
      `boot heartbeat memoryVersion ${memoryVersion} regressed from ${previousBoot.memoryVersion}`,
    );
  }

  return errors;
}

function activationSlotErrors(observation) {
  const errors = [];
  const expectedTick = observation.gameTime - 1;
  if (observation.trace !== null) {
    errors.push("the activation-latency slot unexpectedly exposed Segment 99");
  }
  if (!observation.publication || typeof observation.publication !== "object")
    return errors;
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
 * Evaluate the post-tick Segment 99 window. Observation one is the documented
 * active-segment latency slot. A small, monotonic v0 boot-heartbeat prefix may
 * follow; once a complete v1 trace appears, only complete v1 traces are legal.
 */
export function evaluateProductionPublicationWindow(input) {
  const acceptedObservationIndexes = [];
  const acceptedSegmentTicks = [];
  const bootObservationIndexes = [];
  const bootSegmentTicks = [];
  const bootPhases = [];
  const invalidObservations = [];
  const bootCandidateIndexes = [];
  let previousSegmentTick = null;
  let previousBoot = null;
  let firstFullObservationIndex = null;
  let activationPublicationMissing = false;

  for (const observation of input.observations) {
    if (observation.index === 1) {
      const errors = activationSlotErrors(observation);
      activationPublicationMissing =
        !observation.publication || typeof observation.publication !== "object";
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

    const segmentTick = observation.trace?.tick;
    const errors = [];
    if (
      Number.isInteger(segmentTick) &&
      previousSegmentTick !== null &&
      segmentTick <= previousSegmentTick
    ) {
      errors.push(
        `Segment 99 tick ${segmentTick} is not strictly newer than ${previousSegmentTick}`,
      );
    }
    if (Number.isInteger(segmentTick)) previousSegmentTick = segmentTick;

    if (isBootHeartbeatCandidate(observation.trace)) {
      bootCandidateIndexes.push(observation.index);
      if (firstFullObservationIndex !== null) {
        errors.push(
          `boot heartbeat appeared after complete trace observation ${firstFullObservationIndex}`,
        );
      }
      errors.push(...bootHeartbeatErrors(observation, input, previousBoot));
      if (errors.length === 0) {
        const phase = observation.trace.boot.phase;
        previousBoot = {
          phase,
          phaseRank: BOOT_PHASE_ORDER.get(phase),
          memoryVersion: observation.trace.memoryVersion,
        };
        bootObservationIndexes.push(observation.index);
        bootSegmentTicks.push(segmentTick);
        bootPhases.push(phase);
      }
    } else {
      firstFullObservationIndex ??= observation.index;
      errors.push(...fullPublicationErrors(observation, input));
      if (errors.length === 0) {
        acceptedObservationIndexes.push(observation.index);
        acceptedSegmentTicks.push(segmentTick);
      }
    }

    if (errors.length > 0) {
      invalidObservations.push({
        index: observation.index,
        gameTime: observation.gameTime,
        segmentTick: Number.isInteger(segmentTick) ? segmentTick : null,
        errors,
      });
    }
  }

  if (input.observations.length !== input.ticks) {
    invalidObservations.push({
      index: null,
      gameTime: null,
      segmentTick: null,
      errors: [
        `observed ${input.observations.length} engine ticks; expected ${input.ticks}`,
      ],
    });
  }
  if (activationPublicationMissing && bootCandidateIndexes.length === 0) {
    invalidObservations.push({
      index: 1,
      gameTime:
        input.observations.find((entry) => entry.index === 1)?.gameTime ?? null,
      segmentTick: null,
      errors: ["tick 1 did not reach the runtime publication boundary"],
    });
  }
  if (bootCandidateIndexes.length > MAX_BOOT_PREFIX_PUBLICATIONS) {
    invalidObservations.push({
      index: null,
      gameTime: null,
      segmentTick: null,
      errors: [
        `observed ${bootCandidateIndexes.length} boot heartbeats; maximum bounded prefix is ${MAX_BOOT_PREFIX_PUBLICATIONS}`,
      ],
    });
  }

  const acceptedIndexSet = new Set(acceptedObservationIndexes);
  let trailingFullPublications = 0;
  for (let index = input.ticks; index >= 2; index -= 1) {
    if (!acceptedIndexSet.has(index)) break;
    trailingFullPublications += 1;
  }
  if (trailingFullPublications < MIN_CONSECUTIVE_FULL_PUBLICATIONS) {
    invalidObservations.push({
      index: null,
      gameTime: null,
      segmentTick: null,
      errors: [
        `final observation has ${trailingFullPublications} consecutive complete v1 publications; required at least ${MIN_CONSECUTIVE_FULL_PUBLICATIONS}`,
      ],
    });
  }

  return {
    passed: invalidObservations.length === 0,
    maxBootPrefixPublications: MAX_BOOT_PREFIX_PUBLICATIONS,
    bootPublications: bootObservationIndexes.length,
    bootObservationIndexes,
    bootSegmentTicks,
    bootPhases,
    firstFullObservationIndex,
    minimumConsecutiveFullPublications: MIN_CONSECUTIVE_FULL_PUBLICATIONS,
    trailingFullPublications,
    freshPublications: acceptedObservationIndexes.length,
    acceptedObservationIndexes,
    acceptedSegmentTicks,
    invalidObservations,
  };
}
