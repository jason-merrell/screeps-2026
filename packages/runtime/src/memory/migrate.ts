import {
  type ColonyFspmPortfolio,
  createColonyPortfolioP3,
  createEmpirePortfolioP3,
  EMPIRE_PORTFOLIO_ID,
} from "../planning/fspm";
import { validateRoomDevelopmentPlan } from "../planning/room-development";
import { migrateRoomPlanProjection } from "../planning/room-plan-projection";
import { createRuntimeSupervisorMemory } from "../runtime/supervisor";
import {
  MEMORY_VERSION,
  type RuntimeBootMemory,
  type RuntimeBootPhase,
} from "./schema";

export interface MemoryMigrationStepResult {
  state: RuntimeBootPhase;
  sourceVersion: number | null;
  fromVersion: number | null;
  toVersion: number | null;
  targetVersion: number;
  progressed: boolean;
  reason: string;
}

function boundedError(error: unknown): string {
  const value =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return value.slice(0, 240);
}

function currentVersion(memory: Partial<Memory>): number | null {
  return typeof memory.version === "number" && Number.isInteger(memory.version)
    ? memory.version
    : null;
}

function ensureRuntimeBoot(
  memory: Partial<Memory>,
  sourceVersion: number | null,
): RuntimeBootMemory {
  const existing = memory.runtimeBoot;
  if (
    existing?.version === 1 &&
    existing.targetMemoryVersion === MEMORY_VERSION &&
    existing.phase !== "ready"
  ) {
    return existing;
  }
  const created: RuntimeBootMemory = {
    version: 1,
    sourceMemoryVersion: sourceVersion,
    targetMemoryVersion: MEMORY_VERSION,
    phase: "migration",
    startedAt: Game.time,
    lastProgressTick: Game.time,
    settlementAttempts: 0,
    degraded: false,
  };
  memory.runtimeBoot = created;
  return created;
}

function finalizeCurrentMemory(memory: Partial<Memory>): void {
  memory.colonies ??= {};
  memory.empireFspm ??= {
    p3: createEmpirePortfolioP3(Game.time, Game.time),
  };
  memory.runtimeSupervisor ??= createRuntimeSupervisorMemory();
}

type LegacyEvidencePortfolio = ColonyFspmPortfolio & {
  activityEvents?: unknown;
  activityEventSequence?: unknown;
};

/**
 * Build the entire v8 authority projection off-Memory, then replace one
 * portfolio. A timeout before the assignment leaves v7 untouched; a timeout
 * after it leaves a fully transformed, idempotently recognizable portfolio.
 */
function migrateV7Portfolio(
  portfolio: ColonyFspmPortfolio,
): ColonyFspmPortfolio {
  const legacy = portfolio as LegacyEvidencePortfolio;
  const requirements = portfolio.requirements ?? {};
  const deliverables = portfolio.deliverables ?? {};
  const tasks = portfolio.tasks ?? {};
  const activities = portfolio.activities ?? {};
  const activityEvents = Array.isArray(legacy.activityEvents)
    ? legacy.activityEvents
    : legacy.activityEvents === undefined
      ? []
      : [legacy.activityEvents];
  const activityEventSequence =
    typeof legacy.activityEventSequence === "number" &&
    Number.isFinite(legacy.activityEventSequence)
      ? legacy.activityEventSequence
      : 0;
  const hasPlaceholderSpine =
    Object.keys(requirements).length > 0 ||
    Object.keys(deliverables).length > 0 ||
    Object.keys(tasks).length > 0 ||
    Object.keys(activities).length > 0 ||
    activityEvents.length > 0 ||
    activityEventSequence !== 0;
  const p3 = portfolio.p3 ? { ...portfolio.p3 } : portfolio.p3;
  if (p3 && typeof p3 === "object") delete p3.quality;

  const next = {
    ...portfolio,
    ...(p3 ? { p3 } : {}),
    ...(hasPlaceholderSpine
      ? {
          authorityQuarantine: [
            ...(portfolio.authorityQuarantine ?? []),
            {
              schema: "screeps-fspm-authority-quarantine/v1" as const,
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
            },
          ],
        }
      : {}),
    requirements: {},
    deliverables: {},
    tasks: {},
    activities: {},
    qualityHistory: {},
    activityKpiHistory: {},
    requirementApprovalLedger: {},
    deliverableReceipts: {},
    deliverableReceiptDecisions: {},
    authorityLifecycleLedger: {},
    authorityLedgerAnchors: {
      deliverableReceipts: { count: 0, headHash: null },
      deliverableReceiptDecisions: { count: 0, headHash: null },
      authorityLifecycle: { count: 0, headHash: null },
    },
  } as ColonyFspmPortfolio;
  const nextLegacy = next as LegacyEvidencePortfolio;
  nextLegacy.activityEvents = [];
  nextLegacy.activityEventSequence = 0;
  delete next.governanceBinding;
  return next;
}

