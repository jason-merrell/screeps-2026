import type { ArbitrationRejection } from "../intents/arbitrate";
import type { Intent, IntentTrace } from "../intents/types";
import { writeObservabilitySegment } from "../memory/segments";
import type { MovementMetrics } from "../movement/traffic";
import {
  activityContinuityRatio,
  activityTimeToFirstProductiveWork,
  activityWorkConversionRatio,
  fspmActivityEvents,
  type FspmActivityEvent,
  type FspmActivityOutcome,
  type FspmAssignmentEvidence,
  type FspmAssignmentState,
  type FspmProcedureHistoryEntry,
} from "../planning/activity-lifecycle";
import type {
  ColonyDeliverable,
  ColonyRequirement,
  ColonyTask,
  FspmActivityKpiSample,
  FspmActivityRecord,
  FspmQuality,
  FspmQualitySample,
  FspmStatus,
} from "../planning/fspm";
import type { SpatialIndexMetrics } from "../world/spatial-index";

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
  trace?: IntentTrace;
}

interface CompactRejectionTrace {
  conflictKey: string;
  winner: CompactIntentTrace;
  loser: CompactIntentTrace;
}

interface RoomPlanTraceSummary {
  roomName: string;
  planId: string | null;
  deliverableId: string | null;
  version: number;
  horizonRcl: number;
  generatedAt: number;
  generatedReason: string;
  hub: { x: number; y: number };
  automaticStructures: number;
  demandStructures: number;
  roadTiles: number;
  roadEdges: number;
  invalidated: boolean;
}

interface CompactFspmQuality {
  score: number;
  state: FspmQuality["state"];
  trend: FspmQuality["trend"];
  evidence: string[];
}

interface CompactFspmRecord {
  id: string;
  title: string;
  status: FspmStatus;
  quality?: CompactFspmQuality;
}

interface CompactRequirement extends CompactFspmRecord {
  p3Id: string;
  contractId?: string;
  domain: ColonyRequirement["domain"];
}

interface CompactDeliverable extends CompactFspmRecord {
  requirementId: string;
  domain: ColonyDeliverable["domain"];
}

interface CompactTask extends CompactFspmRecord {
  deliverableId: string;
  domain: ColonyTask["domain"];
  taskKey: string;
  qualityDescription: string;
  qualityMetric: string;
  kpiMetric: ColonyTask["kpiMetric"];
  procedures: Array<{ id: string; procedureKey: string; title: string }>;
  qi?: ColonyTask["qi"];
  recentActivities: FspmActivityKpiSample[];
}

interface ActivityWithEvidence extends FspmActivityRecord {
  currentTargetKey?: string;
  currentDisposition?: FspmAssignmentState;
  procedureHistory?: FspmProcedureHistoryEntry[];
  outcome?: FspmActivityOutcome;
  kpiEvidence?: string;
}

interface CompactActivity {
  id: string;
  taskId: string;
  assignee: string;
  status: FspmActivityRecord["status"];
  currentProcedureId: string;
  currentTargetKey: string | null;
  currentDisposition: FspmAssignmentState | null;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  timeToCompletion: number | null;
  timeToFirstProductiveWork: number | null;
  kpiScore: FspmActivityRecord["kpiScore"] | null;
  kpiEvidence: string | null;
  continuityRatio: number | null;
  workConversionRatio: number | null;
  outcome: FspmActivityOutcome | null;
  procedureHistory: FspmProcedureHistoryEntry[];
  metrics: Record<string, number | undefined>;
  holdReason: string | null;
}

interface FspmTraceSummary {
  roomName: string;
  p3: {
    id: string;
    type: "portfolio";
    subType: "ou_portfolio";
    title: string;
    status: FspmStatus;
    quality?: CompactFspmQuality;
  };
  /** Legacy pre-migration Service Program evidence. */
  program: {
    id: string;
    type: "program";
    subType: "service_program";
    title: string;
    status: FspmStatus;
  } | null;
  /** Legacy synthetic contract evidence. */
  contract: CompactFspmRecord | null;
  p3History: FspmQualitySample[];
  contractHistory: FspmQualitySample[];
  requirements: CompactRequirement[];
  deliverables: CompactDeliverable[];
  tasks: CompactTask[];
  activities: CompactActivity[];
  activityEvents: FspmActivityEvent[];
}

