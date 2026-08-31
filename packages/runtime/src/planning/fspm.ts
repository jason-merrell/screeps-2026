import type { Intent, IntentTrace } from "../intents/types";
import {
  FSPM_TASK_CATALOG,
  type FspmTaskDetermination,
  fspmProcedureDefinition,
  fspmProcedureIndex,
  fspmTaskDefinition,
  requireFspmTaskDefinition,
} from "./fspm-catalog";

export type FspmDomain = "economy" | "spawning" | "construction" | "defense";
export type FspmStatus = "active" | "completed" | "cancelled" | "retired";
export type FspmTaskStatus = "active" | "retired";
export type FspmActivityStatus =
  | "not_started"
  | "in_progress"
  | "on_hold"
  | "completed";
export type FspmQualityState = "healthy" | "watch" | "degraded";
export type FspmQualityTrend = "new" | "improving" | "stable" | "declining";
export type FspmKpiRating =
  | "exceptional"
  | "satisfactory"
  | "unsatisfactory"
  | "in_progress";

export const EMPIRE_PORTFOLIO_ID = "portfolio:empire:operations";

export interface FspmQuality {
  score: number;
  state: FspmQualityState;
  trend: FspmQualityTrend;
  measuredAt: number;
  evidence: string[];
}

export interface FspmQualitySample {
  tick: number;
  score: number;
  state: FspmQualityState;
}

export interface FspmTaskKpiRubric {
  metric: string;
  exceptional: string;
  satisfactory: string;
  unsatisfactory: string;
}

export interface FspmProcedure {
  id: string;
  taskId: string;
  procedureKey: string;
  title: string;
}

export interface FspmActivityKpiSample {
  tick: number;
  activityId: string;
  activityType: string;
  actor: string;
  rating: FspmKpiRating;
  value: number | null;
  evidence: string;
  outcome?: {
    metric: string;
    actual: number;
    target: number;
    unit: string;
    utilization: number;
  };
}

export interface FspmTaskQi {
  score: number;
  measuredAt: number;
  ratedActivities: number;
  totalActivities: number;
  exceptional: number;
  satisfactory: number;
  unsatisfactory: number;
}

export interface FspmActivityMetrics {
  inProgressTicks: number;
  onHoldTicks: number;
  productiveTicks: number;
  travelTicks: number;
  idleTicks: number;
  holdCount: number;
  resumeCount: number;
  taskPreemptions: number;
  procedureTransitions: number;
}

export interface FspmActivityRecord {
  id: string;
  taskId: string;
  assignee: string;
  status: FspmActivityStatus;
  currentProcedureId: string;
  qualityDescription: string;
  qualityMetric: string;
  kpiMetric: FspmTaskKpiRubric;
  kpiScore?: Exclude<FspmKpiRating, "in_progress">;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  holdReason?: string;
  metrics: FspmActivityMetrics;
}

interface FspmRecordBase {
  id: string;
  title: string;
  status: FspmStatus;
  completionCriterion: string;
  statusReason?: string;
  quality?: FspmQuality;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reopenedAt?: number;
}

interface PortfolioP3Base {
  id: string;
  type: "portfolio";
  subType: "ou_portfolio";
  name: string;
  description: string;
  parentP3Id: string | null;
  /** Screeps adaptation of FSPM Start Date. Runtime scheduling authority is game ticks. */
  temporalBasis: "game_tick";
  startTick: number;
  status: FspmStatus;
  statusReason: string;
  quality?: FspmQuality;
  createdAt: number;
  updatedAt: number;
}

export interface EmpirePortfolioP3 extends PortfolioP3Base {
  id: typeof EMPIRE_PORTFOLIO_ID;
  parentP3Id: null;
}

export interface EmpireFspmPortfolio {
  p3: EmpirePortfolioP3;
}

export interface ColonyPortfolioP3 extends PortfolioP3Base {
  roomName: string;
  parentP3Id: typeof EMPIRE_PORTFOLIO_ID;
}

/** Historical authority retained only to decode pre-migration evidence. */
export interface ColonyServiceProgram {
  id: string;
  type: "program";
  subType: "service_program";
  roomName: string;
  title: string;
  status: "active" | "retired";
  statusReason?: string;
  retiredAt?: number;
}

/** Historical synthetic authority retained only to decode pre-migration evidence. */
export interface ColonyContract extends FspmRecordBase {
  kind: "contract";
  roomName: string;
  programId?: string;
}

export interface ColonyRequirement extends FspmRecordBase {
  kind: "requirement";
  p3Id: string;
  /** Legacy authority retained on migrated records; new requirements omit it. */
  contractId?: string;
  domain: FspmDomain;
}

export interface ColonyDeliverable extends FspmRecordBase {
  kind: "deliverable";
  requirementId: string;
  domain: FspmDomain;
}

export interface ColonyTask {
  kind: "task";
  id: string;
  title: string;
  description?: string;
  status: FspmTaskStatus;
  statusReason?: string;
  deliverableId: string;
  domain: FspmDomain;
  taskKey: string;
  taskWeight?: number;
  qualityDescription: string;
  qualityMetric: string;
  kpiMetric: FspmTaskKpiRubric;
  procedures: FspmProcedure[];
  determination?: FspmTaskDetermination;
  qi?: FspmTaskQi;
  createdAt: number;
  updatedAt: number;
  retiredAt?: number;
}

export interface ColonyFspmPortfolio {
  /** Current P3 authority for all newly generated colony work. */
  p3: ColonyPortfolioP3;
  /** Legacy pre-migration Service Program, retained as historical evidence only. */
  program?: ColonyServiceProgram;
  /** Legacy synthetic contract, retained as historical evidence only. */
  contract?: ColonyContract;
  requirements: Partial<Record<FspmDomain, ColonyRequirement>>;
  deliverables: Partial<Record<FspmDomain, ColonyDeliverable>>;
  tasks: Record<string, ColonyTask>;
  activities?: Record<string, FspmActivityRecord>;
  qualityHistory?: Record<string, FspmQualitySample[]>;
  activityKpiHistory?: Record<string, FspmActivityKpiSample[]>;
}

export type FspmAuthorityDenialCode =
  | "trace_missing"
  | "trace_p3_missing"
  | "empire_p3_missing"
  | "empire_p3_mismatch"
  | "empire_p3_inactive"
  | "p3_missing"
  | "p3_ambiguous"
  | "p3_mismatch"
  | "p3_inactive"
  | "requirement_missing"
  | "requirement_ambiguous"
  | "requirement_mismatch"
  | "requirement_inactive"
  | "deliverable_missing"
  | "deliverable_ambiguous"
  | "deliverable_mismatch"
  | "deliverable_inactive"
  | "task_missing"
  | "task_ambiguous"
  | "task_mismatch"
  | "task_catalog_mismatch"
  | "task_inactive"
  | "procedure_missing"
  | "procedure_ambiguous"
  | "procedure_mismatch"
  | "procedure_catalog_mismatch"
  | "authority_registry_invalid"
  | "intent_type_mismatch"
  | "scope_room_mismatch"
  | "scope_actor_missing"
  | "scope_actor_mismatch"
  | "scope_executor_missing"
  | "scope_executor_mismatch"
  | "scope_target_missing"
  | "scope_target_mismatch"
  | "snapshot_stale";

export interface ActiveFspmAuthority {
  authorized: true;
  roomName: string;
  portfolio: ColonyFspmPortfolio;
  requirement: ColonyRequirement;
  deliverable: ColonyDeliverable;
  task: ColonyTask;
  procedure: FspmProcedure;
}

export interface DeniedFspmAuthority {
  authorized: false;
  code: FspmAuthorityDenialCode;
  reason: string;
}

export type FspmAuthorityResolution = ActiveFspmAuthority | DeniedFspmAuthority;

export interface FspmAuthorityDenialEvidence {
  code: FspmAuthorityDenialCode;
  reason: string;
  intentType: Intent["type"];
  trace: IntentTrace | null;
}

export interface FspmAuthorityDenialSummary {
  total: number;
  byCode: Partial<Record<FspmAuthorityDenialCode, number>>;
  samples: FspmAuthorityDenialEvidence[];
}

export interface FspmAuthoritySnapshot {
  readonly tick: number;
  readonly stats: Readonly<{
    colonies: number;
    requirements: number;
    deliverables: number;
    tasks: number;
    procedures: number;
  }>;
  resolveTrace(trace: IntentTrace): FspmAuthorityResolution;
  resolveIntent(intent: Intent): FspmAuthorityResolution;
}

export interface AuthorizedFspmIntentBatch {
  accepted: Intent[];
  denied: FspmAuthorityDenialSummary;
  snapshot: FspmAuthoritySnapshot;
}

function denyAuthority(
  code: FspmAuthorityDenialCode,
  reason: string,
): DeniedFspmAuthority {
  return { authorized: false, code, reason };
}

interface IndexedPortfolio {
  colonyStorageKey: string;
  colony: Memory["colonies"][string];
  roomName: string;
  portfolio: ColonyFspmPortfolio;
  requirements: Map<string, Array<[string, ColonyRequirement]>>;
  deliverables: Map<string, Array<[string, ColonyDeliverable]>>;
  tasks: Map<string, IndexedTask[]>;
}

interface IndexedTask {
  storageId: string;
  task: ColonyTask;
  procedures: Map<string, FspmProcedure[]>;
  procedureArray: FspmProcedure[];
  procedureIndexesById: Map<string, number>;
}

const AUTHORITY_DENIAL_SAMPLE_LIMIT = 24;

export function createFspmAuthorityDenialSummary(): FspmAuthorityDenialSummary {
  return { total: 0, byCode: {}, samples: [] };
}

export function recordFspmAuthorityDenial(
  summary: FspmAuthorityDenialSummary,
  intent: Intent,
  denial: DeniedFspmAuthority,
): void {
  summary.total += 1;
  summary.byCode[denial.code] = (summary.byCode[denial.code] ?? 0) + 1;
  if (summary.samples.length < AUTHORITY_DENIAL_SAMPLE_LIMIT) {
    summary.samples.push({
      code: denial.code,
      reason: denial.reason,
      intentType: intent.type,
      trace: intent.trace ? { ...intent.trace } : null,
    });
  }
}

