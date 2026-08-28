import type { TrafficMemory } from "../movement/traffic-heatmap";
import type { ColonyFspmPortfolio, EmpireFspmPortfolio } from "../planning/fspm";
import type { RoomPlan } from "../planning/room-plan";

export const MEMORY_VERSION = 6;

export interface ColonyMemory {
  roomName: string;
  discoveredAt: number;
  fspm?: ColonyFspmPortfolio;
  roomPlan?: RoomPlan;
  traffic?: TrafficMemory;
}

export interface ScreepsMemorySchema {
  version: number;
  /** Root P3 authority for the continuously managed empire scope. */
  empireFspm?: EmpireFspmPortfolio;
  colonies: Record<string, ColonyMemory>;
}

declare global {
  interface Memory extends ScreepsMemorySchema {}
}
