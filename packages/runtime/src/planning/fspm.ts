export type FspmDomain = "economy" | "spawning" | "construction" | "defense";
export type FspmStatus = "active" | "completed" | "cancelled";

interface FspmRecordBase {
  id: string;
  title: string;
  status: FspmStatus;
  createdAt: number;
  updatedAt: number;
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
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");

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
        createdAt: Game.time,
        updatedAt: Game.time,
      },
      requirements: {},
      deliverables: {},
      tasks: {},
    };
  }

  return colony.fspm;
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
    createdAt: Game.time,
    updatedAt: Game.time,
  };
  portfolio.tasks[id] = task;
  return task;
}
