import type { TrafficMemory } from "../movement/traffic-heatmap";
import type {
  ColonyFspmPortfolio,
  EmpireFspmPortfolio,
} from "../planning/fspm";
import type { RoomPlan } from "../planning/room-plan";
import type { SettlementProjectionFault } from "../planning/room-plan-projection";
import type { RuntimeSupervisorMemory } from "../runtime/supervisor";

export const MEMORY_VERSION = 10;

export type RuntimeBootPhase = "migration" | "settlement" | "ready" | "fault";

/**
 * Durable, deliberately small progress marker for schema upgrades. The marker
 * lets a CPU-interrupted tick resume before the ordinary runtime (and its
 * expensive planners) is admitted.
 */
export interface RuntimeBootMemory {
  version: 1;
  sourceMemoryVersion: number | null;
  targetMemoryVersion: number;
  phase: RuntimeBootPhase;
  startedAt: number;
  lastProgressTick: number;
  lastFromVersion?: number;
  lastToVersion?: number;
  settlementAttempts: number;
  completedAt?: number;
  /** Settlement boot may fail open so survival planners can resume. */
  degraded?: boolean;
  /** Earliest tick at which degraded settlement may consume one retry tick. */
  settlementRetryTick?: number;
  fault?: string;
}

export interface ColonyMemory {
  roomName: string;
  discoveredAt: number;
  fspm?: ColonyFspmPortfolio;
  roomPlan?: RoomPlan;
  settlementProjectionFault?: SettlementProjectionFault;
  traffic?: TrafficMemory;
}

export interface ScreepsMemorySchema {
  version: number;
  runtimeBoot?: RuntimeBootMemory;
  /** Root P3 authority for the continuously managed empire scope. */
  empireFspm?: EmpireFspmPortfolio;
  runtimeSupervisor?: RuntimeSupervisorMemory;
  colonies: Record<string, ColonyMemory>;
}

declare global {
  interface Memory extends ScreepsMemorySchema {}
}
