import type { ArbitrationRejection } from "../intents/arbitrate";
import type { Intent, IntentTrace } from "../intents/types";
import { writeObservabilitySegment } from "../memory/segments";
import type { MovementMetrics } from "../movement/traffic";
import {
  activityContinuityRatio,
  activityTimeToFirstProductiveWork,
  activityWorkConversionRatio,
  type FspmActivityEvent,
  type FspmActivityOutcome,
  type FspmAssignmentEvidence,
  type FspmAssignmentState,
  type FspmProcedureHistoryEntry,
  fspmActivityEvents,
} from "../planning/activity-lifecycle";
import type {
  ColonyDeliverable,
  ColonyRequirement,
  ColonyTask,
  FspmActivityKpiSample,
  FspmActivityRecord,
  FspmAuthorityDenialSummary,
  FspmQuality,
  FspmQualitySample,
  FspmStatus,
} from "../planning/fspm";
import { EMPIRE_PORTFOLIO_ID } from "../planning/fspm";
import { runtimeBuildSha } from "../runtime/build-info";
import type { RuntimeSupervisorTrace } from "../runtime/supervisor";
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

interface CompactPortfolioP3 {
  id: string;
  type: "portfolio";
  subType: "ou_portfolio";
  name: string;
  description: string;
  parentP3Id: string | null;
  temporalBasis: "game_tick";
  startTick: number;
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
  p3: CompactPortfolioP3 | null;
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

export type FspmIntegrityCode =
  | "empire_container_missing"
  | "empire_p3_missing"
  | "empire_p3_malformed"
  | "empire_p3_noncanonical"
  | "empire_p3_inactive"
  | "colony_p3_missing"
  | "colony_p3_malformed"
  | "colony_p3_noncanonical"
  | "colony_p3_inactive";

export interface FspmIntegritySample {
  code: FspmIntegrityCode;
  scope: "empire" | `colony:${string}`;
  reason: string;
}

export interface FspmIntegritySummary {
  /** True only when the canonical root P3 is structurally valid and active. */
  authoritative: boolean;
  total: number;
  byCode: Partial<Record<FspmIntegrityCode, number>>;
  /** Explicit bound for evidence rows published into Segment 99. */
  sampleLimit: number;
  omittedSamples: number;
  samples: FspmIntegritySample[];
}

export interface TickObservabilityTrace {
  /** Observability payload schema version. */
  version: 1;
  /** Persistent Screeps Memory schema version active for this tick. */
  memoryVersion: number;
  /** Git commit embedded into the deployed runtime bundle, or null when unknown. */
  runtimeSha: string | null;
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
    measurementBoundary: "before_segment_fit_and_write";
    previousTickFinal: {
      tick: number;
      observability: number;
      total: number;
      segmentWritten: boolean;
    } | null;
  };
  settlement: { plans: RoomPlanTraceSummary[] };
  fspm: {
    rootP3: CompactPortfolioP3 | null;
    integrity: FspmIntegritySummary;
    colonies: FspmTraceSummary[];
    assignments: FspmAssignmentEvidence[];
  };
  spatial: SpatialIndexMetrics;
  movement: MovementMetrics;
  runtime: RuntimeSupervisorTrace;
  intents: {
    proposed: number;
    accepted: number;
    rejected: number;
    authorityDenied: FspmAuthorityDenialSummary;
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
  supervisor: RuntimeSupervisorTrace;
  accepted: Intent[];
  rejected: ArbitrationRejection[];
  authorityDenials: FspmAuthorityDenialSummary;
  assignments: FspmAssignmentEvidence[];
  plannerByIntent: Map<Intent, PlannerName>;
  conflictKey: (intent: Intent) => string;
}

const SAMPLE_LIMIT = 24;
const EVENT_LIMIT = 96;
const FSPM_INTEGRITY_SAMPLE_LIMIT = 4;
const roundCpu = (value: number): number => Math.round(value * 1000) / 1000;

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function isFspmStatus(value: unknown): value is FspmStatus {
  return (
    value === "active" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "retired"
  );
}

function hasCompactPortfolioShape(
  value: unknown,
): value is Parameters<typeof compactPortfolioP3>[0] {
  const record = jsonRecord(value);
  if (!record) return false;
  const quality = record.quality;
  const qualityRecord = quality === undefined ? null : jsonRecord(quality);
  const qualityValid =
    quality === undefined ||
    (qualityRecord !== null &&
      typeof qualityRecord.score === "number" &&
      Number.isFinite(qualityRecord.score) &&
      (qualityRecord.state === "healthy" ||
        qualityRecord.state === "watch" ||
        qualityRecord.state === "degraded") &&
      (qualityRecord.trend === "new" ||
        qualityRecord.trend === "improving" ||
        qualityRecord.trend === "stable" ||
        qualityRecord.trend === "declining") &&
      Array.isArray(qualityRecord.evidence) &&
      qualityRecord.evidence.every((entry) => typeof entry === "string"));

  return (
    typeof record.id === "string" &&
    record.type === "portfolio" &&
    record.subType === "ou_portfolio" &&
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    (record.parentP3Id === null || typeof record.parentP3Id === "string") &&
    record.temporalBasis === "game_tick" &&
    typeof record.startTick === "number" &&
    Number.isFinite(record.startTick) &&
    isFspmStatus(record.status) &&
    qualityValid
  );
}

function integritySummary(issues: FspmIntegritySample[]): FspmIntegritySummary {
  const samples = issues.slice(0, FSPM_INTEGRITY_SAMPLE_LIMIT);
  const byCode: Partial<Record<FspmIntegrityCode, number>> = {};
  for (const issue of issues)
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
  return {
    authoritative: issues.length === 0,
    total: issues.length,
    byCode,
    sampleLimit: FSPM_INTEGRITY_SAMPLE_LIMIT,
    omittedSamples: Math.max(0, issues.length - samples.length),
    samples,
  };
}

function empireAuthorityEvidence(): {
  rootP3: CompactPortfolioP3 | null;
  issues: FspmIntegritySample[];
} {
  const container = jsonRecord(Memory.empireFspm);
  const root = container?.p3;
  let issue: FspmIntegritySample | null = null;

  if (!container) {
    issue = {
      code: "empire_container_missing",
      scope: "empire",
      reason: "Empire authority container is missing",
    };
  } else if (root === undefined) {
    issue = {
      code: "empire_p3_missing",
      scope: "empire",
      reason:
        "Empire authority container is present but its required root P3 is missing",
    };
  } else if (!hasCompactPortfolioShape(root)) {
    issue = {
      code: "empire_p3_malformed",
      scope: "empire",
      reason:
        "Empire root P3 is structurally malformed and cannot grant authority",
    };
  } else if (root.id !== EMPIRE_PORTFOLIO_ID || root.parentP3Id !== null) {
    issue = {
      code: "empire_p3_noncanonical",
      scope: "empire",
      reason: "Empire root P3 identity or parentage is noncanonical",
    };
  } else if (root.status !== "active") {
    issue = {
      code: "empire_p3_inactive",
      scope: "empire",
      reason: `Empire root P3 is ${root.status}, not active`,
    };
  }

  return {
    rootP3: hasCompactPortfolioShape(root) ? compactPortfolioP3(root) : null,
    issues: issue ? [issue] : [],
  };
}

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
  for (const intent of intents)
    counts[intent.type] = (counts[intent.type] ?? 0) + 1;
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
      return [
        {
          roomName: plan.roomName,
          planId: plan.planId ?? null,
          deliverableId: plan.deliverableId ?? null,
          version: plan.version,
          horizonRcl: plan.horizonRcl,
          generatedAt: plan.generatedAt,
          generatedReason: plan.generatedReason,
          hub: { ...plan.anchors.hub },
          automaticStructures: plan.structures.filter(
            (structure) => structure.activation === "automatic",
          ).length,
          demandStructures: plan.structures.filter(
            (structure) => structure.activation === "demand",
          ).length,
          roadTiles: plan.roads.length,
          roadEdges: plan.roadGraph.edges.length,
          invalidated: plan.invalidatedAt !== undefined,
        },
      ];
    })
    .sort((a, b) => a.roomName.localeCompare(b.roomName));
}

