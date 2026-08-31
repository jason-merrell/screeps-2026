const integerOrNull = (value) => (Number.isSafeInteger(value) ? value : null);
const stringOrNull = (value) =>
  typeof value === "string" && value.length > 0 ? value : null;

const epochFor = (trace, roomName) => {
  if (!trace || typeof trace !== "object") return null;
  const plan = Array.isArray(trace.settlement?.plans)
    ? trace.settlement.plans.find(
        (candidate) => candidate?.roomName === roomName,
      )
    : null;
  if (!plan) return null;
  const plannerRevision = integerOrNull(plan.plannerRevision);
  const projectionRevision = integerOrNull(plan.projectionRevision);
  const projectionFingerprint = stringOrNull(plan.projectionFingerprint);
  if (
    plannerRevision === null ||
    projectionRevision === null ||
    projectionFingerprint === null
  ) {
    return null;
  }
  return { plannerRevision, projectionRevision, projectionFingerprint };
};

const sameEpoch = (left, right) =>
  left?.plannerRevision === right?.plannerRevision &&
  left?.projectionRevision === right?.projectionRevision &&
  left?.projectionFingerprint === right?.projectionFingerprint;

/**
 * A before/after trace fence proves Memory and room-object requests completed
 * without crossing an observability tick or settlement projection epoch.
 */
export const captureConsistencyEvidence = (
  initialTrace,
  finalTrace,
  roomName,
) => {
  const initialTick = integerOrNull(initialTrace?.tick);
  const finalTick = integerOrNull(finalTrace?.tick);
  const initialEpoch = epochFor(initialTrace, roomName);
  const finalEpoch = epochFor(finalTrace, roomName);
  if (
    initialTick === null ||
    finalTick === null ||
    initialEpoch === null ||
    finalEpoch === null
  ) {
    return {
      status: "unverified",
      initialTick,
      finalTick,
      reason:
        "Trace fence lacks a tick or complete room-plan epoch; same-tick overlay is unverified.",
    };
  }
  if (initialTick !== finalTick || !sameEpoch(initialEpoch, finalEpoch)) {
    return {
      status: "mixed",
      initialTick,
      finalTick,
      reason:
        "Snapshot requests crossed an observability tick or settlement projection epoch.",
    };
  }
  return {
    status: "matched",
    initialTick,
    finalTick,
    reason: `Trace fence held at tick ${initialTick} for one exact settlement projection epoch.`,
  };
};
