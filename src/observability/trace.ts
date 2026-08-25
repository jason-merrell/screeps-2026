import type { ArbitrationRejection } from "../intents/arbitrate";
import type { Intent } from "../intents/types";
import { writeObservabilitySegment } from "../memory/segments";

export type PlannerName = "defense" | "spawning" | "construction" | "economy";

export interface PlannerRunTrace {
  name: PlannerName;
  cpu: number;
  intents: Intent[];
}

interface CompactIntentTrace {
  type: Intent["type"];
  planner: PlannerName | "unknown";
  priority: number;
  reason: string;
  actor: string;
  conflictKey: string;
}

interface CompactRejectionTrace {
  conflictKey: string;
  winner: CompactIntentTrace;
  loser: CompactIntentTrace;
}

export interface TickObservabilityTrace {
  version: 1;
  tick: number;
  cpu: {
    limit: number;
    bucket: number;
    memory: number;
    perception: number;
    planners: Record<PlannerName, number>;
    arbitration: number;
    execution: number;
    observability: number;
    total: number;
  };
  intents: {
    proposed: number;
    accepted: number;
    rejected: number;
    proposedByPlanner: Record<PlannerName, number>;
    proposedByType: Record<string, number>;
    acceptedByType: Record<string, number>;
    acceptedSample: CompactIntentTrace[];
    rejectedSample: CompactRejectionTrace[];
  };
}

export interface PublishTickTraceInput {
  tickStartCpu: number;
  memoryCpu: number;
  perceptionCpu: number;
  plannerRuns: PlannerRunTrace[];
  arbitrationCpu: number;
  executionCpu: number;
  accepted: Intent[];
  rejected: ArbitrationRejection[];
  plannerByIntent: Map<Intent, PlannerName>;
  conflictKey: (intent: Intent) => string;
}

const SAMPLE_LIMIT = 24;
const roundCpu = (value: number): number => Math.round(value * 1000) / 1000;

function actorOf(intent: Intent): string {
  switch (intent.type) {
    case "spawn":
      return `spawn:${intent.spawnName}`;
    case "createConstructionSite":
      return `room:${intent.roomName}@${intent.x},${intent.y}`;
    case "towerAttack":
      return `tower:${intent.towerId}`;
    default:
      return `creep:${intent.creepName}`;
  }
}

function countByType(intents: Intent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const intent of intents) counts[intent.type] = (counts[intent.type] ?? 0) + 1;
  return counts;
}

function compactIntent(
  intent: Intent,
  plannerByIntent: Map<Intent, PlannerName>,
  conflictKey: (intent: Intent) => string,
): CompactIntentTrace {
  return {
    type: intent.type,
    planner: plannerByIntent.get(intent) ?? "unknown",
    priority: intent.priority,
    reason: intent.reason,
    actor: actorOf(intent),
    conflictKey: conflictKey(intent),
  };
}

export function publishTickTrace(input: PublishTickTraceInput): TickObservabilityTrace {
  const observabilityStart = Game.cpu.getUsed();
  const proposed = input.plannerRuns.flatMap((run) => run.intents);
  const proposedByPlanner = {
    defense: 0,
    spawning: 0,
    construction: 0,
    economy: 0,
  } satisfies Record<PlannerName, number>;
  const plannerCpu = {
    defense: 0,
    spawning: 0,
    construction: 0,
    economy: 0,
  } satisfies Record<PlannerName, number>;

  for (const run of input.plannerRuns) {
    proposedByPlanner[run.name] += run.intents.length;
    plannerCpu[run.name] += roundCpu(run.cpu);
  }

  const trace: TickObservabilityTrace = {
    version: 1,
    tick: Game.time,
    cpu: {
      limit: Game.cpu.limit,
      bucket: Game.cpu.bucket,
      memory: roundCpu(input.memoryCpu),
      perception: roundCpu(input.perceptionCpu),
      planners: plannerCpu,
      arbitration: roundCpu(input.arbitrationCpu),
      execution: roundCpu(input.executionCpu),
      observability: 0,
      total: 0,
    },
    intents: {
      proposed: proposed.length,
      accepted: input.accepted.length,
      rejected: input.rejected.length,
      proposedByPlanner,
      proposedByType: countByType(proposed),
      acceptedByType: countByType(input.accepted),
      acceptedSample: input.accepted
        .slice(0, SAMPLE_LIMIT)
        .map((intent) => compactIntent(intent, input.plannerByIntent, input.conflictKey)),
      rejectedSample: input.rejected.slice(0, SAMPLE_LIMIT).map((rejection) => ({
        conflictKey: rejection.conflictKey,
        winner: compactIntent(rejection.winner, input.plannerByIntent, input.conflictKey),
        loser: compactIntent(rejection.loser, input.plannerByIntent, input.conflictKey),
      })),
    },
  };

  trace.cpu.observability = roundCpu(Game.cpu.getUsed() - observabilityStart);
  trace.cpu.total = roundCpu(Game.cpu.getUsed() - input.tickStartCpu);
  writeObservabilitySegment(JSON.stringify(trace));

  return trace;
}
