import { createHash, randomBytes } from "node:crypto";

import {
  activatePtrRuntime,
  DEFAULT_PTR_REQUEST_TIMEOUT_MS,
} from "./ptr-activation.mjs";
import { decodeScreepsMemory } from "./screeps-memory.mjs";

export const PTR_CANARY_MEMORY_KEY = "__ptrExecutionCanary";
export const PTR_CANARY_MIN_SHARD_TICKS = 3;

const PTR_PREFIX = "/ptr";
const ACTIVE_NAME = "activeWorld";
const DEFAULT_MAX_SAMPLES = 8;

class PtrCanaryError extends Error {
  constructor(stage, code) {
    super(`${stage}: ${code}`);
    this.name = "PtrCanaryError";
    this.stage = stage;
    this.code = code;
  }
}

const failureFrom = (error, fallbackStage = "unexpected") => ({
  stage:
    error instanceof PtrCanaryError && typeof error.stage === "string"
      ? error.stage
      : fallbackStage,
  code:
    error instanceof PtrCanaryError && typeof error.code === "string"
      ? error.code
      : "unexpected-error",
});

const isSafeTick = (value) => Number.isSafeInteger(value) && Number(value) >= 0;

const requireString = (value, label, pattern) => {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new PtrCanaryError("configuration", `invalid-${label}`);
  }
  return value;
};

const hasExplicitError = (body) =>
  body !== null &&
  typeof body === "object" &&
  Object.hasOwn(body, "error") &&
  body.error !== null &&
  body.error !== "";

const parseJsonResponse = async (response, stage) => {
  const text = await response.text();
  if (!text) throw new PtrCanaryError(stage, "empty-response");

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new PtrCanaryError(stage, "invalid-json");
  }

  if (!response.ok) {
    throw new PtrCanaryError(stage, `http-${response.status}`);
  }
  if (body?.ok !== 1 || hasExplicitError(body)) {
    throw new PtrCanaryError(stage, "api-rejected");
  }
  return body;
};

