import type { ActivityExecutionObservation } from "../intents/execute";
import type { CreepIntent, Intent } from "../intents/types";
import type { ColonyFspmPortfolio, FspmActivityRecord, FspmActivityMetrics } from "./fspm";

function portfolioForTask(taskId: string): ColonyFspmPortfolio | undefined {
  for (const colony of Object.values(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (portfolio?.tasks[taskId]) return portfolio;
  }
  return undefined;
}

function newMetrics(): FspmActivityMetrics {
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
  };
}

function openActivity(
  portfolio: ColonyFspmPortfolio,
  intent: CreepIntent,
): FspmActivityRecord | undefined {
  const trace = intent.trace;
  if (!trace) return undefined;
  const task = portfolio.tasks[trace.taskId];
  if (!task) return undefined;

  portfolio.activities ??= {};
  const id = `activity:${trace.taskId}:${intent.creepName}:${Game.time}`;
  const activity: FspmActivityRecord = {
    id,
    taskId: task.id,
    assignee: intent.creepName,
    status: "in_progress",
    currentProcedureId: trace.procedureId,
    qualityDescription: task.qualityDescription,
    qualityMetric: task.qualityMetric,
    kpiMetric: { ...task.kpiMetric },
    createdAt: Game.time,
    updatedAt: Game.time,
    startedAt: Game.time,
    metrics: newMetrics(),
  };
  portfolio.activities[id] = activity;
  return activity;
}

function activitiesForAssignee(
  portfolio: ColonyFspmPortfolio,
  assignee: string,
): FspmActivityRecord[] {
  return Object.values(portfolio.activities ?? {})
    .filter((activity) => activity.assignee === assignee && activity.status !== "completed")
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function resumeActivity(activity: FspmActivityRecord, procedureId: string): void {
  activity.status = "in_progress";
  activity.updatedAt = Game.time;
  activity.currentProcedureId = procedureId;
  activity.metrics.resumeCount += 1;
  delete activity.holdReason;
}

function holdForTaskPreemption(
  activity: FspmActivityRecord,
  nextTaskId: string,
): void {
  if (activity.status !== "in_progress") return;
  activity.status = "on_hold";
  activity.updatedAt = Game.time;
  activity.holdReason = `assignee switched to ${nextTaskId}`;
  activity.metrics.holdCount += 1;
  activity.metrics.taskPreemptions += 1;
}

function bindCreepIntent(intent: CreepIntent): void {
  const trace = intent.trace;
  if (!trace) return;
  const portfolio = portfolioForTask(trace.taskId);
  if (!portfolio) return;
  portfolio.activities ??= {};

  const assigneeActivities = activitiesForAssignee(portfolio, intent.creepName);
  const current = assigneeActivities.find((activity) => activity.status === "in_progress");

  let activity: FspmActivityRecord | undefined;
  if (current?.taskId === trace.taskId) {
    activity = current;
    if (activity.currentProcedureId !== trace.procedureId) {
      activity.currentProcedureId = trace.procedureId;
      activity.metrics.procedureTransitions += 1;
    }
    activity.updatedAt = Game.time;
  } else {
    if (current) holdForTaskPreemption(current, trace.taskId);

    activity = assigneeActivities.find(
      (candidate) => candidate.taskId === trace.taskId && candidate.status === "on_hold",
    );
    if (activity) resumeActivity(activity, trace.procedureId);
    else activity = openActivity(portfolio, intent);
  }

  if (activity) trace.activityId = activity.id;
}

export function bindFspmActivities(intents: Intent[]): void {
  for (const intent of intents) {
    if (!("creepName" in intent)) continue;
    bindCreepIntent(intent);
  }
}

export function reconcileFspmActivityEvidence(
  observations: ActivityExecutionObservation[],
): void {
  const observationByActivity = new Map<string, ActivityExecutionObservation>();
  for (const observation of observations) {
    const activityId = observation.intent.trace?.activityId;
    if (activityId) observationByActivity.set(activityId, observation);
  }

  for (const colony of Object.values(Memory.colonies)) {
    const activities = Object.values(colony.fspm?.activities ?? {});
    for (const activity of activities) {
      if (activity.status === "completed") continue;

      if (activity.status === "on_hold") {
        activity.metrics.onHoldTicks += 1;
        continue;
      }

      if (activity.updatedAt !== Game.time) {
        activity.metrics.idleTicks += 1;
        continue;
      }

      activity.metrics.inProgressTicks += 1;
      const observation = observationByActivity.get(activity.id);
      if (!observation) {
        activity.metrics.idleTicks += 1;
        continue;
      }

      if (observation.result === ERR_NOT_IN_RANGE && observation.movementRequired) {
        activity.metrics.travelTicks += 1;
      } else if (observation.result === OK) {
        activity.metrics.productiveTicks += 1;
      } else {
        activity.metrics.idleTicks += 1;
      }
    }
  }
}

export function activityContinuityRatio(activity: FspmActivityRecord): number | null {
  const elapsed = activity.metrics.inProgressTicks + activity.metrics.onHoldTicks;
  if (elapsed <= 0) return null;
  return Math.round(
    ((activity.metrics.productiveTicks + activity.metrics.travelTicks) / elapsed) * 1000,
  ) / 1000;
}
