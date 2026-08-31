import { validateRoomDevelopmentPlan } from "./room-development";
import {
  ROOM_PLAN_HORIZON_RCL,
  ROOM_PLAN_PLANNER_REVISION,
  ROOM_PLAN_VERSION,
  type RoomPlan,
} from "./room-plan";

export const ROOM_PLAN_FINGERPRINT_SCHEME = "room-plan-fingerprint/v1";
export const SETTLEMENT_RETRY_BASE_TICKS = 5;
export const SETTLEMENT_RETRY_MAX_TICKS = 320;
export const SETTLEMENT_FAULT_ATTEMPT_LIMIT = 65_535;

const FAULT_REASON_LIMIT = 180;
const FAULT_REMEDIATION_LIMIT = 240;

export type SettlementProjectionFault = {
  kind: "room-plan-generation";
  status: "active" | "superseded";
  firstTick: number;
  lastTick: number;
  attemptCount: number;
  retryDelayTicks: number;
  nextRetryTick: number | null;
  reason: string;
  remediation: string;
  retainedPlannerRevision: number | null;
  targetPlannerRevision: number;
  retainedProjectionRevision: number | null;
  retainedProjectionFingerprint: string | null;
  resolvedAtTick?: number;
  supersededByRevision?: number;
  supersededByFingerprint?: string;
};

type JsonPrimitive = boolean | number | string | null;
type CanonicalJson =
  | JsonPrimitive
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
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
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function fingerprintContent(plan: RoomPlan): CanonicalJson {
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
}

function mixFingerprint(text: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    value = Math.imul(value ^ (code & 0xff), 0x01000193) >>> 0;
    value = Math.imul(value ^ (code >>> 8), 0x01000193) >>> 0;
  }
  return value;
}

/**
 * A compact deterministic identity for mutable projection content. This is a
 * non-cryptographic operational identity, not governance evidence, an
 * authority record, or an append-only digest.
 */
export function roomPlanProjectionFingerprint(plan: RoomPlan): string {
  const serialized = JSON.stringify(fingerprintContent(plan));
  const left = mixFingerprint(serialized, 0x811c9dc5)
    .toString(16)
    .padStart(8, "0");
  const right = mixFingerprint(serialized, 0x9e3779b9)
    .toString(16)
    .padStart(8, "0");
  return `rpf1-${left}${right}`;
}

const validRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

export const hasRoomPlanProjectionEpoch = (plan: RoomPlan): boolean =>
  validRevision(plan.projectionRevision) &&
  typeof plan.projectionFingerprint === "string" &&
  /^rpf1-[0-9a-f]{16}$/.test(plan.projectionFingerprint);

export const roomPlanProjectionMatches = (plan: RoomPlan): boolean =>
  hasRoomPlanProjectionEpoch(plan) &&
  plan.projectionFingerprint === roomPlanProjectionFingerprint(plan);

export type RoomPlanProjectionUsabilityStatus =
  | "missing"
  | "room_mismatch"
  | "version_horizon_mismatch"
  | "planner_stale"
  | "epoch_missing"
  | "fingerprint_mismatch"
  | "schema_invalid"
  | "invalidated"
  | "generation_fault"
  | "current";

export type RoomPlanProjectionAssessment =
  | {
      usable: true;
      status: "current";
      reason: string;
      plan: RoomPlan;
    }
  | {
      usable: false;
      status: Exclude<RoomPlanProjectionUsabilityStatus, "current">;
      reason: string;
      plan: null;
    };

export interface RoomPlanProjectionColonyState {
  roomPlan?: RoomPlan;
  settlementProjectionFault?: SettlementProjectionFault;
}

/**
 * The only runtime authority gate for mutable room-plan projections. A retained
 * plan may remain in Memory for diagnosis and recovery, but callers receive it
 * only when its full operational epoch is current and no generation fault is
 * active.
 */
