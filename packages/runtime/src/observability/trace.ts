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
  FspmCanonicalEqvmRollupState,
  FspmDeliverableQi,
  FspmDeliverableReceipt,
  FspmDeliverableReceiptDecision,
  FspmEqvmCoverageStatus,
  FspmEqvmPolicyAuthorization,
  FspmGovernanceBinding,
  FspmOperationalHealth,
  FspmOperationalHealthSample,
  FspmP3Pqi,
  FspmStatus,
  FspmTaskQi,
  FspmWeightedEqvmCoverage,
} from "../planning/fspm";
import {
  EMPIRE_PORTFOLIO_ID,
  hasFspmPortfolioP3Shape,
  validateColonyGovernanceAuthority,
  validateDeliverableReceipt,
  validateDeliverableReceiptDecisionRegistry,
  validateDeliverableReceiptRegistry,
} from "../planning/fspm";
import { FSPM_GOVERNANCE_SHA } from "../planning/fspm-catalog";
import {
  deliverableTemplateForDomain,
  FSPM_WEIGHT_BASIS_POINTS,
} from "../planning/fspm-governance";
import {
  evaluateRoomDevelopmentForRoom,
  type RoomDevelopmentHorizonStatus,
  type RoomDevelopmentMilestoneKind,
  type RoomDevelopmentStageStatus,
} from "../planning/room-development";
import type { RoomDevelopmentStageId } from "../planning/room-plan";
import {
  type RoomPlanProjectionUsabilityStatus,
  usableRoomPlanProjection,
} from "../planning/room-plan-projection";
import { runtimeBuildSha } from "../runtime/build-info";
import type { RuntimeSupervisorTrace } from "../runtime/supervisor";
import { defensiveRampartTargetHits } from "../systems/defense/readiness";
import { assessMatureLinkService } from "../systems/economy/mature-energy";
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

interface RoomDevelopmentRequirementTrace {
  plannedStructureId: string;
  stageId: RoomDevelopmentStageId;
  structureType: BuildableStructureConstant;
  x: number;
  y: number;
  minRcl: number;
  priority: number;
  strategicWeight: number;
  underConstruction: boolean;
  blocked: boolean;
  blockerReasons: string[];
}

interface RoomDevelopmentStageTrace {
  id: RoomDevelopmentStageId;
  title: string;
  minRcl: number;
  stageWeight: number;
  status: RoomDevelopmentStageStatus;
  controllerEligible: boolean;
  prerequisitesSatisfied: boolean;
  realizationPercentage: number | null;
  realizedStructures: number;
  eligibleStructures: number;
  missingStructures: number;
  blockedStructures: number;
}

interface RuntimeRoomDevelopmentTrace {
  source: "runtime_room_development_evaluator";
  evaluatedAt: number;
  horizonStatus: RoomDevelopmentHorizonStatus;
  validationIssues: string[];
  activeStageId: RoomDevelopmentStageId | null;
  nextStageId: RoomDevelopmentStageId | null;
  realizationPercentage: number | null;
  missingStructures: number;
  blockedStructures: number;
  stages: RoomDevelopmentStageTrace[];
  missingCriticalStructures: RoomDevelopmentRequirementTrace[];
  nextMilestone: {
    kind: RoomDevelopmentMilestoneKind;
    stageId: RoomDevelopmentStageId | null;
    plannedStructureId: string | null;
    reason: string;
  };
}

