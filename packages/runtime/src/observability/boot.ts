import type { RuntimeBootPhase } from "../memory/schema";
import { OBSERVABILITY_SEGMENT } from "../memory/segments";
import { runtimeBuildSha } from "../runtime/build-info";

export type BootTracePhase = RuntimeBootPhase | "deferred";

export interface BootTraceInput {
  phase: BootTracePhase;
  memoryVersion: number | null;
  sourceMemoryVersion: number | null;
  targetMemoryVersion: number;
  fromVersion: number | null;
  toVersion: number | null;
  progressed: boolean;
  reason: string;
  cpuDeadline: number;
  cpuHeadroom: number;
  settlementAttempts?: number;
  settlementRetryTick?: number;
  degraded?: boolean;
}

/**
 * Publish a tiny boot heartbeat without traversing FSPM or fitting a full
 * observability document. It is intentionally safe to call before Memory has
 * been parsed, and before a potentially CPU-heavy settlement attempt.
 */
export function publishBootTrace(input: BootTraceInput): boolean {
  if (RawMemory.segments[OBSERVABILITY_SEGMENT] === undefined) return false;
  const tickLimit =
    typeof Game.cpu.tickLimit === "number"
      ? Game.cpu.tickLimit
      : Game.cpu.limit;
  RawMemory.segments[OBSERVABILITY_SEGMENT] = JSON.stringify({
    // Never impersonate the complete runtime trace v1 contract. Existing
    // experiment/snapshot consumers intentionally ignore non-v1 payloads.
    schema: "screeps-runtime-boot-heartbeat/v1",
    version: 0,
    memoryVersion: input.memoryVersion,
    runtimeSha: runtimeBuildSha,
    tick: Game.time,
    cpu: {
      limit: Game.cpu.limit,
      tickLimit,
      bucket: Game.cpu.bucket,
      total: Game.cpu.getUsed(),
      measurementBoundary: "boot_heartbeat",
    },
    boot: {
      phase: input.phase,
      sourceMemoryVersion: input.sourceMemoryVersion,
      targetMemoryVersion: input.targetMemoryVersion,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      progressed: input.progressed,
      reason: input.reason.slice(0, 240),
      cpuDeadline: input.cpuDeadline,
      cpuHeadroom: input.cpuHeadroom,
      settlementAttempts: input.settlementAttempts ?? 0,
      settlementRetryTick: input.settlementRetryTick ?? null,
      degraded: input.degraded ?? false,
    },
    settlement: { plans: [], faults: [] },
    fspm: { rootP3: null, colonies: [], assignments: [] },
    transport: { bootHeartbeat: true },
  });
  return true;
}
