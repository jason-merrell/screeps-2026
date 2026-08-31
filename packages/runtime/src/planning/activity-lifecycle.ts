import type { ArbitrationRejection } from "../intents/arbitrate";
import {
  type ActivityExecutionObservation,
  intentActorKey,
} from "../intents/execute";
import type { CreepIntent, Intent } from "../intents/types";
import {
  type ActiveFspmAuthority,
  type ColonyFspmPortfolio,
  type ColonyTask,
  createFspmAuthorityDenialSummary,
  createFspmAuthoritySnapshot,
  type FspmActivityKpiSample,
  type FspmActivityMetrics,
  type FspmActivityRecord,
  type FspmAuthorityDenialSummary,
  type FspmAuthoritySnapshot,
  type FspmKpiRating,
  recordFspmAuthorityDenial,
} from "./fspm";
import { computeTaskQi } from "./task-kpi";

const ACTIVITY_EVENT_LIMIT = 192;
const TASK_KPI_HISTORY_LIMIT = 24;
const PEACETIME_TOWER_RESERVE = 400;

export type FspmAssignmentState =
  | "executing"
  | "traveling"
  | "waiting_intentional"
  | "on_hold"
  | "planner_unassigned"
  | "arbitration_lost"
  | "blocked";

export type FspmActivityEventType =
  | "activity_opened"
  | "activity_started"
  | "procedure_entered"
  | "target_changed"
  | "target_advanced"
  | "activity_held"
  | "activity_reassigned"
  | "activity_resumed"
  | "activity_completed"
  | "kpi_scored";

export interface FspmActivityEvent {
  id: string;
  sequence: number;
  tick: number;
  type: FspmActivityEventType;
  activityId: string;
  taskId: string;
  actor: string;
  procedureId?: string;
  targetKey?: string;
  previousTargetKey?: string;
  previousAssignee?: string;
  reason?: string;
  kpiScore?: Exclude<FspmKpiRating, "in_progress">;
}

export interface FspmProcedureHistoryEntry {
  procedureId: string;
  enteredAt: number;
  exitedAt?: number;
  initialTargetKey?: string;
}

export interface FspmActivityOutcome {
  metric: string;
  actual: number;
  target: number;
  unit: string;
  utilization: number;
}

export interface FspmAssignmentEvidence {
  tick: number;
  assignee: string;
  state: FspmAssignmentState;
  activityId: string | null;
  taskId: string | null;
  procedureId: string | null;
  targetKey: string | null;
  reason: string;
}

interface EvidenceActivityMetrics extends FspmActivityMetrics {
  waitTicks?: number;
  assignmentGapTicks?: number;
  arbitrationLostTicks?: number;
  blockedTicks?: number;
  targetRetargets?: number;
  targetAdvances?: number;
  currentTravelStreak?: number;
  maxTravelStreak?: number;
  firstProductiveAt?: number;
}

interface EvidenceActivity extends FspmActivityRecord {
  /** Stable governed work identity; unlike currentTargetKey this survives Procedure handoffs. */
  workKey?: string;
  currentTargetKey?: string;
  currentDisposition?: FspmAssignmentState;
  procedureHistory?: FspmProcedureHistoryEntry[];
  outcome?: FspmActivityOutcome;
  kpiEvidence?: string;
  metrics: EvidenceActivityMetrics;
}

interface EvidencePortfolio extends ColonyFspmPortfolio {
  activities?: Record<string, EvidenceActivity>;
  activityEvents?: FspmActivityEvent[];
  activityEventSequence?: number;
}

interface InfrastructureIdentity {
  roomName: string;
  x: number;
  y: number;
  structureType: StructureConstant;
}

export interface ReconcileFspmActivityEvidenceInput {
  observations: ActivityExecutionObservation[];
  proposed: Intent[];
  accepted: Intent[];
  rejected: ArbitrationRejection[];
  creeps?: Creep[];
}

const metric = (value: number | undefined): number => value ?? 0;

function isCreepIntent(intent: Intent): intent is CreepIntent {
  return "creepName" in intent;
}

function isSystemAssignee(assignee: string): boolean {
  return (
    assignee.startsWith("spawn:") ||
    assignee.startsWith("construction:") ||
    assignee.startsWith("tower:")
  );
}

function newMetrics(): EvidenceActivityMetrics {
  return {
    inProgressTicks: 0,
    onHoldTicks: 0,
    productiveTicks: 0,
    travelTicks: 0,
    idleTicks: 0,
    holdCount: 0,
    resumeCount: 0,
    taskPreemptions: 0,
    procedureTransitions: 0,
    waitTicks: 0,
    assignmentGapTicks: 0,
    arbitrationLostTicks: 0,
    blockedTicks: 0,
    targetRetargets: 0,
    targetAdvances: 0,
    currentTravelStreak: 0,
    maxTravelStreak: 0,
  };
}

function evidencePortfolio(portfolio: ColonyFspmPortfolio): EvidencePortfolio {
  return portfolio as EvidencePortfolio;
}

