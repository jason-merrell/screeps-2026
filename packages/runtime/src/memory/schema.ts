import type { ColonyFspmPortfolio } from "../planning/fspm";
import type { RoomPlan } from "../planning/room-plan";

export const MEMORY_VERSION = 2;

export interface ColonyMemory {
  roomName: string;
  discoveredAt: number;
  fspm?: ColonyFspmPortfolio;
  roomPlan?: RoomPlan;
}

export interface ScreepsMemorySchema {
  version: number;
  colonies: Record<string, ColonyMemory>;
}

declare global {
  interface Memory extends ScreepsMemorySchema {}
}
