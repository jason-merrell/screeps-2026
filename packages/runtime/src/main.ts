import { installRoomPlanDebug } from "./debug/room-plan";
import {
  installSimTrafficDebug,
  runSimTrafficHarness,
} from "./debug/sim-traffic";
import { installSpawnAdvisor } from "./debug/spawn-advisor";
import { arbitrateDetailed, conflictKey } from "./intents/arbitrate";
import { execute } from "./intents/execute";
import type { Intent } from "./intents/types";
import { migrateMemoryStep } from "./memory/migrate";
import { MEMORY_VERSION } from "./memory/schema";
import { activateMemorySegments } from "./memory/segments";
import { publishBootTrace } from "./observability/boot";
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
  activateApprovedColonyGovernance,
  authorizedFspmIntents,
  createFspmAuthorityDenialSummary,
  type FspmAuthorityDenialSummary,
  mergeFspmAuthorityDenials,
  prepareFspmPlanningTick,
  reconcileFspmLifecycle,
} from "./planning/fspm";
import { ensureRoomPlanOwnership } from "./planning/ownership";
import { reconcileFspmEvidence } from "./planning/quality";
import { ensureFspmWorkIdentities } from "./planning/work-identity";
import {
  completeSettlementBootAttempt,
  currentBootCpuWindow,
  failOpenSettlementBoot,
  recoverInterruptedSettlementBoot,
  settlementBootAllowsPlanning,
  startSettlementBootAttempt,
  startSettlementBootRetry,
} from "./runtime/boot";
import { injectFspmMaintenanceFaultForTest } from "./runtime/fault-injection";
import { RuntimeSupervisor } from "./runtime/supervisor";
import { planConstruction } from "./systems/construction/plan";
import { planDefense } from "./systems/defense/plan";
import { planMatureEnergyCore } from "./systems/economy/mature-energy";
import { planEconomy } from "./systems/economy/plan";
import { planScavenging } from "./systems/economy/scavenge";
import { planSurplusLaborUtilization } from "./systems/economy/surplus-utilization";
import { normalizeFreshRoomPlans } from "./systems/settlement/normalize";
import {
  commitSettlementPlanProposals,
  ensureSettlementPlans,
  proposeSettlementPlans,
} from "./systems/settlement/plan";
import { planSpawning } from "./systems/spawning/plan";
import { perceive } from "./world/perceive";

installSpawnAdvisor();
installRoomPlanDebug();
installSimTrafficDebug();