export interface TickObservabilityTrace {
  version: 1;
  tick: number;
  cpu: {
    limit: number;
    bucket: number;
    memory: number;
    perception: number;
    settlement: number;
    planners: Record<PlannerName, number>;
    arbitration: number;
    execution: number;
    observability: number;
    total: number;
  };
  settlement: { plans: RoomPlanTraceSummary[] };
  fspm: {
    colonies: FspmTraceSummary[];
    assignments: FspmAssignmentEvidence[];
  };
  spatial: SpatialIndexMetrics;
  movement: MovementMetrics;
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
  settlementCpu: number;
  plannerRuns: PlannerRunTrace[];
  arbitrationCpu: number;
  executionCpu: number;
  spatial: SpatialIndexMetrics;
  movement: MovementMetrics;
  accepted: Intent[];
  rejected: ArbitrationRejection[];
  assignments: FspmAssignmentEvidence[];
  plannerByIntent: Map<Intent, PlannerName>;
  conflictKey: (intent: Intent) => string;
}

const SAMPLE_LIMIT = 24;
const EVENT_LIMIT = 96;
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
    ...(intent.trace ? { trace: { ...intent.trace } } : {}),
  };
}

function roomPlanSummaries(): RoomPlanTraceSummary[] {
  return Object.values(Memory.colonies)
    .flatMap((colony) => {
      const plan = colony.roomPlan;
      if (!plan) return [];
      return [{
        roomName: plan.roomName,
        planId: plan.planId ?? null,
        deliverableId: plan.deliverableId ?? null,
        version: plan.version,
        horizonRcl: plan.horizonRcl,
        generatedAt: plan.generatedAt,
        generatedReason: plan.generatedReason,
        hub: { ...plan.anchors.hub },
        automaticStructures: plan.structures.filter((structure) => structure.activation === "automatic").length,
        demandStructures: plan.structures.filter((structure) => structure.activation === "demand").length,
        roadTiles: plan.roads.length,
        roadEdges: plan.roadGraph.edges.length,
        invalidated: plan.invalidatedAt !== undefined,
      }];
    })
    .sort((a, b) => a.roomName.localeCompare(b.roomName));
}

const compactRecord = (record: { id: string; title: string; status: FspmStatus; quality?: FspmQuality }): CompactFspmRecord => ({
  id: record.id,
  title: record.title,
  status: record.status,
  ...(record.quality ? { quality: {
    score: record.quality.score,
    state: record.quality.state,
    trend: record.quality.trend,
    evidence: [...record.quality.evidence],
  } } : {}),
});

export function activityTraceDisposition(
  activity: FspmActivityRecord,
): FspmAssignmentState | null {
  if (activity.status === "on_hold") return "on_hold";
  return (activity as ActivityWithEvidence).currentDisposition ?? null;
}

const compactActivity = (activity: FspmActivityRecord): CompactActivity => {
  const evidence = activity as ActivityWithEvidence;
  return {
    id: activity.id,
    taskId: activity.taskId,
    assignee: activity.assignee,
    status: activity.status,
    currentProcedureId: activity.currentProcedureId,
    currentTargetKey: evidence.currentTargetKey ?? null,
    currentDisposition: activityTraceDisposition(activity),
    createdAt: activity.createdAt,
    startedAt: activity.startedAt ?? null,
    updatedAt: activity.updatedAt,
    completedAt: activity.completedAt ?? null,
    timeToCompletion:
      activity.startedAt !== undefined && activity.completedAt !== undefined
        ? Math.max(0, activity.completedAt - activity.startedAt)
        : null,
    timeToFirstProductiveWork: activityTimeToFirstProductiveWork(activity),
    kpiScore: activity.kpiScore ?? null,
    kpiEvidence: evidence.kpiEvidence ?? null,
    continuityRatio: activityContinuityRatio(activity),
    workConversionRatio: activityWorkConversionRatio(activity),
    outcome: evidence.outcome ? { ...evidence.outcome } : null,
    procedureHistory: (evidence.procedureHistory ?? []).map((entry) => ({ ...entry })),
    metrics: { ...activity.metrics },
    holdReason: activity.holdReason ?? null,
  };
};