export function mergeFspmAuthorityDenials(
  ...summaries: FspmAuthorityDenialSummary[]
): FspmAuthorityDenialSummary {
  const merged = createFspmAuthorityDenialSummary();
  for (const summary of summaries) {
    merged.total += summary.total;
    for (const [code, count] of Object.entries(summary.byCode)) {
      const denialCode = code as FspmAuthorityDenialCode;
      merged.byCode[denialCode] =
        (merged.byCode[denialCode] ?? 0) + (count ?? 0);
    }
    merged.samples.push(
      ...summary.samples
        .slice(0, AUTHORITY_DENIAL_SAMPLE_LIMIT - merged.samples.length)
        .map((sample) => ({
          ...sample,
          trace: sample.trace ? { ...sample.trace } : null,
        })),
    );
  }
  return merged;
}

function appendIndex<T>(index: Map<string, T[]>, id: string, value: T): void {
  const values = index.get(id);
  if (values) values.push(value);
  else index.set(id, [value]);
}

function roomNameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    room?: { name?: unknown };
    pos?: { roomName?: unknown };
  };
  if (typeof candidate.room?.name === "string") return candidate.room.name;
  return typeof candidate.pos?.roomName === "string"
    ? candidate.pos.roomName
    : undefined;
}

function targetIdOf(intent: Intent): string | undefined {
  switch (intent.type) {
    case "move":
    case "withdraw":
    case "transfer":
    case "build":
    case "repair":
    case "towerAttack":
      return String(intent.targetId);
    case "harvest":
      return String(intent.sourceId);
    case "upgrade":
      return String(intent.controllerId);
    case "spawn":
    case "createConstructionSite":
      return undefined;
  }
}

function validateIntentScope(
  intent: Intent,
  authority: ActiveFspmAuthority,
): FspmAuthorityResolution {
  const governedRoom = authority.roomName;

  if ("creepName" in intent) {
    const actor = Game.creeps[intent.creepName];
    const actorRoom = roomNameOf(actor);
    if (!actor || !actorRoom) {
      return denyAuthority(
        "scope_actor_missing",
        `${intent.type} actor ${intent.creepName} cannot be resolved to governed room ${governedRoom}`,
      );
    }
    if (actorRoom !== governedRoom) {
      return denyAuthority(
        "scope_actor_mismatch",
        `${intent.type} actor ${intent.creepName} is in ${actorRoom}, outside governed room ${governedRoom}`,
      );
    }
  }

  if (intent.type === "createConstructionSite") {
    if (intent.roomName !== governedRoom) {
      return denyAuthority(
        "scope_room_mismatch",
        `construction room ${intent.roomName} is outside governed room ${governedRoom}`,
      );
    }
    const room = Game.rooms[governedRoom];
    if (!room) {
      return denyAuthority(
        "scope_executor_missing",
        `construction room ${governedRoom} is not currently visible`,
      );
    }
    return room.controller?.my === true
      ? authority
      : denyAuthority(
          "scope_executor_mismatch",
          `construction room ${governedRoom} is not currently owned`,
        );
  }

  if (intent.type === "spawn") {
    const executor = Game.spawns[intent.spawnName];
    const executorRoom = roomNameOf(executor);
    if (!executor || !executorRoom) {
      return denyAuthority(
        "scope_executor_missing",
        `spawn executor ${intent.spawnName} cannot be resolved to governed room ${governedRoom}`,
      );
    }
    return executorRoom === governedRoom
      ? authority
      : denyAuthority(
          "scope_executor_mismatch",
          `spawn executor ${intent.spawnName} is in ${executorRoom}, outside governed room ${governedRoom}`,
        );
  }

  if (intent.type === "towerAttack") {
    const executor = Game.getObjectById(intent.towerId);
    const executorRoom = roomNameOf(executor);
    if (!executor || !executorRoom) {
      return denyAuthority(
        "scope_executor_missing",
        `tower executor ${intent.towerId} cannot be resolved to governed room ${governedRoom}`,
      );
    }
    if (executorRoom !== governedRoom || executor.my !== true) {
      return denyAuthority(
        "scope_executor_mismatch",
        `tower executor ${intent.towerId} is not an owned tower in governed room ${governedRoom}`,
      );
    }
  }

  const targetId = targetIdOf(intent);
  if (!targetId) return authority;
  const target = (
    Game.getObjectById as unknown as (id: string) => RoomObject | null
  )(targetId);
  const targetRoom = roomNameOf(target);
  if (!target || !targetRoom) {
    return denyAuthority(
      "scope_target_missing",
      `${intent.type} target ${targetId} cannot be resolved to governed room ${governedRoom}`,
    );
  }
  return targetRoom === governedRoom
    ? authority
    : denyAuthority(
        "scope_target_mismatch",
        `${intent.type} target ${targetId} is in ${targetRoom}, outside governed room ${governedRoom}`,
      );
}

/**
 * Build one read-only authority view for the current tick. All hierarchy scans
 * happen here; proposal authorization and Activity binding reuse its indexes.
 */