function evaluateRoomPlanProjection(
  colony: RoomPlanProjectionColonyState | null | undefined,
  expectedRoomName: string,
): RoomPlanProjectionAssessment {
  const plan = colony?.roomPlan;
  const fault = colony?.settlementProjectionFault;
  if (fault?.status === "active") {
    return {
      usable: false,
      status: "generation_fault",
      reason: `Settlement projection generation fault is active: ${fault.reason}`,
      plan: null,
    };
  }
  if (!plan) {
    return {
      usable: false,
      status: "missing",
      reason: "No room-plan projection is retained",
      plan: null,
    };
  }
  if (plan.roomName !== expectedRoomName) {
    return {
      usable: false,
      status: "room_mismatch",
      reason: `Expected a projection for ${expectedRoomName}; retained projection belongs to ${String(plan.roomName)}`,
      plan: null,
    };
  }
  if (plan.invalidatedAt !== undefined) {
    return {
      usable: false,
      status: "invalidated",
      reason: `Room-plan projection was invalidated at tick ${plan.invalidatedAt}: ${plan.invalidationReason ?? "no reason recorded"}`,
      plan: null,
    };
  }
  if (
    plan.version !== ROOM_PLAN_VERSION ||
    plan.horizonRcl !== ROOM_PLAN_HORIZON_RCL
  ) {
    return {
      usable: false,
      status: "version_horizon_mismatch",
      reason: `Expected room plan v${ROOM_PLAN_VERSION}/RCL${ROOM_PLAN_HORIZON_RCL}; retained v${plan.version}/RCL${plan.horizonRcl}`,
      plan: null,
    };
  }
  if (plan.plannerRevision !== ROOM_PLAN_PLANNER_REVISION) {
    return {
      usable: false,
      status: "planner_stale",
      reason: `Expected planner revision ${ROOM_PLAN_PLANNER_REVISION}; retained ${plan.plannerRevision ?? "missing"}`,
      plan: null,
    };
  }
  if (!hasRoomPlanProjectionEpoch(plan)) {
    return {
      usable: false,
      status: "epoch_missing",
      reason: "Room-plan projection revision or fingerprint is missing/corrupt",
      plan: null,
    };
  }
  if (!roomPlanProjectionMatches(plan)) {
    return {
      usable: false,
      status: "fingerprint_mismatch",
      reason: "Room-plan projection content does not match its fingerprint",
      plan: null,
    };
  }
  const shapeIssue = operationalRoomPlanShapeIssue(plan);
  if (shapeIssue) {
    return {
      usable: false,
      status: "schema_invalid",
      reason: shapeIssue,
      plan: null,
    };
  }
  const developmentIssues = validateRoomDevelopmentPlan(plan);
  if (developmentIssues.length > 0) {
    return {
      usable: false,
      status: "schema_invalid",
      reason: `Room-plan development schema is invalid: ${developmentIssues[0]}`,
      plan: null,
    };
  }
  const snapshot = frozenOperationalProjectionSnapshot(plan);
  return {
    usable: true,
    status: "current",
    reason: "Room-plan projection epoch is current and fingerprint-valid",
    plan: snapshot,
  };
}

/**
 * Consumers receive an immutable value snapshot, never the retained Memory
 * object. Runtime writers can therefore publish ownership links, invalidation,
 * or normalization results through atomic copy-on-write assignments without a
 * prior reader freezing the object they are authorized to replace.
 */
function frozenOperationalProjectionSnapshot(plan: RoomPlan): RoomPlan {
  const cloneAndFreeze = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return Object.freeze(value.map((child) => cloneAndFreeze(child)));
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          cloneAndFreeze(child),
        ]),
      ),
    );
  };
  return cloneAndFreeze(plan) as RoomPlan;
}

interface RoomPlanProjectionCacheEntry {
  tick: number | null;
  plan: RoomPlan | undefined;
  fault: SettlementProjectionFault | undefined;
  projectionFingerprint: string | undefined;
  invalidatedAt: number | undefined;
  faultStatus: SettlementProjectionFault["status"] | undefined;
  assessment: RoomPlanProjectionAssessment;
}

const projectionAssessmentCache = new Map<
  string,
  RoomPlanProjectionCacheEntry
>();

/**
 * Memoized per room/tick/epoch so every planner shares one full blueprint
 * fingerprint and schema validation instead of serializing it per consumer.
 */
