export type CpuMode = "critical" | "constrained" | "normal" | "surplus";

export interface TickBudget {
  limit: number;
  bucket: number;
  used: number;
  mode: CpuMode;
}

export interface WorldSnapshot {
  tick: number;
  rooms: Room[];
  creeps: Creep[];
  spawns: StructureSpawn[];
  budget: TickBudget;
}

export function readTickBudget(): TickBudget {
  const bucket = Game.cpu.bucket;
  const mode: CpuMode =
    bucket < 1000 ? "critical" : bucket < 4000 ? "constrained" : bucket > 9000 ? "surplus" : "normal";

  return {
    limit: Game.cpu.limit,
    bucket,
    used: Game.cpu.getUsed(),
    mode,
  };
}