export const loop = (): void => {
  const tickStartCpu = Game.cpu.getUsed();
  activateMemorySegments();
  const bootCpu = currentBootCpuWindow();
  if (Game.cpu.getUsed() >= bootCpu.deadline) {
    publishBootTrace({
      phase: "deferred",
      memoryVersion: null,
      sourceMemoryVersion: null,
      targetMemoryVersion: MEMORY_VERSION,
      fromVersion: null,
      toVersion: null,
      progressed: false,
      reason:
        "runtime entry consumed the boot CPU allowance before Memory could be admitted",
      cpuDeadline: bootCpu.deadline,
      cpuHeadroom: bootCpu.headroom,
    });
    return;
  }

  let phaseStart = Game.cpu.getUsed();
  const migration = migrateMemoryStep({
    shouldDefer: () => Game.cpu.getUsed() >= bootCpu.deadline,
  });
  const memoryCpu = Game.cpu.getUsed() - phaseStart;
  if (migration.state !== "ready") {
    const boot = Memory.runtimeBoot;
    const publishMigrationTrace = (
      reason = migration.reason,
      tracePhase = migration.state,
      progressed = migration.progressed,
    ): void => {
      publishBootTrace({
        phase: tracePhase,
        memoryVersion: Memory.version ?? null,
        sourceMemoryVersion: migration.sourceVersion,
        targetMemoryVersion: migration.targetVersion,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        progressed,
        reason,
        cpuDeadline: bootCpu.deadline,
        cpuHeadroom: bootCpu.headroom,
        ...(boot ? { settlementAttempts: boot.settlementAttempts } : {}),
        ...(boot?.settlementRetryTick !== undefined
          ? { settlementRetryTick: boot.settlementRetryTick }
          : {}),
        degraded: boot?.degraded ?? false,
      });
    };

    if (migration.state !== "settlement") {
      publishMigrationTrace();
      return;
    }

    // Always yield the tick that commits the final schema hop. The following
    // tick receives a warm module cache and an otherwise empty CPU window for
    // the one-time mature-plan attempt.
    if (migration.progressed || !boot) {
      publishMigrationTrace();
      return;
    }

    const interruptedFault = recoverInterruptedSettlementBoot(boot, Game.time);
    if (interruptedFault) {
      publishMigrationTrace(interruptedFault, "ready", true);
      return;
    }
    if (Game.cpu.getUsed() >= bootCpu.deadline) {
      publishMigrationTrace(
        "settlement stabilization deferred to preserve boot CPU headroom",
      );
      return;
    }

    startSettlementBootAttempt(boot, Game.time);
    publishMigrationTrace("starting isolated settlement stabilization attempt");

    try {
      prepareFspmPlanningTick();
      const world = perceive();
      for (const room of world.rooms) {
        activateApprovedColonyGovernance(room.name);
      }
      const proposals = proposeSettlementPlans(world);
      commitSettlementPlanProposals(proposals);
      normalizeFreshRoomPlans();
      ensureRoomPlanOwnership();
      completeSettlementBootAttempt(boot, Game.time);
      publishBootTrace({
        phase: "ready",
        memoryVersion: Memory.version,
        sourceMemoryVersion: migration.sourceVersion,
        targetMemoryVersion: migration.targetVersion,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        progressed: true,
        reason: "isolated settlement stabilization attempt returned safely",
        cpuDeadline: bootCpu.deadline,
        cpuHeadroom: bootCpu.headroom,
        settlementAttempts: boot.settlementAttempts,
        ...(boot.settlementRetryTick !== undefined
          ? { settlementRetryTick: boot.settlementRetryTick }
          : {}),
        degraded: false,
      });
    } catch (error) {
      const reason = failOpenSettlementBoot(boot, Game.time, error);
      publishBootTrace({
        phase: "ready",
        memoryVersion: Memory.version,
        sourceMemoryVersion: migration.sourceVersion,
        targetMemoryVersion: migration.targetVersion,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        progressed: true,
        reason,
        cpuDeadline: bootCpu.deadline,
        cpuHeadroom: bootCpu.headroom,
        settlementAttempts: boot.settlementAttempts,
        ...(boot.settlementRetryTick !== undefined
          ? { settlementRetryTick: boot.settlementRetryTick }
          : {}),
        degraded: true,
      });
    }
    return;
  }
  if (runSimTrafficHarness()) return;
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
  const governanceReady = supervisor.run(
    "fspm_governance",
    () => {
      for (const room of world.rooms) {
        activateApprovedColonyGovernance(room.name);
      }
      return true;
    },
    () => false,
  );

  const plannerByIntent = new Map<Intent, PlannerName>();
  const runPlanner = (
    name: PlannerName,
    planner: () => Intent[],
  ): PlannerRunTrace => {
    const start = Game.cpu.getUsed();
    const intents = supervisor.run(
      name,
      () => (governanceReady ? planner() : []),
      () => [],
    );
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
      const mature = planMatureEnergyCore(world, primary);
      const governed = [...primary, ...mature];
      return [...governed, ...planSurplusLaborUtilization(world, governed)];
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
          if (!governanceReady) return;
          const runtimeBoot = Memory.runtimeBoot;
          if (!settlementBootAllowsPlanning(runtimeBoot, Game.time)) return;
          if (runtimeBoot?.degraded) {
            startSettlementBootRetry(runtimeBoot, Game.time);
          }
          ensureSettlementPlans(world);
          normalizeFreshRoomPlans();
          ensureRoomPlanOwnership();
          if (runtimeBoot?.degraded) {
            completeSettlementBootAttempt(runtimeBoot, Game.time);
          }
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
      reconcileFspmEvidence(world);
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
    () => {
      return reconcileFspmActivityEvidence({
        observations: execution.activities,
        proposed: authorizedProposals,
        accepted: arbitration.accepted,
        rejected: arbitration.rejected,
        creeps: world.creeps,
      });
    },
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
