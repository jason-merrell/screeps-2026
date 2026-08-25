import type { ActivityExecutionObservation } from "../intents/execute";
import type {
  ColonyFspmPortfolio,
  FspmActivityKpiSample,
  FspmKpiRating,
  FspmTaskQi,
} from "./fspm";

const HISTORY_LIMIT = 24;

const ratingValue = (rating: FspmKpiRating): number | null => {
  switch (rating) {
    case "exceptional":
      return 1.5;
    case "satisfactory":
      return 1;
    case "unsatisfactory":
      return 0.5;
    case "in_progress":
      return null;
  }
};

export function classifyActivityObservation(
  observation: Pick<ActivityExecutionObservation, "result" | "movementRequired" | "outcome">,
): FspmKpiRating {
  if (observation.result === OK) return observation.outcome && observation.outcome.actual / observation.outcome.target >= 0.9 ? "exceptional" : "satisfactory";
  if (observation.result === ERR_NOT_IN_RANGE && observation.movementRequired) return "in_progress";
  return "unsatisfactory";
}

export function computeTaskQi(samples: FspmActivityKpiSample[], measuredAt: number): FspmTaskQi | undefined {
  const rated = samples.filter((sample) => sample.value !== null);
  if (rated.length === 0) return undefined;

  const score = rated.reduce((sum, sample) => sum + (sample.value ?? 0), 0) / rated.length;
  return {
    score: Math.round(score * 1000) / 1000,
    measuredAt,
    ratedActivities: rated.length,
    totalActivities: samples.length,
    exceptional: rated.filter((sample) => sample.rating === "exceptional").length,
    satisfactory: rated.filter((sample) => sample.rating === "satisfactory").length,
    unsatisfactory: rated.filter((sample) => sample.rating === "unsatisfactory").length,
  };
}

function portfolioForTask(taskId: string): ColonyFspmPortfolio | undefined {
  for (const colony of Object.values(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (portfolio?.tasks[taskId]) return portfolio;
  }
  return undefined;
}

export function reconcileTaskKpis(observations: ActivityExecutionObservation[]): void {
  for (const observation of observations) {
    const trace = observation.intent.trace;
    if (!trace) continue;

    const portfolio = portfolioForTask(trace.taskId);
    const task = portfolio?.tasks[trace.taskId];
    if (!portfolio || !task) continue;

    portfolio.activityKpiHistory ??= {};
    const history = portfolio.activityKpiHistory[task.id] ?? [];
    const rating = classifyActivityObservation(observation);
    const sample: FspmActivityKpiSample = {
      tick: Game.time,
      activityId: trace.activityId,
      activityType: observation.intent.type,
      actor: observation.intent.creepName,
      rating,
      value: ratingValue(rating),
      evidence: observation.evidence,
      ...(observation.outcome ? { outcome: { ...observation.outcome, utilization: Math.round((observation.outcome.actual / observation.outcome.target) * 1000) / 1000 } } : {}),
    };

    history.push(sample);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    portfolio.activityKpiHistory[task.id] = history;

    const qi = computeTaskQi(history, Game.time);
    if (qi) task.qi = qi;
    else delete task.qi;
  }
}