function portfolioForTask(taskId: string): EvidencePortfolio | undefined {
  for (const colony of Object.values(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (portfolio?.tasks[taskId]) return evidencePortfolio(portfolio);
  }
  return undefined;
}

function targetKeyForIntent(intent: Intent): string {
  switch (intent.type) {
    case "move":
      return String(intent.targetId);
    case "harvest":
      return String(intent.sourceId);
    case "withdraw":
    case "transfer":
    case "build":
    case "repair":
      return String(intent.targetId);
    case "upgrade":
      return String(intent.controllerId);
    case "spawn":
      return `creep:${intent.name}`;
    case "createConstructionSite":
      return `site:${intent.roomName}:${intent.x}:${intent.y}:${intent.structureType}`;
    case "towerAttack":
      return String(intent.targetId);
  }
}

export function activityTargetKey(intent: CreepIntent): string {
  return targetKeyForIntent(intent);
}

function appendEvent(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  type: FspmActivityEventType,
  detail: Partial<
    Omit<
      FspmActivityEvent,
      "id" | "sequence" | "tick" | "type" | "activityId" | "taskId" | "actor"
    >
  > = {},
): void {
  portfolio.activityEvents ??= [];
  const sequence = (portfolio.activityEventSequence ?? 0) + 1;
  portfolio.activityEventSequence = sequence;
  portfolio.activityEvents.push({
    id: `activity-event:${activity.id}:${sequence}`,
    sequence,
    tick: Game.time,
    type,
    activityId: activity.id,
    taskId: activity.taskId,
    actor: activity.assignee,
    ...detail,
  });
  if (portfolio.activityEvents.length > ACTIVITY_EVENT_LIMIT) {
    portfolio.activityEvents.splice(
      0,
      portfolio.activityEvents.length - ACTIVITY_EVENT_LIMIT,
    );
  }
}

function closeCurrentProcedure(activity: EvidenceActivity): void {
  const current = activity.procedureHistory?.at(-1);
  if (current && current.exitedAt === undefined) current.exitedAt = Game.time;
}

function enterProcedure(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  procedureId: string,
  targetKey: string,
  reason: string,
): void {
  closeCurrentProcedure(activity);
  activity.currentProcedureId = procedureId;
  activity.currentTargetKey = targetKey;
  activity.procedureHistory ??= [];
  activity.procedureHistory.push({
    procedureId,
    enteredAt: Game.time,
    initialTargetKey: targetKey,
  });
  appendEvent(portfolio, activity, "procedure_entered", {
    procedureId,
    targetKey,
    reason,
  });
}

function startActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  procedureId: string,
  targetKey: string,
): void {
  if (activity.status !== "not_started") return;
  activity.status = "in_progress";
  activity.startedAt = Game.time;
  activity.updatedAt = Game.time;
  appendEvent(portfolio, activity, "activity_started", {
    procedureId,
    targetKey,
    reason:
      "Activity transitioned from Not Started to In Progress when the Assignee commenced governed work",
  });
  enterProcedure(
    portfolio,
    activity,
    procedureId,
    targetKey,
    "initial Task Procedure",
  );
}

function openActivity(
  portfolio: EvidencePortfolio,
  intent: Intent,
): EvidenceActivity | undefined {
  const trace = intent.trace;
  if (!trace) return undefined;
  const task = portfolio.tasks[trace.taskId];
  if (!task) return undefined;

  portfolio.activities ??= {};
  const assignee = intentActorKey(intent);
  const targetKey = targetKeyForIntent(intent);
  const id = `activity:${trace.taskId}:${assignee}:${Game.time}`;
  const activity: EvidenceActivity = {
    id,
    taskId: task.id,
    assignee,
    status: "not_started",
    currentProcedureId: trace.procedureId,
    currentTargetKey: targetKey,
    ...(trace.workKey ? { workKey: trace.workKey } : {}),
    qualityDescription: task.qualityDescription,
    qualityMetric: task.qualityMetric,
    kpiMetric: { ...task.kpiMetric },
    createdAt: Game.time,
    updatedAt: Game.time,
    procedureHistory: [],
    metrics: newMetrics(),
  };
  portfolio.activities[id] = activity;
  appendEvent(portfolio, activity, "activity_opened", {
    procedureId: trace.procedureId,
    targetKey,
    reason: `${intent.reason}; Activity created in governed Not Started state`,
  });
  startActivity(portfolio, activity, trace.procedureId, targetKey);
  return activity;
}

function activitiesForAssignee(
  portfolio: EvidencePortfolio,
  assignee: string,
): EvidenceActivity[] {
  return Object.values(portfolio.activities ?? {})
    .filter(
      (activity) =>
        activity.assignee === assignee && activity.status !== "completed",
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function currentActivityForAssignee(
  assignee: string,
): { portfolio: EvidencePortfolio; activity: EvidenceActivity } | undefined {
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    const activity = Object.values(portfolio.activities ?? {}).find(
      (candidate) =>
        candidate.assignee === assignee && candidate.status === "in_progress",
    );
    if (activity) return { portfolio, activity };
  }
  return undefined;
}

function latestHeldActivityForAssignee(
  assignee: string,
): { portfolio: EvidencePortfolio; activity: EvidenceActivity } | undefined {
  let latest:
    | { portfolio: EvidencePortfolio; activity: EvidenceActivity }
    | undefined;
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (activity.assignee !== assignee || activity.status !== "on_hold")
        continue;
      if (!latest || activity.updatedAt > latest.activity.updatedAt) {
        latest = { portfolio, activity };
      }
    }
  }
  return latest;
}

function latestHeldActivityForTaskWork(
  portfolio: EvidencePortfolio,
  taskId: string,
  targetKey: string,
  workKey: string | undefined,
  allowLiveAssignee = false,
): EvidenceActivity | undefined {
  return Object.values(portfolio.activities ?? {})
    .filter((activity) => {
      if (activity.status !== "on_hold" || activity.taskId !== taskId)
        return false;
      const sameWork = workKey
        ? activity.workKey === workKey
        : activity.currentTargetKey === targetKey;
      if (!sameWork) return false;
      return (
        allowLiveAssignee ||
        isSystemAssignee(activity.assignee) ||
        !Game.creeps[activity.assignee]
      );
    })
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        b.id.localeCompare(a.id),
    )[0];
}

function objectForTargetKey(targetKey: string): RoomObject | null {
  return Game.getObjectById(
    targetKey as Id<
      Source | AnyStructure | ConstructionSite | Tombstone | Ruin
    >,
  );
}

function activityObject(activity: EvidenceActivity): RoomObject | null {
  return activity.currentTargetKey
    ? objectForTargetKey(activity.currentTargetKey)
    : null;
}

