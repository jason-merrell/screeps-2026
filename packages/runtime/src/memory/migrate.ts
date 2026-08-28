import { MEMORY_VERSION } from "./schema";

export function migrateMemory(): void {
  const memory = Memory as Partial<Memory>;

  if (memory.version === undefined) {
    memory.version = MEMORY_VERSION;
    memory.colonies = {};
    return;
  }

  if (memory.version === 1) {
    memory.version = 2;
  }

  if (memory.version === 2) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;

      portfolio.activities = {};
      portfolio.activityKpiHistory = {};
      for (const task of Object.values(portfolio.tasks)) delete task.qi;
    }
    memory.version = 3;
  }

  if (memory.version !== MEMORY_VERSION) {
    throw new Error(`Unsupported Memory version ${memory.version}; expected ${MEMORY_VERSION}`);
  }

  memory.colonies ??= {};
}