interface RoomPlanTraceSummary {
  roomName: string;
  projectionUsability: {
    usable: boolean;
    status: RoomPlanProjectionUsabilityStatus;
    reason: string;
  };
  planId: string | null;
  deliverableId: string | null;
  plannerRevision: number | null;
  projectionRevision: number | null;
  projectionFingerprint: string | null;
  version: number | null;
  horizonRcl: number | null;
  generatedAt: number | null;
  generatedReason: string | null;
  hub: { x: number; y: number } | null;
  automaticStructures: number | null;
  demandStructures: number | null;
  roadTiles: number | null;
  roadEdges: number | null;
  invalidated: boolean;
  controllerLevel: number | null;
  horizonStatus: RoomDevelopmentHorizonStatus | null;
  activeStageId: RoomDevelopmentStageId | null;
  nextStageId: RoomDevelopmentStageId | null;
  realizationPercentage: number | null;
  missingStructures: number | null;
  blockedStructures: number | null;
  nextMilestone: {
    kind: RoomDevelopmentMilestoneKind;
    reason: string;
  } | null;
  development: RuntimeRoomDevelopmentTrace | null;
  defense: {
    strategy: string | null;
    protectedTiles: number | null;
    perimeterPlanned: number | null;
    perimeterBuilt: number | null;
    perimeterAtTarget: number | null;
    targetHits: number | null;
    underAttack: boolean;
    nextMissingTile: { x: number; y: number } | null;
  };
  energyTopology: {
    status: "authorization-debt" | "incomplete" | "fault" | "unavailable";
    reason: string;
    sourceLinks: number | null;
    controllerLinkPlanId: string | null;
    coreLinkPlanId: string | null;
  };
}

interface SettlementProjectionFaultTrace {
  roomName: string;
  kind: "room-plan-generation";
  status: "active" | "superseded";
  firstTick: number;
  lastTick: number;
  attemptCount: number;
  retryDelayTicks: number;
  nextRetryTick: number | null;
  reason: string;
  remediation: string;
  retainedPlannerRevision: number | null;
  targetPlannerRevision: number;
  retainedProjectionRevision: number | null;
  retainedProjectionFingerprint: string | null;
  resolvedAtTick: number | null;
  supersededByRevision: number | null;
  supersededByFingerprint: string | null;
}

interface CompactOperationalHealth {
  score: number;
  state: FspmOperationalHealth["state"];
  trend: FspmOperationalHealth["trend"];
  measuredAt: number;
  evidence: string[];
}