const createClient = ({ token, host, fetchImpl, requestTimeoutMs }) => {
  if (typeof token !== "string" || token.length === 0) {
    throw new PtrCanaryError("configuration", "missing-token");
  }
  if (typeof fetchImpl !== "function") {
    throw new PtrCanaryError("configuration", "missing-fetch");
  }
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 60_000
  ) {
    throw new PtrCanaryError("configuration", "invalid-request-timeout");
  }

  let baseUrl;
  try {
    baseUrl = new URL(host);
  } catch {
    throw new PtrCanaryError("configuration", "invalid-host");
  }

  const request = async (
    path,
    { method = "GET", query = {}, body, stage } = {},
  ) => {
    const url = new URL(`${PTR_PREFIX}${path}`, baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    const pending = (async () => {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined
            ? {}
            : { "Content-Type": "application/json; charset=utf-8" }),
          "X-Token": token,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      return parseJsonResponse(response, stage);
    })();
    const deadline = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new PtrCanaryError(stage, "request-timeout"));
      }, requestTimeoutMs);
    });

    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      if (error instanceof PtrCanaryError) throw error;
      if (timedOut || controller.signal.aborted) {
        throw new PtrCanaryError(stage, "request-timeout");
      }
      throw new PtrCanaryError(stage, "network-error");
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const listBranches = async () => {
    const body = await request("/api/user/branches", {
      query: { withCode: 0 },
      stage: "list-branches",
    });
    if (!Array.isArray(body.list)) {
      throw new PtrCanaryError("list-branches", "missing-list");
    }

    // The official response can contain module source and opaque account
    // metadata. Reduce it immediately to the activation facts the canary uses.
    return body.list
      .filter((candidate) => typeof candidate?.branch === "string")
      .map((candidate) => ({
        branch: candidate.branch,
        activeWorld: candidate.activeWorld === true,
        activeSim: candidate.activeSim === true,
      }));
  };

  const requireActiveBranch = async (expectedBranch, stage) => {
    const branches = await listBranches();
    const active = branches.filter((candidate) => candidate.activeWorld);
    if (active.length !== 1 || active[0].branch !== expectedBranch) {
      throw new PtrCanaryError(stage, "active-branch-mismatch");
    }
    return branches;
  };

  return {
    listBranches,
    requireActiveBranch,
    async createBranch(branch, source) {
      await request("/api/user/clone-branch", {
        method: "POST",
        body: { newName: branch, defaultModules: { main: source } },
        stage: "create-canary-branch",
      });
      const branches = await listBranches();
      const created = branches.filter(
        (candidate) => candidate.branch === branch,
      );
      if (created.length !== 1 || created[0].activeWorld) {
        throw new PtrCanaryError("create-canary-branch", "branch-not-inactive");
      }
    },
    async uploadAndVerifyBranch(branch, source) {
      await request("/api/user/code", {
        method: "POST",
        body: { branch, modules: { main: source } },
        stage: "upload-canary-code",
      });
      const body = await request("/api/user/code", {
        query: { branch },
        stage: "verify-canary-code",
      });
      if (typeof body.modules?.main !== "string") {
        throw new PtrCanaryError("verify-canary-code", "missing-main-module");
      }
      if (body.modules.main !== source) {
        throw new PtrCanaryError("verify-canary-code", "module-mismatch");
      }
    },
    async setActiveBranch(branch) {
      await request("/api/user/set-active-branch", {
        method: "POST",
        body: { activeName: ACTIVE_NAME, branch },
        stage: "set-active-branch",
      });
      await requireActiveBranch(branch, "verify-active-branch");
    },
    async deleteBranch(branch) {
      const before = await listBranches();
      const candidate = before.find((entry) => entry.branch === branch);
      if (!candidate) return true;
      if (candidate.activeWorld || candidate.activeSim) {
        throw new PtrCanaryError("delete-canary-branch", "branch-still-active");
      }
      await request("/api/user/delete-branch", {
        method: "POST",
        body: { branch },
        stage: "delete-canary-branch",
      });
      const after = await listBranches();
      if (after.some((entry) => entry.branch === branch)) {
        throw new PtrCanaryError(
          "delete-canary-branch",
          "branch-still-present",
        );
      }
      return true;
    },
    async requestMemoryNeutralization(shard) {
      await request("/api/user/memory", {
        method: "POST",
        body: { path: PTR_CANARY_MEMORY_KEY, value: null, shard },
        stage: "request-memory-neutralization",
      });
    },
    async gameTime(shard) {
      const body = await request("/api/game/time", {
        query: { shard },
        stage: "sample-game-time",
      });
      if (!isSafeTick(body.time)) {
        throw new PtrCanaryError("sample-game-time", "invalid-tick");
      }
      return body.time;
    },
    async memory(shard, nonce) {
      const body = await request("/api/user/memory", {
        query: { path: PTR_CANARY_MEMORY_KEY, shard },
        stage: "sample-canary-memory",
      });
      return sanitizeCanaryMemory(decodeScreepsMemory(body), nonce);
    },
    async roomEngine(room, shard, shardTick) {
      const body = await request("/api/game/room-objects", {
        query: { room, shard },
        stage: "sample-room-engine",
      });
      if (!Array.isArray(body.objects)) {
        throw new PtrCanaryError("sample-room-engine", "missing-objects");
      }
      return sanitizeRoomEngine(body.objects, shardTick);
    },
  };
};

const numericRange = (values) => {
  const accepted = values.filter(isSafeTick);
  return accepted.length === 0
    ? null
    : {
        count: accepted.length,
        minimum: Math.min(...accepted),
        maximum: Math.max(...accepted),
      };
};