function infrastructureIdentity(
  activity: EvidenceActivity,
): InfrastructureIdentity | null {
  const parts = activity.workKey?.split(":");
  if (parts?.length !== 5 || parts[0] !== "infrastructure") return null;
  const x = Number(parts[2]);
  const y = Number(parts[3]);
  const structureType = parts[4];
  if (
    !parts[1] ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !structureType
  )
    return null;
  return {
    roomName: parts[1],
    x,
    y,
    structureType: structureType as StructureConstant,
  };
}

function infrastructureBuilt(activity: EvidenceActivity): boolean {
  const identity = infrastructureIdentity(activity);
  if (!identity) return false;
  const room = Game.rooms?.[identity.roomName];
  if (!room) return false;
  return room
    .lookForAt(LOOK_STRUCTURES, identity.x, identity.y)
    .some((structure) => structure.structureType === identity.structureType);
}

function sourceObjectDepleted(object: RoomObject | null): boolean {
  return (
    object !== null &&
    "energy" in object &&
    typeof object.energy === "number" &&
    object.energy <= 0
  );
}

function storeObjectDepleted(object: RoomObject | null): boolean {
  if (!object || !("store" in object)) return false;
  const storeObject = object as StructureContainer | Tombstone | Ruin;
  return storeObject.store.getUsedCapacity(RESOURCE_ENERGY) <= 0;
}

function storeTargetFull(object: RoomObject | null): boolean {
  if (!object || !("store" in object)) return false;
  const storeObject = object as AnyStoreStructure;
  return (storeObject.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0) <= 0;
}

function towerReserveSatisfied(object: RoomObject | null): boolean {
  if (!object || !("store" in object)) return false;
  const tower = object as StructureTower;
  const capacity = tower.store.getCapacity(RESOURCE_ENERGY);
  if (capacity === null) return false;
  const underAttack = tower.room?.find(FIND_HOSTILE_CREEPS).length > 0;
  const target = underAttack
    ? capacity
    : Math.min(PEACETIME_TOWER_RESERVE, capacity);
  return tower.store.getUsedCapacity(RESOURCE_ENERGY) >= target;
}

function procedureKey(
  task: ColonyTask,
  activity: EvidenceActivity,
): string | undefined {
  return task.procedures.find(
    (procedure) => procedure.id === activity.currentProcedureId,
  )?.procedureKey;
}

function targetSatisfiedForCurrentProcedure(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  targetKey: string,
): boolean {
  const task = portfolio.tasks[activity.taskId];
  if (!task) return false;
  const currentProcedure = procedureKey(task, activity);
  const object = objectForTargetKey(targetKey);

  switch (currentProcedure) {
    case "extract-source-energy":
      return sourceObjectDepleted(object);
    case "withdraw-buffered-energy":
    case "recover-salvage-energy":
      return storeObjectDepleted(object);
    case "fund-workforce-energy":
      return storeTargetFull(object);
    case "fund-tower-reserve":
      return towerReserveSatisfied(object);
    default:
      return false;
  }
}

function recordTargetTransition(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  targetKey: string,
  reason: string,
): void {
  if (activity.currentTargetKey === targetKey) return;
  const previousTargetKey = activity.currentTargetKey;
  const advanced = previousTargetKey
    ? targetSatisfiedForCurrentProcedure(portfolio, activity, previousTargetKey)
    : false;
  activity.currentTargetKey = targetKey;

  if (advanced) {
    activity.metrics.targetAdvances =
      metric(activity.metrics.targetAdvances) + 1;
    appendEvent(portfolio, activity, "target_advanced", {
      procedureId: activity.currentProcedureId,
      targetKey,
      previousTargetKey: previousTargetKey ?? targetKey,
      reason: `previous target satisfied before same-Procedure progression; ${reason}`,
    });
    return;
  }

  activity.metrics.targetRetargets =
    metric(activity.metrics.targetRetargets) + 1;
  appendEvent(portfolio, activity, "target_changed", {
    procedureId: activity.currentProcedureId,
    targetKey,
    ...(previousTargetKey ? { previousTargetKey } : {}),
    reason,
  });
}

function resumeActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  procedureId: string,
  targetKey: string,
  workKey?: string,
): void {
  activity.status = "in_progress";
  activity.updatedAt = Game.time;
  activity.metrics.resumeCount += 1;
  delete activity.holdReason;
  if (workKey && !activity.workKey) activity.workKey = workKey;
  appendEvent(portfolio, activity, "activity_resumed", {
    procedureId,
    targetKey,
    reason: "Task became current for assignee again",
  });

  if (activity.currentProcedureId !== procedureId) {
    activity.metrics.procedureTransitions += 1;
    enterProcedure(
      portfolio,
      activity,
      procedureId,
      targetKey,
      "resumed through a different Procedure",
    );
  } else {
    recordTargetTransition(
      portfolio,
      activity,
      targetKey,
      "resumed Procedure selected a different concrete target",
    );
  }
}

function holdActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  reason: string,
  disposition: FspmAssignmentState = "on_hold",
  taskPreemption = false,
): void {
  if (activity.status !== "in_progress") return;
  activity.status = "on_hold";
  activity.updatedAt = Game.time;
  activity.holdReason = reason;
  activity.currentDisposition = disposition;
  activity.metrics.holdCount += 1;
  if (taskPreemption) activity.metrics.taskPreemptions += 1;
  activity.metrics.currentTravelStreak = 0;
  appendEvent(portfolio, activity, "activity_held", {
    procedureId: activity.currentProcedureId,
    ...(activity.currentTargetKey
      ? { targetKey: activity.currentTargetKey }
      : {}),
    reason,
  });
}

function holdForTaskPreemption(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  nextTaskId: string,
): void {
  holdActivity(
    portfolio,
    activity,
    `assignee switched to ${nextTaskId}`,
    "on_hold",
    true,
  );
}

