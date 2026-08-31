import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildPtrRuntimeReadiness,
  DEFAULT_PTR_MEMORY_VERSION,
  sanitizePtrAccountResponse,
} from "../../../scripts/lib/ptr-runtime-readiness.mjs";

const RUNTIME_SHA = "0123456789abcdef0123456789abcdef01234567";
const GAME_TICK = 82_600_000;
const TRACE_TICK = GAME_TICK - 1;
const ROOM = "E52N38";
const SHARD = "shard3";

const response = (body, overrides = {}) => ({
  ok: true,
  httpOk: true,
  status: 200,
  body,
  ...overrides,
});

const memoryResponse = (value = 10) =>
  response({
    ok: 1,
    data: `gz:${gzipSync(Buffer.from(JSON.stringify(value))).toString("base64")}`,
  });

const traceValue = (overrides = {}) => ({
  version: 1,
  tick: TRACE_TICK,
  runtimeSha: RUNTIME_SHA,
  memoryVersion: 10,
  cpu: { limit: 20, bucket: 9_000, total: 3.25 },
  settlement: {
    plans: [
      {
        roomName: ROOM,
        development: { evaluatedAt: TRACE_TICK },
      },
    ],
  },
  privateRuntimeState: "trace-private-canary",
  ...overrides,
});

const traceResponse = (overrides = {}) =>
  response({ ok: 1, data: JSON.stringify(traceValue(overrides)) });

const accountValue = (overrides = {}) => ({
  ok: 1,
  _id: "private-account-id-canary",
  username: "SgtMerrell",
  cpu: 20,
  cpuShard: { shard0: 0, shard3: 20, privateField: "cpu-private-canary" },
  cpuShardUpdatedTime: 82_599_900,
  ...overrides,
});

const readyInput = (overrides = {}) => ({
  expectedBranch: "default",
  expectedRuntimeSha: RUNTIME_SHA,
  expectedMemoryVersion: 10,
  shard: SHARD,
  room: ROOM,
  worldStatusResponse: response({ ok: 1, status: "normal" }),
  branchesResponse: response({
    ok: 1,
    list: [
      {
        _id: "branch-private-id-canary",
        branch: "default",
        activeWorld: true,
        activeSim: false,
        modules: { main: "branch-module-private-canary" },
        timestamp: "branch-timestamp-private-canary",
      },
    ],
  }),
  accountResponse: response(accountValue()),
  gameTimeResponse: response({ ok: 1, time: GAME_TICK }),
  memoryVersionResponse: memoryResponse(),
  observabilityResponse: traceResponse(),
  roomsResponse: response({
    ok: 1,
    shards: { shard3: [ROOM] },
  }),
  roomObjectsResponse: response({
    ok: 1,
    objects: [
      {
        type: "controller",
        user: "private-account-id-canary",
        privateField: "controller-private-canary",
      },
    ],
  }),
  ...overrides,
});