export function usableRoomPlanProjection(
  colony: RoomPlanProjectionColonyState | null | undefined,
  expectedRoomName: string,
): RoomPlanProjectionAssessment {
  const plan = colony?.roomPlan;
  const fault = colony?.settlementProjectionFault;
  const tick = typeof Game === "undefined" ? null : Game.time;
  const cached = projectionAssessmentCache.get(expectedRoomName);
  if (
    cached &&
    cached.tick === tick &&
    cached.plan === plan &&
    cached.fault === fault &&
    cached.projectionFingerprint === plan?.projectionFingerprint &&
    cached.invalidatedAt === plan?.invalidatedAt &&
    cached.faultStatus === fault?.status
  ) {
    return cached.assessment;
  }
  const assessment = evaluateRoomPlanProjection(colony, expectedRoomName);
  projectionAssessmentCache.set(expectedRoomName, {
    tick,
    plan,
    fault,
    projectionFingerprint: plan?.projectionFingerprint,
    invalidatedAt: plan?.invalidatedAt,
    faultStatus: fault?.status,
    assessment,
  });
  return assessment;
}

const isPoint = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    (point.x as number) >= 0 &&
    (point.x as number) <= 49 &&
    (point.y as number) >= 0 &&
    (point.y as number) <= 49
  );
};

function operationalRoomPlanShapeIssue(plan: RoomPlan): string | null {
  if (
    !Number.isSafeInteger(plan.generatedAt) ||
    typeof plan.generatedReason !== "string" ||
    !plan.generatedReason.trim()
  ) {
    return "Room-plan generation provenance is missing or invalid";
  }
  if (
    !plan.anchors ||
    !isPoint(plan.anchors.spawn) ||
    typeof plan.anchors.spawn?.name !== "string" ||
    !plan.anchors.spawn.name.trim() ||
    !isPoint(plan.anchors.hub) ||
    !Array.isArray(plan.anchors.sources) ||
    (plan.anchors.controller !== null &&
      (!isPoint(plan.anchors.controller) ||
        !isPoint(plan.anchors.controller?.service)))
  ) {
    return "Room-plan anchor topology is missing or invalid";
  }
  if (
    plan.anchors.sources.some(
      (source) =>
        typeof source?.sourceId !== "string" ||
        !source.sourceId.trim() ||
        !isPoint(source) ||
        !isPoint(source.container),
    )
  ) {
    return "Room-plan source-anchor topology is invalid";
  }
  if (
    !Array.isArray(plan.stages) ||
    !Array.isArray(plan.reservations) ||
    !Array.isArray(plan.structures) ||
    !Array.isArray(plan.roads) ||
    !plan.roadGraph ||
    !Array.isArray(plan.roadGraph.nodes) ||
    !Array.isArray(plan.roadGraph.edges) ||
    !plan.defense ||
    !Array.isArray(plan.defense.protectedTiles) ||
    !Array.isArray(plan.defense.perimeter)
  ) {
    return "Room-plan collections are missing or invalid";
  }
  const stablePointRecord = (value: {
    id?: unknown;
    x?: unknown;
    y?: unknown;
  }) => typeof value?.id === "string" && value.id.trim() && isPoint(value);
  if (
    plan.reservations.some(
      (reservation) =>
        !stablePointRecord(reservation) ||
        (reservation.kind !== "hard" && reservation.kind !== "soft") ||
        typeof reservation.reason !== "string",
    ) ||
    plan.structures.some(
      (structure) =>
        !stablePointRecord(structure) ||
        typeof structure.structureType !== "string" ||
        !structure.structureType ||
        !Number.isInteger(structure.minRcl) ||
        structure.minRcl < 1 ||
        structure.minRcl > ROOM_PLAN_HORIZON_RCL ||
        !Number.isFinite(structure.priority),
    ) ||
    plan.roads.some(
      (road) =>
        !stablePointRecord(road) ||
        !Number.isInteger(road.minRcl) ||
        road.minRcl < 1 ||
        road.minRcl > ROOM_PLAN_HORIZON_RCL,
    )
  ) {
    return "Room-plan placement records are invalid";
  }
  const nodeIds = new Set<string>();
  for (const node of plan.roadGraph.nodes) {
    if (!stablePointRecord(node) || nodeIds.has(node.id)) {
      return "Room-plan road nodes have invalid or duplicate identities";
    }
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of plan.roadGraph.edges) {
    if (
      typeof edge?.id !== "string" ||
      !edge.id.trim() ||
      edgeIds.has(edge.id) ||
      typeof edge.from !== "string" ||
      typeof edge.to !== "string" ||
      !nodeIds.has(edge.from) ||
      !nodeIds.has(edge.to) ||
      !Array.isArray(edge.tiles) ||
      edge.tiles.some((tile) => !isPoint(tile))
    ) {
      return "Room-plan road graph is invalid";
    }
    edgeIds.add(edge.id);
  }
  if (
    (plan.defense.strategy !== "pending-mincut" &&
      plan.defense.strategy !== "terrain-mincut-v1") ||
    plan.defense.protectedTiles.some((tile) => !isPoint(tile)) ||
    plan.defense.perimeter.some((tile) => !isPoint(tile))
  ) {
    return "Room-plan defensive envelope is invalid";
  }
  return null;
}

