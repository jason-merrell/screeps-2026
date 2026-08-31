const canonicalize = (value) => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

const fingerprintContent = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  const {
    deliverableId: _deliverableId,
    generatedAt: _generatedAt,
    generatedReason: _generatedReason,
    invalidatedAt: _invalidatedAt,
    invalidationReason: _invalidationReason,
    planId: _planId,
    projectionFingerprint: _projectionFingerprint,
    projectionRevision: _projectionRevision,
    ...content
  } = plan;
  return canonicalize(content);
};

const mixFingerprint = (text, seed) => {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    value = Math.imul(value ^ (code & 0xff), 0x01000193) >>> 0;
    value = Math.imul(value ^ (code >>> 8), 0x01000193) >>> 0;
  }
  return value;
};

const fingerprint = (plan, prefix) => {
  const content = fingerprintContent(plan);
  if (content === null) return null;
  const serialized = JSON.stringify(content);
  const left = mixFingerprint(serialized, 0x811c9dc5)
    .toString(16)
    .padStart(8, "0");
  const right = mixFingerprint(serialized, 0x9e3779b9)
    .toString(16)
    .padStart(8, "0");
  return `${prefix}-${left}${right}`;
};

/** Must remain byte-for-byte compatible with runtime roomPlanProjectionFingerprint. */
export const runtimeRoomPlanFingerprint = (plan) => fingerprint(plan, "rpf1");

/** Binds the separately sanitized browser projection to this publication. */
export const snapshotRoomPlanDigest = (plan) => fingerprint(plan, "lpf1");

export const roomPlanIntegrityEvidence = (rawPlan, snapshotPlan) => {
  if (!rawPlan || !snapshotPlan) return null;
  const declaredFingerprint =
    typeof rawPlan.projectionFingerprint === "string"
      ? rawPlan.projectionFingerprint
      : null;
  const runtimeComputedFingerprint = runtimeRoomPlanFingerprint(rawPlan);
  return {
    projectionScheme: "room-plan-fingerprint/v1",
    declaredFingerprint,
    runtimeComputedFingerprint,
    runtimeVerified:
      declaredFingerprint !== null &&
      declaredFingerprint === runtimeComputedFingerprint,
    snapshotDigestScheme: "screeps-lab-room-plan-digest/v1",
    snapshotDigest: snapshotRoomPlanDigest(snapshotPlan),
  };
};