function holdForMissingAssignee(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
): void {
  holdActivity(
    portfolio,
    activity,
    `assignee ${activity.assignee} is unavailable; governed work awaits reassignment`,
  );
}

function reassignActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  intent: Intent,
  targetKey: string,
): void {
  const trace = intent.trace;
  if (!trace) return;
  const previousAssignee = activity.assignee;
  activity.assignee = intentActorKey(intent);
  activity.updatedAt = Game.time;
  if (trace.workKey && !activity.workKey) activity.workKey = trace.workKey;
  appendEvent(portfolio, activity, "activity_reassigned", {
    procedureId: trace.procedureId,
    targetKey,
    previousAssignee,
    reason: isSystemAssignee(previousAssignee)
      ? `governed work handed off from ${previousAssignee} to ${activity.assignee}`
      : `governed work reassigned from ${previousAssignee} after performer became unavailable`,
  });
  resumeActivity(
    portfolio,
    activity,
    trace.procedureId,
    targetKey,
    trace.workKey,
  );
}

function sweepMissingAssignees(): void {
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (
        activity.status !== "in_progress" ||
        isSystemAssignee(activity.assignee)
      )
        continue;
      const creep = Game.creeps[activity.assignee];
      if (!creep || creep.spawning) holdForMissingAssignee(portfolio, activity);
    }
  }
}

function sourceDepleted(activity: EvidenceActivity): boolean {
  return sourceObjectDepleted(activityObject(activity));
}

function storeDepleted(activity: EvidenceActivity): boolean {
  return storeObjectDepleted(activityObject(activity));
}

function repairedEnough(activity: EvidenceActivity): boolean {
  const object = activityObject(activity);
  if (!object || !("hits" in object) || !("hitsMax" in object)) return false;
  const structure = object as Structure;
  if (structure.structureType === STRUCTURE_RAMPART) {
    return structure.hits >= Math.min(10_000, structure.hitsMax);
  }
  return structure.hits >= structure.hitsMax * 0.5;
}

function isLegacyWaitingTask(taskKey: string): boolean {
  return (
    taskKey === "stage-source-transport" || taskKey === "hold-surplus-transport"
  );
}

function energyServiceHandoffReason(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  creep: Creep,
  nextTaskId: string,
): string | null {
  const task = portfolio.tasks[activity.taskId];
  if (task?.taskKey !== "maintain-colony-energy-service") return null;
  if (metric(activity.metrics.productiveTicks) <= 0) return null;

  const currentProcedure = procedureKey(task, activity);
  if (
    currentProcedure !== "extract-source-energy" &&
    currentProcedure !== "withdraw-buffered-energy" &&
    currentProcedure !== "recover-salvage-energy"
  ) {
    return null;
  }

  const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  if (energy <= 0) return null;

  return `canonical energy-service collection handed usable energy (${energy}) to downstream governed Task ${nextTaskId} after ${currentProcedure}`;
}

function completionReason(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  creep: Creep,
): string | null {
  const task = portfolio.tasks[activity.taskId];
  if (!task) return null;
  const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? energy;
  const productive = metric(activity.metrics.productiveTicks);
  const currentProcedure = procedureKey(task, activity);

  switch (task.taskKey) {
    case "maintain-colony-energy-service":
      if (
        productive > 0 &&
        (currentProcedure === "buffer-source-energy" ||
          currentProcedure === "fund-workforce-energy") &&
        energy <= 0
      ) {
        return `canonical energy-service cycle completed through ${currentProcedure}`;
      }
      return null;
    case "advance-controller-capability":
      return productive > 0 && energy <= 0
        ? "controller advancement load was productively invested"
        : null;
    case "realize-planned-infrastructure":
      if (
        currentProcedure === "build-planned-infrastructure" &&
        productive > 0 &&
        activity.currentTargetKey &&
        activityObject(activity) === null &&
        infrastructureBuilt(activity)
      ) {
        return "planned infrastructure target verified at governed room-plan location";
      }
      return null;
    case "maintain-infrastructure-condition":
      if (
        productive <= 0 ||
        (activity.currentTargetKey && activityObject(activity) === null)
      ) {
        return null;
      }
      return repairedEnough(activity)
        ? "infrastructure target reached governed health threshold"
        : null;
    case "maintain-defensive-readiness":
      return currentProcedure === "fund-tower-reserve" &&
        productive > 0 &&
        energy <= 0
        ? "defensive reserve funding load was fully delivered"
        : null;

    case "produce-source-energy":
    case "maintain-energy-flow":
      if (capacity > 0 && energy >= capacity)
        return "collection load reached creep capacity";
      if (productive > 0 && sourceDepleted(activity)) {
        return "assigned source was exhausted after productive collection";
      }
      return null;
    case "recover-salvage-energy":
    case "move-buffered-energy":
      if (capacity > 0 && energy >= capacity)
        return "collection load reached creep capacity";
      if (productive > 0 && storeDepleted(activity)) {
        return "assigned energy store was exhausted after productive collection";
      }
      return null;
    case "buffer-source-energy":
    case "fund-reproduction":
    case "maintain-defense-reserve":
    case "advance-controller":
      return energy <= 0 ? "assigned delivery load was fully spent" : null;
    case "build-infrastructure":
      return activity.currentTargetKey && activityObject(activity) === null
        ? "assigned construction target reached terminal state"
        : null;
    case "restore-infrastructure":
      if (activity.currentTargetKey && activityObject(activity) === null) {
        return "assigned repair target is no longer present";
      }
      return repairedEnough(activity)
        ? "assigned repair target reached governed health threshold"
        : null;
    default:
      return null;
  }
}

function ratingValue(rating: Exclude<FspmKpiRating, "in_progress">): number {
  switch (rating) {
    case "exceptional":
      return 1.5;
    case "satisfactory":
      return 1;
    case "unsatisfactory":
      return 0.5;
  }
}

