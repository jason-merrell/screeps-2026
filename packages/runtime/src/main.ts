import { installRoomPlanDebug } from "./debug/room-plan";
import {
  installSimTrafficDebug,
  runSimTrafficHarness,
} from "./debug/sim-traffic";
import { installSpawnAdvisor } from "./debug/spawn-advisor";
import { arbitrateDetailed, conflictKey } from "./intents/arbitrate";
import { execute } from "./intents/execute";
import type { Intent } from "./intents/types";
import { migrateMemory } from "./memory/migrate";
import { activateMemorySegments } from "./memory/segments";
import {
  type PlannerName,
  type PlannerRunTrace,
  publishTickTrace,
} from "./observability/trace";
import {
  bindFspmActivities,
  reconcileFspmActivityEvidence,
} from "./planning/activity-lifecycle";
import { enforceRoutineControllerProgress } from "./planning/controller-policy";
import {
  type AuthorizedFspmIntentBatch,
  authorizedFspmIntents,
  createFspmAuthorityDenialSummary,
  type FspmAuthorityDenialSummary,
  mergeFspmAuthorityDenials,
  prepareFspmPlanningTick,
  reconcileFspmLifecycle,
} from "./planning/fspm";
import { ensureRoomPlanOwnership } from "./planning/ownership";
import { reconcileFspmQuality } from "./planning/quality";
import { ensureFspmWorkIdentities } from "./planning/work-identity";
import { injectFspmMaintenanceFaultForTest } from "./runtime/fault-injection";
import { RuntimeSupervisor } from "./runtime/supervisor";
import { planConstruction } from "./systems/construction/plan";
import { planDefense } from "./systems/defense/plan";
import { planEconomy } from "./systems/economy/plan";
import { planScavenging } from "./systems/economy/scavenge";
import { planSurplusLaborUtilization } from "./systems/economy/surplus-utilization";
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
  prepareFspmPlanningTick();

  phaseStart = Game.cpu.getUsed();
  const world = perceive();
  const perceptionCpu = Game.cpu.getUsed() - phaseStart;
  Memory.runtimeSupervisor ??= { version: 1, phases: {} };
  const supervisor = new RuntimeSupervisor({
    tick: Game.time,
    budget: world.budget,
    memory: Memory.runtimeSupervisor,
    getUsed: () => Game.cpu.getUsed(),
    scopeUnits: world.rooms.length,
  });

  const plannerByIntent = new Map<Intent, PlannerName>();
  const runPlanner = (
    name: PlannerName,
    planner: () => Intent[],
  ): PlannerRunTrace => {
    const start = Game.cpu.getUsed();
    const intents = supervisor.run(name, planner, () => []);
    const cpu = Game.cpu.getUsed() - start;
    for (const intent of intents) plannerByIntent.set(intent, name);
    return { name, cpu, intents };
  };

  const plannerRuns: PlannerRunTrace[] = [
    runPlanner("defense", () => planDefense(world)),
    runPlanner("spawning", () => planSpawning(world)),
    runPlanner("economy", () => {
      const primary = enforceRoutineControllerProgress([
        ...planScavenging(world),
        ...planEconomy(world),
      ]);
      return [...primary, ...planSurplusLaborUtilization(world, primary)];
    }),
  ];
  let settlementCpu = 0;
  for (const phase of supervisor.orderDeferrable([
    "settlement",
    "construction",
  ])) {
    if (phase === "settlement") {
      phaseStart = Game.cpu.getUsed();
      supervisor.run(
        "settlement",
        () => {
          ensureSettlementPlans(world);
          normalizeFreshRoomPlans();
          ensureRoomPlanOwnership();
        },
        () => undefined,
      );
      settlementCpu = Game.cpu.getUsed() - phaseStart;
      continue;
    }
    plannerRuns.push(runPlanner("construction", () => planConstruction(world)));
  }
  const proposed = plannerRuns.flatMap((run) => run.intents);
  supervisor.run(
    "fspm_maintenance",
    () => {
      injectFspmMaintenanceFaultForTest();
      ensureFspmWorkIdentities(proposed);
      reconcileFspmLifecycle(proposed);
      reconcileFspmQuality(world);
    },
    () => undefined,
  );
  const authorization = supervisor.run<AuthorizedFspmIntentBatch | null>(
    "fspm_authority",
    () => authorizedFspmIntents(proposed),
    () => null,
  );
  const authorizedProposals = authorization?.accepted ?? [];

  phaseStart = Game.cpu.getUsed();
  let bindingDenials: FspmAuthorityDenialSummary =
    createFspmAuthorityDenialSummary();
  const arbitration = supervisor.run(
    "arbitration",
    () => {
      const result = arbitrateDetailed(authorizedProposals);
      if (authorization) {
        bindingDenials = bindFspmActivities(
          result.accepted,
          authorization.snapshot,
        );
      }
      return result;
    },
    () => ({ accepted: [], rejected: [] }),
  );
  const arbitrationCpu = Game.cpu.getUsed() - phaseStart;

  phaseStart = Game.cpu.getUsed();
  const execution = supervisor.run(
    "execution",
    () => execute(arbitration.accepted),
    () => ({
      movement: {
        requests: 0,
        cachedPathAttempts: 0,
        pathFinds: 0,
        congestionRepaths: 0,
        fatigueWaits: 0,
        stuckRequests: 0,
        contentionYields: 0,
        headOnSwapAttempts: 0,
        headOnSwaps: 0,
      },
      activities: [],
    }),
  );
  const executionCpu = Game.cpu.getUsed() - phaseStart;
  const assignments = supervisor.run(
    "activity_evidence",
    () =>
      reconcileFspmActivityEvidence({
        observations: execution.activities,
        proposed: authorizedProposals,
        accepted: arbitration.accepted,
        rejected: arbitration.rejected,
        creeps: world.creeps,
      }),
    () => [],
  );

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
    authorityDenials: mergeFspmAuthorityDenials(
      authorization?.denied ?? createFspmAuthorityDenialSummary(),
      bindingDenials,
    ),
    supervisor: supervisor.trace(),
    plannerByIntent,
    conflictKey,
  });
};
