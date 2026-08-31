import {
  createColonyPortfolioP3,
  createEmpirePortfolioP3,
  EMPIRE_PORTFOLIO_ID,
} from "../planning/fspm";
import { validateRoomDevelopmentPlan } from "../planning/room-development";
import { migrateRoomPlanProjection } from "../planning/room-plan-projection";
import { createRuntimeSupervisorMemory } from "../runtime/supervisor";
import { MEMORY_VERSION } from "./schema";

export function migrateMemory(): void {
  const memory = Memory as Partial<Memory>;

  if (memory.version === undefined) {
    memory.version = MEMORY_VERSION;
    memory.colonies = {};
    memory.empireFspm = {
      p3: createEmpirePortfolioP3(Game.time, Game.time),
    };
    memory.runtimeSupervisor = createRuntimeSupervisorMemory();
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
      for (const task of Object.values(portfolio.tasks)) {
        if (task) delete task.qi;
      }
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
        if (!task) continue;
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
      for (const task of Object.values(portfolio.tasks)) {
        if (task) delete task.qi;
      }
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
      portfolio.p3.description ??= `Continuously manage economy, workforce, construction, defense, expansion and operational priorities for owned colony ${colony.roomName}.`;

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

  if (memory.version === 6) {
    memory.runtimeSupervisor ??= createRuntimeSupervisorMemory();
    memory.version = 7;
  }

  if (memory.version === 7) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;
      const requirements = portfolio.requirements ?? {};
      const deliverables = portfolio.deliverables ?? {};
      const tasks = portfolio.tasks ?? {};
      const activities = portfolio.activities ?? {};
      const evidencePortfolio = portfolio as typeof portfolio & {
        activityEvents?: unknown;
        activityEventSequence?: unknown;
      };
      const activityEvents = Array.isArray(evidencePortfolio.activityEvents)
        ? evidencePortfolio.activityEvents
        : evidencePortfolio.activityEvents === undefined
          ? []
          : [evidencePortfolio.activityEvents];
      const activityEventSequence =
        typeof evidencePortfolio.activityEventSequence === "number" &&
        Number.isFinite(evidencePortfolio.activityEventSequence)
          ? evidencePortfolio.activityEventSequence
          : 0;
      const hasPlaceholderSpine =
        Object.keys(requirements).length > 0 ||
        Object.keys(deliverables).length > 0 ||
        Object.keys(tasks).length > 0 ||
        Object.keys(activities).length > 0 ||
        activityEvents.length > 0 ||
        activityEventSequence !== 0;
      if (hasPlaceholderSpine) {
        portfolio.authorityQuarantine ??= [];
        portfolio.authorityQuarantine.push({
          schema: "screeps-fspm-authority-quarantine/v1",
          migratedFromVersion: 7,
          reason:
            "pre-v8 planner-created Requirement/Deliverable authority was compatibility scaffolding and cannot be promoted into an approved obligation",
          quarantinedAtTick: Game.time,
          requirements: requirements as Partial<
            Record<keyof typeof requirements, unknown>
          >,
          deliverables: deliverables as Partial<
            Record<keyof typeof deliverables, unknown>
          >,
          tasks,
          activities,
          activityEvents,
          activityEventSequence,
          qualityHistory: portfolio.qualityHistory ?? {},
          activityKpiHistory: portfolio.activityKpiHistory ?? {},
        });
      }
      portfolio.requirements = {};
      portfolio.deliverables = {};
      portfolio.tasks = {};
      portfolio.activities = {};
      evidencePortfolio.activityEvents = [];
      evidencePortfolio.activityEventSequence = 0;
      portfolio.qualityHistory = {};
      portfolio.activityKpiHistory = {};
      portfolio.requirementApprovalLedger = {};
      portfolio.deliverableReceipts = {};
      portfolio.deliverableReceiptDecisions = {};
      portfolio.authorityLifecycleLedger = {};
      portfolio.authorityLedgerAnchors = {
        deliverableReceipts: { count: 0, headHash: null },
        deliverableReceiptDecisions: { count: 0, headHash: null },
        authorityLifecycle: { count: 0, headHash: null },
      };
      if (portfolio.p3 && typeof portfolio.p3 === "object") {
        delete portfolio.p3.quality;
      }
      delete portfolio.governanceBinding;
    }
    memory.version = 8;
  }

  if (memory.version === 8) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      if (!colony.roomPlan) continue;
      // RoomPlan is a mutable execution projection. This migration adds only
      // operational epoch identity and leaves Deliverable trace linkage and
      // every authoritative FSPM record untouched. Incomplete projections stay
      // pre-epoch so the settlement planner regenerates them from room evidence;
      // migration must never self-fingerprint a truncated mature horizon.
      let issues: string[];
      try {
        issues = validateRoomDevelopmentPlan(colony.roomPlan);
      } catch {
        continue;
      }
      if (issues.length === 0) {
        colony.roomPlan = migrateRoomPlanProjection(colony.roomPlan);
      }
    }
    memory.version = 9;
  }

  if (memory.version === 9) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;

      // v9 room-state/readiness percentages were mislabeled as canonical FSPM
      // quality. They cannot be promoted into Activity KPI evidence. Preserve
      // all authority and receipt ledgers, but restart derived telemetry under
      // explicit operational-health and EQVM contracts.
      portfolio.qualityHistory = {};
      portfolio.operationalHealthHistory = {};
      portfolio.activityKpiHistory = {};
      portfolio.eqvmResearchTelemetry = {};
      if (portfolio.p3) {
        delete portfolio.p3.quality;
        delete portfolio.p3.operationalHealth;
        delete portfolio.p3.pqi;
      }
      for (const requirement of Object.values(portfolio.requirements)) {
        if (!requirement) continue;
        delete requirement.quality;
        delete requirement.operationalHealth;
      }
      for (const deliverable of Object.values(portfolio.deliverables)) {
        if (!deliverable) continue;
        delete deliverable.quality;
        delete deliverable.operationalHealth;
        delete deliverable.dqi;
      }
      for (const task of Object.values(portfolio.tasks)) {
        if (!task) continue;
        delete task.qi;
      }
    }
    memory.version = 10;
  }

  if (memory.version !== MEMORY_VERSION) {
    throw new Error(
      `Unsupported Memory version ${memory.version}; expected ${MEMORY_VERSION}`,
    );
  }

  memory.colonies ??= {};
  memory.empireFspm ??= {
    p3: createEmpirePortfolioP3(Game.time, Game.time),
  };
  memory.runtimeSupervisor ??= createRuntimeSupervisorMemory();
}