const compactQuality = (quality: FspmQuality): CompactFspmQuality => ({
  score: quality.score,
  state: quality.state,
  trend: quality.trend,
  evidence: [...quality.evidence],
});

const compactRecord = (record: {
  id: string;
  title: string;
  status: FspmStatus;
  quality?: FspmQuality;
}): CompactFspmRecord => ({
  id: record.id,
  title: record.title,
  status: record.status,
  ...(record.quality ? { quality: compactQuality(record.quality) } : {}),
});

const compactPortfolioP3 = (record: {
  id: string;
  type: "portfolio";
  subType: "ou_portfolio";
  name: string;
  description: string;
  parentP3Id: string | null;
  temporalBasis: "game_tick";
  startTick: number;
  status: FspmStatus;
  quality?: FspmQuality;
}): CompactPortfolioP3 => ({
  id: record.id,
  type: record.type,
  subType: record.subType,
  name: record.name,
  description: record.description,
  parentP3Id: record.parentP3Id,
  temporalBasis: record.temporalBasis,
  startTick: record.startTick,
  status: record.status,
  ...(record.quality ? { quality: compactQuality(record.quality) } : {}),
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
    procedureHistory: (evidence.procedureHistory ?? []).map((entry) => ({
      ...entry,
    })),
    metrics: { ...activity.metrics },
    holdReason: activity.holdReason ?? null,
  };
};

