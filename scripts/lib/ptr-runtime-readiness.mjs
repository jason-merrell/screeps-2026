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
  const cpuShardReported =
    requestOk &&
    body.cpuShard !== null &&
    typeof body.cpuShard === "object" &&
    !Array.isArray(body.cpuShard);
  const shardAllocation = cpuShardReported
    ? Object.fromEntries(
        Object.entries(body.cpuShard)
          .filter(
            ([key, value]) =>
              /^shard\d+$/i.test(key) && finiteNumber(value) !== null,
          )
          .map(([key, value]) => [key.toLowerCase(), value])
          .sort(([left], [right]) => left.localeCompare(right)),
      )
    : {};
  const promoPeriodUntil = finiteNumber(body.promoPeriodUntil);

  return {
    requestOk,
    httpStatus: integer(response?.status) ?? 0,
    totalCpu: finiteNumber(body.cpu),
    cpuShardReported,
    shardAllocation,
    cpuUnlockWindowActive:
      promoPeriodUntil === null || !Number.isFinite(collectedAtMs)
        ? null
        : promoPeriodUntil > collectedAtMs,
    active: typeof body.active === "boolean" ? body.active : null,
    blocked: typeof body.blocked === "boolean" ? body.blocked : null,
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
  if (!account.cpuShardReported) return null;
  if (!Object.hasOwn(account.shardAllocation, shard)) return false;
  return account.shardAllocation[shard] > 0;
};

const summarizeTrace = (response) => {
  const decoded = accepted(response)
    ? decodeScreepsSegment(response.body)
    : null;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    return null;

  const plans = Array.isArray(decoded.settlement?.plans)
    ? decoded.settlement.plans.map((plan) => ({
        roomName: normalizeRoomName(plan?.roomName),
        developmentEvaluatedAt: integer(plan?.development?.evaluatedAt),
      }))
    : null;

  return {
    version: integer(decoded.version),
    tick: integer(decoded.tick),
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
    ? integer(gameTimeResponse.body.time)
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
    "accountOperational",
    !account.requestOk
      ? null
      : !(account.active === false || account.blocked === true),
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
    trace === null || gameTime === null
      ? null
      : traceLag !== null &&
          traceLag >= -maximumTraceLead &&
          traceLag <= maximumTraceLag,
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
    schema: "screeps-ptr-runtime-readiness/v1",
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