function migrateV9Portfolio(
  portfolio: ColonyFspmPortfolio,
): ColonyFspmPortfolio {
  const p3 = portfolio.p3 ? { ...portfolio.p3 } : portfolio.p3;
  if (p3) {
    delete p3.quality;
    delete p3.operationalHealth;
    delete p3.pqi;
  }
  const requirements = Object.fromEntries(
    Object.entries(portfolio.requirements).map(([domain, requirement]) => {
      if (!requirement) return [domain, requirement];
      const next = { ...requirement };
      delete next.quality;
      delete next.operationalHealth;
      return [domain, next];
    }),
  ) as ColonyFspmPortfolio["requirements"];
  const deliverables = Object.fromEntries(
    Object.entries(portfolio.deliverables).map(([domain, deliverable]) => {
      if (!deliverable) return [domain, deliverable];
      const next = { ...deliverable };
      delete next.quality;
      delete next.operationalHealth;
      delete next.dqi;
      return [domain, next];
    }),
  ) as ColonyFspmPortfolio["deliverables"];
  const tasks = Object.fromEntries(
    Object.entries(portfolio.tasks).map(([taskId, task]) => {
      const next = { ...task };
      delete next.qi;
      return [taskId, next];
    }),
  ) as ColonyFspmPortfolio["tasks"];

  return {
    ...portfolio,
    ...(p3 ? { p3 } : {}),
    requirements,
    deliverables,
    tasks,
    qualityHistory: {},
    operationalHealthHistory: {},
    activityKpiHistory: {},
    eqvmResearchTelemetry: {},
  };
}

function migrateMemoryPass(stopAfterVersion: boolean): void {
  const memory = Memory as Partial<Memory>;

  if (memory.version === undefined) {
    memory.colonies = {};
    memory.empireFspm = {
      p3: createEmpirePortfolioP3(Game.time, Game.time),
    };
    memory.runtimeSupervisor = createRuntimeSupervisorMemory();
    // The schema version is the commit marker. Publish it only after every
    // required root exists so a CPU interruption cannot expose a false v10.
    memory.version = MEMORY_VERSION;
    return;
  }

  if (memory.version === 1) {
    memory.version = 2;
    if (stopAfterVersion) return;
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
    if (stopAfterVersion) return;
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
    if (stopAfterVersion) return;
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
    if (stopAfterVersion) return;
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
    if (stopAfterVersion) return;
  }

  if (memory.version === 6) {
    memory.runtimeSupervisor ??= createRuntimeSupervisorMemory();
    memory.version = 7;
    if (stopAfterVersion) return;
  }

  if (memory.version === 7) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;
      colony.fspm = migrateV7Portfolio(portfolio);
    }
    memory.version = 8;
    if (stopAfterVersion) return;
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
    if (stopAfterVersion) return;
  }

  if (memory.version === 9) {
    for (const colony of Object.values(memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio) continue;

      // v9 room-state/readiness percentages were mislabeled as canonical FSPM
      // quality. They cannot be promoted into Activity KPI evidence. Preserve
      // all authority and receipt ledgers, but restart derived telemetry under
      // explicit operational-health and EQVM contracts.
      colony.fspm = migrateV9Portfolio(portfolio);
    }
    memory.version = 10;
    if (stopAfterVersion) return;
  }

  if (memory.version !== MEMORY_VERSION) {
    throw new Error(
      `Unsupported Memory version ${memory.version}; expected ${MEMORY_VERSION}`,
    );
  }

  finalizeCurrentMemory(memory);
}

