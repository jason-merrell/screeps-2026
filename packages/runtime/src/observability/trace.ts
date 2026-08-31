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
  FspmDeliverableReceipt,
  FspmDeliverableReceiptDecision,
  FspmActivityKpiSample,
  FspmActivityRecord,
  FspmAuthorityDenialSummary,
  FspmGovernanceBinding,
  FspmQuality,
  FspmQualitySample,
  FspmStatus,
} from "../planning/fspm";
import {
  EMPIRE_PORTFOLIO_ID,
  hasFspmPortfolioP3Shape,
  validateColonyGovernanceAuthority,
  validateDeliverableReceipt,
  validateDeliverableReceiptDecisionRegistry,
  validateDeliverableReceiptRegistry,
} from "../planning/fspm";
import {
  deliverableTemplateForDomain,
  FSPM_WEIGHT_BASIS_POINTS,
} from "../planning/fspm-governance";
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
  revision: number;
  strategicPriority: ColonyRequirement["strategicPriority"];
  requirementSource: string | null;
  originatingAuthority: string | null;
  applicableOuId: string;
  approvalAuthorityOuId: string;
  approval: boolean;
  approvedBy: string;
  dateApproved: string;
  approvalEventId: string;
  activationStatus: "valid" | "missing" | "invalid";
}

interface CompactDeliverable extends CompactFspmRecord {
  p3Id: string;
  requirementId: string;
  domain: ColonyDeliverable["domain"];
  revision: number;
  category: ColonyDeliverable["category"];
  deliverableType: ColonyDeliverable["deliverableType"];
  output: string;
  qualityDescription: string;
  qualityMetric: string;
  siblingWeightBasisPoints: number;
  expectedSiblingWeightBasisPoints: number;
  weightStatus: "valid" | "invalid";
  taskWeightBasisPoints: number;
  receiptValidation?: ColonyDeliverable["receiptValidation"];
  servicePrincipalAcceptance?: ColonyDeliverable["servicePrincipalAcceptance"];
  receiptContractStatus: "valid" | "invalid";
  servicePrincipalAcceptanceStatus: "valid" | "invalid";
  receiptEvidenceStatus: "pending" | "missing" | "validated" | "invalid";
  receiptAcceptanceStatus:
    | "pending"
    | "missing"
    | "accepted"
    | "rejected"
    | "disputed"
    | "invalid";
  childDeliverableIds: string[];
}

