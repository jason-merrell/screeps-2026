import {
  decodeScreepsMemory,
  decodeScreepsSegment,
  summarizeMemoryResponse,
  summarizeSegmentResponse,
} from "./screeps-memory.mjs";

// Kept in lockstep with packages/runtime/src/memory/schema.ts by a contract
// test so a schema migration cannot silently make every PTR preflight fail.
export const DEFAULT_PTR_MEMORY_VERSION = 10;

const finiteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const integer = (value) => (Number.isInteger(value) ? value : null);

const nonNegativeInteger = (value) => {
  const normalized = integer(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
};

const operationalFlag = (value) => {
  if (typeof value === "boolean") return value;
  const numeric = finiteNumber(value);
  return numeric === null ? null : numeric > 0;
};

const boundedString = (value, maximumLength = 120) =>
  typeof value === "string" && value.length > 0
    ? value.slice(0, maximumLength)
    : null;

const explicitError = (body) =>
  body !== null &&
  typeof body === "object" &&
  Object.hasOwn(body, "error") &&
  body.error !== null &&
  body.error !== "";

const accepted = (response) =>
  response?.ok === true &&
  response?.httpOk === true &&
  Number.isInteger(response?.status) &&
  response.status >= 200 &&
  response.status < 300 &&
  response?.body?.ok === 1 &&
  !explicitError(response.body);

const normalizeRoomName = (value) => {
  if (typeof value === "string") return value.toUpperCase();
  if (value && typeof value._id === "string") return value._id.toUpperCase();
  if (value && typeof value.room === "string") return value.room.toUpperCase();
  return null;
};

const safeTransportSummary = (response, summarize) => ({
  ...summarize(response),
  ok: accepted(response),
  httpOk: response?.httpOk === true,
  status: integer(response?.status) ?? 0,
});

export function sanitizePtrAccountResponse(
  response,
  collectedAtMs = Date.now(),
) {
  const requestOk = accepted(response);
  const body =
    requestOk && response.body && typeof response.body === "object"
      ? response.body
      : {};
  const totalCpuReported = requestOk && Object.hasOwn(body, "cpu");
  const totalCpu = finiteNumber(body.cpu);
  const totalCpuValid =
    !totalCpuReported || (totalCpu !== null && totalCpu >= 0);
  const cpuShardFieldReported = requestOk && Object.hasOwn(body, "cpuShard");
  const cpuShardReported =
    cpuShardFieldReported &&
    body.cpuShard !== null &&
    typeof body.cpuShard === "object" &&
    !Array.isArray(body.cpuShard);
  const duplicateShardAllocations = new Set();
  const invalidShardAllocations = new Set();
  const seenShardAllocations = new Set();
  const shardAllocation = cpuShardReported
    ? Object.fromEntries(
        Object.entries(body.cpuShard)
          .filter(([key]) => /^shard\d+$/i.test(key))
          .flatMap(([key, value]) => {
            const normalizedKey = key.toLowerCase();
            if (seenShardAllocations.has(normalizedKey)) {
              duplicateShardAllocations.add(normalizedKey);
              return [];
            }
            seenShardAllocations.add(normalizedKey);
            const normalizedValue = finiteNumber(value);
            if (normalizedValue === null || normalizedValue < 0) {
              invalidShardAllocations.add(normalizedKey);
              return [];
            }
            return [[normalizedKey, normalizedValue]];
          })
          .sort(([left], [right]) => left.localeCompare(right)),
      )
    : {};
  const promoPeriodUntil = finiteNumber(body.promoPeriodUntil);
  const activeReported = requestOk && Object.hasOwn(body, "active");
  const blockedReported = requestOk && Object.hasOwn(body, "blocked");
  const active = operationalFlag(body.active);
  const blocked = operationalFlag(body.blocked);
  const shardAllocationTotal = Object.values(shardAllocation).reduce(
    (sum, allocation) => sum + allocation,
    0,
  );

  return {
    requestOk,
    httpStatus: integer(response?.status) ?? 0,
    totalCpuReported,
    totalCpu,
    totalCpuValid,
    cpuShardFieldReported,
    cpuShardReported,
    shardAllocation,
    shardAllocationTotal,
    duplicateShardAllocations: [...duplicateShardAllocations].sort(),
    invalidShardAllocations: [...invalidShardAllocations].sort(),
    cpuShardUpdatedTime: finiteNumber(body.cpuShardUpdatedTime),
    cpuUnlockWindowActive:
      promoPeriodUntil === null || !Number.isFinite(collectedAtMs)
        ? null
        : promoPeriodUntil > collectedAtMs,
    // Screeps stores `active` as an activation lease/counter (0 means idle),
    // although some compatible servers expose a boolean. Normalize both
    // shapes so a numeric zero can never pass the operational preflight.
    activeReported,
    activeValid: !activeReported || active !== null,
    active,
    blockedReported,
    blockedValid: !blockedReported || blocked !== null,
    blocked,
  };
}

export function sanitizePtrBranchesResponse(response) {
  const requestOk = accepted(response);
  const list =
    requestOk && Array.isArray(response.body.list)
      ? response.body.list.map((candidate) => ({
          branch: boundedString(candidate?.branch, 80),
          activeWorld: candidate?.activeWorld === true,
          activeSim: candidate?.activeSim === true,
        }))
      : [];

  return {
    ok: requestOk,
    httpOk: response?.httpOk === true,
    status: integer(response?.status) ?? 0,
    body: {
      ok: requestOk ? 1 : 0,
      list,
    },
  };
}

const resolveCpuAllocation = (account, shard) => {
  if (!account.requestOk) return null;
  if (!account.totalCpuValid) return null;
  if (
    account.invalidShardAllocations.length > 0 ||
    account.duplicateShardAllocations.length > 0
  ) {
    return null;
  }
  if (
    account.totalCpu !== null &&
    account.shardAllocationTotal > account.totalCpu
  ) {
    return null;
  }
  const targetReported = Object.hasOwn(account.shardAllocation, shard);
  if (account.totalCpu === 0) {
    if (targetReported && account.shardAllocation[shard] > 0) return null;
    return false;
  }
  if (!account.cpuShardFieldReported) return null;
  if (!account.cpuShardReported) return null;
  if (!targetReported) return false;
  return account.shardAllocation[shard] > 0;
};

const resolveAccountNotExplicitlyDisabled = (account) => {
  if (!account.requestOk) return null;
  if (!account.activeValid || !account.blockedValid) return null;
  if (account.active === false || account.blocked === true) return false;
  return true;
};

const summarizeTrace = (response) => {
  const decoded = accepted(response)
    ? decodeScreepsSegment(response.body)
    : null;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    return null;

  const bootHeartbeat =
    decoded.schema === "screeps-runtime-boot-heartbeat/v1" &&
    decoded.boot &&
    typeof decoded.boot === "object" &&
    !Array.isArray(decoded.boot)
      ? {
          phase: boundedString(decoded.boot.phase, 40),
          sourceMemoryVersion: nonNegativeInteger(
            decoded.boot.sourceMemoryVersion,
          ),
          targetMemoryVersion: nonNegativeInteger(
            decoded.boot.targetMemoryVersion,
          ),
          fromVersion: nonNegativeInteger(decoded.boot.fromVersion),
          toVersion: nonNegativeInteger(decoded.boot.toVersion),
          progressed:
            typeof decoded.boot.progressed === "boolean"
              ? decoded.boot.progressed
              : null,
          degraded:
            typeof decoded.boot.degraded === "boolean"
              ? decoded.boot.degraded
              : null,
          settlementAttempts: nonNegativeInteger(
            decoded.boot.settlementAttempts,
          ),
          settlementRetryTick: nonNegativeInteger(
            decoded.boot.settlementRetryTick,
          ),
          reason: boundedString(decoded.boot.reason, 240),
        }
      : null;

  const plans = Array.isArray(decoded.settlement?.plans)
    ? decoded.settlement.plans.map((plan) => ({
        roomName: normalizeRoomName(plan?.roomName),
        developmentEvaluatedAt: nonNegativeInteger(
          plan?.development?.evaluatedAt,
        ),
      }))
    : null;

  return {
    kind:
      bootHeartbeat !== null
        ? "boot-heartbeat"
        : decoded.version === 1
          ? "runtime-trace"
          : "unknown",
    version: integer(decoded.version),
    tick: nonNegativeInteger(decoded.tick),
    runtimeSha: boundedString(decoded.runtimeSha, 80),
    memoryVersion: integer(decoded.memoryVersion),
    cpu:
      decoded.cpu && typeof decoded.cpu === "object"
        ? {
            limit: finiteNumber(decoded.cpu.limit),
            bucket: finiteNumber(decoded.cpu.bucket),
            total: finiteNumber(decoded.cpu.total),
          }
        : null,
    boot: bootHeartbeat,
    plans,
  };
};

const pushCheck = (checks, blockers, missingEvidence, name, value) => {
  checks[name] = value;
  if (value === false) blockers.push(name);
  if (value === null) missingEvidence.push(name);
};

export function buildPtrRuntimeReadiness({
  expectedBranch,
  expectedRuntimeSha,
  expectedMemoryVersion,
  shard,
  room,
  worldStatusResponse,
  branchesResponse,
  accountResponse,
  gameTimeResponse,
  memoryVersionResponse,
  observabilityResponse,
  roomsResponse,
  roomObjectsResponse,
  observabilitySegment = 99,
  maximumTraceLag = 5,
  maximumTraceLead = 1,
  collectedAtMs = Date.now(),
}) {
  const normalizedExpectedBranch =
    typeof expectedBranch === "string" ? expectedBranch.trim() : "";
  if (normalizedExpectedBranch.length === 0) {
    throw new Error("PTR readiness requires an expected branch");
  }
  if (!/^[0-9a-f]{40}$/i.test(expectedRuntimeSha || "")) {
    throw new Error("PTR readiness requires a 40-character runtime SHA");
  }
  if (!Number.isInteger(expectedMemoryVersion) || expectedMemoryVersion < 1) {
    throw new Error("PTR readiness requires a positive memory version");
  }
  if (!/^shard\d+$/i.test(shard || "")) {
    throw new Error("PTR readiness requires a shard name");
  }
  if (!/^[WE]\d+[NS]\d+$/i.test(room || "")) {
    throw new Error("PTR readiness requires a room name");
  }
  if (
    !Number.isInteger(observabilitySegment) ||
    observabilitySegment < 0 ||
    observabilitySegment > 99
  ) {
    throw new Error(
      "PTR readiness requires an observability segment from 0 through 99",
    );
  }
  if (!Number.isInteger(maximumTraceLag) || maximumTraceLag < 0) {
    throw new Error("PTR readiness requires a non-negative maximum trace lag");
  }
  if (!Number.isInteger(maximumTraceLead) || maximumTraceLead < 0) {
    throw new Error("PTR readiness requires a non-negative maximum trace lead");
  }
  if (!Number.isFinite(collectedAtMs) || collectedAtMs < 0) {
    throw new Error("PTR readiness requires a finite collection time");
  }

  const normalizedRoom = room.toUpperCase();
  const normalizedShard = shard.toLowerCase();
  const account = sanitizePtrAccountResponse(accountResponse, collectedAtMs);
  const sanitizedBranches = sanitizePtrBranchesResponse(branchesResponse);
  const branchList = accepted(sanitizedBranches)
    ? sanitizedBranches.body.list
    : null;
  const activeWorldRows =
    branchList?.filter((candidate) => candidate.activeWorld === true) ?? null;
  const activeBranch =
    activeWorldRows?.length === 1 &&
    typeof activeWorldRows[0].branch === "string"
      ? activeWorldRows[0].branch
      : null;
  const activeBranchMatches =
    activeWorldRows === null
      ? null
      : activeWorldRows.length === 1 && activeBranch !== null
        ? activeBranch === normalizedExpectedBranch
        : false;

  const gameTime = accepted(gameTimeResponse)
    ? nonNegativeInteger(gameTimeResponse.body.time)
    : null;
  const decodedMemoryVersion = accepted(memoryVersionResponse)
    ? decodeScreepsMemory(memoryVersionResponse.body)
    : null;
  const memoryVersion = integer(decodedMemoryVersion);
  const trace = summarizeTrace(observabilityResponse);
  const traceLag =
    gameTime !== null && trace?.tick !== null && trace?.tick !== undefined
      ? gameTime - trace.tick
      : null;

  let roomListed = null;
  if (
    accepted(roomsResponse) &&
    roomsResponse.body.shards &&
    typeof roomsResponse.body.shards === "object" &&
    !Array.isArray(roomsResponse.body.shards)
  ) {
    if (!Object.hasOwn(roomsResponse.body.shards, normalizedShard)) {
      roomListed = false;
    } else if (Array.isArray(roomsResponse.body.shards[normalizedShard])) {
      roomListed = roomsResponse.body.shards[normalizedShard]
        .map(normalizeRoomName)
        .includes(normalizedRoom);
    }
  }

  const objects =
    accepted(roomObjectsResponse) &&
    Array.isArray(roomObjectsResponse.body.objects)
      ? roomObjectsResponse.body.objects
      : null;
  const controllers =
    objects?.filter((object) => object?.type === "controller") ?? null;
  const accountId =
    accepted(accountResponse) && typeof accountResponse.body._id === "string"
      ? accountResponse.body._id
      : null;
  const controllerOwned =
    controllers === null
      ? null
      : controllers.length !== 1
        ? false
        : accountId === null
          ? null
          : controllers[0].user === accountId;

  const targetPlans =
    trace?.plans?.filter((plan) => plan.roomName === normalizedRoom) ?? null;
  const targetRoomEvaluated =
    trace === null || trace.plans === null
      ? null
      : targetPlans.length !== 1
        ? false
        : trace.tick === null
          ? false
          : targetPlans[0].developmentEvaluatedAt === trace.tick;

  const checks = {};
  const blockers = [];
  const missingEvidence = [];
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "worldStatusNormal",
    accepted(worldStatusResponse)
      ? worldStatusResponse.body.status === "normal"
      : null,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "activeBranchMatches",
    activeBranchMatches,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "cpuAllocationPositive",
    resolveCpuAllocation(account, normalizedShard),
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "accountNotExplicitlyDisabled",
    resolveAccountNotExplicitlyDisabled(account),
  );
  pushCheck(checks, blockers, missingEvidence, "roomListed", roomListed);
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "gameTimeAvailable",
    gameTime === null ? null : true,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "memoryVersionMatches",
    memoryVersion === null ? null : memoryVersion === expectedMemoryVersion,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "traceVersionMatches",
    trace === null ? null : trace.version === 1,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "traceCpuValid",
    trace === null
      ? null
      : trace.cpu !== null &&
          trace.cpu.limit !== null &&
          trace.cpu.limit > 0 &&
          trace.cpu.bucket !== null &&
          trace.cpu.bucket >= 0 &&
          trace.cpu.total !== null &&
          trace.cpu.total >= 0,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "runtimeShaMatches",
    trace === null
      ? null
      : trace.runtimeSha !== null &&
          trace.runtimeSha.toLowerCase() === expectedRuntimeSha.toLowerCase(),
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "traceMemoryVersionMatches",
    trace === null ? null : trace.memoryVersion === expectedMemoryVersion,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "traceFresh",
    trace === null || gameTime === null || traceLag === null
      ? null
      : traceLag >= -maximumTraceLead && traceLag <= maximumTraceLag,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "targetRoomEvaluated",
    targetRoomEvaluated,
  );
  pushCheck(
    checks,
    blockers,
    missingEvidence,
    "controllerOwned",
    controllerOwned,
  );

  return {
    schema: "screeps-ptr-runtime-readiness/v2",
    assurance: "runtime-preflight",
    releaseClosure: false,
    status:
      blockers.length > 0
        ? "blocked"
        : missingEvidence.length > 0
          ? "unverified"
          : "ready",
    expected: {
      branch: normalizedExpectedBranch,
      runtimeSha: expectedRuntimeSha.toLowerCase(),
      memoryVersion: expectedMemoryVersion,
      shard: normalizedShard,
      room: normalizedRoom,
      observabilitySegment,
      maximumTraceLag,
      maximumTraceLead,
    },
    checks,
    blockers,
    missingEvidence,
    evidence: {
      activeWorldCount: activeWorldRows?.length ?? null,
      activeBranch,
      gameTime,
      memoryVersion,
      trace,
      traceLag,
      roomListed,
      controllerOwned,
      account,
      memoryTransport: safeTransportSummary(
        memoryVersionResponse,
        summarizeMemoryResponse,
      ),
      observabilityTransport: safeTransportSummary(
        observabilityResponse,
        summarizeSegmentResponse,
      ),
    },
  };
}