function fspmSummaries(): {
  colonies: FspmTraceSummary[];
  issues: FspmIntegritySample[];
} {
  const issues: FspmIntegritySample[] = [];
  const colonies = Object.values(Memory.colonies)
    .flatMap((colony) => {
      const portfolio = colony.fspm;
      if (!portfolio) return [];
      const p3 = (portfolio as { p3?: unknown }).p3;
      const p3Record = jsonRecord(p3);
      const compactP3 = hasCompactPortfolioShape(p3)
        ? compactPortfolioP3(p3)
        : null;
      let issue: FspmIntegritySample | null = null;
      if (p3 === undefined) {
        issue = {
          code: "colony_p3_missing",
          scope: `colony:${colony.roomName}`,
          reason: `Colony ${colony.roomName} authority portfolio is missing its required P3`,
        };
      } else if (!compactP3) {
        issue = {
          code: "colony_p3_malformed",
          scope: `colony:${colony.roomName}`,
          reason: `Colony ${colony.roomName} P3 is structurally malformed and cannot grant authority`,
        };
      } else if (
        compactP3.id !== `portfolio:colony:${colony.roomName}` ||
        compactP3.parentP3Id !== EMPIRE_PORTFOLIO_ID ||
        p3Record?.roomName !== colony.roomName
      ) {
        issue = {
          code: "colony_p3_noncanonical",
          scope: `colony:${colony.roomName}`,
          reason: `Colony ${colony.roomName} P3 identity, room scope, or parentage is noncanonical`,
        };
      } else if (compactP3.status !== "active") {
        issue = {
          code: "colony_p3_inactive",
          scope: `colony:${colony.roomName}`,
          reason: `Colony ${colony.roomName} P3 is ${compactP3.status}, not active`,
        };
      }
      if (issue) issues.push(issue);
      return [
        {
          roomName: colony.roomName,
          p3: compactP3,
          program: portfolio.program
            ? {
                id: portfolio.program.id,
                type: portfolio.program.type,
                subType: portfolio.program.subType,
                title: portfolio.program.title,
                status: portfolio.program.status,
              }
            : null,
          contract: portfolio.contract
            ? compactRecord(portfolio.contract)
            : null,
          p3History: (compactP3
            ? (portfolio.qualityHistory?.[compactP3.id] ?? [])
            : []
          )
            .slice(-12)
            .map((sample) => ({ ...sample })),
          contractHistory: portfolio.contract
            ? (portfolio.qualityHistory?.[portfolio.contract.id] ?? [])
                .slice(-12)
                .map((sample) => ({ ...sample }))
            : [],
          requirements: Object.values(portfolio.requirements)
            .flatMap((record) =>
              record
                ? [
                    {
                      ...compactRecord(record),
                      p3Id: record.p3Id,
                      ...(record.contractId
                        ? { contractId: record.contractId }
                        : {}),
                      domain: record.domain,
                    },
                  ]
                : [],
            )
            .sort((a, b) => a.id.localeCompare(b.id)),
          deliverables: Object.values(portfolio.deliverables)
            .flatMap((record) =>
              record
                ? [
                    {
                      ...compactRecord(record),
                      requirementId: record.requirementId,
                      domain: record.domain,
                    },
                  ]
                : [],
            )
            .sort((a, b) => a.id.localeCompare(b.id)),
          tasks: Object.values(portfolio.tasks)
            .filter((record) => record !== undefined)
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
              recentActivities: (
                portfolio.activityKpiHistory?.[record.id] ?? []
              )
                .slice(-8)
                .map((sample) => ({ ...sample })),
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
          activities: Object.values(portfolio.activities ?? {})
            .map(compactActivity)
            .sort(
              (a, b) =>
                a.assignee.localeCompare(b.assignee) ||
                a.createdAt - b.createdAt ||
                a.id.localeCompare(b.id),
            ),
          activityEvents: fspmActivityEvents(portfolio)
            .slice(-EVENT_LIMIT)
            .map((event) => ({ ...event })),
        },
      ];
    })
    .sort((a, b) => a.roomName.localeCompare(b.roomName));
  return { colonies, issues };
}