function scoreCanonicalActivity(
  task: ColonyTask,
  activity: EvidenceActivity,
): Exclude<FspmKpiRating, "in_progress"> | undefined {
  const productive = metric(activity.metrics.productiveTicks);
  const blocked = metric(activity.metrics.blockedTicks);
  const retargets = metric(activity.metrics.targetRetargets);
  const conversion = activityWorkConversionRatio(activity) ?? 0;

  switch (task.taskKey) {
    case "maintain-colony-energy-service":
      if (productive <= 0 || blocked > 0 || retargets > 0)
        return "unsatisfactory";
      return metric(activity.metrics.procedureTransitions) >= 1 &&
        conversion >= 0.75
        ? "exceptional"
        : "satisfactory";
    case "advance-controller-capability":
      if (productive <= 0 || blocked > 0) return "unsatisfactory";
      return conversion >= 0.6 ? "exceptional" : "satisfactory";
    case "maintain-workforce-capacity":
      return productive > 0 && blocked === 0
        ? "satisfactory"
        : "unsatisfactory";
    case "realize-planned-infrastructure":
      if (productive <= 0 || blocked > 0) return "unsatisfactory";
      return conversion >= 0.6 ? "exceptional" : "satisfactory";
    case "maintain-infrastructure-condition":
      if (productive <= 0 || blocked > 0) return "unsatisfactory";
      return conversion >= 0.6 ? "exceptional" : "satisfactory";
    case "maintain-defensive-readiness":
      if (productive <= 0 || blocked > 0) return "unsatisfactory";
      return conversion >= 0.75 ? "exceptional" : "satisfactory";
    default:
      return undefined;
  }
}

function scoreActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
): Exclude<FspmKpiRating, "in_progress"> {
  const task = portfolio.tasks[activity.taskId];
  if (task) {
    const canonical = scoreCanonicalActivity(task, activity);
    if (canonical) return canonical;
  }

  if (activity.outcome && activity.outcome.target > 0) {
    if (activity.outcome.utilization >= 0.9) return "exceptional";
    if (activity.outcome.actual > 0) return "satisfactory";
    return "unsatisfactory";
  }
  if (
    metric(activity.metrics.productiveTicks) > 0 ||
    metric(activity.metrics.waitTicks) > 0
  ) {
    return "satisfactory";
  }
  return "unsatisfactory";
}

function recordCompletedKpi(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  rating: Exclude<FspmKpiRating, "in_progress">,
  evidence: string,
): void {
  const task = portfolio.tasks[activity.taskId];
  if (!task) return;
  portfolio.activityKpiHistory ??= {};
  const history = portfolio.activityKpiHistory[task.id] ?? [];
  const sample: FspmActivityKpiSample = {
    tick: Game.time,
    activityId: activity.id,
    activityType: task.taskKey,
    actor: activity.assignee,
    rating,
    value: ratingValue(rating),
    evidence,
    ...(activity.outcome ? { outcome: { ...activity.outcome } } : {}),
  };
  history.push(sample);
  if (history.length > TASK_KPI_HISTORY_LIMIT) {
    history.splice(0, history.length - TASK_KPI_HISTORY_LIMIT);
  }
  portfolio.activityKpiHistory[task.id] = history;
  const qi = computeTaskQi(history, Game.time);
  if (qi) task.qi = qi;
}

function completeActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  reason: string,
  ratingOverride?: Exclude<FspmKpiRating, "in_progress">,
): void {
  if (activity.status === "completed") return;
  closeCurrentProcedure(activity);
  activity.status = "completed";
  activity.completedAt = Game.time;
  activity.updatedAt = Game.time;
  activity.metrics.currentTravelStreak = 0;
  delete activity.holdReason;

  const rating = ratingOverride ?? scoreActivity(portfolio, activity);
  const evidence = `${reason}; Quality Metric=${activity.qualityMetric}; productive=${metric(activity.metrics.productiveTicks)} travel=${metric(activity.metrics.travelTicks)} wait=${metric(activity.metrics.waitTicks)} blocked=${metric(activity.metrics.blockedTicks)} assignmentGap=${metric(activity.metrics.assignmentGapTicks)} procedureTransitions=${metric(activity.metrics.procedureTransitions)} targetAdvances=${metric(activity.metrics.targetAdvances)} retargets=${metric(activity.metrics.targetRetargets)}`;
  activity.kpiScore = rating;
  activity.kpiEvidence = evidence;

  appendEvent(portfolio, activity, "activity_completed", {
    procedureId: activity.currentProcedureId,
    ...(activity.currentTargetKey
      ? { targetKey: activity.currentTargetKey }
      : {}),
    reason,
  });
  recordCompletedKpi(portfolio, activity, rating, evidence);
  appendEvent(portfolio, activity, "kpi_scored", {
    procedureId: activity.currentProcedureId,
    ...(activity.currentTargetKey
      ? { targetKey: activity.currentTargetKey }
      : {}),
    reason: evidence,
    kpiScore: rating,
  });
}

function sweepSatisfiedActivities(): void {
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (
        activity.status !== "in_progress" ||
        isSystemAssignee(activity.assignee)
      )
        continue;
      const creep = Game.creeps[activity.assignee];
      if (!creep || creep.spawning) continue;
      const task = portfolio.tasks[activity.taskId];
      const currentProcedure = task ? procedureKey(task, activity) : undefined;

      if (
        task?.taskKey === "realize-planned-infrastructure" &&
        currentProcedure === "build-planned-infrastructure" &&
        metric(activity.metrics.productiveTicks) > 0 &&
        activity.currentTargetKey &&
        activityObject(activity) === null &&
        !infrastructureBuilt(activity)
      ) {
        activity.metrics.blockedTicks =
          metric(activity.metrics.blockedTicks) + 1;
        activity.metrics.idleTicks += 1;
        holdActivity(
          portfolio,
          activity,
          "construction site disappeared without the governed structure being present; Activity awaits re-siting",
          "blocked",
        );
        continue;
      }

      if (
        task?.taskKey === "maintain-infrastructure-condition" &&
        metric(activity.metrics.productiveTicks) > 0 &&
        activity.currentTargetKey &&
        activityObject(activity) === null
      ) {
        completeActivity(
          portfolio,
          activity,
          "maintenance target disappeared before governed health restoration could be verified",
          "unsatisfactory",
        );
        continue;
      }

      const reason = completionReason(portfolio, activity, creep);
      if (reason) completeActivity(portfolio, activity, reason);
    }
  }
}

