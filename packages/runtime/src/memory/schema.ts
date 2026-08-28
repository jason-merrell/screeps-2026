import type { TrafficMemory } from "../movement/traffic-heatmap";
import type { ColonyFspmPortfolio } from "../planning/fspm";
import type { RoomPlan } from "../planning/room-plan";

export const MEMORY_VERSION = 3;

export interface ColonyMemory {
  roomName: string;
  discoveredAt: number;
  fspm?: ColonyFspmPortfolio;
  roomPlan?: RoomPlan;
  traffic?: TrafficMemory;
}

export interface ScreepsMemorySchema {
  version: number;
  colonies: Record<string, ColonyMemory>;
}

declare global {
  interface Memory extends ScreepsMemorySchema {}
}
