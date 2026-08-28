import type { Intent } from "../intents/types";
import {
  fspmTaskDefinition,
  requireFspmTaskDefinition,
  type FspmTaskDetermination,
} from "./fspm-catalog";

export type FspmDomain = "economy" | "spawning" | "construction" | "defense";
export type FspmStatus = "active" | "completed" | "cancelled" | "retired";
export type FspmTaskStatus = "active" | "retired";
export type FspmActivityStatus = "not_started" | "in_progress" | "on_hold" | "completed";
export type FspmQualityState = "healthy" | "watch" | "degraded";
export type FspmQualityTrend = "new" | "improving" | "stable" | "declining";
export type FspmKpiRating = "exceptional" | "satisfactory" | "unsatisfactory" | "in_progress";

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
  outcome?: { metric: string; actual: number; target: number; unit: string; utilization: number };
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

export interface ColonyPortfolioP3 {
  id: string;
  type: "portfolio";
  subType: "ou_portfolio";
  roomName: string;
  title: string;
  status: "active";
  statusReason: string;
  quality?: FspmQuality;
  createdAt: number;
  updatedAt: number;
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

const titleCase = (value: string): string =>
  value
    .split("-")
    .map((part) => (part.length > 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ");

const childRollupCriterion =
  "complete when the governed acceptance criteria for this record are satisfied";

const defaultQualityDescription = (taskKey: string): string =>
  `${titleCase(taskKey)} produces the intended colony outcome without unnecessary interruption or rework`;

const defaultQualityMetric = (taskKey: string): string =>
  `${titleCase(taskKey)} is evaluated from completed Activity outcome evidence`;

const defaultKpiMetric = (taskKey: string): FspmTaskKpiRubric => ({
  metric: `${titleCase(taskKey)} execution effectiveness`,
  exceptional: "completed Activity exceeds the task-specific expected threshold",
  satisfactory: "completed Activity satisfies the task Quality Metric",
  unsatisfactory: "completed Activity fails the task Quality Metric or requires material rework",
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

function currentColonyP3(roomName: string, createdAt = Game.time): ColonyPortfolioP3 {
  return {
    id: `portfolio:colony:${roomName}`,
    type: "portfolio",
    subType: "ou_portfolio",
    roomName,
    title: `Colony ${roomName} Operations`,
    status: "active",
    statusReason: "owned colony is continuously managed as operational portfolio scope",
    createdAt,
    updatedAt: Game.time,
  };
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

export function ensureColonyPortfolio(roomName: string): ColonyFspmPortfolio {
  const colony = Memory.colonies[roomName];
  if (!colony) throw new Error(`Cannot create FSPM portfolio for unknown colony ${roomName}`);

  if (!colony.fspm) {
    colony.fspm = {
      p3: currentColonyP3(roomName, colony.discoveredAt),
      requirements: {},
      deliverables: {},
      tasks: {},
      activities: {},
      qualityHistory: {},
      activityKpiHistory: {},
    };
  }

  const portfolio = colony.fspm;
  portfolio.p3 ??= currentColonyP3(roomName, colony.discoveredAt);
  portfolio.p3.statusReason =
    "owned colony is continuously managed as operational portfolio scope";
  portfolio.p3.updatedAt = Game.time;
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
    if (task.status !== "active" && task.status !== "retired") {
      task.status = "active";
      task.statusReason = "migrated to governed Active/Retired Task lifecycle";
      task.updatedAt = Game.time;
    }

    if (fspmTaskDefinition(task.domain, task.taskKey)) {
      applyCanonicalDefinition(task);
    } else {
      task.qualityDescription ??= defaultQualityDescription(task.taskKey);
      task.qualityMetric ??= defaultQualityMetric(task.taskKey);
      task.kpiMetric ??= defaultKpiMetric(task.taskKey);
      task.procedures ??= [];
      task.statusReason ??= "legacy Task definition retained for immutable Activity history";
    }

    delete (task as ColonyTask & { completedAt?: number }).completedAt;
    delete (task as ColonyTask & { reopenedAt?: number }).reopenedAt;
    delete (task as ColonyTask & { completionCriterion?: string }).completionCriterion;
  }

  return portfolio;
}

export function ensureDomainHierarchy(roomName: string, domain: FspmDomain) {
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
    requirement.p3Id = portfolio.p3.id;
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

export function ensureTask(roomName: string, domain: FspmDomain, taskKey: string): ColonyTask {
  const definition = requireFspmTaskDefinition(domain, taskKey);
  const { portfolio, deliverable } = ensureDomainHierarchy(roomName, domain);
  const id = `task:${roomName}:${domain}:${taskKey}`;
  const existing = portfolio.tasks[id];
  if (existing) {
    applyCanonicalDefinition(existing);
    if (existing.status !== "retired") existing.status = "active";
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

export function ensureProcedure(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): FspmProcedure {
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

export function reconcileFspmLifecycle(_intents: Intent[]): void {
  for (const colony of Object.values(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (!portfolio) continue;

    ensureColonyPortfolio(colony.roomName);

    for (const task of Object.values(portfolio.tasks)) {
      if (task.status !== "retired") {
        task.status = "active";
        task.statusReason = fspmTaskDefinition(task.domain, task.taskKey)
          ? "canonical governed Task definition is in the live work set"
          : "legacy Task definition retained while immutable child Activities drain";
      }
    }

    for (const domain of ["economy", "spawning", "construction", "defense"] as const) {
      const requirement = portfolio.requirements[domain];
      const deliverable = portfolio.deliverables[domain];
      if (!requirement || !deliverable) continue;

      const activeTasks = Object.values(portfolio.tasks).filter(
        (task) => task.domain === domain && task.status === "active",
      ).length;
      const reason = `${activeTasks} active Task definition${activeTasks === 1 ? "" : "s"}; acceptance is not inferred from tick demand`;
      transitionStatus(deliverable, "active", reason);
      transitionStatus(requirement, "active", reason);
    }

    portfolio.p3.statusReason =
      "owned colony is continuously managed as operational portfolio scope";
    portfolio.p3.updatedAt = Game.time;
  }
}
