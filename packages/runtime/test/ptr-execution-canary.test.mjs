import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  buildPtrExecutionCanarySource,
  ptrExecutionCanaryBranch,
  restorePtrExecutionCanary,
  runPtrExecutionCanary,
} from "../../../scripts/lib/ptr-execution-canary.mjs";

const ROOM = "E52N38";
const SHARD = "shard3";
const REQUEST_ID = "5483000000";
const NONCE = "0123456789abcdef01234567";
const PRODUCTION_SOURCE_CANARY = "PRIVATE_PRODUCTION_MODULE_SOURCE";
const ACCOUNT_ID_CANARY = "PRIVATE_ACCOUNT_IDENTIFIER";
const NESTED_RESPONSE_CANARY = "PRIVATE_NESTED_RESPONSE_VALUE";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const encodeMemory = (value) => ({
  ok: 1,
  data: `gz:${gzipSync(Buffer.from(JSON.stringify(value))).toString("base64")}`,
});

function createPtrHarness({
  failMemoryRead = false,
  hangMemoryRead = false,
  hangSetActiveBranch = false,
  noExecution = false,
  failBranchListAfterClone = false,
  startingTick = 1_000,
  roomObjects,
} = {}) {
  const canaryBranch = ptrExecutionCanaryBranch(REQUEST_ID);
  const branches = new Map([
    [
      "default",
      {
        activeWorld: true,
        activeSim: false,
        modules: { main: PRODUCTION_SOURCE_CANARY },
      },
    ],
  ]);
  const requests = [];
  let gameTimeReads = 0;
  let currentTick = startingTick;
  let activationCalls = 0;
  let cleanupCalls = 0;
  let rejectNextBranchList = false;

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const requestBody = init.body ? JSON.parse(init.body) : null;
    requests.push({
      method,
      pathname: url.pathname,
      query: url.searchParams,
      body: requestBody,
      token: init.headers?.["X-Token"],
    });

    if (url.pathname === "/ptr/api/user/branches" && method === "GET") {
      if (rejectNextBranchList) {
        rejectNextBranchList = false;
        return jsonResponse({ ok: 0, error: "lost verification" }, 503);
      }
      return jsonResponse({
        ok: 1,
        list: [...branches].map(([branch, state]) => ({
          _id: ACCOUNT_ID_CANARY,
          branch,
          activeWorld: state.activeWorld,
          activeSim: state.activeSim,
          modules: state.modules,
          privateState: { nested: NESTED_RESPONSE_CANARY },
        })),
      });
    }

    if (url.pathname === "/ptr/api/user/clone-branch" && method === "POST") {
      if (branches.has(requestBody.newName)) {
        return jsonResponse({ ok: 0, error: "exists" });
      }
      branches.set(requestBody.newName, {
        activeWorld: false,
        activeSim: false,
        modules: requestBody.defaultModules,
      });
      rejectNextBranchList = failBranchListAfterClone;
      return jsonResponse({ ok: 1, timestamp: 1 });
    }

    if (url.pathname === "/ptr/api/user/code" && method === "POST") {
      const branch = branches.get(requestBody.branch);
      if (!branch) return jsonResponse({ ok: 0, error: "missing" });
      branch.modules = requestBody.modules;
      return jsonResponse({ ok: 1, timestamp: 2 });
    }

    if (url.pathname === "/ptr/api/user/code" && method === "GET") {
      const branch = branches.get(url.searchParams.get("branch"));
      return branch
        ? jsonResponse({ ok: 1, modules: branch.modules })
        : jsonResponse({ ok: 0, error: "missing" });
    }

    if (
      url.pathname === "/ptr/api/user/set-active-branch" &&
      method === "POST"
    ) {
      if (hangSetActiveBranch) return new Promise(() => undefined);
      if (!branches.has(requestBody.branch)) {
        return jsonResponse({ ok: 0, error: "missing" });
      }
      for (const state of branches.values()) state.activeWorld = false;
      branches.get(requestBody.branch).activeWorld = true;
      return jsonResponse({ ok: 1 });
    }

    if (url.pathname === "/ptr/api/user/delete-branch" && method === "POST") {
      const branch = branches.get(requestBody.branch);
      if (branch && !branch.activeWorld && !branch.activeSim) {
        branches.delete(requestBody.branch);
      }
      return jsonResponse({ ok: 1, timestamp: 3 });
    }

    if (url.pathname === "/ptr/api/user/activate-ptr" && method === "POST") {
      activationCalls += 1;
      return jsonResponse({ ok: 1, result: { nModified: 1 } });
    }

    if (url.pathname === "/ptr/api/user/world-status" && method === "GET") {
      return jsonResponse({ ok: 1, status: "normal" });
    }

    if (url.pathname === "/ptr/api/game/time" && method === "GET") {
      currentTick = startingTick + Math.floor(gameTimeReads / 2);
      gameTimeReads += 1;
      return jsonResponse({ ok: 1, time: currentTick });
    }

    if (url.pathname === "/ptr/api/user/memory" && method === "GET") {
      if (hangMemoryRead) return new Promise(() => undefined);
      if (failMemoryRead) {
        return jsonResponse({ ok: 0, error: "private failure detail" }, 503);
      }
      if (noExecution) return jsonResponse(encodeMemory(null));
      const start = Math.max(startingTick, currentTick - 3);
      return jsonResponse(
        encodeMemory({
          nonce: NONCE,
          runs: currentTick - startingTick + 1,
          loopTick: currentTick,
          roomTick: currentTick,
          roomVisible: true,
          history: Array.from(
            { length: currentTick - start + 1 },
            (_, index) => {
              const tick = start + index;
              return { tick, roomTick: tick, roomVisible: true };
            },
          ),
          privateState: NESTED_RESPONSE_CANARY,
        }),
      );
    }

    if (url.pathname === "/ptr/api/user/memory" && method === "POST") {
      cleanupCalls += 1;
      return jsonResponse({ ok: 1, privateState: NESTED_RESPONSE_CANARY });
    }

    if (url.pathname === "/ptr/api/game/room-objects" && method === "GET") {
      return jsonResponse({
        ok: 1,
        users: { [ACCOUNT_ID_CANARY]: { username: "private-user" } },
        objects: roomObjects ?? [
          {
            _id: ACCOUNT_ID_CANARY,
            user: ACCOUNT_ID_CANARY,
            type: "controller",
            level: 8,
            downgradeTime: 25_000,
            privateState: NESTED_RESPONSE_CANARY,
          },
          {
            _id: "creep-private-id",
            user: ACCOUNT_ID_CANARY,
            name: NESTED_RESPONSE_CANARY,
            type: "creep",
            ageTime: 2_400,
          },
          {
            _id: "source-private-id",
            type: "source",
            energy: 2_900,
            energyCapacity: 3_000,
            nextRegenerationTime: 1_020,
          },
          { _id: "road-private-id", type: "road", nextDecayTime: 2_000 },
        ],
      });
    }

    return jsonResponse({ ok: 0, error: "unexpected" }, 404);
  };

  return {
    canaryBranch,
    branches,
    requests,
    fetchImpl,
    get activationCalls() {
      return activationCalls;
    },
    get cleanupCalls() {
      return cleanupCalls;
    },
  };
}