const sanitizeRoomEngine = (objects, shardTick) => {
  const controllers = objects.filter((object) => object?.type === "controller");
  const controller = controllers[0] ?? null;
  const byType = (type) => objects.filter((object) => object?.type === type);
  const creeps = byType("creep");
  const sources = byType("source");
  const minerals = byType("mineral");
  const roads = byType("road");
  const overdueCreeps = creeps.filter(
    (creep) => isSafeTick(creep?.ageTime) && creep.ageTime <= shardTick,
  );
  const overdueSources = sources.filter(
    (source) =>
      isSafeTick(source?.nextRegenerationTime) &&
      source.nextRegenerationTime <= shardTick &&
      Number.isFinite(source?.energy) &&
      Number.isFinite(source?.energyCapacity) &&
      source.energy < source.energyCapacity,
  );
  const overdueRoads = roads.filter(
    (road) =>
      isSafeTick(road?.nextDecayTime) && road.nextDecayTime <= shardTick,
  );
  const overdueTotal =
    overdueCreeps.length + overdueSources.length + overdueRoads.length;
  const timeBearingObjectCount =
    creeps.filter((creep) => isSafeTick(creep?.ageTime)).length +
    sources.filter((source) => isSafeTick(source?.nextRegenerationTime))
      .length +
    roads.filter((road) => isSafeTick(road?.nextDecayTime)).length;

  return {
    observedObjectCount: objects.length,
    controllerCount: controllers.length,
    controllerLevel: Number.isSafeInteger(controller?.level)
      ? controller.level
      : null,
    timestamps: {
      controllerDowngrade: isSafeTick(controller?.downgradeTime)
        ? controller.downgradeTime
        : null,
      controllerSafeMode: isSafeTick(controller?.safeMode)
        ? controller.safeMode
        : null,
      controllerSafeModeCooldown: isSafeTick(controller?.safeModeCooldown)
        ? controller.safeModeCooldown
        : null,
      reservationEnd: isSafeTick(controller?.reservation?.endTime)
        ? controller.reservation.endTime
        : null,
      creepAge: numericRange(creeps.map((creep) => creep?.ageTime)),
      creepDeath: numericRange(creeps.map((creep) => creep?.deathTime)),
      sourceRegeneration: numericRange(
        sources.map((source) => source?.nextRegenerationTime),
      ),
      mineralRegeneration: numericRange(
        minerals.map((mineral) => mineral?.nextRegenerationTime),
      ),
      roadDecay: numericRange(roads.map((road) => road?.nextDecayTime)),
      objectDecay: numericRange(objects.map((object) => object?.decayTime)),
      nukeLand: numericRange(objects.map((object) => object?.landTime)),
    },
    processing: {
      classification:
        overdueTotal > 0
          ? "blocked-overdue-obligations"
          : timeBearingObjectCount > 0
            ? "no-overdue-obligation-observed"
            : "unverified-no-time-bearing-objects",
      timeBearingObjectCount,
      overdueTotal,
      overdue: {
        creepExpiry: {
          count: overdueCreeps.length,
          oldestTimestamp:
            numericRange(overdueCreeps.map((creep) => creep.ageTime))
              ?.minimum ?? null,
        },
        sourceRegeneration: {
          count: overdueSources.length,
          oldestTimestamp:
            numericRange(
              overdueSources.map((source) => source.nextRegenerationTime),
            )?.minimum ?? null,
        },
        roadDecay: {
          count: overdueRoads.length,
          oldestTimestamp:
            numericRange(overdueRoads.map((road) => road.nextDecayTime))
              ?.minimum ?? null,
        },
      },
    },
  };
};

const sanitizeCanaryMemory = (value, nonce) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      available: false,
      nonceMatches: false,
      runs: null,
      loopTick: null,
      roomTick: null,
      roomVisible: null,
      history: [],
    };
  }

  const history = Array.isArray(value.history)
    ? value.history.slice(-8).flatMap((entry) => {
        if (!isSafeTick(entry?.tick)) return [];
        return [
          {
            tick: entry.tick,
            roomTick: isSafeTick(entry.roomTick) ? entry.roomTick : null,
            roomVisible: entry.roomVisible === true,
          },
        ];
      })
    : [];

  return {
    available: true,
    nonceMatches: value.nonce === nonce,
    runs:
      Number.isSafeInteger(value.runs) && value.runs >= 0 ? value.runs : null,
    loopTick: isSafeTick(value.loopTick) ? value.loopTick : null,
    roomTick: isSafeTick(value.roomTick) ? value.roomTick : null,
    roomVisible: value.roomVisible === true,
    history,
  };
};

const distinctSortedTicks = (values) =>
  [...new Set(values.filter(isSafeTick))].sort((left, right) => left - right);

const evaluateSamples = (samples, minimumShardTicks) => {
  const shardTicks = distinctSortedTicks(
    samples.map((sample) => sample.shardTick),
  );
  const boundSamples = samples.filter((sample) => sample.memory.nonceMatches);
  const canaryLoopTicks = distinctSortedTicks(
    boundSamples.flatMap((sample) =>
      sample.memory.history.map((entry) => entry.tick),
    ),
  );
  const visibleRoomTicks = distinctSortedTicks(
    boundSamples.flatMap((sample) =>
      sample.memory.history.flatMap((entry) =>
        entry.roomVisible && entry.roomTick === entry.tick ? [entry.tick] : [],
      ),
    ),
  );

  const reasons = [];
  if (shardTicks.length < minimumShardTicks) {
    reasons.push("insufficient-distinct-shard-ticks");
  }
  if (canaryLoopTicks.length < minimumShardTicks) {
    reasons.push("insufficient-canary-loop-ticks");
  }
  if (visibleRoomTicks.length < minimumShardTicks) {
    reasons.push("insufficient-room-visibility-ticks");
  }

  return {
    status: reasons.length === 0 ? "passed" : "failed",
    minimumShardTicks,
    shardTicks,
    canaryLoopTicks,
    visibleRoomTicks,
    reasons,
  };
};