function pendingWorkforceTarget(activity: EvidenceActivity): string | null {
  if (!activity.currentTargetKey?.startsWith("creep:")) return null;
  return activity.currentTargetKey.slice("creep:".length);
}

function sweepPendingWorkforceActivities(): void {
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (
        activity.status !== "in_progress" ||
        !activity.assignee.startsWith("spawn:") ||
        activity.updatedAt >= Game.time
      ) {
        continue;
      }
      const task = portfolio.tasks[activity.taskId];
      if (task?.taskKey !== "maintain-workforce-capacity") continue;
      const creepName = pendingWorkforceTarget(activity);
      if (!creepName) continue;
      const creep = Game.creeps[creepName];

      if (creep?.spawning) {
        recordAssignmentTick(activity, "waiting_intentional");
        activity.updatedAt = Game.time;
        continue;
      }
      if (creep) {
        completeActivity(
          portfolio,
          activity,
          `spawned workforce ${creepName} reached viable non-spawning state`,
        );
        continue;
      }

      const spawnName = activity.assignee.slice("spawn:".length);
      const spawn = Game.spawns?.[spawnName];
      if (spawn?.spawning?.name === creepName) {
        recordAssignmentTick(activity, "waiting_intentional");
        activity.updatedAt = Game.time;
        continue;
      }
      holdActivity(
        portfolio,
        activity,
        `staffing target ${creepName} disappeared before reaching viable workforce state`,
        "blocked",
      );
    }
  }
}

function advanceBoundActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  intent: Intent,
  targetKey: string,
): void {
  const trace = intent.trace;
  if (!trace) return;
  if (trace.workKey && !activity.workKey) activity.workKey = trace.workKey;

  if (activity.currentProcedureId !== trace.procedureId) {
    activity.metrics.procedureTransitions += 1;
    enterProcedure(
      portfolio,
      activity,
      trace.procedureId,
      targetKey,
      "planner advanced to a different governed Procedure",
    );
  } else {
    recordTargetTransition(
      portfolio,
      activity,
      targetKey,
      "planner selected a different concrete target within the current Procedure",
    );
  }
  activity.updatedAt = Game.time;
}

function bindCreepIntent(
  intent: CreepIntent,
  authority: ActiveFspmAuthority,
): void {
  const trace = intent.trace;
  if (!trace) return;
  const portfolio = evidencePortfolio(authority.portfolio);
  portfolio.activities ??= {};

  let assigneeActivities = activitiesForAssignee(portfolio, intent.creepName);
  let current = assigneeActivities.find(
    (activity) => activity.status === "in_progress",
  );
  const targetKey = targetKeyForIntent(intent);

  if (current && current.taskId !== trace.taskId) {
    const currentTask = portfolio.tasks[current.taskId];
    const creep = Game.creeps[intent.creepName];
    const handoffReason = creep
      ? energyServiceHandoffReason(portfolio, current, creep, trace.taskId)
      : null;
    if (currentTask && isLegacyWaitingTask(currentTask.taskKey)) {
      completeActivity(
        portfolio,
        current,
        `legacy waiting assignment ended when planner selected ${trace.taskId}`,
      );
    } else if (handoffReason) {
      completeActivity(portfolio, current, handoffReason);
    } else {
      holdForTaskPreemption(portfolio, current, trace.taskId);
    }
    assigneeActivities = activitiesForAssignee(portfolio, intent.creepName);
    current = assigneeActivities.find(
      (activity) => activity.status === "in_progress",
    );
  }

  let activity: EvidenceActivity | undefined;
  if (current?.taskId === trace.taskId) {
    activity = current;
    advanceBoundActivity(portfolio, activity, intent, targetKey);
  } else {
    activity = assigneeActivities.find(
      (candidate) =>
        candidate.taskId === trace.taskId &&
        candidate.status === "on_hold" &&
        (!trace.workKey || candidate.workKey === trace.workKey),
    );
    if (activity) {
      resumeActivity(
        portfolio,
        activity,
        trace.procedureId,
        targetKey,
        trace.workKey,
      );
    } else {
      const transferable = latestHeldActivityForTaskWork(
        portfolio,
        trace.taskId,
        targetKey,
        trace.workKey,
      );
      if (transferable) {
        activity = transferable;
        reassignActivity(portfolio, activity, intent, targetKey);
      } else {
        activity = openActivity(portfolio, intent);
      }
    }
  }

  if (activity) trace.activityId = activity.id;
}

function bindSystemIntent(
  intent: Exclude<Intent, CreepIntent>,
  authority: ActiveFspmAuthority,
): void {
  const trace = intent.trace;
  if (!trace) return;
  const portfolio = evidencePortfolio(authority.portfolio);
  const assignee = intentActorKey(intent);
  const targetKey = targetKeyForIntent(intent);
  const candidates = activitiesForAssignee(portfolio, assignee);
  let activity = candidates.find(
    (candidate) =>
      candidate.taskId === trace.taskId &&
      candidate.status === "in_progress" &&
      (!trace.workKey || candidate.workKey === trace.workKey),
  );
  if (activity) {
    advanceBoundActivity(portfolio, activity, intent, targetKey);
  } else {
    activity = candidates.find(
      (candidate) =>
        candidate.taskId === trace.taskId &&
        candidate.status === "on_hold" &&
        (!trace.workKey || candidate.workKey === trace.workKey),
    );
    if (activity) {
      resumeActivity(
        portfolio,
        activity,
        trace.procedureId,
        targetKey,
        trace.workKey,
      );
    } else {
      const transferable = trace.workKey
        ? latestHeldActivityForTaskWork(
            portfolio,
            trace.taskId,
            targetKey,
            trace.workKey,
            true,
          )
        : undefined;
      if (transferable) {
        activity = transferable;
        reassignActivity(portfolio, activity, intent, targetKey);
      } else {
        activity = openActivity(portfolio, intent);
      }
    }
  }
  if (activity) trace.activityId = activity.id;
}

