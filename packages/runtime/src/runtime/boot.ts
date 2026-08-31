import type { RuntimeBootMemory } from "../memory/schema";

export interface BootCpuWindow {
  ceiling: number;
  deadline: number;
  headroom: number;
}

export const SETTLEMENT_BOOT_RETRY_TICKS = 100;

const finiteNonnegative = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

/**
 * Keep enough of the assigned (non-bucket) CPU for a tiny heartbeat and the
 * engine's end-of-tick Memory serialization. Boot never assumes bucket burst
 * capacity, which makes a 50-CPU deployment safe on an empty bucket too.
 */
export function bootCpuWindow(input: {
  limit: number;
  tickLimit?: number;
}): BootCpuWindow {
  const limit = finiteNonnegative(input.limit) ?? 0;
  const tickLimit = finiteNonnegative(input.tickLimit) ?? limit;
  const ceiling = Math.min(limit, tickLimit);
  const minimumHeadroom = Math.min(5, ceiling * 0.5);
  const headroom = Math.max(minimumHeadroom, ceiling * 0.2);
  return {
    ceiling,
    deadline: Math.max(0, ceiling - headroom),
    headroom,
  };
}

export function currentBootCpuWindow(): BootCpuWindow {
  return bootCpuWindow({
    limit: Game.cpu.limit,
    tickLimit: Game.cpu.tickLimit,
  });
}

const boundedBootFault = (error: unknown): string => {
  const value =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return value.slice(0, 240);
};

/**
 * Detect the durable marker left when the engine terminated an isolated
 * settlement attempt. Planning is deferrable, so this fails open after one
 * attempt rather than withholding defense, spawning, and economy forever.
 */
export function recoverInterruptedSettlementBoot(
  boot: RuntimeBootMemory,
  tick: number,
): string | null {
  if (
    boot.phase !== "settlement" ||
    boot.settlementAttempts === 0 ||
    boot.lastProgressTick >= tick
  ) {
    return null;
  }

  const fault = boundedBootFault(
    `isolated settlement stabilization attempt ${boot.settlementAttempts} did not record completion before tick ${tick}; normal runtime admitted with settlement degraded`,
  );
  boot.phase = "ready";
  boot.degraded = true;
  boot.fault = fault;
  boot.completedAt = tick;
  boot.lastProgressTick = tick;
  boot.settlementRetryTick ??= tick + SETTLEMENT_BOOT_RETRY_TICKS;
  return fault;
}

/** Persisted immediately before entering the non-preemptible room planner. */
export function startSettlementBootAttempt(
  boot: RuntimeBootMemory,
  tick: number,
): void {
  boot.settlementAttempts += 1;
  boot.lastProgressTick = tick;
  boot.degraded = false;
  boot.settlementRetryTick = tick + SETTLEMENT_BOOT_RETRY_TICKS;
  delete boot.fault;
}

export function completeSettlementBootAttempt(
  boot: RuntimeBootMemory,
  tick: number,
): void {
  boot.phase = "ready";
  boot.degraded = false;
  boot.completedAt = tick;
  boot.lastProgressTick = tick;
  delete boot.settlementRetryTick;
  delete boot.fault;
}

/** Preserve bounded evidence, but never let optional settlement brick World. */
export function failOpenSettlementBoot(
  boot: RuntimeBootMemory,
  tick: number,
  error: unknown,
): string {
  const fault = boundedBootFault(error);
  boot.phase = "ready";
  boot.degraded = true;
  boot.fault = fault;
  boot.completedAt = tick;
  boot.lastProgressTick = tick;
  boot.settlementRetryTick = tick + SETTLEMENT_BOOT_RETRY_TICKS;
  return fault;
}

/** A hard-killed planner gets one retry tick per bounded backoff window. */
export const settlementBootAllowsPlanning = (
  boot: Pick<RuntimeBootMemory, "degraded" | "settlementRetryTick"> | undefined,
  tick: number,
): boolean =>
  boot?.degraded !== true ||
  boot.settlementRetryTick === undefined ||
  tick >= boot.settlementRetryTick;

/** Persist the next backoff before entering a retry that may be hard-killed. */
export function startSettlementBootRetry(
  boot: RuntimeBootMemory,
  tick: number,
): void {
  boot.settlementAttempts += 1;
  boot.lastProgressTick = tick;
  boot.settlementRetryTick = tick + SETTLEMENT_BOOT_RETRY_TICKS;
}