describe("PTR runtime readiness", () => {
  it("keeps the collector default aligned with the runtime Memory schema", async () => {
    const schema = await readFile(
      new URL("../src/memory/schema.ts", import.meta.url),
      "utf8",
    );
    const declaration = schema.match(
      /export\s+const\s+MEMORY_VERSION\s*=\s*(\d+)\s*;/,
    );

    expect(declaration, "runtime MEMORY_VERSION declaration").not.toBeNull();
    expect(Number(declaration?.[1])).toBe(DEFAULT_PTR_MEMORY_VERSION);
  });

  it("requires the complete exact-room runtime preflight contract", () => {
    const readiness = buildPtrRuntimeReadiness(readyInput());

    expect(readiness).toMatchObject({
      schema: "screeps-ptr-runtime-readiness/v2",
      assurance: "runtime-preflight",
      releaseClosure: false,
      status: "ready",
      expected: {
        branch: "default",
        runtimeSha: RUNTIME_SHA,
        memoryVersion: 10,
        shard: SHARD,
        room: ROOM,
        maximumTraceLag: 5,
        maximumTraceLead: 1,
      },
      checks: {
        worldStatusNormal: true,
        activeBranchMatches: true,
        cpuAllocationPositive: true,
        accountNotExplicitlyDisabled: true,
        gameTimeAvailable: true,
        memoryVersionMatches: true,
        traceVersionMatches: true,
        runtimeShaMatches: true,
        traceMemoryVersionMatches: true,
        traceCpuValid: true,
        traceFresh: true,
        targetRoomEvaluated: true,
        roomListed: true,
        controllerOwned: true,
      },
      blockers: [],
      missingEvidence: [],
      evidence: {
        activeBranch: "default",
        gameTime: GAME_TICK,
        memoryVersion: 10,
        traceLag: 1,
        roomListed: true,
        controllerOwned: true,
        account: {
          requestOk: true,
          httpStatus: 200,
          totalCpuReported: true,
          totalCpu: 20,
          totalCpuValid: true,
          cpuShardFieldReported: true,
          cpuShardReported: true,
          shardAllocation: { shard0: 0, shard3: 20 },
          shardAllocationTotal: 20,
          duplicateShardAllocations: [],
          invalidShardAllocations: [],
          cpuShardUpdatedTime: 82_599_900,
          cpuUnlockWindowActive: null,
          activeReported: false,
          activeValid: true,
          active: null,
          blockedReported: false,
          blockedValid: true,
          blocked: null,
        },
      },
    });
    expect(JSON.stringify(readiness)).not.toContain(
      "private-account-id-canary",
    );
    expect(JSON.stringify(readiness)).not.toContain("trace-private-canary");
  });

  it("normalizes only the explicitly supplied room and shard identities", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({ room: "e52n38", shard: "SHARD3" }),
    );

    expect(readiness.status).toBe("ready");
    expect(readiness.expected.room).toBe(ROOM);
    expect(readiness.expected.shard).toBe(SHARD);
    expect(readiness.checks.roomListed).toBe(true);
    expect(readiness.checks.targetRoomEvaluated).toBe(true);
  });

  it("never promotes preflight readiness to release closure", () => {
    const readiness = buildPtrRuntimeReadiness(readyInput());

    expect(readiness.assurance).toBe("runtime-preflight");
    expect(readiness.releaseClosure).toBe(false);
  });

  it("treats a zero allocation on the target shard as disabled CPU", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(accountValue({ cpuShard: { shard3: 0 } })),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.cpuAllocationPositive).toBe(false);
    expect(readiness.blockers).toContain("cpuAllocationPositive");
  });

  it("blocks a matching reported runtime SHA on a non-active branch", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        branchesResponse: response({
          ok: 1,
          list: [{ branch: "main", activeWorld: true }],
        }),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.activeBranchMatches).toBe(false);
  });

  it("blocks a stale trace even when branch, SHA, and status match", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        observabilityResponse: response({
          ok: 1,
          data: JSON.stringify({
            version: 1,
            tick: 82599000,
            runtimeSha: RUNTIME_SHA,
            memoryVersion: 10,
          }),
        }),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.evidence.traceLag).toBe(1000);
    expect(readiness.checks.traceFresh).toBe(false);
  });

  it("reports a boot heartbeat without accepting it as a full runtime trace", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        observabilityResponse: traceResponse({
          schema: "screeps-runtime-boot-heartbeat/v1",
          version: 0,
          boot: {
            phase: "migration",
            sourceMemoryVersion: 6,
            targetMemoryVersion: 10,
            fromVersion: 6,
            toVersion: 7,
            progressed: true,
            degraded: false,
            settlementAttempts: 0,
            reason: "memory schema advanced",
            privateBootState: "private-canary",
          },
        }),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.traceVersionMatches).toBe(false);
    expect(readiness.evidence.trace).toMatchObject({
      kind: "boot-heartbeat",
      version: 0,
      boot: {
        phase: "migration",
        sourceMemoryVersion: 6,
        targetMemoryVersion: 10,
        fromVersion: 6,
        toVersion: 7,
        progressed: true,
        degraded: false,
        settlementAttempts: 0,
        reason: "memory schema advanced",
      },
    });
    expect(JSON.stringify(readiness)).not.toContain("private-canary");
  });

  it("allows a one-tick sampling race but rejects a larger future trace", () => {
    const oneTickAhead = buildPtrRuntimeReadiness(
      readyInput({
        observabilityResponse: response({
          ok: 1,
          data: JSON.stringify({
            version: 1,
            tick: 82600001,
            runtimeSha: RUNTIME_SHA,
            memoryVersion: 10,
          }),
        }),
      }),
    );
    const twoTicksAhead = buildPtrRuntimeReadiness(
      readyInput({
        observabilityResponse: response({
          ok: 1,
          data: JSON.stringify({
            version: 1,
            tick: 82600002,
            runtimeSha: RUNTIME_SHA,
            memoryVersion: 10,
          }),
        }),
      }),
    );

    expect(oneTickAhead.checks.traceFresh).toBe(true);
    expect(twoTicksAhead.checks.traceFresh).toBe(false);
  });

  it.each([
    ["runtimeShaMatches", "89abcdef0123456789abcdef0123456789abcdef"],
    ["runtimeShaMatches", null],
  ])(
    "never accepts missing or mismatched exact-SHA evidence",
    (check, runtimeSha) => {
      const readiness = buildPtrRuntimeReadiness(
        readyInput({
          observabilityResponse: response({
            ok: 1,
            data: JSON.stringify({
              version: 1,
              tick: 82599999,
              runtimeSha,
              memoryVersion: 10,
            }),
          }),
        }),
      );

      expect(readiness.status).not.toBe("ready");
      expect(readiness.checks[check]).not.toBe(true);
    },
  );

  it("blocks both durable and trace memory-version drift", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        memoryVersionResponse: response({ ok: 1, data: "6" }),
        observabilityResponse: response({
          ok: 1,
          data: JSON.stringify({
            version: 1,
            tick: 82599999,
            runtimeSha: RUNTIME_SHA,
            memoryVersion: 6,
          }),
        }),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        "memoryVersionMatches",
        "traceMemoryVersionMatches",
      ]),
    );
  });

  it("is unverified when account CPU or ownership evidence is unavailable", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(
          { ok: 0, error: "insufficient scope" },
          { ok: false, status: 403 },
        ),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.missingEvidence).toEqual(
      expect.arrayContaining([
        "cpuAllocationPositive",
        "accountNotExplicitlyDisabled",
        "controllerOwned",
      ]),
    );
  });

  it("rejects invalid configuration before interpreting evidence", () => {
    expect(() =>
      buildPtrRuntimeReadiness(
        readyInput({ expectedRuntimeSha: "not-a-deploy-sha" }),
      ),
    ).toThrow("40-character runtime SHA");
    expect(() =>
      buildPtrRuntimeReadiness(readyInput({ maximumTraceLag: -1 })),
    ).toThrow("non-negative maximum trace lag");
    expect(() =>
      buildPtrRuntimeReadiness(readyInput({ maximumTraceLead: -1 })),
    ).toThrow("non-negative maximum trace lead");
    expect(() =>
      buildPtrRuntimeReadiness(readyInput({ expectedBranch: "   " })),
    ).toThrow("expected branch");
    expect(() =>
      buildPtrRuntimeReadiness(readyInput({ expectedMemoryVersion: 10.5 })),
    ).toThrow("memory version");
    expect(() => buildPtrRuntimeReadiness(readyInput({ shard: "" }))).toThrow(
      "shard",
    );
    expect(() => buildPtrRuntimeReadiness(readyInput({ room: "" }))).toThrow(
      "room",
    );
  });
});