export function publishTickTrace(
  input: PublishTickTraceInput,
): TickObservabilityTrace {
  const observabilityStart = Game.cpu.getUsed();
  const previousTickFinal = Memory.runtimeSupervisor?.lastPublication
    ? { ...Memory.runtimeSupervisor.lastPublication }
    : null;
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
  const empireAuthority = empireAuthorityEvidence();
  const fspm = fspmSummaries();

  const trace: TickObservabilityTrace = {
    version: 1,
    memoryVersion: Memory.version,
    runtimeSha: runtimeBuildSha,
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
      measurementBoundary: "before_segment_fit_and_write",
      previousTickFinal,
    },
    settlement: { plans: roomPlanSummaries() },
    fspm: {
      rootP3: empireAuthority.rootP3,
      integrity: integritySummary([...empireAuthority.issues, ...fspm.issues]),
      colonies: fspm.colonies,
      assignments: input.assignments.map((assignment) => ({ ...assignment })),
    },
    spatial: { ...input.spatial },
    movement: { ...input.movement },
    runtime: {
      ...input.supervisor,
      phases: input.supervisor.phases.map((phase) => ({ ...phase })),
      metrics: Object.fromEntries(
        Object.entries(input.supervisor.metrics).map(([name, metrics]) => [
          name,
          { ...metrics },
        ]),
      ) as RuntimeSupervisorTrace["metrics"],
    },
    intents: {
      proposed: proposed.length,
      accepted: input.accepted.length,
      rejected: input.rejected.length,
      authorityDenied: {
        total: input.authorityDenials.total,
        byCode: { ...input.authorityDenials.byCode },
        samples: input.authorityDenials.samples.map((sample) => ({
          ...sample,
          trace: sample.trace ? { ...sample.trace } : null,
        })),
      },
      proposedByPlanner,
      proposedByType: countByType(proposed),
      acceptedByType: countByType(input.accepted),
      acceptedSample: input.accepted
        .slice(0, SAMPLE_LIMIT)
        .map((intent) =>
          compactIntent(intent, input.plannerByIntent, input.conflictKey),
        ),
      rejectedSample: input.rejected
        .slice(0, SAMPLE_LIMIT)
        .map((rejection) => ({
          conflictKey: rejection.conflictKey,
          winner: compactIntent(
            rejection.winner,
            input.plannerByIntent,
            input.conflictKey,
          ),
          loser: compactIntent(
            rejection.loser,
            input.plannerByIntent,
            input.conflictKey,
          ),
        })),
    },
  };

  trace.cpu.observability = roundCpu(Game.cpu.getUsed() - observabilityStart);
  trace.cpu.total = roundCpu(Game.cpu.getUsed() - input.tickStartCpu);
  const segmentWritten = writeObservabilitySegment(JSON.stringify(trace));
  const afterPublication = Game.cpu.getUsed();
  Memory.runtimeSupervisor ??= { version: 1, phases: {} };
  Memory.runtimeSupervisor.lastPublication = {
    tick: Game.time,
    observability: roundCpu(afterPublication - observabilityStart),
    total: roundCpu(afterPublication - input.tickStartCpu),
    segmentWritten,
  };
  return trace;
}