export function migrateMemoryStep(
  options: { shouldDefer?: () => boolean } = {},
): MemoryMigrationStepResult {
  const memory = Memory as Partial<Memory>;
  const fromVersion = currentVersion(memory);

  if (fromVersion === MEMORY_VERSION) {
    finalizeCurrentMemory(memory);
    let boot = memory.runtimeBoot;
    if (boot?.version !== 1 || boot.targetMemoryVersion !== MEMORY_VERSION) {
      boot = {
        version: 1,
        sourceMemoryVersion: fromVersion,
        targetMemoryVersion: MEMORY_VERSION,
        phase: "settlement",
        startedAt: Game.time,
        lastProgressTick: Game.time,
        settlementAttempts: 0,
      };
      memory.runtimeBoot = boot;
      return {
        state: "settlement",
        sourceVersion: fromVersion,
        fromVersion,
        toVersion: fromVersion,
        targetVersion: MEMORY_VERSION,
        progressed: true,
        reason:
          "current schema admitted into one-time settlement stabilization",
      };
    }
    if (boot?.phase === "migration") {
      boot.phase = "settlement";
      boot.degraded = false;
      boot.lastProgressTick = Game.time;
      boot.lastToVersion = MEMORY_VERSION;
      delete boot.fault;
      return {
        state: "settlement",
        sourceVersion: boot.sourceMemoryVersion,
        fromVersion,
        toVersion: fromVersion,
        targetVersion: MEMORY_VERSION,
        progressed: true,
        reason:
          "schema migration committed; settlement stabilization is pending",
      };
    }
    if (boot?.phase === "settlement" || boot?.phase === "fault") {
      return {
        state: boot.phase,
        sourceVersion: boot.sourceMemoryVersion,
        fromVersion,
        toVersion: fromVersion,
        targetVersion: MEMORY_VERSION,
        progressed: false,
        reason:
          boot.phase === "fault"
            ? (boot.fault ?? "runtime boot fault")
            : "settlement stabilization is pending",
      };
    }
    return {
      state: "ready",
      sourceVersion: boot?.sourceMemoryVersion ?? fromVersion,
      fromVersion,
      toVersion: fromVersion,
      targetVersion: MEMORY_VERSION,
      progressed: false,
      reason: "memory schema is current",
    };
  }

  const boot = ensureRuntimeBoot(memory, fromVersion);
  boot.phase = "migration";
  boot.degraded = false;
  delete boot.fault;
  if (options.shouldDefer?.()) {
    return {
      state: "migration",
      sourceVersion: boot.sourceMemoryVersion,
      fromVersion,
      toVersion: fromVersion,
      targetVersion: MEMORY_VERSION,
      progressed: false,
      reason: "migration deferred to preserve boot CPU headroom",
    };
  }

  try {
    migrateMemoryPass(true);
    const toVersion = currentVersion(memory);
    const progressed = toVersion !== fromVersion;
    if (toVersion === MEMORY_VERSION) finalizeCurrentMemory(memory);
    boot.phase = toVersion === MEMORY_VERSION ? "settlement" : "migration";
    boot.degraded = false;
    if (progressed) {
      boot.lastProgressTick = Game.time;
      if (fromVersion !== null) boot.lastFromVersion = fromVersion;
      if (toVersion !== null) boot.lastToVersion = toVersion;
    }
    return {
      state: boot.phase,
      sourceVersion: boot.sourceMemoryVersion,
      fromVersion,
      toVersion,
      targetVersion: MEMORY_VERSION,
      progressed,
      reason:
        toVersion === MEMORY_VERSION
          ? "schema migration committed; settlement stabilization is pending"
          : progressed
            ? `memory schema advanced from v${String(fromVersion)} to v${String(toVersion)}`
            : "memory migration made no version progress",
    };
  } catch (error) {
    const fault = boundedError(error);
    boot.phase = "fault";
    boot.fault = fault;
    boot.lastProgressTick = Game.time;
    return {
      state: "fault",
      sourceVersion: boot.sourceMemoryVersion,
      fromVersion,
      toVersion: currentVersion(memory),
      targetVersion: MEMORY_VERSION,
      progressed: false,
      reason: fault,
    };
  }
}

/** Complete migration helper retained for tests, tools, and explicit consoles. */
export function migrateMemory(): void {
  for (let attempt = 0; attempt <= MEMORY_VERSION + 1; attempt += 1) {
    const result = migrateMemoryStep();
    if (result.state === "fault") throw new Error(result.reason);
    if (Memory.version === MEMORY_VERSION) return;
  }
  throw new Error(
    `Memory migration did not converge on version ${MEMORY_VERSION}`,
  );
}
