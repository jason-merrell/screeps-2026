import { installRoomPlanDebug } from "./debug/room-plan";
import { installSimTrafficDebug, runSimTrafficHarness } from "./debug/sim-traffic";
import { installSpawnAdvisor } from "./debug/spawn-advisor";
import { arbitrateDetailed, conflictKey } from "./intents/arbitrate";
import { execute } from "./intents/execute";
import type { Intent } from "./intents/types";
import { migrateMemory } from "./memory/migrate";
import { activateMemorySegments } from "./memory/segments";
import {
  publishTickTrace,
  type PlannerName,
  type PlannerRunTrace,
} from "./observability/trace";
import {
  bindFspmActivities,
  reconcileFspmActivityEvidence,
} from "./planning/activity-lifecycle";
import { reconcileFspmLifecycle } from "./planning/fspm";
import { ensureRoomPlanOwnership } from "./planning/ownership";
import { reconcileFspmQuality } from "./planning/quality";
import { ensureFspmWorkIdentities } from "./planning/work-identity";
import { planConstruction } from "./systems/construction/plan";
import { planDefense } from "./systems/defense/plan";
import { planEconomy } from "./systems/economy/plan";
import { planScavenging } from "./systems/economy/scavenge";
import { normalizeFreshRoomPlans } from "./systems/settlement/normalize";
import { ensureSettlementPlans } from "./systems/settlement/plan";
import { planSpawning } from "./systems/spawning/plan";
import { perceive } from "./world/perceive";

installSpawnAdvisor();
installRoomPlanDebug();
installSimTrafficDebug();

export const loop = (): void => {
  if (runSimTrafficHarness()) return;

  const tickStartCpu = Game.cpu.getUsed();
  activateMemorySegments();

  let phaseStart = Game.cpu.getUsed();
  migrateMemory();
  const memoryCpu = Game.cpu.getUsed() - phaseStart;

  phaseStart = Game.cpu.getUsed();
  const world = perceive();
  const perceptionCpu = Game.cpu.getUsed() - phaseStart;

  phaseStart = Game.cpu.getUsed();
  ensureSettlementPlans(world);
  normalizeFreshRoomPlans();
  ensureRoomPlanOwnership();
  const settlementCpu = Game.cpu.getUsed() - phaseStart;

  const plannerByIntent = new Map<Intent, PlannerName>();
  const runPlanner = (name: PlannerName, planner: () => Intent[]): PlannerRunTrace => {
    const start = Game.cpu.getUsed();
    const intents = planner();
    const cpu = Game.cpu.getUsed() - start;
    for (const intent of intents) plannerByIntent.set(intent, name);
    return { name, cpu, intents };
  };

  const plannerRuns: PlannerRunTrace[] = [
    runPlanner("defense", () => planDefense(world)),
    runPlanner("spawning", () => planSpawning(world)),
    runPlanner("construction", () => planConstruction(world)),
    runPlanner("economy", () => [...planScavenging(world), ...planEconomy(world)]),
  ];
  const proposed = plannerRuns.flatMap((run) => run.intents);
  ensureFspmWorkIdentities(proposed);
  reconcileFspmLifecycle(proposed);
  reconcileFspmQuality(world);

  phaseStart = Game.cpu.getUsed();
  const arbitration = arbitrateDetailed(proposed);
  bindFspmActivities(arbitration.accepted);
  const arbitrationCpu = Game.cpu.getUsed() - phaseStart;

  phaseStart = Game.cpu.getUsed();
  const execution = execute(arbitration.accepted);
  const executionCpu = Game.cpu.getUsed() - phaseStart;
  const assignments = reconcileFspmActivityEvidence({
    observations: execution.activities,
    proposed,
    accepted: arbitration.accepted,
    rejected: arbitration.rejected,
    creeps: world.creeps,
  });

  publishTickTrace({
    tickStartCpu,
    memoryCpu,
    perceptionCpu,
    settlementCpu,
    plannerRuns,
    arbitrationCpu,
    executionCpu,
    spatial: world.spatial.metrics,
    movement: execution.movement,
    accepted: arbitration.accepted,
    rejected: arbitration.rejected,
    assignments,
    plannerByIntent,
    conflictKey,
  });
};