describe("PTR response-envelope integrity", () => {
  it.each([
    [
      "normalized request rejection",
      response({ ok: 1, status: "normal" }, { ok: false }),
    ],
    [
      "HTTP rejection despite normalized ok",
      response(
        { ok: 1, status: "normal" },
        { ok: true, httpOk: false, status: 500 },
      ),
    ],
    ["non-2xx status", response({ ok: 1, status: "normal" }, { status: 500 })],
    ["API ok=0", response({ ok: 0, status: "normal" })],
    [
      "API ok=1 with explicit error",
      response({ ok: 1, status: "normal", error: "rejected" }),
    ],
    ["missing API ok", response({ status: "normal" })],
  ])("does not trust a %s envelope", (_name, worldStatusResponse) => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({ worldStatusResponse }),
    );

    expect(readiness.status).not.toBe("ready");
    expect(readiness.checks.worldStatusNormal).not.toBe(true);
  });

  it("treats HTTP-200 invalid-shard errors as unavailable game time", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        gameTimeResponse: response({ ok: 1, error: "invalid shard" }),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.gameTimeAvailable).toBeNull();
    expect(readiness.missingEvidence).toContain("gameTimeAvailable");
  });

  it("does not accept negative shard or trace ticks as temporal evidence", () => {
    const negativeGameTime = buildPtrRuntimeReadiness(
      readyInput({ gameTimeResponse: response({ ok: 1, time: -1 }) }),
    );
    const negativeTraceTick = buildPtrRuntimeReadiness(
      readyInput({ observabilityResponse: traceResponse({ tick: -1 }) }),
    );

    expect(negativeGameTime.checks.gameTimeAvailable).toBeNull();
    expect(negativeGameTime.checks.traceFresh).toBeNull();
    expect(negativeTraceTick.checks.traceFresh).toBeNull();
    expect(negativeTraceTick.checks.targetRoomEvaluated).toBe(false);
  });

  it("never throws when Segment 99 is absent or malformed", () => {
    for (const observabilityResponse of [
      null,
      response({ ok: 1, data: "not-json" }),
      response({ ok: 0, error: "segment unavailable" }, { ok: false }),
    ]) {
      expect(() =>
        buildPtrRuntimeReadiness(readyInput({ observabilityResponse })),
      ).not.toThrow();
      const readiness = buildPtrRuntimeReadiness(
        readyInput({ observabilityResponse }),
      );
      expect(readiness.status).not.toBe("ready");
      expect(readiness.checks.runtimeShaMatches).toBeNull();
      expect(readiness.checks.traceFresh).toBeNull();
    }
  });
});

