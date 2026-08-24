export const MEMORY_VERSION = 1;

export interface ColonyMemory {
  roomName: string;
  discoveredAt: number;
}

export interface ScreepsMemorySchema {
  version: number;
  colonies: Record<string, ColonyMemory>;
}

declare global {
  interface Memory extends ScreepsMemorySchema {}
}