export function bindFspmActivities(
  intents: Intent[],
  snapshot: FspmAuthoritySnapshot = createFspmAuthoritySnapshot(),
): FspmAuthorityDenialSummary {
  const denied = createFspmAuthorityDenialSummary();
  sweepMissingAssignees();
  sweepSatisfiedActivities();
  sweepPendingWorkforceActivities();
  for (const intent of intents) {
    const authority = snapshot.resolveIntent(intent);
    if (!authority.authorized) {
      recordFspmAuthorityDenial(denied, intent, authority);
      continue;
    }
    if (isCreepIntent(intent)) bindCreepIntent(intent, authority);
    else bindSystemIntent(intent, authority);
  }
  return denied;
}

function aggregateOutcome(
  activity: EvidenceActivity,
  observation: ActivityExecutionObservation,
): void {
  const outcome = observation.outcome;
  if (!outcome || outcome.target <= 0) return;
  if (!activity.outcome) {
    activity.outcome = {
      ...outcome,
      utilization: Math.round((outcome.actual / outcome.target) * 1000) / 1000,
    };
    return;
  }
  if (
    activity.outcome.metric !== outcome.metric ||
    activity.outcome.unit !== outcome.unit
  )
    return;
  activity.outcome.actual += outcome.actual;
  activity.outcome.target += outcome.target;
  activity.outcome.utilization =
    Math.round((activity.outcome.actual / activity.outcome.target) * 1000) /
    1000;
}

function recordAssignmentTick(
  activity: EvidenceActivity,
  state: FspmAssignmentState,
): void {
  activity.currentDisposition = state;
  activity.metrics.inProgressTicks += 1;

  if (state === "traveling") {
    activity.metrics.travelTicks += 1;
    activity.metrics.currentTravelStreak =
      metric(activity.metrics.currentTravelStreak) + 1;
    activity.metrics.maxTravelStreak = Math.max(
      metric(activity.metrics.maxTravelStreak),
      metric(activity.metrics.currentTravelStreak),
    );
    return;
  }

  activity.metrics.currentTravelStreak = 0;
  switch (state) {
    case "executing":
      activity.metrics.productiveTicks += 1;
      activity.metrics.firstProductiveAt ??= Game.time;
      break;
    case "waiting_intentional":
      activity.metrics.waitTicks = metric(activity.metrics.waitTicks) + 1;
      break;
    case "planner_unassigned":
      activity.metrics.assignmentGapTicks =
        metric(activity.metrics.assignmentGapTicks) + 1;
      activity.metrics.idleTicks += 1;
      break;
    case "arbitration_lost":
      activity.metrics.arbitrationLostTicks =
        metric(activity.metrics.arbitrationLostTicks) + 1;
      activity.metrics.idleTicks += 1;
      break;
    case "blocked":
      activity.metrics.blockedTicks = metric(activity.metrics.blockedTicks) + 1;
      activity.metrics.idleTicks += 1;
      break;
    case "on_hold":
      break;
  }
}

function classifyAssignment(
  creepName: string,
  observation: ActivityExecutionObservation | undefined,
  accepted: CreepIntent | undefined,
  proposed: boolean,
  rejected: ArbitrationRejection | undefined,
  current: EvidenceActivity | undefined,
  held: EvidenceActivity | undefined,
): { state: FspmAssignmentState; reason: string } {
  if (observation) {
    if (
      observation.result === ERR_NOT_IN_RANGE &&
      observation.movementRequired
    ) {
      return { state: "traveling", reason: observation.evidence };
    }
    if (observation.result === OK && observation.intent.type === "move") {
      return {
        state: "waiting_intentional",
        reason:
          "positioning Procedure is satisfied; creep is intentionally staged",
      };
    }
    if (observation.result === OK)
      return { state: "executing", reason: observation.evidence };
    return { state: "blocked", reason: observation.evidence };
  }
  if (accepted) {
    return {
      state: "blocked",
      reason: "accepted creep intent produced no execution observation",
    };
  }
  if (rejected || proposed) {
    return {
      state: "arbitration_lost",
      reason: rejected
        ? `proposed intent lost arbitration on ${rejected.conflictKey}`
        : "proposed creep work was not accepted by arbitration",
    };
  }
  if (!current && held) {
    return {
      state: "on_hold",
      reason: held.holdReason ?? "Activity is intentionally On Hold",
    };
  }
  return {
    state: "planner_unassigned",
    reason: `planner produced no accepted assignment for ${creepName}`,
  };
}

function activityForObservation(
  observation: ActivityExecutionObservation,
): { portfolio: EvidencePortfolio; activity: EvidenceActivity } | undefined {
  const activityId = observation.intent.trace?.activityId;
  const taskId = observation.intent.trace?.taskId;
  if (!activityId || !taskId) return undefined;
  const portfolio = portfolioForTask(taskId);
  const activity = portfolio?.activities?.[activityId];
  return portfolio && activity ? { portfolio, activity } : undefined;
}