/** Add initial epoch metadata to a legacy projection without changing content. */
export function migrateRoomPlanProjection(plan: RoomPlan): RoomPlan {
  const migrated = {
    ...plan,
    plannerRevision: ROOM_PLAN_PLANNER_REVISION,
  };
  const projectionRevision = validRevision(migrated.projectionRevision)
    ? migrated.projectionRevision
    : 1;
  const projectionFingerprint = roomPlanProjectionFingerprint(migrated);
  return { ...migrated, projectionRevision, projectionFingerprint };
}

/** Stamp a newly generated projection as the next operational epoch. */
export function advanceRoomPlanProjection(
  plan: RoomPlan,
  previous?: RoomPlan,
): RoomPlan {
  const previousRevision = validRevision(previous?.projectionRevision)
    ? previous.projectionRevision
    : 0;
  const current = {
    ...plan,
    plannerRevision: ROOM_PLAN_PLANNER_REVISION,
    projectionRevision: previousRevision + 1,
  };
  return {
    ...current,
    projectionFingerprint: roomPlanProjectionFingerprint(current),
  };
}

export function settlementRetryDelay(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  return Math.min(
    SETTLEMENT_RETRY_MAX_TICKS,
    SETTLEMENT_RETRY_BASE_TICKS * 2 ** exponent,
  );
}

export const settlementRetryDue = (
  fault: SettlementProjectionFault | undefined,
  tick: number,
): boolean =>
  fault?.status !== "active" ||
  fault.nextRetryTick === null ||
  tick >= fault.nextRetryTick;

const boundedText = (value: string, limit: number): string =>
  value.replace(/\s+/g, " ").trim().slice(0, limit);

function failureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    boundedText(raw, FAULT_REASON_LIMIT) ||
    "Room-plan generation failed without a diagnostic message"
  );
}

export function recordSettlementProjectionFault(
  previous: SettlementProjectionFault | undefined,
  retainedPlan: RoomPlan | undefined,
  tick: number,
  error: unknown,
): SettlementProjectionFault {
  const continues = previous?.status === "active";
  const attemptCount = Math.min(
    continues ? previous.attemptCount + 1 : 1,
    SETTLEMENT_FAULT_ATTEMPT_LIMIT,
  );
  const retryDelayTicks = settlementRetryDelay(attemptCount);
  return {
    kind: "room-plan-generation",
    status: "active",
    firstTick: continues ? previous.firstTick : tick,
    lastTick: tick,
    attemptCount,
    retryDelayTicks,
    nextRetryTick: tick + retryDelayTicks,
    reason: failureReason(error),
    remediation: boundedText(
      "Inspect visible terrain, natural objects, incompatible occupancy, and envelope limits; clear the blocker or explicitly invalidate after correcting room geometry.",
      FAULT_REMEDIATION_LIMIT,
    ),
    retainedPlannerRevision: Number.isSafeInteger(retainedPlan?.plannerRevision)
      ? (retainedPlan?.plannerRevision ?? null)
      : null,
    targetPlannerRevision: ROOM_PLAN_PLANNER_REVISION,
    retainedProjectionRevision: validRevision(retainedPlan?.projectionRevision)
      ? retainedPlan.projectionRevision
      : null,
    retainedProjectionFingerprint:
      typeof retainedPlan?.projectionFingerprint === "string"
        ? retainedPlan.projectionFingerprint
        : null,
  };
}

export function supersedeSettlementProjectionFault(
  fault: SettlementProjectionFault | undefined,
  replacement: RoomPlan,
  tick: number,
): SettlementProjectionFault | undefined {
  if (fault?.status !== "active") return fault;
  return {
    ...fault,
    status: "superseded",
    nextRetryTick: null,
    resolvedAtTick: tick,
    ...(validRevision(replacement.projectionRevision)
      ? { supersededByRevision: replacement.projectionRevision }
      : {}),
    ...(typeof replacement.projectionFingerprint === "string"
      ? { supersededByFingerprint: replacement.projectionFingerprint }
      : {}),
  };
}
