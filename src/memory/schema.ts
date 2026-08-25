import type { TickObservabilityTrace } from "../observability/trace";

export const MEMORY_VERSION = 1;

export interface ColonyMemory {
  roomName: string;
  discoveredAt: number;
}

export interface StatsMemory {
  observability?: TickObservabilityTrace;
}

export interface ScreepsMemorySchema {
  version: number;
  colonies: Record<string, ColonyMemory>;
  stats?: StatsMemory;
}

declare global {
  interface Memory extends ScreepsMemorySchema {}
}
