import {
  EMPIRE_PORTFOLIO_ID,
  createColonyPortfolioP3,
  createEmpirePortfolioP3,
} from "../planning/fspm";
import { MEMORY_VERSION } from "./schema";

export function migrateMemory(): void {
  const memory = Memory as Partial<Memory>;

  if (memory.version === undefined) {
    memory.version = MEMORY_VERSION;
    memory.colonies = {};
    memory.empireFspm = {
      p3: createEmpirePortfolioP3(Game.time, Game.time),
    };
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

  if (memory.version === 5) {
    const colonies = Object.values(memory.colonies ?? {});
    const earliestColonyTick =
      colonies.length > 0
        ? Math.min(...colonies.map((colony) => colony.discoveredAt))
        : Game.time;

    memory.empireFspm ??= {
      p3: createEmpirePortfolioP3(earliestColonyTick, Game.time),
    };

    for (const colony of colonies) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;

      portfolio.p3 ??= createColonyPortfolioP3(
        colony.roomName,
        colony.discoveredAt,
        Game.time,
      );
      portfolio.p3.parentP3Id = EMPIRE_PORTFOLIO_ID;
      portfolio.p3.temporalBasis = "game_tick";
      portfolio.p3.startTick ??= colony.discoveredAt;
      portfolio.p3.name ??= `COLONY-PORTFOLIO-${colony.roomName} Operations`;
      portfolio.p3.description ??=
        `Continuously manage economy, workforce, construction, defense, expansion and operational priorities for owned colony ${colony.roomName}.`;

      if (portfolio.program && portfolio.program.status !== "retired") {
        portfolio.program.status = "retired";
        portfolio.program.statusReason =
          "retired after governance audit determined colony operations are Portfolio scope, not a Service Program";
        portfolio.program.retiredAt = Game.time;
      }

      if (portfolio.contract && portfolio.contract.status !== "retired") {
        portfolio.contract.status = "retired";
        portfolio.contract.statusReason =
          "retired synthetic contract authority; no Federal customer award or contractual period of performance exists";
        portfolio.contract.updatedAt = Game.time;
      }

      for (const requirement of Object.values(portfolio.requirements)) {
        if (!requirement) continue;
        requirement.p3Id ??= portfolio.p3.id;
      }
    }

    memory.version = 6;
  }

  if (memory.version !== MEMORY_VERSION) {
    throw new Error(`Unsupported Memory version ${memory.version}; expected ${MEMORY_VERSION}`);
  }

  memory.colonies ??= {};
  memory.empireFspm ??= {
    p3: createEmpirePortfolioP3(Game.time, Game.time),
  };
}