export function createFspmAuthoritySnapshot(): FspmAuthoritySnapshot {
  let globalRegistryError: string | null = null;
  try {
    currentFspmPlanningAuthorityContext();
    if (planningAuthorityViolationTick === Game.time) {
      globalRegistryError =
        "globally indexed authority changed outside the trace materialization transaction";
    }
  } catch (error) {
    globalRegistryError =
      error instanceof Error ? error.message : String(error);
  }
  const snapshotPlanningRevision = planningAuthorityRevision;
  const snapshotTick = Game.time;
  const empireContainer = Memory.empireFspm;
  const empireP3 = empireContainer?.p3;
  const portfolios = new Map<string, IndexedPortfolio[]>();
  const stats = {
    colonies: 0,
    requirements: 0,
    deliverables: 0,
    tasks: 0,
    procedures: 0,
  };

  for (const [colonyStorageKey, colony] of Object.entries(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (!portfolio?.p3) continue;
    stats.colonies += 1;
    const indexed: IndexedPortfolio = {
      colonyStorageKey,
      colony,
      roomName: colony.roomName,
      portfolio,
      requirements: new Map(),
      deliverables: new Map(),
      tasks: new Map(),
    };
    for (const [domain, requirement] of Object.entries(
      portfolio.requirements,
    )) {
      if (!requirement) continue;
      stats.requirements += 1;
      appendIndex(indexed.requirements, requirement.id, [domain, requirement]);
    }
    for (const [domain, deliverable] of Object.entries(
      portfolio.deliverables,
    )) {
      if (!deliverable) continue;
      stats.deliverables += 1;
      appendIndex(indexed.deliverables, deliverable.id, [domain, deliverable]);
    }
    for (const [id, task] of Object.entries(portfolio.tasks)) {
      if (!task) continue;
      stats.tasks += 1;
      stats.procedures += task.procedures?.length ?? 0;
      const procedures = new Map<string, FspmProcedure[]>();
      const procedureIndexesById = new Map<string, number>();
      for (const [index, procedure] of (task.procedures ?? []).entries()) {
        appendIndex(procedures, procedure.id, procedure);
        procedureIndexesById.set(procedure.id, index);
      }
      appendIndex(indexed.tasks, task.id, {
        storageId: id,
        task,
        procedures,
        procedureArray: task.procedures,
        procedureIndexesById,
      });
    }
    appendIndex(portfolios, portfolio.p3.id, indexed);
  }

  const frozenStats = Object.freeze({ ...stats });

  const resolveTrace = (trace: IntentTrace): FspmAuthorityResolution => {
    if (
      Game.time !== snapshotTick ||
      Memory.empireFspm !== empireContainer ||
      Memory.empireFspm?.p3 !== empireP3
    ) {
      return denyAuthority(
        "snapshot_stale",
        `authority snapshot from tick ${snapshotTick} no longer matches the live hierarchy at tick ${Game.time}`,
      );
    }
    if (!trace.p3Id) {
      return denyAuthority(
        "trace_p3_missing",
        "current execution requires explicit Portfolio/P3 authority; legacy contract authority is historical only",
      );
    }

    if (!empireP3) {
      return denyAuthority(
        "empire_p3_missing",
        "root Empire Portfolio authority is missing",
      );
    }
    if (
      empireP3.id !== EMPIRE_PORTFOLIO_ID ||
      empireP3.type !== "portfolio" ||
      empireP3.subType !== "ou_portfolio" ||
      empireP3.parentP3Id !== null
    ) {
      return denyAuthority(
        "empire_p3_mismatch",
        "root Empire Portfolio does not match the canonical root P3 identity and parentage",
      );
    }
    if (empireP3.status !== "active") {
      return denyAuthority(
        "empire_p3_inactive",
        `root Empire Portfolio is ${empireP3.status}, not active`,
      );
    }

    const portfolioMatches = portfolios.get(trace.p3Id) ?? [];
    if (portfolioMatches.length === 0) {
      return denyAuthority(
        "p3_missing",
        `Portfolio/P3 ${trace.p3Id} is missing`,
      );
    }
    if (portfolioMatches.length !== 1) {
      return denyAuthority(
        "p3_ambiguous",
        `Portfolio/P3 ${trace.p3Id} is not unique`,
      );
    }

    const indexed = portfolioMatches[0];
    if (!indexed) {
      return denyAuthority(
        "p3_missing",
        `Portfolio/P3 ${trace.p3Id} is missing`,
      );
    }
    const { portfolio } = indexed;
    if (
      Memory.colonies[indexed.colonyStorageKey] !== indexed.colony ||
      indexed.colony.fspm !== portfolio
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Portfolio/P3 ${trace.p3Id} was removed or replaced after the authority snapshot was built`,
      );
    }
    if (
      portfolio.p3.id !== trace.p3Id ||
      portfolio.p3.type !== "portfolio" ||
      portfolio.p3.subType !== "ou_portfolio" ||
      portfolio.p3.roomName !== indexed.roomName ||
      portfolio.p3.parentP3Id !== empireP3.id
    ) {
      return denyAuthority(
        "p3_mismatch",
        `Portfolio/P3 ${trace.p3Id} does not belong to the canonical Empire-to-colony P3 chain`,
      );
    }
    if (portfolio.p3.status !== "active") {
      return denyAuthority(
        "p3_inactive",
        `Portfolio/P3 ${trace.p3Id} is ${portfolio.p3.status}, not active`,
      );
    }

    const requirementMatches =
      indexed.requirements.get(trace.requirementId) ?? [];
    if (requirementMatches.length === 0) {
      return denyAuthority(
        "requirement_missing",
        `Requirement ${trace.requirementId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (requirementMatches.length !== 1) {
      return denyAuthority(
        "requirement_ambiguous",
        `Requirement ${trace.requirementId} is not unique within Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const requirementMatch = requirementMatches[0];
    if (!requirementMatch) {
      return denyAuthority(
        "requirement_missing",
        `Requirement ${trace.requirementId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const [requirementDomain, requirement] = requirementMatch;
    if (
      portfolio.requirements[requirementDomain as FspmDomain] !== requirement
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Requirement ${trace.requirementId} was removed or replaced after the authority snapshot was built`,
      );
    }
    if (
      requirement.id !== trace.requirementId ||
      requirement.kind !== "requirement" ||
      requirementDomain !== requirement.domain ||
      requirement.p3Id !== portfolio.p3.id
    ) {
      return denyAuthority(
        "requirement_mismatch",
        `Requirement ${trace.requirementId} does not belong exactly to Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (requirement.status !== "active") {
      return denyAuthority(
        "requirement_inactive",
        `Requirement ${trace.requirementId} is ${requirement.status}, not active`,
      );
    }

    const deliverableMatches =
      indexed.deliverables.get(trace.deliverableId) ?? [];
    if (deliverableMatches.length === 0) {
      return denyAuthority(
        "deliverable_missing",
        `Deliverable ${trace.deliverableId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (deliverableMatches.length !== 1) {
      return denyAuthority(
        "deliverable_ambiguous",
        `Deliverable ${trace.deliverableId} is not unique within Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const deliverableMatch = deliverableMatches[0];
    if (!deliverableMatch) {
      return denyAuthority(
        "deliverable_missing",
        `Deliverable ${trace.deliverableId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const [deliverableDomain, deliverable] = deliverableMatch;
    if (
      portfolio.deliverables[deliverableDomain as FspmDomain] !== deliverable
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Deliverable ${trace.deliverableId} was removed or replaced after the authority snapshot was built`,
      );
    }
    if (
      deliverable.id !== trace.deliverableId ||
      deliverable.kind !== "deliverable" ||
      deliverableDomain !== deliverable.domain ||
      deliverable.domain !== requirement.domain ||
      deliverable.requirementId !== requirement.id
    ) {
      return denyAuthority(
        "deliverable_mismatch",
        `Deliverable ${trace.deliverableId} does not belong exactly to Requirement ${trace.requirementId}`,
      );
    }
    if (deliverable.status !== "active") {
      return denyAuthority(
        "deliverable_inactive",
        `Deliverable ${trace.deliverableId} is ${deliverable.status}, not active`,
      );
    }

    const taskMatches = indexed.tasks.get(trace.taskId) ?? [];
    if (taskMatches.length === 0) {
      return denyAuthority(
        "task_missing",
        `Task ${trace.taskId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (taskMatches.length !== 1) {
      return denyAuthority(
        "task_ambiguous",
        `Task ${trace.taskId} is not unique within Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const taskMatch = taskMatches[0];
    if (!taskMatch) {
      return denyAuthority(
        "task_missing",
        `Task ${trace.taskId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const {
      storageId: taskId,
      task,
      procedures,
      procedureArray,
      procedureIndexesById,
    } = taskMatch;
    if (portfolio.tasks[taskId] !== task) {
      return denyAuthority(
        "snapshot_stale",
        `Task ${trace.taskId} was removed or replaced after the authority snapshot was built`,
      );
    }
    const definition = fspmTaskDefinition(task.domain, task.taskKey);
    const canonicalTaskId = `task:${indexed.roomName}:${task.domain}:${task.taskKey}`;
    if (
      taskId !== task.id ||
      task.kind !== "task" ||
      task.domain !== deliverable.domain ||
      task.deliverableId !== deliverable.id
    ) {
      return denyAuthority(
        "task_mismatch",
        `Task ${trace.taskId} does not belong exactly to Deliverable ${trace.deliverableId}`,
      );
    }
    if (
      !definition ||
      task.id !== canonicalTaskId ||
      task.id !== trace.taskId
    ) {
      return denyAuthority(
        "task_catalog_mismatch",
        `Task ${trace.taskId} is not the exact canonical catalog Task identity for ${indexed.roomName}`,
      );
    }
    if (task.status !== "active") {
      return denyAuthority(
        "task_inactive",
        `Task ${trace.taskId} is ${task.status}, not active`,
      );
    }

    const procedureMatches = procedures.get(trace.procedureId) ?? [];
    if (procedureMatches.length === 0) {
      return denyAuthority(
        "procedure_missing",
        `Procedure ${trace.procedureId} is missing from Task ${trace.taskId}`,
      );
    }
    if (procedureMatches.length !== 1) {
      return denyAuthority(
        "procedure_ambiguous",
        `Procedure ${trace.procedureId} is not unique within Task ${trace.taskId}`,
      );
    }
    const procedure = procedureMatches[0];
    if (!procedure) {
      return denyAuthority(
        "procedure_missing",
        `Procedure ${trace.procedureId} is missing from Task ${trace.taskId}`,
      );
    }
    const liveProcedureIndex = procedureIndexesById.get(trace.procedureId);
    if (
      task.procedures !== procedureArray ||
      task.procedures.length !== procedures.size ||
      liveProcedureIndex === undefined ||
      task.procedures[liveProcedureIndex] !== procedure
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Procedure ${trace.procedureId} was removed or replaced after the authority snapshot was built`,
      );
    }
    const procedureDefinition = fspmProcedureDefinition(
      task.domain,
      task.taskKey,
      procedure.procedureKey,
    );
    const canonicalProcedureId = `procedure:${indexed.roomName}:${task.domain}:${task.taskKey}:${procedure.procedureKey}`;
    if (procedure.taskId !== task.id) {
      return denyAuthority(
        "procedure_mismatch",
        `Procedure ${trace.procedureId} does not belong exactly to Task ${trace.taskId}`,
      );
    }
    if (!procedureDefinition || procedure.id !== canonicalProcedureId) {
      return denyAuthority(
        "procedure_catalog_mismatch",
        `Procedure ${trace.procedureId} is not the exact canonical catalog Procedure identity for Task ${trace.taskId}`,
      );
    }

    if (
      globalRegistryError !== null ||
      planningAuthorityRevision !== snapshotPlanningRevision ||
      planningAuthorityViolationTick === Game.time
    ) {
      return denyAuthority(
        "authority_registry_invalid",
        globalRegistryError ??
          "the global FSPM authority registry changed after the execution snapshot was built",
      );
    }

    return {
      authorized: true,
      roomName: indexed.roomName,
      portfolio,
      requirement,
      deliverable,
      task,
      procedure,
    };
  };

  const resolveIntent = (intent: Intent): FspmAuthorityResolution => {
    if (!intent.trace) {
      return denyAuthority(
        "trace_missing",
        `${intent.type} intent has no FSPM authority trace`,
      );
    }
    const resolution = resolveTrace(intent.trace);
    if (!resolution.authorized) return resolution;
    const procedureDefinition = fspmProcedureDefinition(
      resolution.task.domain,
      resolution.task.taskKey,
      resolution.procedure.procedureKey,
    );
    if (!procedureDefinition?.allowedIntentTypes.includes(intent.type)) {
      return denyAuthority(
        "intent_type_mismatch",
        `Procedure ${resolution.procedure.id} does not authorize ${intent.type} intents`,
      );
    }
    return validateIntentScope(intent, resolution);
  };

  return Object.freeze({
    tick: snapshotTick,
    stats: frozenStats,
    resolveTrace,
    resolveIntent,
  });
}

/** Resolve against an explicit tick snapshot when available. */
export function resolveActiveFspmAuthority(
  trace: IntentTrace,
  snapshot: FspmAuthoritySnapshot = createFspmAuthoritySnapshot(),
): FspmAuthorityResolution {
  return snapshot.resolveTrace(trace);
}

export function validateFspmIntentAuthority(
  intent: Intent,
  snapshot: FspmAuthoritySnapshot = createFspmAuthoritySnapshot(),
): FspmAuthorityResolution {
  return snapshot.resolveIntent(intent);
}

export function authorizedFspmIntents(
  intents: Intent[],
  snapshot: FspmAuthoritySnapshot = createFspmAuthoritySnapshot(),
): AuthorizedFspmIntentBatch {
  const accepted: Intent[] = [];
  const denied = createFspmAuthorityDenialSummary();
  for (const intent of intents) {
    const resolution = snapshot.resolveIntent(intent);
    if (resolution.authorized) {
      accepted.push(intent);
      continue;
    }
    recordFspmAuthorityDenial(denied, intent, resolution);
  }
  return { accepted, denied, snapshot };
}

const titleCase = (value: string): string =>
  value
    .split("-")
    .map((part) =>
      part.length > 0
        ? `${part.charAt(0).toUpperCase()}${part.slice(1)}`
        : part,
    )
    .join(" ");

const childRollupCriterion =
  "complete when the governed acceptance criteria for this record are satisfied";

const defaultQualityDescription = (taskKey: string): string =>
  `${titleCase(taskKey)} produces the intended colony outcome without unnecessary interruption or rework`;

const defaultQualityMetric = (taskKey: string): string =>
  `${titleCase(taskKey)} is evaluated from completed Activity outcome evidence`;

const defaultKpiMetric = (taskKey: string): FspmTaskKpiRubric => ({
  metric: `${titleCase(taskKey)} execution effectiveness`,
  exceptional:
    "completed Activity exceeds the task-specific expected threshold",
  satisfactory: "completed Activity satisfies the task Quality Metric",
  unsatisfactory:
    "completed Activity fails the task Quality Metric or requires material rework",
});

function applyCanonicalDefinition(task: ColonyTask): void {
  const definition = fspmTaskDefinition(task.domain, task.taskKey);
  if (!definition) return;

  task.title = definition.title;
  task.description = definition.description;
  task.taskWeight = definition.taskWeight;
  task.qualityDescription = definition.qualityDescription;
  task.qualityMetric = definition.qualityMetric;
  task.kpiMetric = { ...definition.kpiMetric };
  task.determination = { ...definition.determination };
  task.procedures ??= [];

  for (const procedureDefinition of definition.procedures) {
    const id = `procedure:${task.id.slice("task:".length)}:${procedureDefinition.key}`;
    const existing = task.procedures.find((procedure) => procedure.id === id);
    if (existing) {
      existing.title = procedureDefinition.title;
      existing.procedureKey = procedureDefinition.key;
      continue;
    }
    task.procedures.push({
      id,
      taskId: task.id,
      procedureKey: procedureDefinition.key,
      title: procedureDefinition.title,
    });
  }
}

function transitionStatus(
  record: FspmRecordBase,
  next: "active" | "completed",
  reason: string,
): void {
  if (record.status === "cancelled" || record.status === "retired") return;
  // Reopening is a governed lifecycle decision, not a side effect of planner
  // demand. An inactive ancestor must remain inactive until explicitly changed.
  if (next === "active" && record.status !== "active") return;
  if (record.status === next && record.statusReason === reason) return;

  const previous = record.status;
  record.status = next;
  record.statusReason = reason;
  record.updatedAt = Game.time;

  if (next === "completed") {
    record.completedAt = Game.time;
  } else if (previous === "completed") {
    record.reopenedAt = Game.time;
    delete record.completedAt;
  }
}

function earliestKnownColonyTick(): number {
  const discovered = Object.values(Memory.colonies).map(
    (colony) => colony.discoveredAt,
  );
  return discovered.length > 0 ? Math.min(...discovered) : Game.time;
}

function assertUniqueRegistryIds(
  label: string,
  ids: Map<string, string[]>,
): void {
  for (const [id, placements] of ids) {
    if (placements.length > 1) {
      throw new Error(
        `FSPM identity registry is ambiguous: ${label} ${id} appears at ${placements.join(", ")}`,
      );
    }
  }
}

export interface FspmPlanningAuthorityDiagnostics {
  readonly globalRegistryTraversals: number;
  readonly traceAuthorityChecks: number;
}

interface FspmPlanningTaskWitness {
  storageId: string;
  task: ColonyTask;
  procedures: FspmProcedure[];
  proceduresById: Map<string, FspmProcedure>;
  procedureIndexesById: Map<string, number>;
}

interface FspmPlanningRoomWitness {
  colony: Memory["colonies"][string];
  portfolio: ColonyFspmPortfolio | undefined;
  p3: ColonyPortfolioP3 | undefined;
  requirements: ColonyFspmPortfolio["requirements"] | undefined;
  deliverables: ColonyFspmPortfolio["deliverables"] | undefined;
  tasks: ColonyFspmPortfolio["tasks"] | undefined;
  requirementsByDomain: Map<string, ColonyRequirement>;
  deliverablesByDomain: Map<string, ColonyDeliverable>;
  tasksById: Map<string, FspmPlanningTaskWitness>;
}

interface FspmPlanningAuthorityContext {
  tick: number;
  memory: Memory;
  colonies: Memory["colonies"];
  empire: Memory["empireFspm"];
  empireP3: EmpirePortfolioP3 | undefined;
  revision: number;
  rooms: Map<string, FspmPlanningRoomWitness>;
}

const planningAuthorityDiagnostics = {
  globalRegistryTraversals: 0,
  traceAuthorityChecks: 0,
};

let planningAuthorityRevision = 0;
let traceCreationDepth = 0;
let planningAuthorityContext: FspmPlanningAuthorityContext | undefined;
let planningAuthorityGuardTick: number | undefined;
let planningAuthorityViolationTick: number | undefined;
let planningAuthorityGuardMemory: Memory | undefined;
let planningAuthorityViolationCheckedRevision: number | undefined;
let planningAuthorityViolationError: string | undefined;
let controlledAuthorityMutationDepth = 0;

const guardedAuthorityProperties = new WeakMap<object, Set<PropertyKey>>();
const guardedProcedureArrays = new WeakSet<FspmProcedure[]>();
const guardedAuthorityPortfolios = new WeakSet<ColonyFspmPortfolio>();
const guardedAuthorityTasks = new WeakSet<ColonyTask>();
const fspmDomains = [
  "economy",
  "spawning",
  "construction",
  "defense",
] as const satisfies readonly FspmDomain[];

/** Read-only counters used to prove planner authority work scales linearly. */
export function getFspmPlanningAuthorityDiagnostics(): FspmPlanningAuthorityDiagnostics {
  return Object.freeze({ ...planningAuthorityDiagnostics });
}

function invalidateFspmPlanningAuthorityContext(): void {
  if (traceCreationDepth > 0) return;
  planningAuthorityRevision += 1;
  planningAuthorityContext = undefined;
}

/**
 * Replace last tick's guarded authority containers with equivalent plain,
 * extensible containers before perception can discover a new colony. Screeps
 * normally rehydrates Memory between ticks; the explicit release also keeps
 * persistent-VM harnesses and same-process tests correct.
 */
export function prepareFspmPlanningTick(): void {
  if (
    planningAuthorityGuardMemory !== undefined &&
    planningAuthorityGuardMemory !== Memory
  ) {
    planningAuthorityGuardMemory = undefined;
    planningAuthorityGuardTick = undefined;
    planningAuthorityViolationTick = undefined;
    planningAuthorityViolationCheckedRevision = undefined;
    planningAuthorityViolationError = undefined;
    planningAuthorityRevision += 1;
    planningAuthorityContext = undefined;
    return;
  }
  if (
    planningAuthorityGuardTick === undefined ||
    planningAuthorityGuardTick === Game.time
  ) {
    return;
  }

  if (Memory.empireFspm) {
    const empire = { ...Memory.empireFspm };
    if (Memory.empireFspm.p3) empire.p3 = { ...Memory.empireFspm.p3 };
    Memory.empireFspm = empire;
  }

  Memory.colonies = Object.fromEntries(
    Object.entries(Memory.colonies).map(([roomName, colony]) => {
      const portfolio = colony.fspm;
      if (!portfolio) return [roomName, { ...colony }];

      const requirements = Object.fromEntries(
        Object.entries(portfolio.requirements).map(([domain, requirement]) => [
          domain,
          requirement ? { ...requirement } : requirement,
        ]),
      ) as ColonyFspmPortfolio["requirements"];
      const deliverables = Object.fromEntries(
        Object.entries(portfolio.deliverables).map(([domain, deliverable]) => [
          domain,
          deliverable ? { ...deliverable } : deliverable,
        ]),
      ) as ColonyFspmPortfolio["deliverables"];
      const tasks = Object.fromEntries(
        Object.entries(portfolio.tasks).flatMap(([taskId, task]) =>
          task
            ? [
                [
                  taskId,
                  {
                    ...task,
                    procedures: task.procedures.map((procedure) => ({
                      ...procedure,
                    })),
                  },
                ] as const,
              ]
            : [],
        ),
      );

      const nextPortfolio = {
        ...portfolio,
        requirements,
        deliverables,
        tasks,
      };
      if (portfolio.p3) nextPortfolio.p3 = { ...portfolio.p3 };
      return [roomName, { ...colony, fspm: nextPortfolio }];
    }),
  );
  planningAuthorityGuardTick = undefined;
  planningAuthorityViolationTick = undefined;
  planningAuthorityViolationCheckedRevision = undefined;
  planningAuthorityViolationError = undefined;
  planningAuthorityGuardMemory = undefined;
  planningAuthorityRevision += 1;
  planningAuthorityContext = undefined;
}

function recordGuardedAuthorityMutation(): void {
  if (traceCreationDepth > 0 || controlledAuthorityMutationDepth > 0) return;
  if (planningAuthorityGuardTick === Game.time) {
    planningAuthorityViolationTick = Game.time;
    planningAuthorityViolationCheckedRevision = undefined;
    planningAuthorityViolationError = undefined;
  }
  invalidateFspmPlanningAuthorityContext();
}

function controlledAuthorityMutation<T>(operation: () => T): T {
  controlledAuthorityMutationDepth += 1;
  try {
    return operation();
  } finally {
    controlledAuthorityMutationDepth -= 1;
  }
}

function guardAuthorityProperty(
  target: object,
  key: PropertyKey,
  enumerableWhenMissing = true,
): void {
  let guarded = guardedAuthorityProperties.get(target);
  if (!guarded) {
    guarded = new Set();
    guardedAuthorityProperties.set(target, guarded);
  }
  if (guarded.has(key)) return;

  const record = target as Record<PropertyKey, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && descriptor.configurable === false) return;
  let value = record[key];
  const enumerable = descriptor?.enumerable ?? enumerableWhenMissing;
  guarded.add(key);

  const defineGuard = (): void => {
    Object.defineProperty(target, key, {
      configurable: false,
      enumerable,
      get: () => value,
      set: (next: unknown) => {
        if (Object.is(next, value)) return;
        value = next;
        recordGuardedAuthorityMutation();
      },
    });
  };
  defineGuard();
}

function guardAuthorityFields(
  record: object,
  fields: readonly PropertyKey[],
): void {
  for (const field of fields) guardAuthorityProperty(record, field);
}

function guardProcedureArray(procedures: FspmProcedure[]): void {
  if (guardedProcedureArrays.has(procedures)) return;
  guardedProcedureArrays.add(procedures);
  for (const index of procedures.keys()) {
    guardAuthorityProperty(procedures, index);
  }
  for (const method of [
    "copyWithin",
    "fill",
    "pop",
    "push",
    "reverse",
    "shift",
    "sort",
    "splice",
    "unshift",
  ] as const) {
    Object.defineProperty(procedures, method, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function guardedProcedureMutation(
        this: FspmProcedure[],
        ...args: unknown[]
      ) {
        recordGuardedAuthorityMutation();
        const result = (
          Array.prototype[method] as (...values: unknown[]) => unknown
        ).apply(this, args);
        return result;
      },
    });
  }
}

function guardTaskAuthority(task: ColonyTask): void {
  if (guardedAuthorityTasks.has(task)) return;
  guardedAuthorityTasks.add(task);
  guardAuthorityFields(task, [
    "kind",
    "id",
    "deliverableId",
    "domain",
    "taskKey",
    "status",
    "procedures",
  ]);
  guardProcedureArray(task.procedures);
  for (const procedure of task.procedures) {
    guardAuthorityFields(procedure, ["id", "taskId", "procedureKey"]);
  }

  const definition = fspmTaskDefinition(task.domain, task.taskKey);
  const procedureIds = new Set(
    task.procedures.map((procedure) => procedure.id),
  );
  const hasCompleteCanonicalProcedureSet =
    definition !== undefined &&
    task.procedures.length === definition.procedures.length &&
    definition.procedures.every((procedure) =>
      procedureIds.has(
        `procedure:${task.id.slice("task:".length)}:${procedure.key}`,
      ),
    );
  if (hasCompleteCanonicalProcedureSet) {
    Object.preventExtensions(task.procedures);
  }
}

function guardPortfolioAuthority(
  roomName: string,
  portfolio: ColonyFspmPortfolio,
): void {
  if (guardedAuthorityPortfolios.has(portfolio)) return;
  guardedAuthorityPortfolios.add(portfolio);
  guardAuthorityProperty(portfolio, "p3");
  guardAuthorityProperty(portfolio, "requirements");
  guardAuthorityProperty(portfolio, "deliverables");
  guardAuthorityProperty(portfolio, "tasks");
  guardAuthorityFields(portfolio.p3, [
    "id",
    "type",
    "subType",
    "roomName",
    "parentP3Id",
    "status",
  ]);

  for (const domain of fspmDomains) {
    const requirement = portfolio.requirements[domain];
    guardAuthorityProperty(portfolio.requirements, domain, true);
    if (requirement) {
      guardAuthorityFields(requirement, [
        "kind",
        "id",
        "p3Id",
        "domain",
        "status",
      ]);
    }

    const deliverable = portfolio.deliverables[domain];
    guardAuthorityProperty(portfolio.deliverables, domain, true);
    if (deliverable) {
      guardAuthorityFields(deliverable, [
        "kind",
        "id",
        "requirementId",
        "domain",
        "status",
      ]);
    }
  }

  for (const definition of FSPM_TASK_CATALOG) {
    const taskId = `task:${roomName}:${definition.domain}:${definition.taskKey}`;
    guardAuthorityProperty(portfolio.tasks, taskId, true);
  }
  for (const task of Object.values(portfolio.tasks)) {
    if (task) guardTaskAuthority(task);
  }

  Object.preventExtensions(portfolio.requirements);
  Object.preventExtensions(portfolio.deliverables);
  Object.preventExtensions(portfolio.tasks);
}

function installFspmAuthorityMutationGuards(): void {
  guardAuthorityProperty(Memory, "empireFspm");
  if (Memory.empireFspm) {
    guardAuthorityProperty(Memory.empireFspm, "p3");
    guardAuthorityFields(Memory.empireFspm.p3, [
      "id",
      "type",
      "subType",
      "parentP3Id",
      "status",
    ]);
  }

  for (const [roomName, colony] of Object.entries(Memory.colonies)) {
    guardAuthorityProperty(Memory.colonies, roomName);
    guardAuthorityProperty(colony, "fspm");
    if (colony.fspm) guardPortfolioAuthority(roomName, colony.fspm);
  }
  Object.preventExtensions(Memory.colonies);
  planningAuthorityGuardTick = Game.time;
  planningAuthorityGuardMemory = Memory;
}

function guardMaterializedAuthoritySpine(
  roomName: string,
  portfolio: ColonyFspmPortfolio,
  requirement: ColonyRequirement,
  deliverable: ColonyDeliverable,
  task: ColonyTask,
  procedure: FspmProcedure,
): void {
  guardAuthorityProperty(Memory, "empireFspm");
  if (Memory.empireFspm) {
    guardAuthorityProperty(Memory.empireFspm, "p3");
    guardAuthorityFields(Memory.empireFspm.p3, [
      "id",
      "type",
      "subType",
      "parentP3Id",
      "status",
    ]);
  }
  const colony = Memory.colonies[roomName];
  if (colony) guardAuthorityProperty(colony, "fspm");

  if (!guardedAuthorityPortfolios.has(portfolio)) {
    guardPortfolioAuthority(roomName, portfolio);
    return;
  }
  guardAuthorityFields(requirement, ["kind", "id", "p3Id", "domain", "status"]);
  guardAuthorityFields(deliverable, [
    "kind",
    "id",
    "requirementId",
    "domain",
    "status",
  ]);
  guardTaskAuthority(task);
  guardAuthorityFields(procedure, ["id", "taskId", "procedureKey"]);
}

/**
 * Validate and index every persisted authority identity before planner ensure
 * paths mutate Memory. The returned witnesses retain live object references so
 * later trace requests can validate only their requested authority spine.
 */
function buildFspmPlanningAuthorityContext(): FspmPlanningAuthorityContext {
  prepareFspmPlanningTick();
  planningAuthorityDiagnostics.globalRegistryTraversals += 1;
  if (Memory.empireFspm && !Memory.empireFspm.p3) {
    throw new Error(
      "FSPM Empire authority container is missing its required root P3; refusing implicit approval",
    );
  }
  const empireP3 = Memory.empireFspm?.p3;
  if (
    empireP3 &&
    (empireP3.id !== EMPIRE_PORTFOLIO_ID ||
      empireP3.type !== "portfolio" ||
      empireP3.subType !== "ou_portfolio" ||
      empireP3.parentP3Id !== null)
  ) {
    throw new Error("FSPM Empire Portfolio identity is not canonical");
  }

  const registries = {
    p3: new Map<string, string[]>(),
    requirement: new Map<string, string[]>(),
    deliverable: new Map<string, string[]>(),
    task: new Map<string, string[]>(),
    procedure: new Map<string, string[]>(),
  };
  const rooms = new Map<string, FspmPlanningRoomWitness>();
  const record = (
    index: Map<string, string[]>,
    id: string,
    placement: string,
  ) => {
    const placements = index.get(id);
    if (placements) placements.push(placement);
    else index.set(id, [placement]);
  };

  for (const [colonyKey, colony] of Object.entries(Memory.colonies)) {
    if (colonyKey !== colony.roomName) {
      throw new Error(
        `FSPM identity registry colony key ${colonyKey} disagrees with roomName ${colony.roomName}`,
      );
    }
    const portfolio = colony.fspm;
    const roomWitness: FspmPlanningRoomWitness = {
      colony,
      portfolio,
      p3: portfolio?.p3,
      requirements: portfolio?.requirements,
      deliverables: portfolio?.deliverables,
      tasks: portfolio?.tasks,
      requirementsByDomain: new Map(),
      deliverablesByDomain: new Map(),
      tasksById: new Map(),
    };
    rooms.set(colonyKey, roomWitness);
    if (!portfolio) continue;
    if (!portfolio.p3) {
      throw new Error(
        `FSPM colony authority container ${colonyKey} is missing its required root P3; refusing implicit approval`,
      );
    }
    const expectedP3Id = `portfolio:colony:${colony.roomName}`;
    record(registries.p3, portfolio.p3.id, `${colonyKey}.p3`);
    if (
      portfolio.p3.id !== expectedP3Id ||
      portfolio.p3.roomName !== colony.roomName ||
      portfolio.p3.parentP3Id !== EMPIRE_PORTFOLIO_ID
    ) {
      throw new Error(
        `FSPM colony Portfolio identity is not canonical at ${colonyKey}.p3`,
      );
    }

    for (const [registryKey, requirement] of Object.entries(
      portfolio.requirements,
    )) {
      if (!requirement) continue;
      record(
        registries.requirement,
        requirement.id,
        `${colonyKey}.requirements.${registryKey}`,
      );
      if (
        registryKey !== requirement.domain ||
        requirement.id !==
          `requirement:${colony.roomName}:${requirement.domain}` ||
        requirement.p3Id !== expectedP3Id
      ) {
        throw new Error(
          `FSPM Requirement identity is not canonical at ${colonyKey}.requirements.${registryKey}`,
        );
      }
      roomWitness.requirementsByDomain.set(requirement.domain, requirement);
    }

    for (const [registryKey, deliverable] of Object.entries(
      portfolio.deliverables,
    )) {
      if (!deliverable) continue;
      record(
        registries.deliverable,
        deliverable.id,
        `${colonyKey}.deliverables.${registryKey}`,
      );
      if (
        registryKey !== deliverable.domain ||
        deliverable.id !==
          `deliverable:${colony.roomName}:${deliverable.domain}` ||
        deliverable.requirementId !==
          `requirement:${colony.roomName}:${deliverable.domain}`
      ) {
        throw new Error(
          `FSPM Deliverable identity is not canonical at ${colonyKey}.deliverables.${registryKey}`,
        );
      }
      roomWitness.deliverablesByDomain.set(deliverable.domain, deliverable);
    }

    for (const [storageId, task] of Object.entries(portfolio.tasks)) {
      if (!task) continue;
      const expectedTaskId = `task:${colony.roomName}:${task.domain}:${task.taskKey}`;
      record(registries.task, task.id, `${colonyKey}.tasks.${storageId}`);
      if (
        storageId !== task.id ||
        task.id !== expectedTaskId ||
        task.deliverableId !== `deliverable:${colony.roomName}:${task.domain}`
      ) {
        throw new Error(
          `FSPM Task identity is not canonical at ${colonyKey}.tasks.${storageId}`,
        );
      }
      const taskWitness: FspmPlanningTaskWitness = {
        storageId,
        task,
        procedures: task.procedures,
        proceduresById: new Map(),
        procedureIndexesById: new Map(),
      };
      roomWitness.tasksById.set(task.id, taskWitness);
      const definition = fspmTaskDefinition(task.domain, task.taskKey);
      if (
        task.status === "active" &&
        definition &&
        task.procedures.length !== definition.procedures.length
      ) {
        throw new Error(
          `FSPM Task ${task.id} does not contain the exact canonical Procedure set`,
        );
      }
      for (const [procedureIndex, procedure] of task.procedures.entries()) {
        const catalogProcedure = definition?.procedures[procedureIndex];
        const expectedProcedureKey =
          task.status === "active" && definition
            ? catalogProcedure?.key
            : procedure.procedureKey;
        const expectedProcedureId = `procedure:${colony.roomName}:${task.domain}:${task.taskKey}:${expectedProcedureKey}`;
        record(
          registries.procedure,
          procedure.id,
          `${colonyKey}.tasks.${storageId}.procedures.${procedureIndex}`,
        );
        if (
          !expectedProcedureKey ||
          procedure.procedureKey !== expectedProcedureKey ||
          procedure.id !== expectedProcedureId ||
          procedure.taskId !== task.id
        ) {
          throw new Error(
            `FSPM Procedure identity is not canonical at ${colonyKey}.tasks.${storageId}.procedures.${procedureIndex}`,
          );
        }
        taskWitness.proceduresById.set(procedure.id, procedure);
        taskWitness.procedureIndexesById.set(procedure.id, procedureIndex);
      }
    }
  }

  assertUniqueRegistryIds("Portfolio/P3", registries.p3);
  assertUniqueRegistryIds("Requirement", registries.requirement);
  assertUniqueRegistryIds("Deliverable", registries.deliverable);
  assertUniqueRegistryIds("Task", registries.task);
  assertUniqueRegistryIds("Procedure", registries.procedure);
  installFspmAuthorityMutationGuards();

  return {
    tick: Game.time,
    memory: Memory,
    colonies: Memory.colonies,
    empire: Memory.empireFspm,
    empireP3: Memory.empireFspm?.p3,
    revision: planningAuthorityRevision,
    rooms,
  };
}

function currentFspmPlanningAuthorityContext(): FspmPlanningAuthorityContext {
  prepareFspmPlanningTick();
  if (planningAuthorityViolationTick === Game.time) {
    if (
      planningAuthorityViolationCheckedRevision === planningAuthorityRevision
    ) {
      throw new Error(
        planningAuthorityViolationError ??
          "Cannot create FSPM trace: globally indexed authority changed outside the trace materialization transaction",
      );
    }
    try {
      const context = buildFspmPlanningAuthorityContext();
      planningAuthorityContext = context;
      planningAuthorityViolationCheckedRevision = planningAuthorityRevision;
      planningAuthorityViolationError =
        "Cannot create FSPM trace: globally indexed authority changed outside the trace materialization transaction";
      return context;
    } catch (error) {
      planningAuthorityViolationCheckedRevision = planningAuthorityRevision;
      planningAuthorityViolationError =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  const cached = planningAuthorityContext;
  if (
    cached &&
    cached.tick === Game.time &&
    cached.memory === Memory &&
    cached.revision === planningAuthorityRevision
  ) {
    if (
      cached.colonies !== Memory.colonies ||
      cached.empire !== Memory.empireFspm ||
      cached.empireP3 !== Memory.empireFspm?.p3
    ) {
      throw new Error(
        "Cannot create FSPM trace: authority containers changed after the tick index was built",
      );
    }
    return cached;
  }

  const context = buildFspmPlanningAuthorityContext();
  planningAuthorityContext = context;
  return context;
}

function planningRoomWitness(roomName: string): {
  context: FspmPlanningAuthorityContext;
  witness: FspmPlanningRoomWitness;
} {
  const context = currentFspmPlanningAuthorityContext();
  const colony = Memory.colonies[roomName];
  const witness = context.rooms.get(roomName);
  if (!colony) {
    throw new Error(`Cannot create FSPM trace for unknown colony ${roomName}`);
  }

  if (!witness) {
    throw new Error(
      `Cannot create FSPM trace: colony ${roomName} changed during authority indexing`,
    );
  }
  if (
    witness.colony !== colony ||
    witness.portfolio !== colony.fspm ||
    witness.p3 !== colony.fspm?.p3 ||
    witness.requirements !== colony.fspm?.requirements ||
    witness.deliverables !== colony.fspm?.deliverables ||
    witness.tasks !== colony.fspm?.tasks
  ) {
    throw new Error(
      `Cannot create FSPM trace: colony ${roomName} authority containers changed after the tick index was built`,
    );
  }
  return { context, witness };
}

/**
 * Planner-side read-only guard. If any existing authority record for the
 * requested canonical spine is inactive or contradictory, trace creation must
 * throw before compatibility/defaulting code can touch Memory.
 */
export function assertFspmTraceCreationAllowed(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): void {
  planningAuthorityDiagnostics.traceAuthorityChecks += 1;
  requireFspmTaskDefinition(domain, taskKey);
  if (!fspmProcedureDefinition(domain, taskKey, procedureKey)) {
    throw new Error(
      `Unknown FSPM Procedure ${domain}:${taskKey}:${procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }

  const { context, witness } = planningRoomWitness(roomName);
  const assertNoOutOfBandMutation = (): void => {
    if (planningAuthorityViolationTick === Game.time) {
      throw new Error(
        "Cannot create FSPM trace: globally indexed authority changed outside the trace materialization transaction",
      );
    }
  };
  const empire = context.empireP3;
  if (
    empire &&
    (empire.id !== EMPIRE_PORTFOLIO_ID ||
      empire.type !== "portfolio" ||
      empire.subType !== "ou_portfolio" ||
      empire.parentP3Id !== null)
  ) {
    throw new Error(
      "Cannot create FSPM trace: Empire Portfolio identity is not canonical",
    );
  }
  if (empire && empire.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Empire Portfolio is ${empire.status}`,
    );
  }
  const portfolio = witness.portfolio;
  if (!portfolio) {
    assertNoOutOfBandMutation();
    return;
  }
  if (
    portfolio.p3.id !== `portfolio:colony:${roomName}` ||
    portfolio.p3.type !== "portfolio" ||
    portfolio.p3.subType !== "ou_portfolio" ||
    portfolio.p3.roomName !== roomName ||
    portfolio.p3.parentP3Id !== EMPIRE_PORTFOLIO_ID
  ) {
    throw new Error(
      "Cannot create FSPM trace: colony Portfolio identity is not canonical",
    );
  }
  if (portfolio.p3.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: colony Portfolio is ${portfolio.p3.status}`,
    );
  }
  const requirement = portfolio.requirements[domain];
  if (requirement !== witness.requirementsByDomain.get(domain)) {
    throw new Error(
      "Cannot create FSPM trace: Requirement changed after the tick index was built",
    );
  }
  if (
    requirement &&
    (requirement.kind !== "requirement" ||
      requirement.id !== `requirement:${roomName}:${domain}` ||
      requirement.p3Id !== portfolio.p3.id ||
      requirement.domain !== domain)
  ) {
    throw new Error(
      "Cannot create FSPM trace: Requirement identity is not canonical",
    );
  }
  if (requirement && requirement.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Requirement is ${requirement.status}`,
    );
  }
  const deliverable = portfolio.deliverables[domain];
  if (deliverable !== witness.deliverablesByDomain.get(domain)) {
    throw new Error(
      "Cannot create FSPM trace: Deliverable changed after the tick index was built",
    );
  }
  if (
    deliverable &&
    (deliverable.kind !== "deliverable" ||
      deliverable.id !== `deliverable:${roomName}:${domain}` ||
      deliverable.requirementId !== `requirement:${roomName}:${domain}` ||
      deliverable.domain !== domain)
  ) {
    throw new Error(
      "Cannot create FSPM trace: Deliverable identity is not canonical",
    );
  }
  if (deliverable && deliverable.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Deliverable is ${deliverable.status}`,
    );
  }

  const canonicalTaskId = `task:${roomName}:${domain}:${taskKey}`;
  const task = portfolio.tasks[canonicalTaskId];
  const taskWitness = witness.tasksById.get(canonicalTaskId);
  if (!task && !taskWitness) {
    assertNoOutOfBandMutation();
    return;
  }
  if (!task || !taskWitness || taskWitness.task !== task) {
    throw new Error(
      `Cannot create FSPM trace: Task ${canonicalTaskId} changed after the tick index was built`,
    );
  }
  if (task.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Task ${canonicalTaskId} is ${task.status}`,
    );
  }
  if (
    taskWitness.storageId !== canonicalTaskId ||
    task.id !== canonicalTaskId ||
    task.kind !== "task" ||
    task.domain !== domain ||
    task.taskKey !== taskKey ||
    task.deliverableId !== `deliverable:${roomName}:${domain}` ||
    !fspmTaskDefinition(domain, taskKey)
  ) {
    throw new Error(
      `Cannot create FSPM trace: Task ${canonicalTaskId} identity is not canonical`,
    );
  }

  const canonicalProcedureId = `procedure:${roomName}:${domain}:${taskKey}:${procedureKey}`;
  if (
    task.procedures !== taskWitness.procedures ||
    task.procedures.length !== taskWitness.proceduresById.size
  ) {
    throw new Error(
      `Cannot create FSPM trace: Procedures for ${canonicalTaskId} changed after the tick index was built`,
    );
  }
  const procedureIndex =
    taskWitness.procedureIndexesById.get(canonicalProcedureId);
  const procedure =
    procedureIndex === undefined ? undefined : task.procedures[procedureIndex];
  if (procedure !== taskWitness.proceduresById.get(canonicalProcedureId)) {
    throw new Error(
      `Cannot create FSPM trace: Procedure ${canonicalProcedureId} changed after the tick index was built`,
    );
  }
  if (
    procedure &&
    (procedure.id !== canonicalProcedureId ||
      procedure.taskId !== canonicalTaskId ||
      procedure.procedureKey !== procedureKey)
  ) {
    throw new Error(
      `Cannot create FSPM trace: Procedure ${canonicalProcedureId} identity is not canonical`,
    );
  }
  assertNoOutOfBandMutation();
}

export function createEmpirePortfolioP3(
  startTick: number,
  updatedAt: number,
): EmpirePortfolioP3 {
  return {
    id: EMPIRE_PORTFOLIO_ID,
    type: "portfolio",
    subType: "ou_portfolio",
    name: "EMPIRE-PORTFOLIO-Empire Operations",
    description:
      "Continuously manage owned colonies and subordinate P3 work by prioritizing and rebalancing empire resources against strategic operating objectives.",
    parentP3Id: null,
    temporalBasis: "game_tick",
    startTick,
    status: "active",
    statusReason: "root Empire Operations Portfolio is continuously managed",
    createdAt: startTick,
    updatedAt,
  };
}

export function createColonyPortfolioP3(
  roomName: string,
  startTick: number,
  updatedAt: number,
): ColonyPortfolioP3 {
  return {
    id: `portfolio:colony:${roomName}`,
    type: "portfolio",
    subType: "ou_portfolio",
    roomName,
    name: `COLONY-PORTFOLIO-${roomName} Operations`,
    description: `Continuously manage economy, workforce, construction, defense, expansion and operational priorities for owned colony ${roomName}.`,
    parentP3Id: EMPIRE_PORTFOLIO_ID,
    temporalBasis: "game_tick",
    startTick,
    status: "active",
    statusReason:
      "owned colony is continuously managed as subordinate Portfolio scope",
    createdAt: startTick,
    updatedAt,
  };
}

function ensureEmpirePortfolioImpl(): EmpireFspmPortfolio {
  invalidateFspmPlanningAuthorityContext();
  Memory.empireFspm ??= {
    p3: createEmpirePortfolioP3(earliestKnownColonyTick(), Game.time),
  };
  if (Memory.empireFspm.p3.status === "active") {
    Memory.empireFspm.p3.statusReason =
      "root Empire Operations Portfolio is continuously managed";
    Memory.empireFspm.p3.updatedAt = Game.time;
  }
  return Memory.empireFspm;
}

export function ensureEmpirePortfolio(): EmpireFspmPortfolio {
  return controlledAuthorityMutation(ensureEmpirePortfolioImpl);
}

function retireLegacyAuthority(portfolio: ColonyFspmPortfolio): void {
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
}

function ensureColonyPortfolioImpl(roomName: string): ColonyFspmPortfolio {
  invalidateFspmPlanningAuthorityContext();
  const colony = Memory.colonies[roomName];
  if (!colony)
    throw new Error(
      `Cannot create FSPM portfolio for unknown colony ${roomName}`,
    );
  if (colony.fspm && !colony.fspm.p3) {
    throw new Error(
      `FSPM colony authority container ${roomName} is missing its required root P3; refusing implicit repair outside versioned migration`,
    );
  }
  for (const task of Object.values(colony.fspm?.tasks ?? {})) {
    if (!task) continue;
    if (task.status !== "active" && task.status !== "retired") {
      throw new Error(
        `FSPM Task ${task.id} has invalid lifecycle state ${String(task.status)}; refusing implicit activation`,
      );
    }
  }
  ensureEmpirePortfolio();

  if (!colony.fspm) {
    colony.fspm = {
      p3: createColonyPortfolioP3(roomName, colony.discoveredAt, Game.time),
      requirements: {},
      deliverables: {},
      tasks: {},
      activities: {},
      qualityHistory: {},
      activityKpiHistory: {},
    };
  }

  const portfolio = colony.fspm;
  if (portfolio.p3.parentP3Id === undefined) {
    portfolio.p3.parentP3Id = EMPIRE_PORTFOLIO_ID;
  }
  portfolio.p3.temporalBasis = "game_tick";
  portfolio.p3.startTick ??= colony.discoveredAt;
  portfolio.p3.description ??= `Continuously manage economy, workforce, construction, defense, expansion and operational priorities for owned colony ${roomName}.`;
  portfolio.p3.name ??= `COLONY-PORTFOLIO-${roomName} Operations`;
  if (portfolio.p3.status === "active") {
    portfolio.p3.statusReason =
      "owned colony is continuously managed as subordinate Portfolio scope";
    portfolio.p3.updatedAt = Game.time;
  }
  portfolio.activities ??= {};
  portfolio.qualityHistory ??= {};
  portfolio.activityKpiHistory ??= {};

  retireLegacyAuthority(portfolio);

  for (const requirement of Object.values(portfolio.requirements)) {
    if (!requirement) continue;
    requirement.p3Id ??= portfolio.p3.id;
    requirement.completionCriterion ??= childRollupCriterion;
  }
  for (const deliverable of Object.values(portfolio.deliverables)) {
    if (!deliverable) continue;
    deliverable.completionCriterion ??= childRollupCriterion;
  }
  for (const task of Object.values(portfolio.tasks)) {
    if (!task) continue;
    // A Retired Task and its Procedures are immutable historical evidence.
    // Compatibility/canonicalization must never rewrite or append to it.
    if (task.status === "retired") continue;
    if (task.status !== "active") {
      throw new Error(
        `FSPM Task ${task.id} has invalid lifecycle state ${String(task.status)}; refusing implicit activation`,
      );
    }

    if (fspmTaskDefinition(task.domain, task.taskKey)) {
      applyCanonicalDefinition(task);
    } else {
      task.qualityDescription ??= defaultQualityDescription(task.taskKey);
      task.qualityMetric ??= defaultQualityMetric(task.taskKey);
      task.kpiMetric ??= defaultKpiMetric(task.taskKey);
      task.procedures ??= [];
      task.statusReason ??=
        "legacy Task definition retained for immutable Activity history";
    }

    delete (task as ColonyTask & { completedAt?: number }).completedAt;
    delete (task as ColonyTask & { reopenedAt?: number }).reopenedAt;
    delete (task as ColonyTask & { completionCriterion?: string })
      .completionCriterion;
  }

  return portfolio;
}

export function ensureColonyPortfolio(roomName: string): ColonyFspmPortfolio {
  return controlledAuthorityMutation(() => ensureColonyPortfolioImpl(roomName));
}

function ensureDomainHierarchyImpl(roomName: string, domain: FspmDomain) {
  invalidateFspmPlanningAuthorityContext();
  const portfolio = ensureColonyPortfolio(roomName);
  const scope = `${roomName}:${domain}`;

  let requirement = portfolio.requirements[domain];
  if (!requirement) {
    requirement = {
      kind: "requirement",
      id: `requirement:${scope}`,
      p3Id: portfolio.p3.id,
      domain,
      title: `${titleCase(domain)} capability`,
      status: "active",
      completionCriterion: childRollupCriterion,
      statusReason: "domain work has not yet reached governed acceptance",
      createdAt: Game.time,
      updatedAt: Game.time,
    };
    portfolio.requirements[domain] = requirement;
  } else {
    requirement.p3Id ??= portfolio.p3.id;
  }

  let deliverable = portfolio.deliverables[domain];
  if (!deliverable) {
    deliverable = {
      kind: "deliverable",
      id: `deliverable:${scope}`,
      requirementId: requirement.id,
      domain,
      title: `${titleCase(domain)} operating system`,
      status: "active",
      completionCriterion: childRollupCriterion,
      statusReason: "deliverable has not yet reached governed acceptance",
      createdAt: Game.time,
      updatedAt: Game.time,
    };
    portfolio.deliverables[domain] = deliverable;
  }

  return { portfolio, requirement, deliverable };
}

export function ensureDomainHierarchy(roomName: string, domain: FspmDomain) {
  return controlledAuthorityMutation(() =>
    ensureDomainHierarchyImpl(roomName, domain),
  );
}

function ensureTaskImpl(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
): ColonyTask {
  invalidateFspmPlanningAuthorityContext();
  const definition = requireFspmTaskDefinition(domain, taskKey);
  const { portfolio, deliverable } = ensureDomainHierarchy(roomName, domain);
  const id = `task:${roomName}:${domain}:${taskKey}`;
  const existing = portfolio.tasks[id];
  if (existing) {
    if (existing.status !== "active") {
      throw new Error(
        `Cannot ensure inactive FSPM Task ${id} (${existing.status})`,
      );
    }
    applyCanonicalDefinition(existing);
    return existing;
  }

  const task: ColonyTask = {
    kind: "task",
    id,
    deliverableId: deliverable.id,
    domain,
    taskKey,
    title: definition.title,
    description: definition.description,
    taskWeight: definition.taskWeight,
    status: "active",
    statusReason: "canonical governed Task definition is in the live work set",
    qualityDescription: definition.qualityDescription,
    qualityMetric: definition.qualityMetric,
    kpiMetric: { ...definition.kpiMetric },
    procedures: [],
    determination: { ...definition.determination },
    createdAt: Game.time,
    updatedAt: Game.time,
  };
  portfolio.tasks[id] = task;
  applyCanonicalDefinition(task);
  return task;
}

export function ensureTask(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
): ColonyTask {
  return controlledAuthorityMutation(() =>
    ensureTaskImpl(roomName, domain, taskKey),
  );
}

function ensureProcedureImpl(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): FspmProcedure {
  invalidateFspmPlanningAuthorityContext();
  const definition = requireFspmTaskDefinition(domain, taskKey);
  const procedureDefinition = definition.procedures.find(
    (candidate) => candidate.key === procedureKey,
  );
  if (!procedureDefinition) {
    throw new Error(
      `Unknown FSPM Procedure ${domain}:${taskKey}:${procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }

  const task = ensureTask(roomName, domain, taskKey);
  const id = `procedure:${roomName}:${domain}:${taskKey}:${procedureKey}`;
  const existing = task.procedures.find((procedure) => procedure.id === id);
  if (existing) {
    existing.title = procedureDefinition.title;
    return existing;
  }

  const procedure: FspmProcedure = {
    id,
    taskId: task.id,
    procedureKey,
    title: procedureDefinition.title,
  };
  task.procedures.push(procedure);
  task.updatedAt = Game.time;
  return procedure;
}

export function ensureProcedure(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): FspmProcedure {
  return controlledAuthorityMutation(() =>
    ensureProcedureImpl(roomName, domain, taskKey, procedureKey),
  );
}

function synchronizeFspmPlanningAuthoritySpine(
  roomName: string,
  domain: FspmDomain,
  portfolio: ColonyFspmPortfolio,
  requirement: ColonyRequirement,
  deliverable: ColonyDeliverable,
  task: ColonyTask,
  procedure: FspmProcedure,
): void {
  const context = planningAuthorityContext;
  const colony = Memory.colonies[roomName];
  if (
    !context ||
    !colony ||
    context.tick !== Game.time ||
    context.memory !== Memory ||
    context.colonies !== Memory.colonies ||
    context.revision !== planningAuthorityRevision
  ) {
    return;
  }

  context.empire = Memory.empireFspm;
  context.empireP3 = Memory.empireFspm?.p3;
  let witness = context.rooms.get(roomName);
  if (!witness) {
    witness = {
      colony,
      portfolio,
      p3: portfolio.p3,
      requirements: portfolio.requirements,
      deliverables: portfolio.deliverables,
      tasks: portfolio.tasks,
      requirementsByDomain: new Map(),
      deliverablesByDomain: new Map(),
      tasksById: new Map(),
    };
    context.rooms.set(roomName, witness);
  }

  witness.colony = colony;
  witness.portfolio = portfolio;
  witness.p3 = portfolio.p3;
  witness.requirements = portfolio.requirements;
  witness.deliverables = portfolio.deliverables;
  witness.tasks = portfolio.tasks;
  witness.requirementsByDomain.set(domain, requirement);
  witness.deliverablesByDomain.set(domain, deliverable);
  let taskWitness = witness.tasksById.get(task.id);
  if (!taskWitness || taskWitness.task !== task) {
    taskWitness = {
      storageId: task.id,
      task,
      procedures: task.procedures,
      proceduresById: new Map(),
      procedureIndexesById: new Map(),
    };
    for (const [index, candidate] of task.procedures.entries()) {
      taskWitness.proceduresById.set(candidate.id, candidate);
      taskWitness.procedureIndexesById.set(candidate.id, index);
    }
    witness.tasksById.set(task.id, taskWitness);
  } else {
    taskWitness.procedures = task.procedures;
    taskWitness.proceduresById.set(procedure.id, procedure);
    const procedureIndex = fspmProcedureIndex(
      task.domain,
      task.taskKey,
      procedure.procedureKey,
    );
    if (procedureIndex === undefined) {
      throw new Error(
        `Cannot index unknown FSPM Procedure ${procedure.id} after trace materialization`,
      );
    }
    taskWitness.procedureIndexesById.set(procedure.id, procedureIndex);
  }
  guardMaterializedAuthoritySpine(
    roomName,
    portfolio,
    requirement,
    deliverable,
    task,
    procedure,
  );
}

function materializeFspmTraceSpine(input: FspmTraceLineageInput): {
  portfolio: ColonyFspmPortfolio;
  requirement: ColonyRequirement;
  deliverable: ColonyDeliverable;
  task: ColonyTask;
  procedure: FspmProcedure;
} {
  const colony = Memory.colonies[input.roomName];
  if (!colony) {
    throw new Error(
      `Cannot create FSPM portfolio for unknown colony ${input.roomName}`,
    );
  }
  Memory.empireFspm ??= {
    p3: createEmpirePortfolioP3(earliestKnownColonyTick(), Game.time),
  };

  colony.fspm ??= {
    p3: createColonyPortfolioP3(input.roomName, colony.discoveredAt, Game.time),
    requirements: {},
    deliverables: {},
    tasks: {},
    activities: {},
    qualityHistory: {},
    activityKpiHistory: {},
  };
  const portfolio = colony.fspm;
  portfolio.activities ??= {};
  portfolio.qualityHistory ??= {};
  portfolio.activityKpiHistory ??= {};

  const scope = `${input.roomName}:${input.domain}`;
  let requirement = portfolio.requirements[input.domain];
  if (!requirement) {
    requirement = {
      kind: "requirement",
      id: `requirement:${scope}`,
      p3Id: portfolio.p3.id,
      domain: input.domain,
      title: `${titleCase(input.domain)} capability`,
      status: "active",
      completionCriterion: childRollupCriterion,
      statusReason: "domain work has not yet reached governed acceptance",
      createdAt: Game.time,
      updatedAt: Game.time,
    };
    portfolio.requirements[input.domain] = requirement;
  }

  let deliverable = portfolio.deliverables[input.domain];
  if (!deliverable) {
    deliverable = {
      kind: "deliverable",
      id: `deliverable:${scope}`,
      requirementId: requirement.id,
      domain: input.domain,
      title: `${titleCase(input.domain)} operating system`,
      status: "active",
      completionCriterion: childRollupCriterion,
      statusReason: "deliverable has not yet reached governed acceptance",
      createdAt: Game.time,
      updatedAt: Game.time,
    };
    portfolio.deliverables[input.domain] = deliverable;
  }

  const definition = requireFspmTaskDefinition(input.domain, input.taskKey);
  const taskId = `task:${input.roomName}:${input.domain}:${input.taskKey}`;
  let task = portfolio.tasks[taskId];
  if (!task) {
    task = {
      kind: "task",
      id: taskId,
      deliverableId: deliverable.id,
      domain: input.domain,
      taskKey: input.taskKey,
      title: definition.title,
      description: definition.description,
      taskWeight: definition.taskWeight,
      status: "active",
      statusReason:
        "canonical governed Task definition is in the live work set",
      qualityDescription: definition.qualityDescription,
      qualityMetric: definition.qualityMetric,
      kpiMetric: { ...definition.kpiMetric },
      procedures: [],
      determination: { ...definition.determination },
      createdAt: Game.time,
      updatedAt: Game.time,
    };
    portfolio.tasks[taskId] = task;
    applyCanonicalDefinition(task);
  }

  const procedureDefinition = fspmProcedureDefinition(
    input.domain,
    input.taskKey,
    input.procedureKey,
  );
  if (!procedureDefinition) {
    throw new Error(
      `Unknown FSPM Procedure ${input.domain}:${input.taskKey}:${input.procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }
  const procedureId = `procedure:${input.roomName}:${input.domain}:${input.taskKey}:${input.procedureKey}`;
  const procedureIndex = fspmProcedureIndex(
    input.domain,
    input.taskKey,
    input.procedureKey,
  );
  if (procedureIndex === undefined) {
    throw new Error(
      `Unknown FSPM Procedure ${input.domain}:${input.taskKey}:${input.procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }
  let procedure = task.procedures[procedureIndex];
  if (!procedure) {
    procedure = {
      id: procedureId,
      taskId,
      procedureKey: input.procedureKey,
      title: procedureDefinition.title,
    };
    task.procedures.push(procedure);
    task.updatedAt = Game.time;
  }

  return { portfolio, requirement, deliverable, task, procedure };
}

export interface FspmTraceLineageInput {
  roomName: string;
  domain: FspmDomain;
  taskKey: string;
  procedureKey: string;
  workKey?: string;
}

/**
 * Validate and materialize one governed trace as a single indexed operation.
 * Validation happens before any compatibility ensure path can mutate Memory;
 * canonical records created by this operation are then added to the live
 * tick-local witnesses without another global hierarchy traversal.
 */
export function ensureFspmTraceLineage(
  input: FspmTraceLineageInput,
): IntentTrace {
  traceCreationDepth += 1;
  try {
    assertFspmTraceCreationAllowed(
      input.roomName,
      input.domain,
      input.taskKey,
      input.procedureKey,
    );
    const { portfolio, requirement, deliverable, task, procedure } =
      materializeFspmTraceSpine(input);
    synchronizeFspmPlanningAuthoritySpine(
      input.roomName,
      input.domain,
      portfolio,
      requirement,
      deliverable,
      task,
      procedure,
    );

    return {
      p3Id: portfolio.p3.id,
      requirementId: requirement.id,
      deliverableId: deliverable.id,
      taskId: task.id,
      procedureId: procedure.id,
      ...(input.workKey ? { workKey: input.workKey } : {}),
    };
  } catch (error) {
    if (planningAuthorityViolationTick !== Game.time) {
      planningAuthorityRevision += 1;
      planningAuthorityContext = undefined;
    }
    throw error;
  } finally {
    traceCreationDepth -= 1;
  }
}

function reconcileFspmLifecycleImpl(_intents: Intent[]): void {
  invalidateFspmPlanningAuthorityContext();
  for (const colony of Object.values(Memory.colonies)) {
    if (colony.fspm && !colony.fspm.p3) {
      throw new Error(
        `FSPM colony authority container ${colony.roomName} is missing its required root P3; refusing lifecycle reconciliation`,
      );
    }
    for (const task of Object.values(colony.fspm?.tasks ?? {})) {
      if (!task) continue;
      if (task.status !== "active" && task.status !== "retired") {
        throw new Error(
          `FSPM Task ${task.id} has invalid lifecycle state ${String(task.status)}; refusing lifecycle reconciliation`,
        );
      }
    }
  }
  ensureEmpirePortfolio();

  for (const colony of Object.values(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (!portfolio) continue;

    ensureColonyPortfolio(colony.roomName);

    for (const task of Object.values(portfolio.tasks)) {
      if (!task) continue;
      if (task.status === "active") {
        task.statusReason = fspmTaskDefinition(task.domain, task.taskKey)
          ? "canonical governed Task definition is in the live work set"
          : "legacy Task definition retained while immutable child Activities drain";
      }
    }

    for (const domain of [
      "economy",
      "spawning",
      "construction",
      "defense",
    ] as const) {
      const requirement = portfolio.requirements[domain];
      const deliverable = portfolio.deliverables[domain];
      if (!requirement || !deliverable) continue;

      const activeTasks = Object.values(portfolio.tasks).filter(
        (task) =>
          task !== undefined &&
          task.domain === domain &&
          task.status === "active",
      ).length;
      const reason = `${activeTasks} active Task definition${activeTasks === 1 ? "" : "s"}; acceptance is not inferred from tick demand`;
      transitionStatus(deliverable, "active", reason);
      transitionStatus(requirement, "active", reason);
    }

    if (portfolio.p3.status === "active") {
      portfolio.p3.statusReason =
        "owned colony is continuously managed as subordinate Portfolio scope";
      portfolio.p3.updatedAt = Game.time;
    }
  }
}

export function reconcileFspmLifecycle(intents: Intent[]): void {
  controlledAuthorityMutation(() => reconcileFspmLifecycleImpl(intents));
}
