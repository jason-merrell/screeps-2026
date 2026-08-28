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

  if (memory.version === 3) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;

      // v3 Procedure IDs embedded concrete targets and command-level evidence.
      // Supabase retains the historical observations, but runtime authority must
      // restart from governed Procedure identity before collecting new proof.
      portfolio.activities = {};
      portfolio.activityKpiHistory = {};
      const evidencePortfolio = portfolio as typeof portfolio & {
        activityEvents?: unknown[];
        activityEventSequence?: number;
      };
      evidencePortfolio.activityEvents = [];
      evidencePortfolio.activityEventSequence = 0;
      for (const task of Object.values(portfolio.tasks)) {
        task.procedures = [];
        delete task.qi;
      }
    }
    memory.version = 4;
  }

  if (memory.version === 4) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;

      // v4 could close an On Hold Activity from unrelated assignee state, which
      // contaminated Activity outcomes, KPI closeouts, and Task QI. Preserve the
      // governed hierarchy and Procedure definitions, but restart causal evidence.
      portfolio.activities = {};
      portfolio.activityKpiHistory = {};
      const evidencePortfolio = portfolio as typeof portfolio & {
        activityEvents?: unknown[];
        activityEventSequence?: number;
      };
      evidencePortfolio.activityEvents = [];
      evidencePortfolio.activityEventSequence = 0;
      for (const task of Object.values(portfolio.tasks)) delete task.qi;
    }
    memory.version = 5;
  }

  if (memory.version !== MEMORY_VERSION) {
    throw new Error(`Unsupported Memory version ${memory.version}; expected ${MEMORY_VERSION}`);
  }

  memory.colonies ??= {};
}
