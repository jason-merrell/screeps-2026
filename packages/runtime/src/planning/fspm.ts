import type { Intent } from "../intents/types";

export type FspmDomain = "economy" | "spawning" | "construction" | "defense";
export type FspmStatus = "active" | "completed" | "cancelled";

interface FspmRecordBase {
  id: string;
  title: string;
  status: FspmStatus;
  completionCriterion: string;
  statusReason?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reopenedAt?: number;
}

export interface ColonyContract extends FspmRecordBase {
  kind: "contract";
  roomName: string;
}

export interface ColonyRequirement extends FspmRecordBase {
  kind: "requirement";
  contractId: string;
  domain: FspmDomain;
}

export interface ColonyDeliverable extends FspmRecordBase {
  kind: "deliverable";
  requirementId: string;
  domain: FspmDomain;
}

export interface ColonyTask extends FspmRecordBase {
  kind: "task";
  deliverableId: string;
  domain: FspmDomain;
  taskKey: string;
}

export interface ColonyFspmPortfolio {
  contract: ColonyContract;
  requirements: Partial<Record<FspmDomain, ColonyRequirement>>;
  deliverables: Partial<Record<FspmDomain, ColonyDeliverable>>;
  tasks: Record<string, ColonyTask>;
}

const titleCase = (value: string): string =>
  value
    .split("-")
    .map((part) => (part.length > 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ");

const taskCriterion =
  "complete when the planner emits no activity for this task during the current tick; reopen when demand returns";
const childRollupCriterion =
  "complete when at least one child task exists and every materialized child task is completed";

function transitionStatus(
  record: FspmRecordBase,
  next: Exclude<FspmStatus, "cancelled">,
  reason: string,
): void {
  if (record.status === "cancelled") return;
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

export function ensureColonyPortfolio(roomName: string): ColonyFspmPortfolio {
  const colony = Memory.colonies[roomName];
  if (!colony) throw new Error(`Cannot create FSPM portfolio for unknown colony ${roomName}`);

  if (!colony.fspm) {
    colony.fspm = {
      contract: {
        kind: "contract",
        id: `contract:colony:${roomName}`,
        roomName,
        title: `Operate colony ${roomName}`,
        status: "active",
        completionCriterion: "close only by explicit colony decommission",
        statusReason: "owned colony is operational",
        createdAt: Game.time,
        updatedAt: Game.time,
      },
      requirements: {},
      deliverables: {},
      tasks: {},
    };
  }

  const portfolio = colony.fspm;
  portfolio.contract.completionCriterion ??= "close only by explicit colony decommission";
  portfolio.contract.statusReason ??= "owned colony is operational";

  for (const requirement of Object.values(portfolio.requirements)) {
    if (!requirement) continue;
    requirement.completionCriterion ??= childRollupCriterion;
  }
  for (const deliverable of Object.values(portfolio.deliverables)) {
    if (!deliverable) continue;
    deliverable.completionCriterion ??= childRollupCriterion;
  }
  for (const task of Object.values(portfolio.tasks)) {
    task.completionCriterion ??= taskCriterion;
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
      contractId: portfolio.contract.id,
      domain,
      title: `${titleCase(domain)} capability`,
      status: "active",
      completionCriterion: childRollupCriterion,
      statusReason: "domain work has not yet rolled up to completion",
      createdAt: Game.time,
      updatedAt: Game.time,
    };
    portfolio.requirements[domain] = requirement;
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
      statusReason: "domain work has not yet rolled up to completion",
      createdAt: Game.time,
      updatedAt: Game.time,
    };
    portfolio.deliverables[domain] = deliverable;
  }

  return { portfolio, requirement, deliverable };
}

export function ensureTask(roomName: string, domain: FspmDomain, taskKey: string): ColonyTask {
  const { portfolio, deliverable } = ensureDomainHierarchy(roomName, domain);
  const id = `task:${roomName}:${domain}:${taskKey}`;
  const existing = portfolio.tasks[id];
  if (existing) return existing;

  const task: ColonyTask = {
    kind: "task",
    id,
    deliverableId: deliverable.id,
    domain,
    taskKey,
    title: titleCase(taskKey),
    status: "active",
    completionCriterion: taskCriterion,
    statusReason: "planner demand created activity",
    createdAt: Game.time,
    updatedAt: Game.time,
  };
  portfolio.tasks[id] = task;
  return task;
}

export function reconcileFspmLifecycle(intents: Intent[]): void {
  const demandedTaskIds = new Set(
    intents.flatMap((intent) => (intent.trace?.taskId ? [intent.trace.taskId] : [])),
  );

  for (const colony of Object.values(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (!portfolio) continue;

    for (const task of Object.values(portfolio.tasks)) {
      const demanded = demandedTaskIds.has(task.id);
      transitionStatus(
        task,
        demanded ? "active" : "completed",
        demanded ? "planner emitted activity this tick" : "planner emitted no activity this tick",
      );
    }

    for (const domain of ["economy", "spawning", "construction", "defense"] as const) {
      const requirement = portfolio.requirements[domain];
      const deliverable = portfolio.deliverables[domain];
      if (!requirement || !deliverable) continue;

      const tasks = Object.values(portfolio.tasks).filter((task) => task.domain === domain);
      const complete = tasks.length > 0 && tasks.every((task) => task.status === "completed");
      const reason = complete
        ? `${tasks.length} materialized task${tasks.length === 1 ? "" : "s"} completed`
        : tasks.length === 0
          ? "no materialized tasks yet"
          : `${tasks.filter((task) => task.status === "active").length} active task${tasks.filter((task) => task.status === "active").length === 1 ? "" : "s"}`;

      transitionStatus(deliverable, complete ? "completed" : "active", reason);
      transitionStatus(requirement, complete ? "completed" : "active", reason);
    }

    transitionStatus(portfolio.contract, "active", "owned colony is operational");
  }
}