function fspmSummaries(): FspmTraceSummary[] {
  return Object.values(Memory.colonies)
    .flatMap((colony) => {
      const portfolio = colony.fspm;
      if (!portfolio) return [];
      return [{
        roomName: colony.roomName,
        p3: {
          ...compactRecord(portfolio.p3),
          type: portfolio.p3.type,
          subType: portfolio.p3.subType,
        },
        program: portfolio.program ? {
          id: portfolio.program.id,
          type: portfolio.program.type,
          subType: portfolio.program.subType,
          title: portfolio.program.title,
          status: portfolio.program.status,
        } : null,
        contract: portfolio.contract ? compactRecord(portfolio.contract) : null,
        p3History: (portfolio.qualityHistory?.[portfolio.p3.id] ?? []).slice(-12).map((sample) => ({ ...sample })),
        contractHistory: portfolio.contract
          ? (portfolio.qualityHistory?.[portfolio.contract.id] ?? []).slice(-12).map((sample) => ({ ...sample }))
          : [],
        requirements: Object.values(portfolio.requirements)
          .flatMap((record) => record ? [{
            ...compactRecord(record),
            p3Id: record.p3Id,
            ...(record.contractId ? { contractId: record.contractId } : {}),
            domain: record.domain,
          }] : [])
          .sort((a, b) => a.id.localeCompare(b.id)),
        deliverables: Object.values(portfolio.deliverables)
          .flatMap((record) => record ? [{ ...compactRecord(record), requirementId: record.requirementId, domain: record.domain }] : [])
          .sort((a, b) => a.id.localeCompare(b.id)),
        tasks: Object.values(portfolio.tasks)
          .map((record) => ({
            ...compactRecord(record),
            deliverableId: record.deliverableId,
            domain: record.domain,
            taskKey: record.taskKey,
            qualityDescription: record.qualityDescription,
            qualityMetric: record.qualityMetric,
            kpiMetric: { ...record.kpiMetric },
            procedures: record.procedures.map((procedure) => ({
              id: procedure.id,
              procedureKey: procedure.procedureKey,
              title: procedure.title,
            })),
            ...(record.qi ? { qi: { ...record.qi } } : {}),
            recentActivities: (portfolio.activityKpiHistory?.[record.id] ?? []).slice(-8).map((sample) => ({ ...sample })),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        activities: Object.values(portfolio.activities ?? {})
          .map(compactActivity)
          .sort((a, b) => a.assignee.localeCompare(b.assignee) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
        activityEvents: fspmActivityEvents(portfolio).slice(-EVENT_LIMIT).map((event) => ({ ...event })),
      }];
    })
    .sort((a, b) => a.roomName.localeCompare(b.roomName));
}

export function publishTickTrace(input: PublishTickTraceInput): TickObservabilityTrace {
  const observabilityStart = Game.cpu.getUsed();
  const proposed = input.plannerRuns.flatMap((run) => run.intents);
  const proposedByPlanner = { defense: 0, spawning: 0, construction: 0, economy: 0 } satisfies Record<PlannerName, number>;
  const plannerCpu = { defense: 0, spawning: 0, construction: 0, economy: 0 } satisfies Record<PlannerName, number>;

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
      settlement: roundCpu(input.settlementCpu),
      planners: plannerCpu,
      arbitration: roundCpu(input.arbitrationCpu),
      execution: roundCpu(input.executionCpu),
      observability: 0,
      total: 0,
    },
    settlement: { plans: roomPlanSummaries() },
    fspm: {
      colonies: fspmSummaries(),
      assignments: input.assignments.map((assignment) => ({ ...assignment })),
    },
    spatial: { ...input.spatial },
    movement: { ...input.movement },
    intents: {
      proposed: proposed.length,
      accepted: input.accepted.length,
      rejected: input.rejected.length,
      proposedByPlanner,
      proposedByType: countByType(proposed),
      acceptedByType: countByType(input.accepted),
      acceptedSample: input.accepted.slice(0, SAMPLE_LIMIT).map((intent) => compactIntent(intent, input.plannerByIntent, input.conflictKey)),
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