interface CompactFspmRecord {
  id: string;
  title: string;
  status: FspmStatus;
  operationalHealth?: CompactOperationalHealth;
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
  operationalHealth?: CompactOperationalHealth;
  pqi?: FspmP3Pqi;
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
  dqi?: FspmDeliverableQi;
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
  qi?: FspmTaskQi;
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
  p3OperationalHealthHistory: FspmOperationalHealthSample[];
  contractOperationalHealthHistory: FspmOperationalHealthSample[];
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
  settlement: {
    plans: RoomPlanTraceSummary[];
    faults: SettlementProjectionFaultTrace[];
  };
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
  operationalHealth?: FspmOperationalHealth;
} {
  const record = jsonRecord(value);
  if (!record) return false;
  const operationalHealthValid =
    record.operationalHealth === undefined ||
    compactOperationalHealth(record.operationalHealth) !== null;

  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    isFspmStatus(record.status) &&
    operationalHealthValid
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

function isEqvmCoverageStatus(value: unknown): value is FspmEqvmCoverageStatus {
  return (
    value === "unavailable" ||
    value === "partial" ||
    value === "complete" ||
    value === "stale" ||
    value === "invalid"
  );
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? [...value]
    : null;
}

function compactWeightedCoverage(
  value: unknown,
): FspmWeightedEqvmCoverage | null {
  const record = jsonRecord(value);
  const missingIds = stringArray(record?.missingIds);
  const staleIds = stringArray(record?.staleIds);
  const invalidIds = stringArray(record?.invalidIds);
  const evidence = stringArray(record?.evidence);
  return record &&
    isEqvmCoverageStatus(record.status) &&
    isFiniteNumber(record.expectedWeightBasisPoints) &&
    isFiniteNumber(record.coveredWeightBasisPoints) &&
    missingIds &&
    staleIds &&
    invalidIds &&
    evidence
    ? {
        status: record.status,
        expectedWeightBasisPoints: record.expectedWeightBasisPoints,
        coveredWeightBasisPoints: record.coveredWeightBasisPoints,
        missingIds,
        staleIds,
        invalidIds,
        evidence,
      }
    : null;
}

function compactEqvmPolicyAuthorization(
  value: unknown,
): FspmEqvmPolicyAuthorization | null {
  const record = jsonRecord(value);
  if (
    record?.status === "unapproved" &&
    typeof record.authorizationDebt === "string" &&
    record.authorizationDebt.trim().length > 0
  ) {
    return {
      status: "unapproved",
      authorizationDebt: record.authorizationDebt,
    };
  }
  // Approval-shaped nested telemetry is not authority. Until a governed EQVM
  // approval ledger exists and is resolved here, every approved claim is
  // omitted from the trusted trace.
  return null;
}

function compactCanonicalEqvmRollupState(
  score: unknown,
  coverage: FspmWeightedEqvmCoverage,
  policyAuthorization: FspmEqvmPolicyAuthorization,
): FspmCanonicalEqvmRollupState | null {
  return policyAuthorization.status === "unapproved" &&
    score === null &&
    coverage.status !== "complete"
    ? {
        score: null,
        coverage: {
          ...coverage,
          status: coverage.status as Exclude<
            FspmEqvmCoverageStatus,
            "complete"
          >,
        },
        policyAuthorization,
      }
    : null;
}

function compactDeliverableQi(value: unknown): FspmDeliverableQi | null {
  const record = jsonRecord(value);
  const measuredAt =
    Number.isSafeInteger(record?.measuredAt) &&
    (record?.measuredAt as number) >= 0
      ? (record?.measuredAt as number)
      : null;
  const coverage = compactWeightedCoverage(record?.coverage);
  const policyAuthorization = compactEqvmPolicyAuthorization(
    record?.policyAuthorization,
  );
  const state =
    coverage && policyAuthorization
      ? compactCanonicalEqvmRollupState(
          record?.score,
          coverage,
          policyAuthorization,
        )
      : null;
  return record &&
    measuredAt !== null &&
    record.activityWeightPolicyId ===
      "eqvm:activity-weight:equal-terminal-samples:v1" &&
    Number.isSafeInteger(record.taskWeightBasisPoints) &&
    (record.taskWeightBasisPoints as number) >= 0 &&
    state
    ? {
        ...state,
        measuredAt,
        activityWeightPolicyId: record.activityWeightPolicyId,
        taskWeightBasisPoints: record.taskWeightBasisPoints as number,
      }
    : null;
}

function compactP3Pqi(value: unknown): FspmP3Pqi | null {
  const record = jsonRecord(value);
  const measuredAt =
    Number.isSafeInteger(record?.measuredAt) &&
    (record?.measuredAt as number) >= 0
      ? (record?.measuredAt as number)
      : null;
  const coverage = compactWeightedCoverage(record?.coverage);
  const policyAuthorization = compactEqvmPolicyAuthorization(
    record?.policyAuthorization,
  );
  const state =
    coverage && policyAuthorization
      ? compactCanonicalEqvmRollupState(
          record?.score,
          coverage,
          policyAuthorization,
        )
      : null;
  return record &&
    measuredAt !== null &&
    record.activityWeightPolicyId ===
      "eqvm:activity-weight:equal-terminal-samples:v1" &&
    Number.isSafeInteger(record.deliverableWeightBasisPoints) &&
    (record.deliverableWeightBasisPoints as number) >= 0 &&
    state
    ? {
        ...state,
        measuredAt,
        activityWeightPolicyId: record.activityWeightPolicyId,
        deliverableWeightBasisPoints:
          record.deliverableWeightBasisPoints as number,
      }
    : null;
}

function compactTaskQi(value: unknown): FspmTaskQi | null {
  const record = jsonRecord(value);
  const evidence = stringArray(record?.evidence);
  const policyAuthorization = compactEqvmPolicyAuthorization(
    record?.policyAuthorization,
  );
  const coherentAuthorizationState =
    policyAuthorization?.status === "unapproved" &&
    record?.configurationClass === "implementation_research_configuration" &&
    record.score === null &&
    record.status === "unavailable" &&
    record.unavailabilityReason === "activity_weight_policy_unapproved";
  if (
    !record ||
    !coherentAuthorizationState ||
    !isEqvmCoverageStatus(record.status) ||
    !Number.isSafeInteger(record.measuredAt) ||
    (record.measuredAt as number) < 0 ||
    record.activityWeightPolicyId !==
      "eqvm:activity-weight:equal-terminal-samples:v1" ||
    record.activityWeightModel !== "equal_weight" ||
    record.frameworkReferenceSha !== FSPM_GOVERNANCE_SHA ||
    policyAuthorization?.status !== "unapproved" ||
    !Number.isSafeInteger(record.evidenceWindowTicks) ||
    record.evidenceWindowTicks !== 1_500 ||
    !Number.isSafeInteger(record.ratedActivities) ||
    (record.ratedActivities as number) < 0 ||
    !Number.isSafeInteger(record.totalActivities) ||
    (record.totalActivities as number) < 0 ||
    !Number.isSafeInteger(record.freshActivities) ||
    (record.freshActivities as number) < 0 ||
    !Number.isSafeInteger(record.staleActivities) ||
    (record.staleActivities as number) < 0 ||
    !Number.isSafeInteger(record.unratedActivities) ||
    (record.unratedActivities as number) < 0 ||
    !Number.isSafeInteger(record.invalidActivities) ||
    (record.invalidActivities as number) < 0 ||
    !Number.isSafeInteger(record.exceptional) ||
    (record.exceptional as number) < 0 ||
    !Number.isSafeInteger(record.satisfactory) ||
    (record.satisfactory as number) < 0 ||
    !Number.isSafeInteger(record.marginal) ||
    (record.marginal as number) < 0 ||
    !Number.isSafeInteger(record.unsatisfactory) ||
    (record.unsatisfactory as number) < 0 ||
    !Number.isSafeInteger(record.rejected) ||
    (record.rejected as number) < 0 ||
    !evidence
  ) {
    return null;
  }

  const summary = {
    measuredAt: record.measuredAt as number,
    activityWeightPolicyId:
      "eqvm:activity-weight:equal-terminal-samples:v1" as const,
    activityWeightModel: "equal_weight" as const,
    frameworkReferenceSha: record.frameworkReferenceSha,
    evidenceWindowTicks: record.evidenceWindowTicks as number,
    ratedActivities: record.ratedActivities as number,
    totalActivities: record.totalActivities as number,
    freshActivities: record.freshActivities as number,
    staleActivities: record.staleActivities as number,
    unratedActivities: record.unratedActivities as number,
    invalidActivities: record.invalidActivities as number,
    exceptional: record.exceptional as number,
    satisfactory: record.satisfactory as number,
    marginal: record.marginal as number,
    unsatisfactory: record.unsatisfactory as number,
    rejected: record.rejected as number,
    evidence,
  };
  return {
    ...summary,
    score: null,
    status: "unavailable",
    configurationClass: "implementation_research_configuration",
    policyAuthorization,
    unavailabilityReason: "activity_weight_policy_unapproved",
  };
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
      record.rating !== "marginal" &&
      record.rating !== "unsatisfactory" &&
      record.rating !== "rejected") ||
    (record.value !== null && !isFiniteNumber(record.value)) ||
    typeof record.evidence !== "string" ||
    record.source !== "terminal_activity_kpi" ||
    !isFiniteNumber(record.activityCompletedAtTick) ||
    record.activityWeightPolicyId !==
      "eqvm:activity-weight:equal-terminal-samples:v1" ||
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
    source: record.source,
    activityCompletedAtTick: record.activityCompletedAtTick,
    activityWeightPolicyId: record.activityWeightPolicyId,
    ...(compactOutcome ? { outcome: compactOutcome } : {}),
  };
}