describe("PTR active-branch authority", () => {
  it.each([
    [
      "expected branch first",
      [
        { branch: "default", activeWorld: true },
        { branch: "rogue", activeWorld: true },
      ],
    ],
    [
      "expected branch second",
      [
        { branch: "rogue", activeWorld: true },
        { branch: "default", activeWorld: true },
      ],
    ],
  ])("blocks ambiguous activeWorld authority with %s", (_name, list) => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({ branchesResponse: response({ ok: 1, list }) }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.activeBranchMatches).toBe(false);
    expect(readiness.blockers).toContain("activeBranchMatches");
  });

  it("blocks an accepted branch list with no activeWorld branch", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        branchesResponse: response({
          ok: 1,
          list: [{ branch: "default", activeWorld: false }],
        }),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.activeBranchMatches).toBe(false);
  });

  it("does not retain private branch fields in readiness evidence", () => {
    const serialized = JSON.stringify(buildPtrRuntimeReadiness(readyInput()));

    expect(serialized).not.toContain("branch-private-id-canary");
    expect(serialized).not.toContain("branch-module-private-canary");
    expect(serialized).not.toContain("branch-timestamp-private-canary");
  });
});

describe("PTR CPU allocation and account state", () => {
  it("blocks an explicit zero total CPU even when no shard map is reported", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response({
          ok: 1,
          _id: "private-account-id-canary",
          cpu: 0,
        }),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.cpuAllocationPositive).toBe(false);
  });

  it("keeps positive total CPU unverified when no shard map is reported", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response({
          ok: 1,
          _id: "private-account-id-canary",
          cpu: 50,
        }),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.cpuAllocationPositive).toBeNull();
  });

  it("keeps contradictory zero-total and positive-shard CPU unverified", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(
          accountValue({ cpu: 0, cpuShard: { shard3: 50 } }),
        ),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.cpuAllocationPositive).toBeNull();
  });

  it.each([
    ["target allocation exceeds entitlement", { shard3: 50 }],
    ["allocation sum exceeds entitlement", { shard0: 10, shard3: 20 }],
  ])("keeps %s unverified", (_name, cpuShard) => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(accountValue({ cpu: 20, cpuShard })),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.cpuAllocationPositive).toBeNull();
  });

  it.each([
    ["malformed target", { shard3: "50" }],
    ["duplicate target", { shard3: 50, SHARD3: 50 }],
  ])("keeps a %s allocation unverified", (_name, cpuShard) => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(accountValue({ cpu: 50, cpuShard })),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.cpuAllocationPositive).toBeNull();
  });

  it("does not fall back to total CPU when a reported map omits the target shard", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(
          accountValue({ cpu: 50, cpuShard: { shard0: 50 } }),
        ),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.cpuAllocationPositive).toBe(false);
  });

  it("does not treat cpuAvailable as an execution entitlement", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response({
          ok: 1,
          _id: "private-account-id-canary",
          cpuAvailable: 10_000,
        }),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.cpuAllocationPositive).toBeNull();
  });

  it("ignores positive-looking CPU fields from a rejected auth response", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(accountValue({ error: "unauthorized" }), {
          ok: false,
          httpOk: false,
          status: 403,
        }),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.cpuAllocationPositive).toBeNull();
    expect(readiness.checks.accountNotExplicitlyDisabled).toBeNull();
    expect(readiness.checks.controllerOwned).toBeNull();
  });

  it.each([
    ["explicitly inactive", { active: false }],
    ["numerically inactive", { active: 0 }],
    ["explicitly blocked", { blocked: true }],
    ["numerically blocked", { blocked: 1 }],
  ])("blocks an %s account", (_name, accountOverrides) => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(accountValue(accountOverrides)),
      }),
    );

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.accountNotExplicitlyDisabled).toBe(false);
    expect(readiness.blockers).toContain("accountNotExplicitlyDisabled");
  });

  it("accepts the live PTR shape that omits active and blocked", () => {
    const readiness = buildPtrRuntimeReadiness(readyInput());

    expect(readiness.checks.accountNotExplicitlyDisabled).toBe(true);
  });

  it("accepts a positive numeric activation lease", () => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(accountValue({ active: 10_000 })),
      }),
    );

    expect(readiness.checks.accountNotExplicitlyDisabled).toBe(true);
    expect(readiness.evidence.account.active).toBe(true);
  });

  it.each([
    ["active", { active: "0" }],
    ["blocked", { blocked: "false" }],
  ])("keeps a malformed %s field unverified", (_name, accountOverrides) => {
    const readiness = buildPtrRuntimeReadiness(
      readyInput({
        accountResponse: response(accountValue(accountOverrides)),
      }),
    );

    expect(readiness.status).toBe("unverified");
    expect(readiness.checks.accountNotExplicitlyDisabled).toBeNull();
  });
});

describe("PTR account redaction", () => {
  it("keeps only operational CPU fields and drops private account data", () => {
    const safe = sanitizePtrAccountResponse(
      response({
        ok: 1,
        _id: "private-id",
        username: "operator",
        email: "private@example.invalid",
        password: "hash",
        credits: 1000,
        cpu: 30,
        cpuShard: { shard3: 20, shard2: Number.NaN, secret: 99 },
        cpuShardUpdatedTime: 100,
      }),
    );

    expect(safe).toEqual({
      requestOk: true,
      httpStatus: 200,
      totalCpuReported: true,
      totalCpu: 30,
      totalCpuValid: true,
      cpuShardFieldReported: true,
      cpuShardReported: true,
      shardAllocation: { shard3: 20 },
      shardAllocationTotal: 20,
      duplicateShardAllocations: [],
      invalidShardAllocations: ["shard2"],
      cpuShardUpdatedTime: 100,
      cpuUnlockWindowActive: null,
      activeReported: false,
      activeValid: true,
      active: null,
      blockedReported: false,
      blockedValid: true,
      blocked: null,
    });
  });
});
