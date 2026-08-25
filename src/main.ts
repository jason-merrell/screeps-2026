import { installRoomPlanDebug } from "./debug/room-plan";
import { installSimTrafficDebug, runSimTrafficHarness } from "./debug/sim-traffic";
import { installSpawnAdvisor } from "./debug/spawn-advisor";
import { arbitrateDetailed, conflictKey } from "./intents/arbitrate";
import type { Intent } from "./intents/types";
import { execute } from "./intents/execute";
import { migrateMemory } from "./memory/migrate";
import { activateMemorySegments } from "./memory/segments";
import {
  publishTickTrace,
  type PlannerName,
  type PlannerRunTrace,
} from "./observability/trace";
import { planConstruction } from "./systems/construction/plan";
import { planDefense } from "./systems/defense/plan";
import { planEconomy } from "./systems/economy/plan";
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
    runPlanner("economy", () => planEconomy(world)),
  ];
  const proposed = plannerRuns.flatMap((run) => run.intents);

  phaseStart = Game.cpu.getUsed();
  const arbitration = arbitrateDetailed(proposed);
  const arbitrationCpu = Game.cpu.getUsed() - phaseStart;

  phaseStart = Game.cpu.getUsed();
  const movement = execute(arbitration.accepted);
  const executionCpu = Game.cpu.getUsed() - phaseStart;

  publishTickTrace({
    tickStartCpu,
    memoryCpu,
    perceptionCpu,
    settlementCpu,
    plannerRuns,
    arbitrationCpu,
    executionCpu,
    spatial: world.spatial.metrics,
    movement,
    accepted: arbitration.accepted,
    rejected: arbitration.rejected,
    plannerByIntent,
    conflictKey,
  });
};
