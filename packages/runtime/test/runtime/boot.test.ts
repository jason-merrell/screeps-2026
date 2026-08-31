import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootMemory } from "../../src/memory/schema";
import { OBSERVABILITY_SEGMENT } from "../../src/memory/segments";
import { publishBootTrace } from "../../src/observability/boot";
import {
  bootCpuWindow,
  completeSettlementBootAttempt,
  failOpenSettlementBoot,
  recoverInterruptedSettlementBoot,
  settlementBootAllowsPlanning,
  startSettlementBootAttempt,
  startSettlementBootRetry,
} from "../../src/runtime/boot";

describe("runtime boot safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reserves serialization headroom inside a 50 CPU assignment", () => {
    expect(bootCpuWindow({ limit: 50, tickLimit: 500 })).toEqual({
      ceiling: 50,
      deadline: 40,
      headroom: 10,
    });
    expect(bootCpuWindow({ limit: 20, tickLimit: 20 })).toEqual({
      ceiling: 20,
      deadline: 15,
      headroom: 5,
    });
  });

  it("overwrites a stale Segment 99 with a bounded pre-planner heartbeat", () => {
    vi.stubGlobal("Game", {
      time: 12_345,
      cpu: {
        limit: 50,
        tickLimit: 50,
        bucket: 0,
        getUsed: () => 3.25,
      },
    });
    vi.stubGlobal("RawMemory", {
      segments: { [OBSERVABILITY_SEGMENT]: '{"tick":1,"stale":true}' },
    });

    expect(
      publishBootTrace({
        phase: "settlement",
        memoryVersion: 10,
        sourceMemoryVersion: 6,
        targetMemoryVersion: 10,
        fromVersion: 9,
        toVersion: 10,
        progressed: true,
        reason: "staged test heartbeat",
        cpuDeadline: 40,
        cpuHeadroom: 10,
        settlementAttempts: 1,
      }),
    ).toBe(true);

    const encoded = RawMemory.segments[OBSERVABILITY_SEGMENT] ?? "";
    const trace = JSON.parse(encoded);
    expect(encoded.length).toBeLessThan(2_000);
    expect(trace).toMatchObject({
      schema: "screeps-runtime-boot-heartbeat/v1",
      version: 0,
      memoryVersion: 10,
      tick: 12_345,
      cpu: { limit: 50, tickLimit: 50, bucket: 0, total: 3.25 },
      boot: {
        phase: "settlement",
        sourceMemoryVersion: 6,
        targetMemoryVersion: 10,
        settlementAttempts: 1,
      },
      settlement: { plans: [], faults: [] },
      transport: { bootHeartbeat: true },
    });
  });

  it("fails closed without throwing while Segment 99 is not active yet", () => {
    vi.stubGlobal("Game", {
      time: 1,
      cpu: {
        limit: 50,
        tickLimit: 50,
        bucket: 0,
        getUsed: () => 1,
      },
    });
    vi.stubGlobal("RawMemory", { segments: {} });

    expect(
      publishBootTrace({
        phase: "migration",
        memoryVersion: 7,
        sourceMemoryVersion: 6,
        targetMemoryVersion: 10,
        fromVersion: 6,
        toVersion: 7,
        progressed: true,
        reason: "segment activation takes effect next tick",
        cpuDeadline: 40,
        cpuHeadroom: 10,
      }),
    ).toBe(false);
  });

  it("fails open after a caught settlement exception and retains bounded evidence", () => {
    const boot: RuntimeBootMemory = {
      version: 1,
      sourceMemoryVersion: 6,
      targetMemoryVersion: 10,
      phase: "settlement",
      startedAt: 90,
      lastProgressTick: 99,
      settlementAttempts: 0,
    };
    startSettlementBootAttempt(boot, 100);
    expect(boot).toMatchObject({
      phase: "settlement",
      degraded: false,
      settlementAttempts: 1,
      settlementRetryTick: 200,
      lastProgressTick: 100,
    });

    const fault = failOpenSettlementBoot(
      boot,
      100,
      new Error(`planner failed ${"x".repeat(300)}`),
    );

    expect(fault).toHaveLength(240);
    expect(boot).toMatchObject({
      phase: "ready",
      degraded: true,
      completedAt: 100,
      lastProgressTick: 100,
      settlementAttempts: 1,
      settlementRetryTick: 200,
      fault,
    });
    expect(settlementBootAllowsPlanning(boot, 199)).toBe(false);
    expect(settlementBootAllowsPlanning(boot, 200)).toBe(true);
  });

  it("recovers an interrupted prior settlement attempt before retrying it", () => {
    const boot: RuntimeBootMemory = {
      version: 1,
      sourceMemoryVersion: 6,
      targetMemoryVersion: 10,
      phase: "settlement",
      startedAt: 90,
      lastProgressTick: 100,
      settlementAttempts: 1,
      settlementRetryTick: 200,
    };

    expect(recoverInterruptedSettlementBoot(boot, 100)).toBeNull();
    const fault = recoverInterruptedSettlementBoot(boot, 101);

    expect(fault).toContain("did not record completion");
    expect(boot).toMatchObject({
      phase: "ready",
      degraded: true,
      completedAt: 101,
      lastProgressTick: 101,
      settlementAttempts: 1,
      settlementRetryTick: 200,
      fault,
    });
    expect(settlementBootAllowsPlanning(boot, 199)).toBe(false);
    expect(settlementBootAllowsPlanning(boot, 200)).toBe(true);

    startSettlementBootRetry(boot, 200);
    expect(boot).toMatchObject({
      degraded: true,
      lastProgressTick: 200,
      settlementAttempts: 2,
      settlementRetryTick: 300,
    });

    completeSettlementBootAttempt(boot, 200);
    expect(boot).toMatchObject({
      phase: "ready",
      degraded: false,
      completedAt: 200,
    });
    expect(boot.fault).toBeUndefined();
    expect(boot.settlementRetryTick).toBeUndefined();
    expect(settlementBootAllowsPlanning(boot, 200)).toBe(true);
  });
});
