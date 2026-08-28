import type { ArbitrationRejection } from "../intents/arbitrate";
import type { ActivityExecutionObservation } from "../intents/execute";
import type { CreepIntent, Intent } from "../intents/types";
import type {
  ColonyFspmPortfolio,
  FspmActivityKpiSample,
  FspmActivityMetrics,
  FspmActivityRecord,
  FspmKpiRating,
} from "./fspm";
import { computeTaskQi } from "./task-kpi";

const ACTIVITY_EVENT_LIMIT = 192;
const TASK_KPI_HISTORY_LIMIT = 24;

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
  currentTravelStreak?: number;
  maxTravelStreak?: number;
  firstProductiveAt?: number;
}

interface EvidenceActivity extends FspmActivityRecord {
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

export interface ReconcileFspmActivityEvidenceInput {
  observations: ActivityExecutionObservation[];
  proposed: Intent[];
  accepted: Intent[];
  rejected: ArbitrationRejection[];
  creeps?: Creep[];
}

const metric = (value: number | undefined): number => value ?? 0;

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

function targetKeyForIntent(intent: CreepIntent): string {
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
    portfolio.activityEvents.splice(0, portfolio.activityEvents.length - ACTIVITY_EVENT_LIMIT);
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

function openActivity(
  portfolio: EvidencePortfolio,
  intent: CreepIntent,
): EvidenceActivity | undefined {
  const trace = intent.trace;
  if (!trace) return undefined;
  const task = portfolio.tasks[trace.taskId];
  if (!task) return undefined;

  portfolio.activities ??= {};
  const targetKey = targetKeyForIntent(intent);
  const id = `activity:${trace.taskId}:${intent.creepName}:${Game.time}`;
  const activity: EvidenceActivity = {
    id,
    taskId: task.id,
    assignee: intent.creepName,
    status: "in_progress",
    currentProcedureId: trace.procedureId,
    currentTargetKey: targetKey,
    qualityDescription: task.qualityDescription,
    qualityMetric: task.qualityMetric,
    kpiMetric: { ...task.kpiMetric },
    createdAt: Game.time,
    updatedAt: Game.time,
    startedAt: Game.time,
    procedureHistory: [],
    metrics: newMetrics(),
  };
  portfolio.activities[id] = activity;
  appendEvent(portfolio, activity, "activity_opened", {
    procedureId: trace.procedureId,
    targetKey,
    reason: intent.reason,
  });
  appendEvent(portfolio, activity, "activity_started", {
    procedureId: trace.procedureId,
    targetKey,
    reason: "assignee began governed Task execution",
  });
  enterProcedure(
    portfolio,
    activity,
    trace.procedureId,
    targetKey,
    "initial Task Procedure",
  );
  return activity;
}

function activitiesForAssignee(
  portfolio: EvidencePortfolio,
  assignee: string,
): EvidenceActivity[] {
  return Object.values(portfolio.activities ?? {})
    .filter((activity) => activity.assignee === assignee && activity.status !== "completed")
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
      (candidate) => candidate.assignee === assignee && candidate.status === "in_progress",
    );
    if (activity) return { portfolio, activity };
  }
  return undefined;
}

function latestHeldActivityForAssignee(
  assignee: string,
): { portfolio: EvidencePortfolio; activity: EvidenceActivity } | undefined {
  let latest: { portfolio: EvidencePortfolio; activity: EvidenceActivity } | undefined;
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (activity.assignee !== assignee || activity.status !== "on_hold") continue;
      if (!latest || activity.updatedAt > latest.activity.updatedAt) {
        latest = { portfolio, activity };
      }
    }
  }
  return latest;
}

function latestOrphanedHeldActivityForTaskTarget(
  portfolio: EvidencePortfolio,
  taskId: string,
  targetKey: string,
): EvidenceActivity | undefined {
  return Object.values(portfolio.activities ?? {})
    .filter(
      (activity) =>
        activity.status === "on_hold" &&
        activity.taskId === taskId &&
        activity.currentTargetKey === targetKey &&
        !Game.creeps[activity.assignee],
    )
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        b.id.localeCompare(a.id),
    )[0];
}

function resumeActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  procedureId: string,
  targetKey: string,
): void {
  activity.status = "in_progress";
  activity.updatedAt = Game.time;
  activity.metrics.resumeCount += 1;
  delete activity.holdReason;
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
  }

  if (activity.currentTargetKey !== targetKey) {
    const previousTargetKey = activity.currentTargetKey;
    activity.currentTargetKey = targetKey;
    activity.metrics.targetRetargets = metric(activity.metrics.targetRetargets) + 1;
    appendEvent(portfolio, activity, "target_changed", {
      procedureId,
      targetKey,
      ...(previousTargetKey ? { previousTargetKey } : {}),
      reason: "resumed Task selected a different concrete target",
    });
  }
}

function holdForTaskPreemption(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  nextTaskId: string,
): void {
  if (activity.status !== "in_progress") return;
  activity.status = "on_hold";
  activity.updatedAt = Game.time;
  activity.holdReason = `assignee switched to ${nextTaskId}`;
  activity.metrics.holdCount += 1;
  activity.metrics.taskPreemptions += 1;
  activity.metrics.currentTravelStreak = 0;
  appendEvent(portfolio, activity, "activity_held", {
    procedureId: activity.currentProcedureId,
    ...(activity.currentTargetKey ? { targetKey: activity.currentTargetKey } : {}),
    reason: activity.holdReason,
  });
}

function holdForMissingAssignee(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
): void {
  if (activity.status !== "in_progress") return;
  activity.status = "on_hold";
  activity.updatedAt = Game.time;
  activity.holdReason = `assignee ${activity.assignee} is unavailable; governed work awaits reassignment`;
  activity.currentDisposition = "on_hold";
  activity.metrics.holdCount += 1;
  activity.metrics.currentTravelStreak = 0;
  appendEvent(portfolio, activity, "activity_held", {
    procedureId: activity.currentProcedureId,
    ...(activity.currentTargetKey ? { targetKey: activity.currentTargetKey } : {}),
    reason: activity.holdReason,
  });
}

function reassignActivity(
  portfolio: EvidencePortfolio,
  activity: EvidenceActivity,
  intent: CreepIntent,
  targetKey: string,
): void {
  const trace = intent.trace;
  if (!trace) return;
  const previousAssignee = activity.assignee;
  activity.assignee = intent.creepName;
  activity.updatedAt = Game.time;
  appendEvent(portfolio, activity, "activity_reassigned", {
    procedureId: trace.procedureId,
    targetKey,
    previousAssignee,
    reason: `governed work reassigned from ${previousAssignee} after performer became unavailable`,
  });
  resumeActivity(portfolio, activity, trace.procedureId, targetKey);
}

function sweepMissingAssignees(): void {
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (activity.status !== "in_progress") continue;
      const creep = Game.creeps[activity.assignee];
      if (!creep || creep.spawning) holdForMissingAssignee(portfolio, activity);
    }
  }
}

function activityObject(activity: EvidenceActivity): RoomObject | null {
  if (!activity.currentTargetKey) return null;
  return Game.getObjectById(
    activity.currentTargetKey as Id<Source | AnyStructure | ConstructionSite | Tombstone | Ruin>,
  );
}

function sourceDepleted(activity: EvidenceActivity): boolean {
  const object = activityObject(activity);
  return (
    object !== null &&
    "energy" in object &&
    typeof object.energy === "number" &&
    object.energy <= 0
  );
}

