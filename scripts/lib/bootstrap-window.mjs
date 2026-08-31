import { evaluateBootstrapState } from "./bootstrap-state.mjs";

export const MATURE_EQUILIBRIUM_POLICY = Object.freeze({
  controllerDowngradeHeadroom: 100_000,
  minimumReplacementTtl: 150,
  reserveEnergy: 50_000,
  towerReserveFraction: 0.5,
  towerReserveFloor: 500,
});

const positiveDelta = (after, before) =>
  Math.max(0, Number(after ?? 0) - Number(before ?? 0));

export function bootstrapEnergyActivity(first, current) {
  const delta = {
    harvested: positiveDelta(
      current?.energy?.harvestedTotal,
      first?.energy?.harvestedTotal,
    ),
    creepSpend: positiveDelta(
      current?.energy?.creepSpendTotal,
      first?.energy?.creepSpendTotal,
    ),
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

export function matureEquilibriumAssessment(state) {
  const level = Number(state?.controller?.level ?? 0);
  const spawnEnergy = Number(state?.spawn?.energy ?? 0);
  const spawnCapacity = Number(state?.spawn?.capacity ?? 0);
  const workforceTotal = Number(state?.workforce?.total ?? 0);
  const workforceAlive = Number(state?.workforce?.alive ?? workforceTotal);
  const workforceTarget = Number(state?.workforce?.target ?? 0);
  const workforceMembers = Array.isArray(state?.workforce?.members)
    ? state.workforce.members
    : null;
  const activeWorkParts = Number(state?.workforce?.activeWorkParts ?? 0);
  const activeCarryParts = Number(state?.workforce?.activeCarryParts ?? 0);
  const sourceCount = Number(state?.energy?.sourceCount ?? 0);
  const sourceEvidence = Array.isArray(state?.energy?.sources)
    ? state.energy.sources
    : null;
  const towerEnergy = Number(state?.structures?.towerEnergy ?? 0);
  const towerCapacity = Number(state?.structures?.towerCapacity ?? 0);
  const towerMinimum = Math.max(
    MATURE_EQUILIBRIUM_POLICY.towerReserveFloor,
    towerCapacity * MATURE_EQUILIBRIUM_POLICY.towerReserveFraction,
  );
  const blockers = [];

  if (level < 8) blockers.push("controller is below the RCL8 progression cap");
  if (state?.controller?.owned !== true)
    blockers.push("controller ownership is missing");
  if (!state?.spawn) blockers.push("spawn is missing");
  if (spawnCapacity <= 0 || spawnEnergy < spawnCapacity) {
    blockers.push(`spawn reserve is ${spawnEnergy}/${spawnCapacity}`);
  }
  if (workforceTarget <= 0 || workforceAlive < workforceTarget) {
    blockers.push(`live workforce is ${workforceAlive}/${workforceTarget}`);
  }
  if (activeWorkParts <= 0 || activeCarryParts <= 0) {
    blockers.push(
      `productive workforce capability is WORK=${activeWorkParts}, CARRY=${activeCarryParts}`,
    );
  }
  if (!workforceMembers) {
    blockers.push("workforce replacement-horizon evidence is missing");
  } else {
    const replacementCovered = workforceMembers.filter(
      (member) =>
        member?.spawning === true ||
        Number(member?.ticksToLive ?? -1) >=
          MATURE_EQUILIBRIUM_POLICY.minimumReplacementTtl,
    ).length;
    if (replacementCovered < workforceTarget) {
      blockers.push(
        `replacement-horizon workforce is ${replacementCovered}/${workforceTarget} at ${MATURE_EQUILIBRIUM_POLICY.minimumReplacementTtl} ticks`,
      );
    }
  }
  if (sourceCount <= 0) {
    blockers.push("no energy source is available");
  } else if (!sourceEvidence || sourceEvidence.length !== sourceCount) {
    blockers.push("source connectivity evidence is incomplete");
  } else {
    for (const [index, source] of sourceEvidence.entries()) {
      if (Number(source?.capacity ?? 0) <= 0) {
        blockers.push(`source ${index + 1} has no viable capacity`);
      }
      if (Number(source?.accessibleTiles ?? 0) <= 0) {
        blockers.push(`source ${index + 1} has no accessible harvest tile`);
      }
      if (source?.connectedToSpawn !== true) {
        blockers.push(`source ${index + 1} is not terrain-connected to the spawn`);
      }
    }
  }
  const downgradeHeadroom = Number(
    state?.controller?.ticksToDowngrade ?? 0,
  );
  if (
    downgradeHeadroom <
    MATURE_EQUILIBRIUM_POLICY.controllerDowngradeHeadroom
  ) {
    blockers.push(
      `controller downgrade headroom is ${downgradeHeadroom}/${MATURE_EQUILIBRIUM_POLICY.controllerDowngradeHeadroom}`,
    );
  }
  const reserveEnergy = Number(state?.energy?.reserveEnergy ?? 0);
  if (reserveEnergy < MATURE_EQUILIBRIUM_POLICY.reserveEnergy) {
    blockers.push(
      `strategic energy reserve is ${reserveEnergy}/${MATURE_EQUILIBRIUM_POLICY.reserveEnergy}`,
    );
  }
  if (Number(state?.structures?.constructionSites ?? 0) > 0) {
    blockers.push("construction demand is present");
  }
  if (
    Number(state?.structures?.towers ?? 0) < 1 ||
    towerCapacity <= 0 ||
    towerEnergy < towerMinimum
  ) {
    blockers.push(
      `tower reserve is ${towerEnergy}/${towerCapacity}; ${towerMinimum} required`,
    );
  }
  if (Number(state?.hostiles ?? 0) > 0) blockers.push("hostiles are present");

  const acceptable = blockers.length === 0;
  return {
    acceptable,
    classification: acceptable ? "healthy_equilibrium" : "work_required",
    reasons: acceptable
      ? [
          "controller is capped at RCL8",
          "productive workforce meets its replacement horizon",
          "every source has an accessible terrain route to the spawn",
          "controller downgrade and strategic energy reserves are healthy",
          "spawn reserve is full",
          "no construction or hostile demand is present",
          "tower energy meets the governed reserve threshold",
        ]
      : [],
    blockers,
  };
}

export function evaluateBootstrapWindow(first, current) {
  const snapshot = evaluateBootstrapState(current);
  const energyActivity = bootstrapEnergyActivity(first, current);
  const equilibrium = matureEquilibriumAssessment(current);
  const economyHealthy = energyActivity.active || equilibrium.acceptable;
  const milestones = {
    ...snapshot.milestones,
    energyLoopActive: energyActivity.active,
    matureEquilibrium: equilibrium.acceptable,
    economyHealthy,
    stableRcl3:
      (current?.controller?.level ?? 0) >= 3 &&
      snapshot.milestones.spawnPresent &&
      economyHealthy &&
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
    activityExpectation: {
      classification: energyActivity.active
        ? "recent_activity_observed"
        : equilibrium.classification,
      recentActivityRequired: !equilibrium.acceptable,
      recentActivityObserved: energyActivity.active,
      acceptableInactivity: equilibrium.acceptable,
      reasons: equilibrium.reasons,
      blockers: equilibrium.blockers,
    },
  };
}