interface CompactTask extends CompactFspmRecord {
  deliverableId: string;
  domain: ColonyTask["domain"];
  taskKey: string;
  taskWeightBasisPoints: number;
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
  governance: {
    packageId: string;
    packageRevision: number;
    packageHash: string;
    governanceSha: string;
    effectiveDate: string;
    importedAtTick: number;
    signerPrincipalId: string;
    accountablePositionId: string;
    approvalEvents: number;
    receiptEvidenceEvents: number;
    receiptDecisionEvents: number;
    deliverableWeightBasisPoints: number;
    approvalModel: "source_control_service_principal";
    canonicalHumanApproval: false;
    checks: {
      empireRoot: boolean;
      packageProjection: boolean;
      approvalLedger: boolean;
      ancestry: boolean;
      relationships: boolean;
      exactWeights: boolean;
      receiptContracts: boolean;
      acceptancePolicies: boolean;
      receiptLedgers: boolean;
    };
    valid: boolean;
    executionEligible: boolean;
  } | null;
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
  | "colony_p3_inactive"
  | "colony_governance_invalid";

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
const FSPM_ASSIGNMENT_STATES = new Set<FspmAssignmentState>([
  "executing",
  "traveling",
  "waiting_intentional",
  "on_hold",
  "planner_unassigned",
  "arbitration_lost",
  "blocked",
]);
const roundCpu = (value: number): number => Math.round(value * 1000) / 1000;

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function compactReceiptValidation(
  value: unknown,
): ColonyDeliverable["receiptValidation"] | null {
  const record = jsonRecord(value);
  return record &&
    (record.evidenceForm === "system_generated_confirmation" ||
      record.evidenceForm === "logged_system_record") &&
    typeof record.storageLocation === "string" &&
    record.storageLocation.trim().length > 0 &&
    typeof record.captureResponsibility === "string" &&
    record.captureResponsibility.trim().length > 0
    ? {
        evidenceForm: record.evidenceForm,
        storageLocation: record.storageLocation,
        captureResponsibility: record.captureResponsibility,
      }
    : null;
}

function compactServicePrincipalAcceptance(
  value: unknown,
): ColonyDeliverable["servicePrincipalAcceptance"] | null {
  const record = jsonRecord(value);
  const ratings = record?.acceptedKpiRatings;
  return record?.model === "terminal_activity_kpi_threshold" &&
    record.canonicalHumanAcceptance === false &&
    Array.isArray(ratings) &&
    ratings.length === 2 &&
    ratings[0] === "exceptional" &&
    ratings[1] === "satisfactory"
    ? {
        model: "terminal_activity_kpi_threshold",
        acceptedKpiRatings: ["exceptional", "satisfactory"],
        canonicalHumanAcceptance: false,
      }
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

function hasCompactFspmRecordShape(value: unknown): value is {
  id: string;
  title: string;
  status: FspmStatus;
  quality?: FspmQuality;
} {
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
    typeof record.title === "string" &&
    isFspmStatus(record.status) &&
    qualityValid
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFspmDomain(value: unknown): value is ColonyRequirement["domain"] {
  return (
    value === "economy" ||
    value === "spawning" ||
    value === "construction" ||
    value === "defense"
  );
}

function hasCompactRequirementShape(
  value: unknown,
): value is ColonyRequirement {
  const record = jsonRecord(value);
  return Boolean(
    record &&
      typeof record.p3Id === "string" &&
      (record.contractId === undefined ||
        typeof record.contractId === "string") &&
      isFspmDomain(record.domain) &&
      isFiniteNumber(record.revision) &&
      (record.strategicPriority === "SELL" ||
        record.strategicPriority === "STAFF" ||
        record.strategicPriority === "SERVE") &&
      (record.requirementSource === undefined ||
        typeof record.requirementSource === "string") &&
      (record.originatingAuthority === undefined ||
        typeof record.originatingAuthority === "string") &&
      typeof record.applicableOuId === "string" &&
      typeof record.approvalAuthorityOuId === "string" &&
      typeof record.approval === "boolean" &&
      typeof record.approvedBy === "string" &&
      typeof record.dateApproved === "string" &&
      typeof record.approvalEventId === "string" &&
      hasCompactFspmRecordShape(record),
  );
}

function hasCompactDeliverableShape(
  value: unknown,
): value is ColonyDeliverable {
  const record = jsonRecord(value);
  return Boolean(
    record &&
      typeof record.p3Id === "string" &&
      typeof record.requirementId === "string" &&
      isFspmDomain(record.domain) &&
      isFiniteNumber(record.revision) &&
      (record.category === "corporate" ||
        record.category === "service_program") &&
      (record.deliverableType === "product" ||
        record.deliverableType === "service" ||
        record.deliverableType === "result") &&
      typeof record.output === "string" &&
      typeof record.qualityDescription === "string" &&
      typeof record.qualityMetric === "string" &&
      isFiniteNumber(record.siblingWeightBasisPoints) &&
      hasCompactFspmRecordShape(record),
  );
}

function hasCompactTaskShape(value: unknown): value is ColonyTask {
  const record = jsonRecord(value);
  const kpiMetric = jsonRecord(record?.kpiMetric);
  return Boolean(
    record &&
      (record.status === "active" || record.status === "retired") &&
      typeof record.deliverableId === "string" &&
      isFspmDomain(record.domain) &&
      typeof record.taskKey === "string" &&
      (record.taskWeight === undefined || isFiniteNumber(record.taskWeight)) &&
      typeof record.qualityDescription === "string" &&
      typeof record.qualityMetric === "string" &&
      kpiMetric &&
      typeof kpiMetric.metric === "string" &&
      typeof kpiMetric.exceptional === "string" &&
      typeof kpiMetric.satisfactory === "string" &&
      typeof kpiMetric.unsatisfactory === "string" &&
      Array.isArray(record.procedures) &&
      hasCompactFspmRecordShape(record),
  );
}

function hasCompactGovernanceBindingShape(
  value: unknown,
): value is FspmGovernanceBinding {
  const record = jsonRecord(value);
  return Boolean(
    record &&
      typeof record.authorityPackageId === "string" &&
      isFiniteNumber(record.authorityPackageRevision) &&
      typeof record.authorityPackageHash === "string" &&
      typeof record.governanceSha === "string" &&
      typeof record.effectiveDate === "string" &&
      isFiniteNumber(record.importedAtTick) &&
      typeof record.accountablePrincipalId === "string" &&
      typeof record.accountablePositionId === "string",
  );
}

function hasCompactReceiptShape(
  value: unknown,
): value is FspmDeliverableReceipt {
  const record = jsonRecord(value);
  return Boolean(
    record &&
      typeof record.id === "string" &&
      isFiniteNumber(record.sequence) &&
      typeof record.deliverableId === "string" &&
      isFiniteNumber(record.capturedAtTick),
  );
}

function hasCompactReceiptDecisionShape(
  value: unknown,
): value is FspmDeliverableReceiptDecision {
  const record = jsonRecord(value);
  return Boolean(
    record &&
      typeof record.id === "string" &&
      isFiniteNumber(record.sequence) &&
      typeof record.receiptId === "string" &&
      typeof record.deliverableId === "string" &&
      (record.outcome === "accepted" ||
        record.outcome === "rejected" ||
        record.outcome === "disputed"),
  );
}

function compactTaskQi(value: unknown): NonNullable<ColonyTask["qi"]> | null {
  const record = jsonRecord(value);
  return record &&
    isFiniteNumber(record.score) &&
    isFiniteNumber(record.measuredAt) &&
    isFiniteNumber(record.ratedActivities) &&
    isFiniteNumber(record.totalActivities) &&
    isFiniteNumber(record.exceptional) &&
    isFiniteNumber(record.satisfactory) &&
    isFiniteNumber(record.unsatisfactory)
    ? {
        score: record.score,
        measuredAt: record.measuredAt,
        ratedActivities: record.ratedActivities,
        totalActivities: record.totalActivities,
        exceptional: record.exceptional,
        satisfactory: record.satisfactory,
        unsatisfactory: record.unsatisfactory,
      }
    : null;
}

function compactActivityKpiSample(
  value: unknown,
): FspmActivityKpiSample | null {
  const record = jsonRecord(value);
  const outcome = jsonRecord(record?.outcome);
  const compactOutcome =
    record?.outcome === undefined
      ? undefined
      : outcome &&
          typeof outcome.metric === "string" &&
          isFiniteNumber(outcome.actual) &&
          isFiniteNumber(outcome.target) &&
          typeof outcome.unit === "string" &&
          isFiniteNumber(outcome.utilization)
        ? {
            metric: outcome.metric,
            actual: outcome.actual,
            target: outcome.target,
            unit: outcome.unit,
            utilization: outcome.utilization,
          }
        : null;
  if (
    !record ||
    !isFiniteNumber(record.tick) ||
    typeof record.activityId !== "string" ||
    typeof record.activityType !== "string" ||
    typeof record.actor !== "string" ||
    (record.rating !== "exceptional" &&
      record.rating !== "satisfactory" &&
      record.rating !== "unsatisfactory" &&
      record.rating !== "in_progress") ||
    (record.value !== null && !isFiniteNumber(record.value)) ||
    typeof record.evidence !== "string" ||
    compactOutcome === null
  ) {
    return null;
  }
  return {
    tick: record.tick,
    activityId: record.activityId,
    activityType: record.activityType,
    actor: record.actor,
    rating: record.rating,
    value: record.value,
    evidence: record.evidence,
    ...(compactOutcome ? { outcome: compactOutcome } : {}),
  };
}

function compactQualitySample(value: unknown): FspmQualitySample | null {
  const record = jsonRecord(value);
  return record &&
    isFiniteNumber(record.tick) &&
    isFiniteNumber(record.score) &&
    (record.state === "healthy" ||
      record.state === "watch" ||
      record.state === "degraded")
    ? { tick: record.tick, score: record.score, state: record.state }
    : null;
}

function hasCompactPortfolioShape(
  value: unknown,
): value is Parameters<typeof compactPortfolioP3>[0] {
  const record = jsonRecord(value);
  if (!record || !hasFspmPortfolioP3Shape(value)) return false;
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
    hasFspmPortfolioP3Shape(value) &&
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

const compactActivity = (value: unknown): CompactActivity | null => {
  const record = jsonRecord(value);
  const metrics = jsonRecord(record?.metrics);
  const kpiMetric = jsonRecord(record?.kpiMetric);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.taskId !== "string" ||
    typeof record.assignee !== "string" ||
    (record.status !== "not_started" &&
      record.status !== "in_progress" &&
      record.status !== "on_hold" &&
      record.status !== "completed") ||
    typeof record.currentProcedureId !== "string" ||
    typeof record.qualityDescription !== "string" ||
    typeof record.qualityMetric !== "string" ||
    !kpiMetric ||
    typeof kpiMetric.metric !== "string" ||
    typeof kpiMetric.exceptional !== "string" ||
    typeof kpiMetric.satisfactory !== "string" ||
    typeof kpiMetric.unsatisfactory !== "string" ||
    !isFiniteNumber(record.createdAt) ||
    !isFiniteNumber(record.updatedAt) ||
    (record.startedAt !== undefined && !isFiniteNumber(record.startedAt)) ||
    (record.completedAt !== undefined && !isFiniteNumber(record.completedAt)) ||
    (record.kpiScore !== undefined &&
      record.kpiScore !== "exceptional" &&
      record.kpiScore !== "satisfactory" &&
      record.kpiScore !== "unsatisfactory") ||
    (record.holdReason !== undefined &&
      typeof record.holdReason !== "string") ||
    (record.currentTargetKey !== undefined &&
      typeof record.currentTargetKey !== "string") ||
    (record.kpiEvidence !== undefined &&
      typeof record.kpiEvidence !== "string") ||
    !metrics ||
    ![
      "inProgressTicks",
      "onHoldTicks",
      "productiveTicks",
      "travelTicks",
      "idleTicks",
      "holdCount",
      "resumeCount",
      "taskPreemptions",
      "procedureTransitions",
    ].every((key) => isFiniteNumber(metrics[key]))
  ) {
    return null;
  }

  if (
    record.currentDisposition !== undefined &&
    (typeof record.currentDisposition !== "string" ||
      !FSPM_ASSIGNMENT_STATES.has(
        record.currentDisposition as FspmAssignmentState,
      ))
  ) {
    return null;
  }

  const rawProcedureHistory = record.procedureHistory;
  if (
    rawProcedureHistory !== undefined &&
    !Array.isArray(rawProcedureHistory)
  ) {
    return null;
  }
  const procedureHistory = (rawProcedureHistory ?? []).flatMap((value) => {
    const entry = jsonRecord(value);
    return entry &&
      typeof entry.procedureId === "string" &&
      isFiniteNumber(entry.enteredAt) &&
      (entry.exitedAt === undefined || isFiniteNumber(entry.exitedAt)) &&
      (entry.initialTargetKey === undefined ||
        typeof entry.initialTargetKey === "string")
      ? [
          {
            procedureId: entry.procedureId,
            enteredAt: entry.enteredAt,
            ...(entry.exitedAt !== undefined
              ? { exitedAt: entry.exitedAt }
              : {}),
            ...(entry.initialTargetKey !== undefined
              ? { initialTargetKey: entry.initialTargetKey }
              : {}),
          },
        ]
      : [];
  });
  if (procedureHistory.length !== (rawProcedureHistory?.length ?? 0)) {
    return null;
  }

  const rawOutcome = record.outcome;
  const outcome = jsonRecord(rawOutcome);
  if (
    rawOutcome !== undefined &&
    (!outcome ||
      typeof outcome.metric !== "string" ||
      !isFiniteNumber(outcome.actual) ||
      !isFiniteNumber(outcome.target) ||
      typeof outcome.unit !== "string" ||
      !isFiniteNumber(outcome.utilization))
  ) {
    return null;
  }
  const compactMetrics: Record<string, number | undefined> = {};
  for (const [key, metric] of Object.entries(metrics)) {
    if (metric === undefined || isFiniteNumber(metric)) {
      compactMetrics[key] = metric;
    }
  }

  const activity = value as ActivityWithEvidence;
  try {
    return {
      id: activity.id,
      taskId: activity.taskId,
      assignee: activity.assignee,
      status: activity.status,
      currentProcedureId: activity.currentProcedureId,
      currentTargetKey: activity.currentTargetKey ?? null,
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
      kpiEvidence: activity.kpiEvidence ?? null,
      continuityRatio: activityContinuityRatio(activity),
      workConversionRatio: activityWorkConversionRatio(activity),
      outcome: outcome
        ? {
            metric: outcome.metric as string,
            actual: outcome.actual as number,
            target: outcome.target as number,
            unit: outcome.unit as string,
            utilization: outcome.utilization as number,
          }
        : null,
      procedureHistory,
      metrics: compactMetrics,
      holdReason: activity.holdReason ?? null,
    };
  } catch {
    return null;
  }
};

function fspmSummaries(empireRootAuthoritative: boolean): {
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
      let governanceErrors: string[] = [];
      try {
        governanceErrors = compactP3
          ? validateColonyGovernanceAuthority(portfolio)
          : [
              p3 === undefined
                ? "Colony P3 is missing"
                : "Colony P3 is structurally malformed",
            ];
      } catch (error) {
        governanceErrors = [
          error instanceof Error ? error.message : String(error),
        ];
      }
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
      } else if (governanceErrors.length > 0) {
        issue = {
          code: "colony_governance_invalid",
          scope: `colony:${colony.roomName}`,
          reason: governanceErrors.slice(0, 3).join("; "),
        };
      }
      if (issue) issues.push(issue);
      const requirementRegistry = jsonRecord(portfolio.requirements) ?? {};
      const deliverableRegistry = jsonRecord(portfolio.deliverables) ?? {};
      const taskRegistry = jsonRecord(portfolio.tasks) ?? {};
      const activityRegistry = jsonRecord(portfolio.activities) ?? {};
      const receiptRegistry = jsonRecord(portfolio.deliverableReceipts) ?? {};
      const receiptDecisionRegistry =
        jsonRecord(portfolio.deliverableReceiptDecisions) ?? {};
      const qualityHistoryRegistry = jsonRecord(portfolio.qualityHistory) ?? {};
      const governedRequirements = Object.values(requirementRegistry).filter(
        hasCompactRequirementShape,
      );
      const governedDeliverables = Object.values(deliverableRegistry).filter(
        hasCompactDeliverableShape,
      );
      const governedTasks =
        Object.values(taskRegistry).filter(hasCompactTaskShape);
      const governedReceipts = Object.values(receiptRegistry).filter(
        hasCompactReceiptShape,
      );
      const governedReceiptDecisions = Object.values(
        receiptDecisionRegistry,
      ).filter(hasCompactReceiptDecisionShape);
      const rawGovernanceBinding = (
        portfolio as { governanceBinding?: unknown }
      ).governanceBinding;
      const governanceBinding = hasCompactGovernanceBindingShape(
        rawGovernanceBinding,
      )
        ? rawGovernanceBinding
        : null;
      const governanceBindingPresent =
        rawGovernanceBinding !== undefined && rawGovernanceBinding !== null;
      const deliverableWeightBasisPoints = governedDeliverables
        .filter(
          (record) =>
            record.status === "active" || record.status === "completed",
        )
        .reduce(
          (sum, deliverable) => sum + deliverable.siblingWeightBasisPoints,
          0,
        );
      const taskWeightByDeliverable = new Map<string, number>();
      for (const task of governedTasks) {
        if (task.status !== "active") continue;
        taskWeightByDeliverable.set(
          task.deliverableId,
          (taskWeightByDeliverable.get(task.deliverableId) ?? 0) +
            (task.taskWeight ?? 0) * 100,
        );
      }
      const approvalEvents = Object.keys(
        portfolio.requirementApprovalLedger ?? {},
      ).length;
      const receiptEvidenceEvents = Object.keys(receiptRegistry).length;
      const receiptDecisionEvents = Object.keys(receiptDecisionRegistry).length;
      let receiptRegistryErrors: string[];
      let receiptDecisionRegistryErrors: string[];
      try {
        receiptRegistryErrors = validateDeliverableReceiptRegistry(portfolio);
      } catch (error) {
        receiptRegistryErrors = [
          error instanceof Error ? error.message : String(error),
        ];
      }
      try {
        receiptDecisionRegistryErrors =
          validateDeliverableReceiptDecisionRegistry(portfolio);
      } catch (error) {
        receiptDecisionRegistryErrors = [
          error instanceof Error ? error.message : String(error),
        ];
      }
      const governanceChecks = {
        empireRoot: empireRootAuthoritative,
        packageProjection:
          governanceBinding !== null && governanceErrors.length === 0,
        approvalLedger:
          approvalEvents === governedRequirements.length &&
          governedRequirements.every(
            (record) =>
              record.approval === true &&
              Boolean(
                portfolio.requirementApprovalLedger?.[record.approvalEventId],
              ),
          ) &&
          !governanceErrors.some((error) =>
            /approval|approved|\bOU\b/i.test(error),
          ),
        ancestry:
          governedRequirements.every(
            (record) => record.p3Id === compactP3?.id,
          ) &&
          governedDeliverables.every(
            (record) =>
              record.p3Id === compactP3?.id &&
              governedRequirements.some(
                (requirement) => requirement.id === record.requirementId,
              ),
          ) &&
          governedTasks.every((record) =>
            governedDeliverables.some(
              (deliverable) => deliverable.id === record.deliverableId,
            ),
          ) &&
          !governanceErrors.some((error) => /identity|ancestry/i.test(error)),
        relationships:
          governedDeliverables.every(
            (record) =>
              record.parentDeliverableId === undefined &&
              Array.isArray(record.childDeliverableIds) &&
              record.childDeliverableIds.length === 0,
          ) &&
          !governanceErrors.some((error) =>
            /relationship|parent|child/i.test(error),
          ),
        exactWeights:
          deliverableWeightBasisPoints === FSPM_WEIGHT_BASIS_POINTS &&
          governedDeliverables.every(
            (record) =>
              taskWeightByDeliverable.get(record.id) ===
              FSPM_WEIGHT_BASIS_POINTS,
          ) &&
          !governanceErrors.some((error) => /weight/i.test(error)),
        receiptContracts: governedDeliverables.every((record) =>
          Boolean(compactReceiptValidation(record.receiptValidation)),
        ),
        acceptancePolicies: governedDeliverables.every((record) =>
          Boolean(
            compactServicePrincipalAcceptance(
              record.servicePrincipalAcceptance,
            ),
          ),
        ),
        receiptLedgers:
          receiptRegistryErrors.length === 0 &&
          receiptDecisionRegistryErrors.length === 0,
      };
      const qualityHistoryFor = (recordId: string): FspmQualitySample[] => {
        const samples = qualityHistoryRegistry[recordId];
        return Array.isArray(samples)
          ? samples.slice(-12).flatMap((sample) => {
              const compact = compactQualitySample(sample);
              return compact ? [compact] : [];
            })
          : [];
      };
      return [
        {
          roomName: colony.roomName,
          p3: compactP3,
          program:
            portfolio.program &&
            hasCompactFspmRecordShape(portfolio.program) &&
            portfolio.program.type === "program" &&
            portfolio.program.subType === "service_program"
              ? {
                  id: portfolio.program.id,
                  type: portfolio.program.type,
                  subType: portfolio.program.subType,
                  title: portfolio.program.title,
                  status: portfolio.program.status,
                }
              : null,
          contract:
            portfolio.contract && hasCompactFspmRecordShape(portfolio.contract)
              ? compactRecord(portfolio.contract)
              : null,
          governance: governanceBindingPresent
            ? {
                packageId:
                  governanceBinding?.authorityPackageId ??
                  "unavailable:malformed-governance-binding",
                packageRevision:
                  governanceBinding?.authorityPackageRevision ?? 0,
                packageHash:
                  governanceBinding?.authorityPackageHash ?? "unavailable",
                governanceSha:
                  governanceBinding?.governanceSha ?? "unavailable",
                effectiveDate:
                  governanceBinding?.effectiveDate ?? "not reported",
                importedAtTick: governanceBinding?.importedAtTick ?? -1,
                signerPrincipalId:
                  governanceBinding?.accountablePrincipalId ?? "unavailable",
                accountablePositionId:
                  governanceBinding?.accountablePositionId ?? "unavailable",
                approvalEvents,
                receiptEvidenceEvents,
                receiptDecisionEvents,
                deliverableWeightBasisPoints,
                approvalModel: "source_control_service_principal" as const,
                canonicalHumanApproval: false as const,
                checks: governanceChecks,
                valid:
                  governanceBinding !== null &&
                  empireRootAuthoritative &&
                  governanceErrors.length === 0,
                executionEligible:
                  governanceBinding !== null &&
                  empireRootAuthoritative &&
                  governanceErrors.length === 0 &&
                  compactP3?.status === "active" &&
                  governedRequirements.every(
                    (record) => record.status === "active",
                  ) &&
                  governedDeliverables.every(
                    (record) => record.status === "active",
                  ) &&
                  governedTasks.every((record) => record.status === "active"),
              }
            : null,
          p3History: compactP3 ? qualityHistoryFor(compactP3.id) : [],
          contractHistory:
            portfolio.contract && hasCompactFspmRecordShape(portfolio.contract)
              ? qualityHistoryFor(portfolio.contract.id)
              : [],
          requirements: governedRequirements
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
                      revision: record.revision,
                      strategicPriority: record.strategicPriority,
                      requirementSource: record.requirementSource ?? null,
                      originatingAuthority: record.originatingAuthority ?? null,
                      applicableOuId: record.applicableOuId,
                      approvalAuthorityOuId: record.approvalAuthorityOuId,
                      approval: record.approval,
                      approvedBy: record.approvedBy,
                      dateApproved: record.dateApproved,
                      approvalEventId: record.approvalEventId,
                      activationStatus: (() => {
                        const event =
                          portfolio.requirementApprovalLedger?.[
                            record.approvalEventId
                          ];
                        if (record.approval !== true || !event)
                          return "missing" as const;
                        return governanceErrors.some(
                          (error) =>
                            (error.includes(record.id) ||
                              error.includes(record.approvalEventId)) &&
                            /approval|approved|\bOU\b/i.test(error),
                        )
                          ? ("invalid" as const)
                          : ("valid" as const);
                      })(),
                    },
                  ]
                : [],
            )
            .sort((a, b) => a.id.localeCompare(b.id)),
          deliverables: governedDeliverables
            .flatMap((record) => {
              if (!record) return [];
              const receiptValidation = compactReceiptValidation(
                record.receiptValidation,
              );
              const acceptancePolicy = compactServicePrincipalAcceptance(
                record.servicePrincipalAcceptance,
              );
              return [
                {
                  ...compactRecord(record),
                  p3Id: record.p3Id,
                  requirementId: record.requirementId,
                  domain: record.domain,
                  revision: record.revision,
                  category: record.category,
                  deliverableType: record.deliverableType,
                  output: record.output,
                  qualityDescription: record.qualityDescription,
                  qualityMetric: record.qualityMetric,
                  siblingWeightBasisPoints: record.siblingWeightBasisPoints,
                  expectedSiblingWeightBasisPoints:
                    deliverableTemplateForDomain(record.domain)
                      ?.siblingWeightBasisPoints ?? 0,
                  weightStatus:
                    record.siblingWeightBasisPoints ===
                    deliverableTemplateForDomain(record.domain)
                      ?.siblingWeightBasisPoints
                      ? ("valid" as const)
                      : ("invalid" as const),
                  taskWeightBasisPoints:
                    taskWeightByDeliverable.get(record.id) ?? 0,
                  ...(receiptValidation ? { receiptValidation } : {}),
                  ...(acceptancePolicy
                    ? { servicePrincipalAcceptance: acceptancePolicy }
                    : {}),
                  receiptContractStatus: receiptValidation
                    ? ("valid" as const)
                    : ("invalid" as const),
                  servicePrincipalAcceptanceStatus: acceptancePolicy
                    ? ("valid" as const)
                    : ("invalid" as const),
                  receiptEvidenceStatus: (() => {
                    const receipts = governedReceipts.filter(
                      (receipt) => receipt.deliverableId === record.id,
                    );
                    if (receiptRegistryErrors.length > 0) {
                      return "invalid" as const;
                    }
                    if (receipts.length === 0) {
                      return "pending" as const;
                    }
                    return receipts.some((receipt) =>
                      validateDeliverableReceipt(portfolio, receipt),
                    )
                      ? ("validated" as const)
                      : ("invalid" as const);
                  })(),
                  receiptAcceptanceStatus: (() => {
                    const receipts = governedReceipts
                      .filter((receipt) => receipt.deliverableId === record.id)
                      .sort((left, right) => left.sequence - right.sequence);
                    const decisions = governedReceiptDecisions
                      .filter(
                        (decision) => decision.deliverableId === record.id,
                      )
                      .sort((left, right) => left.sequence - right.sequence);
                    if (
                      receiptRegistryErrors.length > 0 ||
                      receiptDecisionRegistryErrors.length > 0
                    ) {
                      return "invalid" as const;
                    }
                    const latestReceipt = receipts.at(-1);
                    if (!latestReceipt) {
                      return "pending" as const;
                    }
                    const latestDecision = decisions.find(
                      (decision) => decision.receiptId === latestReceipt.id,
                    );
                    return latestDecision?.outcome ?? ("pending" as const);
                  })(),
                  childDeliverableIds: Array.isArray(record.childDeliverableIds)
                    ? record.childDeliverableIds.filter(
                        (id): id is string => typeof id === "string",
                      )
                    : [],
                },
              ];
            })
            .sort((a, b) => a.id.localeCompare(b.id)),
          tasks: governedTasks
            .flatMap((record) => {
              if (!record || !Array.isArray(record.procedures)) return [];
              try {
                const procedures = record.procedures.flatMap((procedure) => {
                  const candidate = jsonRecord(procedure);
                  return candidate &&
                    typeof candidate.id === "string" &&
                    typeof candidate.procedureKey === "string" &&
                    typeof candidate.title === "string"
                    ? [
                        {
                          id: candidate.id,
                          procedureKey: candidate.procedureKey,
                          title: candidate.title,
                        },
                      ]
                    : [];
                });
                const recentHistory = portfolio.activityKpiHistory?.[record.id];
                const qi = compactTaskQi(record.qi);
                return [
                  {
                    ...compactRecord(record),
                    deliverableId: record.deliverableId,
                    domain: record.domain,
                    taskKey: record.taskKey,
                    taskWeightBasisPoints: (record.taskWeight ?? 0) * 100,
                    qualityDescription: record.qualityDescription,
                    qualityMetric: record.qualityMetric,
                    kpiMetric: { ...record.kpiMetric },
                    procedures,
                    ...(qi ? { qi } : {}),
                    recentActivities: Array.isArray(recentHistory)
                      ? recentHistory.slice(-8).flatMap((sample) => {
                          const compact = compactActivityKpiSample(sample);
                          return compact ? [compact] : [];
                        })
                      : [],
                  },
                ];
              } catch {
                return [];
              }
            })
            .sort((a, b) => a.id.localeCompare(b.id)),
          activities: Object.values(activityRegistry)
            .flatMap((activity) => {
              const compact = compactActivity(activity);
              return compact ? [compact] : [];
            })
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
  const fspm = fspmSummaries(empireAuthority.issues.length === 0);

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
