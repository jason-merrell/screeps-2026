import { evaluateBootstrapState } from "./bootstrap-state.mjs";

const positiveDelta = (after, before) => Math.max(0, Number(after ?? 0) - Number(before ?? 0));

export function bootstrapEnergyActivity(first, current) {
  const delta = {
    harvested: positiveDelta(current?.energy?.harvestedTotal, first?.energy?.harvestedTotal),
    creepSpend: positiveDelta(current?.energy?.creepSpendTotal, first?.energy?.creepSpendTotal),
    constructionSpend: positiveDelta(
      current?.energy?.constructionSpendTotal,
      first?.energy?.constructionSpendTotal,
    ),
    controllerSpend: positiveDelta(
      current?.energy?.controllerSpendTotal,
      first?.energy?.controllerSpendTotal,
    ),
    controllerProgress: positiveDelta(
      current?.controller?.progress,
      first?.controller?.progress,
    ),
  };

  return {
    active: Object.values(delta).some((value) => value > 0),
    delta,
  };
}

export function evaluateBootstrapWindow(first, current) {
  const snapshot = evaluateBootstrapState(current);
  const energyActivity = bootstrapEnergyActivity(first, current);
  const milestones = {
    ...snapshot.milestones,
    energyLoopActive: energyActivity.active,
    stableRcl3:
      (current?.controller?.level ?? 0) >= 3 &&
      snapshot.milestones.spawnPresent &&
      energyActivity.active &&
      snapshot.milestones.workforceTargetMet &&
      (current?.structures?.extensions ?? 0) >= 10 &&
      snapshot.milestones.towerOnline,
  };
  const reached = Object.entries(milestones)
    .filter(([, value]) => value)
    .map(([name]) => name);

  return {
    ...snapshot,
    status:
      snapshot.status === "failed"
        ? "failed"
        : milestones.stableRcl3
          ? "passed"
          : "progressing",
    milestones,
    reached,
    energyActivity,
  };
}