describe("PTR execution canary", () => {
  it("keeps diagnostic verdicts in artifacts and workflow failures in restoration", async () => {
    const runner = await readFile(
      new URL("../../../scripts/run-ptr-execution-canary.mjs", import.meta.url),
      "utf8",
    );
    const restorer = await readFile(
      new URL(
        "../../../scripts/restore-ptr-execution-canary.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const workflow = await readFile(
      new URL(
        "../../../.github/workflows/screeps-insights.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(runner).not.toContain("process.exitCode");
    expect(restorer).toContain("process.exitCode = 1");
    expect(workflow).toMatch(
      /name: Independently restore PTR after canary[\s\S]*?always\(\)/,
    );
    expect(workflow).toMatch(
      /name: Run bounded PTR execution canary[\s\S]*?timeout-minutes: 5/,
    );
    expect(workflow).toMatch(
      /name: Independently restore PTR after canary[\s\S]*?timeout-minutes: 3/,
    );
    expect(workflow.match(/SCREEPS_CANARY_REQUEST_TIMEOUT_MS: 10000/g)).toHaveLength(
      2,
    );
  });

  it("proves three distinct loop and visible-room ticks, then restores PTR", async () => {
    const harness = createPtrHarness();
    let now = Date.UTC(2026, 7, 31, 19, 0, 0);
    const restoreReceipts = [];

    const result = await runPtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      requestId: REQUEST_ID,
      requestCommand: `/canary target=ptr room=${ROOM} shard=${SHARD}`,
      room: ROOM,
      shard: SHARD,
      nonce: NONCE,
      pollIntervalMs: 1_000,
      timeoutMs: 30_000,
      fetchImpl: harness.fetchImpl,
      nowImpl: () => now,
      sleepImpl: async (milliseconds) => {
        now += milliseconds;
      },
      onRestoreRequired: async (receipt) => {
        restoreReceipts.push(receipt);
      },
    });

    expect(result.status).toBe("passed");
    expect(result.releaseClosure).toBe(false);
    expect(result.canary.execution).toMatchObject({
      status: "passed",
      shardTicks: [1_000, 1_001, 1_002],
      canaryLoopTicks: [1_000, 1_001, 1_002],
      visibleRoomTicks: [1_000, 1_001, 1_002],
    });
    expect(result.canary.samples).toHaveLength(3);
    expect(result.canary.samples[0].roomEngine).toMatchObject({
      observedAtShardTick: 1_000,
      controllerLevel: 8,
      timestamps: {
        controllerDowngrade: 25_000,
        creepAge: { count: 1, minimum: 2_400, maximum: 2_400 },
      },
      processing: { classification: "no-overdue-obligation-observed" },
    });
    expect(result.canary.roomEngine).toMatchObject({
      status: "consistent",
      processingHealthy: null,
      consistentSamples: 3,
    });
    expect(result.restoration.complete).toBe(true);
    expect(restoreReceipts).toHaveLength(1);
    expect(harness.branches.get("default")?.activeWorld).toBe(true);
    expect(harness.branches.has(harness.canaryBranch)).toBe(false);
    expect(harness.activationCalls).toBe(2);
    expect(harness.cleanupCalls).toBe(1);
    expect(
      harness.requests.every(
        ({ pathname, token }) =>
          pathname.startsWith("/ptr/api/") && token === "test-token",
      ),
    ).toBe(true);

    const cloneRequest = harness.requests.find(
      ({ pathname }) => pathname === "/ptr/api/user/clone-branch",
    );
    expect(cloneRequest.body.branch).toBeUndefined();
    expect(Object.keys(cloneRequest.body).sort()).toEqual([
      "defaultModules",
      "newName",
    ]);
    expect(cloneRequest.body.newName).toBe(harness.canaryBranch);
    expect(cloneRequest.body.defaultModules.main).not.toContain(
      PRODUCTION_SOURCE_CANARY,
    );
    const memoryRead = harness.requests.find(
      ({ pathname, method }) =>
        pathname === "/ptr/api/user/memory" && method === "GET",
    );
    expect(Object.fromEntries(memoryRead.query)).toEqual({
      path: "__ptrExecutionCanary",
      shard: SHARD,
    });
    const roomRead = harness.requests.find(
      ({ pathname }) => pathname === "/ptr/api/game/room-objects",
    );
    expect(Object.fromEntries(roomRead.query)).toEqual({
      room: ROOM,
      shard: SHARD,
    });
    expect(result.canary.sourceBytes).toBeLessThan(700);

    const serialized = JSON.stringify(result);
    for (const privateCanary of [
      PRODUCTION_SOURCE_CANARY,
      ACCOUNT_ID_CANARY,
      NESTED_RESPONSE_CANARY,
      NONCE,
    ]) {
      expect(serialized).not.toContain(privateCanary);
    }
  });

  it("fails closed after three sampled ticks without execution evidence", async () => {
    const harness = createPtrHarness({ noExecution: true });
    let now = 0;
    const result = await runPtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      requestId: REQUEST_ID,
      requestCommand: `/canary target=ptr room=${ROOM} shard=${SHARD}`,
      room: ROOM,
      shard: SHARD,
      nonce: NONCE,
      minimumShardTicks: 3,
      maxSamples: 3,
      pollIntervalMs: 1_000,
      timeoutMs: 30_000,
      fetchImpl: harness.fetchImpl,
      nowImpl: () => now,
      sleepImpl: async (milliseconds) => {
        now += milliseconds;
      },
      onRestoreRequired: async () => {},
    });

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual({
      stage: "sampling",
      code: "insufficient-execution-evidence",
    });
    expect(result.canary.execution.shardTicks).toHaveLength(3);
    expect(result.canary.execution.canaryLoopTicks).toEqual([]);
    expect(result.restoration.complete).toBe(true);
    expect(harness.branches.get("default")?.activeWorld).toBe(true);
    expect(harness.branches.has(harness.canaryBranch)).toBe(false);
  });

  it("restores default and activation when sampling fails abruptly", async () => {
    const harness = createPtrHarness({ failMemoryRead: true });
    const result = await runPtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      requestId: REQUEST_ID,
      requestCommand: `/canary target=ptr room=${ROOM} shard=${SHARD}`,
      room: ROOM,
      shard: SHARD,
      nonce: NONCE,
      pollIntervalMs: 1_000,
      timeoutMs: 30_000,
      fetchImpl: harness.fetchImpl,
      sleepImpl: async () => {},
      onRestoreRequired: async () => {},
    });

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual({
      stage: "sample-canary-memory",
      code: "http-503",
    });
    expect(result.restoration.complete).toBe(true);
    expect(harness.branches.get("default")?.activeWorld).toBe(true);
    expect(harness.branches.has(harness.canaryBranch)).toBe(false);
    expect(harness.activationCalls).toBe(2);
  });

  it("times out a hung sample after branch activation and still restores PTR", async () => {
    const harness = createPtrHarness({ hangMemoryRead: true });
    const result = await runPtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      requestId: REQUEST_ID,
      requestCommand: `/canary target=ptr room=${ROOM} shard=${SHARD}`,
      room: ROOM,
      shard: SHARD,
      requestTimeoutMs: 5,
      pollIntervalMs: 1_000,
      timeoutMs: 30_000,
      fetchImpl: harness.fetchImpl,
      sleepImpl: async () => {},
      onRestoreRequired: async () => {},
    });

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual({
      stage: "sample-canary-memory",
      code: "request-timeout",
    });
    expect(result.restoration.complete).toBe(true);
    expect(harness.branches.get("default")?.activeWorld).toBe(true);
    expect(harness.branches.has(harness.canaryBranch)).toBe(false);
    expect(harness.activationCalls).toBe(2);
  });

  it("arms restoration before a clone whose verification response fails", async () => {
    const harness = createPtrHarness({ failBranchListAfterClone: true });
    const restoreReceipts = [];

    const result = await runPtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      requestId: REQUEST_ID,
      requestCommand: `/canary target=ptr room=${ROOM} shard=${SHARD}`,
      room: ROOM,
      shard: SHARD,
      nonce: NONCE,
      pollIntervalMs: 1_000,
      timeoutMs: 30_000,
      fetchImpl: harness.fetchImpl,
      sleepImpl: async () => {},
      onRestoreRequired: async (receipt) => {
        restoreReceipts.push(receipt);
      },
    });

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual({
      stage: "list-branches",
      code: "http-503",
    });
    expect(restoreReceipts).toHaveLength(1);
    expect(result.safety.restorationReceiptArmed).toBe(true);
    expect(result.restoration.complete).toBe(true);
    expect(harness.branches.get("default")?.activeWorld).toBe(true);
    expect(harness.branches.has(harness.canaryBranch)).toBe(false);
  });

  it("keeps loop execution separate from the frozen E52N38 room engine", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("./fixtures/ptr/frozen-e52n38-engine.json", import.meta.url),
        "utf8",
      ),
    );
    const harness = createPtrHarness({
      startingTick: fixture.shardTick,
      roomObjects: fixture.objects,
    });
    let now = 0;

    const result = await runPtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      requestId: REQUEST_ID,
      requestCommand: `/canary target=ptr room=${fixture.room} shard=${fixture.shard}`,
      room: fixture.room,
      shard: fixture.shard,
      nonce: NONCE,
      pollIntervalMs: 1_000,
      timeoutMs: 30_000,
      fetchImpl: harness.fetchImpl,
      nowImpl: () => now,
      sleepImpl: async (milliseconds) => {
        now += milliseconds;
      },
      onRestoreRequired: async () => {},
    });

    expect(result.canary.execution.status).toBe("passed");
    expect(result.canary.roomEngine).toMatchObject({
      status: "blocked",
      processingHealthy: false,
    });
    expect(result.canary.roomEngine.blockedSamples[0]).toMatchObject({
      shardTick: fixture.shardTick,
      overdueTotal: 8,
      overdue: {
        creepExpiry: { count: 5, oldestTimestamp: 82598183 },
        sourceRegeneration: { count: 2, oldestTimestamp: 82598151 },
        roadDecay: { count: 1, oldestTimestamp: 82597890 },
      },
    });
    expect(result.status).toBe("failed");
    expect(result.failure).toEqual({
      stage: "room-engine",
      code: "overdue-engine-obligations",
    });
    expect(result.restoration.complete).toBe(true);
  });

  it("supports an idempotent independent restoration pass", async () => {
    const harness = createPtrHarness();
    harness.branches.get("default").activeWorld = false;
    harness.branches.set(harness.canaryBranch, {
      activeWorld: true,
      activeSim: false,
      modules: {
        main: buildPtrExecutionCanarySource({ nonce: NONCE, room: ROOM }),
      },
    });

    const restoration = await restorePtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      shard: SHARD,
      fetchImpl: harness.fetchImpl,
    });

    expect(restoration.complete).toBe(true);
    expect(harness.branches.get("default")?.activeWorld).toBe(true);
    expect(harness.branches.has(harness.canaryBranch)).toBe(false);
    expect(harness.activationCalls).toBe(1);

    const cleanupRequest = harness.requests.find(
      ({ pathname, method }) =>
        pathname === "/ptr/api/user/memory" && method === "POST",
    );
    expect(cleanupRequest.body).toEqual({
      path: "__ptrExecutionCanary",
      value: null,
      shard: SHARD,
    });
  });

  it("bounds a hung restoration request and reports incomplete cleanup", async () => {
    const harness = createPtrHarness({ hangSetActiveBranch: true });
    harness.branches.get("default").activeWorld = false;
    harness.branches.set(harness.canaryBranch, {
      activeWorld: true,
      activeSim: false,
      modules: {
        main: buildPtrExecutionCanarySource({ nonce: NONCE, room: ROOM }),
      },
    });

    const restoration = await restorePtrExecutionCanary({
      token: "test-token",
      host: "https://example.invalid",
      restoreBranch: "default",
      canaryBranch: harness.canaryBranch,
      shard: SHARD,
      requestTimeoutMs: 5,
      fetchImpl: harness.fetchImpl,
    });

    expect(restoration.complete).toBe(false);
    expect(restoration.branchRestoreRequested).toBe(false);
    expect(restoration.memoryNeutralizationRequested).toBe(true);
    expect(restoration.activationRestored).toBe(true);
    expect(restoration.errors).toEqual(
      expect.arrayContaining([
        { stage: "set-active-branch", code: "request-timeout" },
      ]),
    );
  });
});
