import type { TrafficMemory } from "../movement/traffic-heatmap";
import type {
  ColonyFspmPortfolio,
  EmpireFspmPortfolio,
} from "../planning/fspm";
import type { RoomPlan } from "../planning/room-plan";
import type { RuntimeSupervisorMemory } from "../runtime/supervisor";

export const MEMORY_VERSION = 8;

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
  runtimeSupervisor?: RuntimeSupervisorMemory;
  colonies: Record<string, ColonyMemory>;
}

declare global {
  interface Memory extends ScreepsMemorySchema {}
}