function reconcileSystemObservation(
  observation: ActivityExecutionObservation,
): FspmAssignmentEvidence | undefined {
  if (isCreepIntent(observation.intent)) return undefined;
  const ref = activityForObservation(observation);
  if (!ref) return undefined;
  const { portfolio, activity } = ref;
  const state: FspmAssignmentState =
    observation.result === OK ? "executing" : "blocked";
  recordAssignmentTick(activity, state);
  if (state === "executing") aggregateOutcome(activity, observation);

  if (observation.result === OK) {
    switch (observation.intent.type) {
      case "createConstructionSite":
        holdActivity(
          portfolio,
          activity,
          "construction site created; governed infrastructure Activity awaits build performer handoff",
        );
        break;
      case "spawn":
        break;
      case "towerAttack":
        completeActivity(
          portfolio,
          activity,
          `tower ${observation.intent.towerId} executed governed hostile response`,
        );
        break;
    }
  } else {
    holdActivity(
      portfolio,
      activity,
      `${observation.intent.type} execution failed with Screeps code ${observation.result}; work remains resumable`,
      "blocked",
    );
  }

  return {
    tick: Game.time,
    assignee: activity.assignee,
    state,
    activityId: activity.id,
    taskId: activity.taskId,
    procedureId: activity.currentProcedureId,
    targetKey: activity.currentTargetKey ?? null,
    reason: observation.evidence,
  };
}

export function reconcileFspmActivityEvidence(
  input: ActivityExecutionObservation[] | ReconcileFspmActivityEvidenceInput,
): FspmAssignmentEvidence[] {
  const context: ReconcileFspmActivityEvidenceInput = Array.isArray(input)
    ? { observations: input, proposed: [], accepted: [], rejected: [] }
    : input;

  sweepMissingAssignees();
  sweepPendingWorkforceActivities();
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (activity.status === "on_hold") activity.metrics.onHoldTicks += 1;
    }
  }

  const creepObservations = context.observations.filter(
    (
      observation,
    ): observation is ActivityExecutionObservation & { intent: CreepIntent } =>
      isCreepIntent(observation.intent),
  );
  const observationByCreep = new Map(
    creepObservations.map((observation) => [
      observation.intent.creepName,
      observation,
    ]),
  );
  const acceptedByCreep = new Map<string, CreepIntent>();
  for (const intent of context.accepted) {
    if (isCreepIntent(intent)) acceptedByCreep.set(intent.creepName, intent);
  }
  const proposedCreeps = new Set<string>();
  for (const intent of context.proposed) {
    if (isCreepIntent(intent)) proposedCreeps.add(intent.creepName);
  }
  const rejectedByCreep = new Map<string, ArbitrationRejection>();
  for (const rejection of context.rejected) {
    if (isCreepIntent(rejection.loser)) {
      rejectedByCreep.set(rejection.loser.creepName, rejection);
    }
  }

  const assignments: FspmAssignmentEvidence[] = [];
  for (const observation of context.observations) {
    const systemEvidence = reconcileSystemObservation(observation);
    if (systemEvidence) assignments.push(systemEvidence);
  }

  const creeps = context.creeps ?? Object.values(Game.creeps);
  for (const creep of creeps) {
    if (creep.spawning) continue;
    const observation = observationByCreep.get(creep.name);
    const accepted = acceptedByCreep.get(creep.name);
    const currentRef = currentActivityForAssignee(creep.name);
    const heldRef = latestHeldActivityForAssignee(creep.name);
    const activity = currentRef?.activity;
    const classified = classifyAssignment(
      creep.name,
      observation,
      accepted,
      proposedCreeps.has(creep.name),
      rejectedByCreep.get(creep.name),
      activity,
      heldRef?.activity,
    );

    if (activity) {
      recordAssignmentTick(activity, classified.state);
      if (classified.state === "executing" && observation) {
        aggregateOutcome(activity, observation);
      }
    }

    const evidenceActivity = activity ?? heldRef?.activity;
    assignments.push({
      tick: Game.time,
      assignee: creep.name,
      state: classified.state,
      activityId: evidenceActivity?.id ?? null,
      taskId: evidenceActivity?.taskId ?? null,
      procedureId: evidenceActivity?.currentProcedureId ?? null,
      targetKey: evidenceActivity?.currentTargetKey ?? null,
      reason: classified.reason,
    });
  }

  sweepSatisfiedActivities();
  return assignments.sort((a, b) => a.assignee.localeCompare(b.assignee));
}

export function activityContinuityRatio(
  activity: FspmActivityRecord,
): number | null {
  const evidence = activity as EvidenceActivity;
  const elapsed =
    evidence.metrics.inProgressTicks + evidence.metrics.onHoldTicks;
  if (elapsed <= 0) return null;
  return (
    Math.round(
      ((evidence.metrics.productiveTicks +
        evidence.metrics.travelTicks +
        metric(evidence.metrics.waitTicks)) /
        elapsed) *
        1000,
    ) / 1000
  );
}

export function activityWorkConversionRatio(
  activity: FspmActivityRecord,
): number | null {
  const evidence = activity as EvidenceActivity;
  const denominator =
    evidence.metrics.productiveTicks +
    evidence.metrics.travelTicks +
    metric(evidence.metrics.blockedTicks) +
    metric(evidence.metrics.assignmentGapTicks) +
    metric(evidence.metrics.arbitrationLostTicks);
  if (denominator <= 0) return null;
  return (
    Math.round((evidence.metrics.productiveTicks / denominator) * 1000) / 1000
  );
}

export function activityTimeToFirstProductiveWork(
  activity: FspmActivityRecord,
): number | null {
  const evidence = activity as EvidenceActivity;
  if (
    evidence.startedAt === undefined ||
    evidence.metrics.firstProductiveAt === undefined
  ) {
    return null;
  }
  return Math.max(0, evidence.metrics.firstProductiveAt - evidence.startedAt);
}

export function fspmActivityEvents(
  portfolio: ColonyFspmPortfolio,
): FspmActivityEvent[] {
  return [...(evidencePortfolio(portfolio).activityEvents ?? [])];
}