function compactOperationalHealthSample(
  value: unknown,
): FspmOperationalHealthSample | null {
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
  const operationalHealthValid =
    record.operationalHealth === undefined ||
    compactOperationalHealth(record.operationalHealth) !== null;

  return (
    hasFspmPortfolioP3Shape(value) &&
    isFspmStatus(record.status) &&
    operationalHealthValid
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
    case "linkTransfer":
      return `link:${intent.linkId}`;
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

const DEVELOPMENT_TRACE_REQUIREMENT_LIMIT = 16;

function roomPlanSummaries(): RoomPlanTraceSummary[] {
  return Object.values(Memory.colonies)
    .map((colony) => {
      const retainedPlan = colony.roomPlan;
      const projection = usableRoomPlanProjection(colony, colony.roomName);
      const plan = projection.plan;
      const room = Game.rooms?.[colony.roomName];
      const development =
        room && plan ? evaluateRoomDevelopmentForRoom(room, plan) : null;
      const energyTopology = plan ? assessMatureLinkService(plan) : null;
      const controllerLevel = room?.controller?.level ?? null;
      const hostiles = room?.find(FIND_HOSTILE_CREEPS) ?? [];
      const targetHits =
        !plan || controllerLevel === null
          ? null
          : defensiveRampartTargetHits(controllerLevel, hostiles.length > 0);
      const rampartsByPosition =
        room && plan
          ? new Map(
              room
                .find(FIND_MY_STRUCTURES)
                .filter(
                  (structure): structure is StructureRampart =>
                    structure.structureType === STRUCTURE_RAMPART,
                )
                .map((rampart) => [
                  `${rampart.pos.x}:${rampart.pos.y}`,
                  rampart,
                ]),
            )
          : null;
      const perimeterRamparts =
        rampartsByPosition && plan
          ? plan.defense.perimeter.flatMap((point) => {
              const rampart = rampartsByPosition.get(`${point.x}:${point.y}`);
              return rampart ? [rampart] : [];
            })
          : null;
      const nextMissingPerimeterTile =
        rampartsByPosition && plan
          ? (plan.defense.perimeter.find(
              (point) => !rampartsByPosition.has(`${point.x}:${point.y}`),
            ) ?? null)
          : null;
      const developmentTrace: RuntimeRoomDevelopmentTrace | null = development
        ? {
            source: "runtime_room_development_evaluator",
            evaluatedAt: Game.time,
            horizonStatus: development.horizonStatus,
            validationIssues: development.validationIssues.slice(0, 12),
            activeStageId: development.activeStageId,
            nextStageId: development.nextStageId,
            realizationPercentage:
              development.overallEligibleRealizationPercentage,
            missingStructures: development.missingStructures.length,
            blockedStructures: development.blockedStructures.length,
            stages: development.stages.map((stage) => ({
              id: stage.id,
              title: stage.title,
              minRcl: stage.minRcl,
              stageWeight: stage.stageWeight,
              status: stage.status,
              controllerEligible: stage.controllerEligible,
              prerequisitesSatisfied: stage.prerequisitesSatisfied,
              realizationPercentage: stage.realizationPercentage,
              realizedStructures: stage.realizedStructures.length,
              eligibleStructures: stage.eligibleStructures.length,
              missingStructures: stage.missingStructures.length,
              blockedStructures: stage.blockedStructures.length,
            })),
            missingCriticalStructures: development.missingStructures
              .slice(0, DEVELOPMENT_TRACE_REQUIREMENT_LIMIT)
              .map((structure) => ({
                plannedStructureId: structure.plannedStructureId,
                stageId: structure.stageId,
                structureType: structure.structureType,
                x: structure.x,
                y: structure.y,
                minRcl: structure.minRcl,
                priority: structure.priority,
                strategicWeight: structure.strategicWeight,
                underConstruction: structure.underConstruction,
                blocked: structure.blocked,
                blockerReasons: structure.blockerReasons.slice(0, 4),
              })),
            nextMilestone: {
              kind: development.nextMilestone.kind,
              stageId: development.nextMilestone.stageId,
              plannedStructureId: development.nextMilestone.plannedStructureId,
              reason: development.nextMilestone.reason,
            },
          }
        : null;
      return {
        roomName: colony.roomName,
        projectionUsability: {
          usable: projection.usable,
          status: projection.status,
          reason: projection.reason,
        },
        planId: retainedPlan?.planId ?? null,
        deliverableId: retainedPlan?.deliverableId ?? null,
        plannerRevision: retainedPlan?.plannerRevision ?? null,
        projectionRevision: retainedPlan?.projectionRevision ?? null,
        projectionFingerprint: retainedPlan?.projectionFingerprint ?? null,
        version: retainedPlan?.version ?? null,
        horizonRcl: retainedPlan?.horizonRcl ?? null,
        generatedAt: retainedPlan?.generatedAt ?? null,
        generatedReason: retainedPlan?.generatedReason ?? null,
        hub: plan ? { ...plan.anchors.hub } : null,
        automaticStructures: plan
          ? plan.structures.filter(
              (structure) => structure.activation === "automatic",
            ).length
          : null,
        demandStructures: plan
          ? plan.structures.filter(
              (structure) => structure.activation === "demand",
            ).length
          : null,
        roadTiles: plan?.roads.length ?? null,
        roadEdges: plan?.roadGraph.edges.length ?? null,
        invalidated: retainedPlan?.invalidatedAt !== undefined,
        controllerLevel,
        horizonStatus: development?.horizonStatus ?? null,
        activeStageId: development?.activeStageId ?? null,
        nextStageId: development?.nextStageId ?? null,
        realizationPercentage:
          development?.overallEligibleRealizationPercentage ?? null,
        missingStructures: development?.missingStructures.length ?? null,
        blockedStructures: development?.blockedStructures.length ?? null,
        nextMilestone: development
          ? {
              kind: development.nextMilestone.kind,
              reason: development.nextMilestone.reason,
            }
          : null,
        development: developmentTrace,
        defense: {
          strategy: plan?.defense.strategy ?? null,
          protectedTiles: plan?.defense.protectedTiles.length ?? null,
          perimeterPlanned: plan?.defense.perimeter.length ?? null,
          perimeterBuilt: perimeterRamparts?.length ?? null,
          perimeterAtTarget:
            perimeterRamparts && targetHits !== null
              ? perimeterRamparts.filter(
                  (rampart) => rampart.hits >= targetHits,
                ).length
              : null,
          targetHits,
          underAttack: hostiles.length > 0,
          nextMissingTile: nextMissingPerimeterTile
            ? { ...nextMissingPerimeterTile }
            : null,
        },
        energyTopology: energyTopology
          ? {
              status: energyTopology.status,
              reason: energyTopology.reason,
              sourceLinks: energyTopology.roles?.sources.length ?? 0,
              controllerLinkPlanId:
                energyTopology.roles?.controllerPlanId ?? null,
              coreLinkPlanId: energyTopology.roles?.corePlanId ?? null,
            }
          : {
              status: "unavailable" as const,
              reason: `Room-plan projection ${projection.status}: ${projection.reason}`,
              sourceLinks: null,
              controllerLinkPlanId: null,
              coreLinkPlanId: null,
            },
      };
    })
    .sort((a, b) => a.roomName.localeCompare(b.roomName));
}

function settlementProjectionFaultSummaries(): SettlementProjectionFaultTrace[] {
  return Object.values(Memory.colonies)
    .flatMap((colony) => {
      const fault = colony.settlementProjectionFault;
      return fault
        ? [
            {
              roomName: colony.roomName,
              kind: fault.kind,
              status: fault.status,
              firstTick: fault.firstTick,
              lastTick: fault.lastTick,
              attemptCount: fault.attemptCount,
              retryDelayTicks: fault.retryDelayTicks,
              nextRetryTick: fault.nextRetryTick,
              reason: fault.reason,
              remediation: fault.remediation,
              retainedPlannerRevision: fault.retainedPlannerRevision,
              targetPlannerRevision: fault.targetPlannerRevision,
              retainedProjectionRevision: fault.retainedProjectionRevision,
              retainedProjectionFingerprint:
                fault.retainedProjectionFingerprint,
              resolvedAtTick: fault.resolvedAtTick ?? null,
              supersededByRevision: fault.supersededByRevision ?? null,
              supersededByFingerprint: fault.supersededByFingerprint ?? null,
            },
          ]
        : [];
    })
    .sort((left, right) => left.roomName.localeCompare(right.roomName));
}

const compactOperationalHealth = (
  value: unknown,
): CompactOperationalHealth | null => {
  const record = jsonRecord(value);
  const evidence = stringArray(record?.evidence);
  return record &&
    isFiniteNumber(record.score) &&
    (record.state === "healthy" ||
      record.state === "watch" ||
      record.state === "degraded") &&
    (record.trend === "new" ||
      record.trend === "improving" ||
      record.trend === "stable" ||
      record.trend === "declining") &&
    isFiniteNumber(record.measuredAt) &&
    evidence
    ? {
        score: record.score,
        state: record.state,
        trend: record.trend,
        measuredAt: record.measuredAt,
        evidence,
      }
    : null;
};

const compactRecord = (record: {
  id: string;
  title: string;
  status: FspmStatus;
  operationalHealth?: FspmOperationalHealth;
}): CompactFspmRecord => {
  const operationalHealth = compactOperationalHealth(record.operationalHealth);
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    ...(operationalHealth ? { operationalHealth } : {}),
  };
};

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
  operationalHealth?: FspmOperationalHealth;
  pqi?: FspmP3Pqi;
}): CompactPortfolioP3 => {
  const operationalHealth = compactOperationalHealth(record.operationalHealth);
  const pqi = compactP3Pqi(record.pqi);
  return {
    id: record.id,
    type: record.type,
    subType: record.subType,
    name: record.name,
    description: record.description,
    parentP3Id: record.parentP3Id,
    temporalBasis: record.temporalBasis,
    startTick: record.startTick,
    status: record.status,
    ...(operationalHealth ? { operationalHealth } : {}),
    ...(pqi ? { pqi } : {}),
  };
};

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
      record.kpiScore !== "marginal" &&
      record.kpiScore !== "unsatisfactory" &&
      record.kpiScore !== "rejected") ||
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
      const operationalHealthHistoryRegistry =
        jsonRecord(portfolio.operationalHealthHistory) ?? {};
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
      const operationalHealthHistoryFor = (
        recordId: string,
      ): FspmOperationalHealthSample[] => {
        const samples = operationalHealthHistoryRegistry[recordId];
        return Array.isArray(samples)
          ? samples.slice(-12).flatMap((sample) => {
              const compact = compactOperationalHealthSample(sample);
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
          p3OperationalHealthHistory: compactP3
            ? operationalHealthHistoryFor(compactP3.id)
            : [],
          contractOperationalHealthHistory:
            portfolio.contract && hasCompactFspmRecordShape(portfolio.contract)
              ? operationalHealthHistoryFor(portfolio.contract.id)
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
              const dqi = compactDeliverableQi(record.dqi);
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
                  ...(dqi ? { dqi } : {}),
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
    settlement: {
      plans: roomPlanSummaries(),
      faults: settlementProjectionFaultSummaries(),
    },
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