function storeDepleted(activity: EvidenceActivity): boolean {
  const object = activityObject(activity);
  if (!object || !("store" in object)) return false;
  const storeObject = object as StructureContainer | Tombstone | Ruin;
  return storeObject.store.getUsedCapacity(RESOURCE_ENERGY) <= 0;
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

function isWaitingTask(taskKey: string): boolean {
  return taskKey === "stage-source-transport" || taskKey === "hold-surplus-transport";
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

  switch (task.taskKey) {
    case "produce-source-energy":
    case "maintain-energy-flow":
      if (capacity > 0 && energy >= capacity) return "collection load reached creep capacity";
      if (metric(activity.metrics.productiveTicks) > 0 && sourceDepleted(activity)) {
        return "assigned source was exhausted after productive collection";
      }
      return null;
    case "recover-salvage-energy":
    case "move-buffered-energy":
      if (capacity > 0 && energy >= capacity) return "collection load reached creep capacity";
      if (metric(activity.metrics.productiveTicks) > 0 && storeDepleted(activity)) {
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

function scoreActivity(activity: EvidenceActivity): Exclude<FspmKpiRating, "in_progress"> {
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
): void {
  if (activity.status === "completed") return;
  closeCurrentProcedure(activity);
  activity.status = "completed";
  activity.completedAt = Game.time;
  activity.updatedAt = Game.time;
  activity.metrics.currentTravelStreak = 0;
  delete activity.holdReason;

  const rating = scoreActivity(activity);
  const evidence = `${reason}; productive=${metric(activity.metrics.productiveTicks)} travel=${metric(activity.metrics.travelTicks)} wait=${metric(activity.metrics.waitTicks)} blocked=${metric(activity.metrics.blockedTicks)} assignmentGap=${metric(activity.metrics.assignmentGapTicks)} retargets=${metric(activity.metrics.targetRetargets)}`;
  activity.kpiScore = rating;
  activity.kpiEvidence = evidence;

  appendEvent(portfolio, activity, "activity_completed", {
    procedureId: activity.currentProcedureId,
    ...(activity.currentTargetKey ? { targetKey: activity.currentTargetKey } : {}),
    reason,
  });
  recordCompletedKpi(portfolio, activity, rating, evidence);
  appendEvent(portfolio, activity, "kpi_scored", {
    procedureId: activity.currentProcedureId,
    ...(activity.currentTargetKey ? { targetKey: activity.currentTargetKey } : {}),
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
      if (activity.status !== "in_progress") continue;
      const creep = Game.creeps[activity.assignee];
      if (!creep || creep.spawning) continue;
      const reason = completionReason(portfolio, activity, creep);
      if (reason) completeActivity(portfolio, activity, reason);
    }
  }
}

function bindCreepIntent(intent: CreepIntent): void {
  const trace = intent.trace;
  if (!trace) return;
  const portfolio = portfolioForTask(trace.taskId);
  if (!portfolio) return;
  portfolio.activities ??= {};

  let assigneeActivities = activitiesForAssignee(portfolio, intent.creepName);
  let current = assigneeActivities.find((activity) => activity.status === "in_progress");
  const targetKey = targetKeyForIntent(intent);

  if (current && current.taskId !== trace.taskId) {
    const currentTask = portfolio.tasks[current.taskId];
    if (currentTask && isWaitingTask(currentTask.taskKey)) {
      completeActivity(
        portfolio,
        current,
        `waiting assignment ended when planner selected ${trace.taskId}`,
      );
    } else {
      holdForTaskPreemption(portfolio, current, trace.taskId);
    }
    assigneeActivities = activitiesForAssignee(portfolio, intent.creepName);
    current = assigneeActivities.find((activity) => activity.status === "in_progress");
  }

  let activity: EvidenceActivity | undefined;
  if (current?.taskId === trace.taskId) {
    activity = current;
    if (activity.currentProcedureId !== trace.procedureId) {
      activity.metrics.procedureTransitions += 1;
      enterProcedure(
        portfolio,
        activity,
        trace.procedureId,
        targetKey,
        "planner advanced to a different governed Procedure",
      );
    }
    if (activity.currentTargetKey !== targetKey) {
      const previousTargetKey = activity.currentTargetKey;
      activity.currentTargetKey = targetKey;
      activity.metrics.targetRetargets = metric(activity.metrics.targetRetargets) + 1;
      appendEvent(portfolio, activity, "target_changed", {
        procedureId: trace.procedureId,
        targetKey,
        ...(previousTargetKey ? { previousTargetKey } : {}),
        reason: "planner selected a different concrete target within the current Task",
      });
    }
    activity.updatedAt = Game.time;
  } else {
    activity = assigneeActivities.find(
      (candidate) => candidate.taskId === trace.taskId && candidate.status === "on_hold",
    );
    if (activity) {
      resumeActivity(portfolio, activity, trace.procedureId, targetKey);
    } else {
      const orphaned = latestOrphanedHeldActivityForTaskTarget(
        portfolio,
        trace.taskId,
        targetKey,
      );
      if (orphaned) {
        activity = orphaned;
        reassignActivity(portfolio, activity, intent, targetKey);
      } else {
        activity = openActivity(portfolio, intent);
      }
    }
  }

  if (activity) trace.activityId = activity.id;
}

export function bindFspmActivities(intents: Intent[]): void {
  sweepMissingAssignees();
  sweepSatisfiedActivities();
  for (const intent of intents) {
    if (!("creepName" in intent)) continue;
    bindCreepIntent(intent);
  }
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
  if (activity.outcome.metric !== outcome.metric || activity.outcome.unit !== outcome.unit) return;
  activity.outcome.actual += outcome.actual;
  activity.outcome.target += outcome.target;
  activity.outcome.utilization =
    Math.round((activity.outcome.actual / activity.outcome.target) * 1000) / 1000;
}

function recordAssignmentTick(activity: EvidenceActivity, state: FspmAssignmentState): void {
  activity.currentDisposition = state;
  activity.metrics.inProgressTicks += 1;

  if (state === "traveling") {
    activity.metrics.travelTicks += 1;
    activity.metrics.currentTravelStreak = metric(activity.metrics.currentTravelStreak) + 1;
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
      activity.metrics.assignmentGapTicks = metric(activity.metrics.assignmentGapTicks) + 1;
      activity.metrics.idleTicks += 1;
      break;
    case "arbitration_lost":
      activity.metrics.arbitrationLostTicks = metric(activity.metrics.arbitrationLostTicks) + 1;
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
    if (observation.result === ERR_NOT_IN_RANGE && observation.movementRequired) {
      return { state: "traveling", reason: observation.evidence };
    }
    if (observation.result === OK && observation.intent.type === "move") {
      return {
        state: "waiting_intentional",
        reason: "positioning Procedure is satisfied; creep is intentionally staged",
      };
    }
    if (observation.result === OK) return { state: "executing", reason: observation.evidence };
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

export function reconcileFspmActivityEvidence(
  input: ActivityExecutionObservation[] | ReconcileFspmActivityEvidenceInput,
): FspmAssignmentEvidence[] {
  const context: ReconcileFspmActivityEvidenceInput = Array.isArray(input)
    ? { observations: input, proposed: [], accepted: [], rejected: [] }
    : input;

  sweepMissingAssignees();
  for (const colony of Object.values(Memory.colonies)) {
    const rawPortfolio = colony.fspm;
    if (!rawPortfolio) continue;
    const portfolio = evidencePortfolio(rawPortfolio);
    for (const activity of Object.values(portfolio.activities ?? {})) {
      if (activity.status === "on_hold") activity.metrics.onHoldTicks += 1;
    }
  }

  const observationByCreep = new Map(
    context.observations.map((observation) => [observation.intent.creepName, observation]),
  );
  const acceptedByCreep = new Map<string, CreepIntent>();
  for (const intent of context.accepted) {
    if ("creepName" in intent) acceptedByCreep.set(intent.creepName, intent);
  }
  const proposedCreeps = new Set<string>();
  for (const intent of context.proposed) {
    if ("creepName" in intent) proposedCreeps.add(intent.creepName);
  }
  const rejectedByCreep = new Map<string, ArbitrationRejection>();
  for (const rejection of context.rejected) {
    if ("creepName" in rejection.loser) {
      rejectedByCreep.set(rejection.loser.creepName, rejection);
    }
  }

  const creeps = context.creeps ?? Object.values(Game.creeps);
  const assignments: FspmAssignmentEvidence[] = [];
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

export function activityContinuityRatio(activity: FspmActivityRecord): number | null {
  const evidence = activity as EvidenceActivity;
  const elapsed = evidence.metrics.inProgressTicks + evidence.metrics.onHoldTicks;
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

export function activityWorkConversionRatio(activity: FspmActivityRecord): number | null {
  const evidence = activity as EvidenceActivity;
  const denominator =
    evidence.metrics.productiveTicks +
    evidence.metrics.travelTicks +
    metric(evidence.metrics.blockedTicks) +
    metric(evidence.metrics.assignmentGapTicks) +
    metric(evidence.metrics.arbitrationLostTicks);
  if (denominator <= 0) return null;
  return Math.round((evidence.metrics.productiveTicks / denominator) * 1000) / 1000;
}

export function activityTimeToFirstProductiveWork(
  activity: FspmActivityRecord,
): number | null {
  const evidence = activity as EvidenceActivity;
  if (evidence.startedAt === undefined || evidence.metrics.firstProductiveAt === undefined) {
    return null;
  }
  return Math.max(0, evidence.metrics.firstProductiveAt - evidence.startedAt);
}

export function fspmActivityEvents(portfolio: ColonyFspmPortfolio): FspmActivityEvent[] {
  return [...(evidencePortfolio(portfolio).activityEvents ?? [])];
}