const evaluateRoomEngine = (samples) => {
  const classifications = samples.map(
    (sample) => sample.roomEngine.processing.classification,
  );
  const blockedSamples = samples
    .filter(
      (sample) =>
        sample.roomEngine.processing.classification ===
        "blocked-overdue-obligations",
    )
    .map((sample) => ({
      shardTick: sample.shardTick,
      overdue: sample.roomEngine.processing.overdue,
      overdueTotal: sample.roomEngine.processing.overdueTotal,
    }));
  const consistentSamples = classifications.filter(
    (classification) => classification === "no-overdue-obligation-observed",
  ).length;
  const status =
    blockedSamples.length > 0
      ? "blocked"
      : consistentSamples === samples.length && samples.length > 0
        ? "consistent"
        : "unverified";

  return {
    status,
    // Absence of an overdue object is consistency evidence, not affirmative
    // proof that the room processor ran. Only a contradiction is decisive.
    processingHealthy: status === "blocked" ? false : null,
    sampleCount: samples.length,
    consistentSamples,
    blockedSamples,
    classifications,
  };
};

export function ptrExecutionCanaryBranch(requestId) {
  const suffix = String(requestId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(-16);
  if (suffix.length === 0) {
    throw new PtrCanaryError("configuration", "invalid-request-id");
  }
  return `ptr-canary-${suffix}`;
}

export function buildPtrExecutionCanarySource({ nonce, room }) {
  requireString(nonce, "nonce", /^[a-z0-9]{16,64}$/);
  requireString(room, "room", /^[WE]\d+[NS]\d+$/);
  const key = JSON.stringify(PTR_CANARY_MEMORY_KEY);
  const encodedNonce = JSON.stringify(nonce);
  const encodedRoom = JSON.stringify(room);
  return `module.exports.loop=function(){var k=${key},n=${encodedNonce},c=Memory[k];if(!c||c.nonce!==n)c=Memory[k]={nonce:n,runs:0,history:[]};var r=Game.rooms[${encodedRoom}],v=!!r,t=Game.time;c.runs+=1;c.loopTick=t;c.roomTick=v?t:null;c.roomVisible=v;c.history.push({tick:t,roomTick:v?t:null,roomVisible:v});if(c.history.length>4)c.history.shift()};`;
}

export async function restorePtrExecutionCanary({
  token,
  host = "https://screeps.com",
  restoreBranch = "default",
  canaryBranch,
  shard,
  fetchImpl = fetch,
  requestTimeoutMs = DEFAULT_PTR_REQUEST_TIMEOUT_MS,
}) {
  requireString(restoreBranch, "restore-branch", /^[A-Za-z0-9_.-]{1,30}$/);
  requireString(canaryBranch, "canary-branch", /^ptr-canary-[a-z0-9]{1,16}$/);
  requireString(shard, "shard", /^shard\d+$/);
  if (restoreBranch === canaryBranch) {
    throw new PtrCanaryError("configuration", "restore-branch-is-canary");
  }

  const client = createClient({ token, host, fetchImpl, requestTimeoutMs });
  const errors = [];
  let branchRestoreRequested = false;
  let memoryNeutralizationRequested = false;
  let activationRestored = false;
  let canaryBranchDeleted = false;
  let activeBranchVerified = false;

  const attempt = async (stage, operation) => {
    try {
      await operation();
      return true;
    } catch (error) {
      errors.push(failureFrom(error, stage));
      return false;
    }
  };

  branchRestoreRequested = await attempt("restore-default-branch", () =>
    client.setActiveBranch(restoreBranch),
  );
  memoryNeutralizationRequested = await attempt(
    "request-memory-neutralization",
    () => client.requestMemoryNeutralization(shard),
  );
  activationRestored = await attempt("restore-ptr-activation", () =>
    activatePtrRuntime({ token, host, fetchImpl, requestTimeoutMs }),
  );
  canaryBranchDeleted = await attempt("delete-canary-branch", () =>
    client.deleteBranch(canaryBranch),
  );
  activeBranchVerified = await attempt("verify-restored-branch", () =>
    client.requireActiveBranch(restoreBranch, "verify-restored-branch"),
  );

  return {
    attempted: true,
    complete:
      branchRestoreRequested &&
      memoryNeutralizationRequested &&
      activationRestored &&
      canaryBranchDeleted &&
      activeBranchVerified,
    branchRestoreRequested,
    memoryNeutralizationRequested,
    activationRestored,
    canaryBranchDeleted,
    activeBranchVerified,
    errors,
  };
}

export async function runPtrExecutionCanary({
  token,
  host = "https://screeps.com",
  restoreBranch = "default",
  canaryBranch,
  requestId,
  requestCommand,
  room,
  shard,
  nonce = randomBytes(12).toString("hex"),
  minimumShardTicks = PTR_CANARY_MIN_SHARD_TICKS,
  maxSamples = DEFAULT_MAX_SAMPLES,
  pollIntervalMs = 2_000,
  timeoutMs = 180_000,
  requestTimeoutMs = DEFAULT_PTR_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
  sleepImpl = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  nowImpl = () => Date.now(),
  onRestoreRequired = async () => {},
}) {
  requireString(restoreBranch, "restore-branch", /^[A-Za-z0-9_.-]{1,30}$/);
  requireString(canaryBranch, "canary-branch", /^ptr-canary-[a-z0-9]{1,16}$/);
  requireString(room, "room", /^[WE]\d+[NS]\d+$/);
  requireString(shard, "shard", /^shard\d+$/);
  requireString(nonce, "nonce", /^[a-z0-9]{16,64}$/);
  if (restoreBranch === canaryBranch) {
    throw new PtrCanaryError("configuration", "restore-branch-is-canary");
  }
  if (!Number.isInteger(minimumShardTicks) || minimumShardTicks < 3) {
    throw new PtrCanaryError(
      "configuration",
      "minimum-shard-ticks-below-three",
    );
  }
  if (!Number.isInteger(maxSamples) || maxSamples < minimumShardTicks) {
    throw new PtrCanaryError("configuration", "invalid-max-samples");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1_000) {
    throw new PtrCanaryError("configuration", "poll-interval-too-short");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < pollIntervalMs) {
    throw new PtrCanaryError("configuration", "invalid-timeout");
  }
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 60_000 ||
    requestTimeoutMs > timeoutMs
  ) {
    throw new PtrCanaryError("configuration", "invalid-request-timeout");
  }

  const source = buildPtrExecutionCanarySource({ nonce, room });
  const sourceFingerprint = createHash("sha256")
    .update(source, "utf8")
    .digest("hex")
    .slice(0, 12);
  const client = createClient({ token, host, fetchImpl, requestTimeoutMs });
  const samples = [];
  const discarded = { repeatedTick: 0, tornWindow: 0 };
  const startedAtMs = nowImpl();
  let branchCreated = false;
  let restorationArmed = false;
  let activationVerified = false;
  let failure = null;
  let evaluation = evaluateSamples(samples, minimumShardTicks);
  let restoration = {
    attempted: false,
    complete: false,
    branchRestoreRequested: false,
    memoryNeutralizationRequested: false,
    activationRestored: false,
    canaryBranchDeleted: false,
    activeBranchVerified: false,
    errors: [],
  };

  try {
    let branches = await client.listBranches();
    let active = branches.filter((candidate) => candidate.activeWorld);
    const staleCanary = branches.find(
      (candidate) => candidate.branch === canaryBranch,
    );

    if (
      staleCanary?.activeWorld === true &&
      active.length === 1 &&
      active[0].branch === canaryBranch
    ) {
      await onRestoreRequired({
        requestId,
        canaryBranch,
        restoreBranch,
        room,
        shard,
      });
      restorationArmed = true;
      const recovered = await restorePtrExecutionCanary({
        token,
        host,
        restoreBranch,
        canaryBranch,
        shard,
        fetchImpl,
        requestTimeoutMs,
      });
      if (!recovered.complete) {
        throw new PtrCanaryError("preflight", "stale-canary-recovery-failed");
      }
      branches = await client.listBranches();
      active = branches.filter((candidate) => candidate.activeWorld);
    }

    if (active.length !== 1 || active[0].branch !== restoreBranch) {
      throw new PtrCanaryError("preflight", "restore-branch-not-active");
    }
    if (!branches.some((candidate) => candidate.branch === restoreBranch)) {
      throw new PtrCanaryError("preflight", "restore-branch-missing");
    }

    // Arm the independently persisted restoration path before the first
    // canary-owned remote mutation. A clone can succeed server-side even when
    // its verification response is lost.
    if (!restorationArmed) {
      await onRestoreRequired({
        requestId,
        canaryBranch,
        restoreBranch,
        room,
        shard,
      });
      restorationArmed = true;
    }

    if (branches.some((candidate) => candidate.branch === canaryBranch)) {
      await client.deleteBranch(canaryBranch);
    }

    await client.createBranch(canaryBranch, source);
    branchCreated = true;
    await client.uploadAndVerifyBranch(canaryBranch, source);

    await client.setActiveBranch(canaryBranch);
    await activatePtrRuntime({ token, host, fetchImpl, requestTimeoutMs });
    await client.requireActiveBranch(canaryBranch, "verify-canary-activation");
    activationVerified = true;

    let lastAcceptedTick = null;
    while (
      samples.length < maxSamples &&
      nowImpl() - startedAtMs <= timeoutMs
    ) {
      const before = await client.gameTime(shard);
      if (lastAcceptedTick !== null && before < lastAcceptedTick) {
        throw new PtrCanaryError("sampling", "shard-clock-regressed");
      }
      if (before === lastAcceptedTick) {
        discarded.repeatedTick += 1;
        await sleepImpl(pollIntervalMs);
        continue;
      }

      const [memory, roomEngine] = await Promise.all([
        client.memory(shard, nonce),
        client.roomEngine(room, shard, before),
      ]);
      const after = await client.gameTime(shard);
      if (before !== after) {
        discarded.tornWindow += 1;
        await sleepImpl(pollIntervalMs);
        continue;
      }

      lastAcceptedTick = before;
      samples.push({
        index: samples.length,
        sampledAt: new Date(nowImpl()).toISOString(),
        shardTick: before,
        memory,
        roomEngine: {
          observedAtShardTick: before,
          ...roomEngine,
        },
      });
      evaluation = evaluateSamples(samples, minimumShardTicks);
      if (evaluation.status === "passed") break;
      await sleepImpl(pollIntervalMs);
    }

    evaluation = evaluateSamples(samples, minimumShardTicks);
    if (evaluation.status !== "passed") {
      failure = {
        stage: "sampling",
        code: "insufficient-execution-evidence",
      };
    }
  } catch (error) {
    failure = failureFrom(error);
    evaluation = evaluateSamples(samples, minimumShardTicks);
  } finally {
    if (branchCreated || restorationArmed) {
      restoration = await restorePtrExecutionCanary({
        token,
        host,
        restoreBranch,
        canaryBranch,
        shard,
        fetchImpl,
        requestTimeoutMs,
      });
    }
  }

  if (!restoration.complete && (branchCreated || restorationArmed)) {
    failure ??= { stage: "restoration", code: "restoration-incomplete" };
  }

  const roomEngineEvaluation = evaluateRoomEngine(samples);
  if (
    evaluation.status === "passed" &&
    roomEngineEvaluation.status === "blocked"
  ) {
    failure ??= {
      stage: "room-engine",
      code: "overdue-engine-obligations",
    };
  } else if (
    evaluation.status === "passed" &&
    roomEngineEvaluation.status === "unverified"
  ) {
    failure ??= {
      stage: "room-engine",
      code: "room-engine-unverified",
    };
  }

  return {
    schema: "screeps-ptr-execution-canary/v1",
    request: {
      id: String(requestId),
      mode: "canary",
      command: requestCommand,
      target: "ptr",
      room,
      shard,
    },
    collectedAt: new Date(nowImpl()).toISOString(),
    status:
      evaluation.status === "passed" &&
      roomEngineEvaluation.status === "consistent" &&
      restoration.complete
        ? "passed"
        : "failed",
    assurance: "temporary-execution-canary",
    releaseClosure: false,
    safety: {
      productionSourcePersistedByCanary: false,
      artifactContainsModuleSource: false,
      branchCreationMode: "default-modules-only",
      restorationReceiptArmed: restorationArmed,
      minimumDistinctShardTicks: minimumShardTicks,
    },
    canary: {
      branch: canaryBranch,
      sourceFingerprint,
      sourceBytes: Buffer.byteLength(source, "utf8"),
      branchCreated,
      activationVerified,
      samples,
      discarded,
      execution: evaluation,
      roomEngine: roomEngineEvaluation,
    },
    restoration,
    failure,
  };
}
