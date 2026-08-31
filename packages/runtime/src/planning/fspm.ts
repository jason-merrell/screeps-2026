import type { Intent, IntentTrace } from "../intents/types";
import {
  FSPM_TASK_CATALOG,
  type FspmTaskDetermination,
  fspmProcedureDefinition,
  fspmProcedureIndex,
  fspmTaskDefinition,
  requireFspmTaskDefinition,
} from "./fspm-catalog";
import {
  APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE,
  deliverableTemplateForDomain,
  type FSPM_AUTHORITY_PACKAGE_SCHEMA,
  FSPM_WEIGHT_BASIS_POINTS,
  type FspmAuthorityPackage,
  type FspmDeliverableCategory,
  type FspmDeliverableType,
  type FspmEvaluationFactors,
  type FspmReceiptValidationContract,
  type FspmRequirementTrigger,
  type FspmServicePrincipalAcceptancePolicy,
  type FspmStrategicPriority,
  governanceContentHash,
  requirementTemplateForDomain,
  validateAuthorityPackage,
} from "./fspm-governance";

export type FspmDomain = "economy" | "spawning" | "construction" | "defense";
export type FspmStatus = "active" | "completed" | "cancelled" | "retired";
export type FspmTaskStatus = "active" | "retired";
export type FspmActivityStatus =
  | "not_started"
  | "in_progress"
  | "on_hold"
  | "completed";
export type FspmOperationalHealthState = "healthy" | "watch" | "degraded";
export type FspmOperationalHealthTrend =
  | "new"
  | "improving"
  | "stable"
  | "declining";
/** @deprecated Use FspmOperationalHealthState. */
export type FspmQualityState = FspmOperationalHealthState;
/** @deprecated Use FspmOperationalHealthTrend. */
export type FspmQualityTrend = FspmOperationalHealthTrend;
export type FspmKpiRating =
  | "exceptional"
  | "satisfactory"
  | "marginal"
  | "unsatisfactory"
  | "rejected"
  | "in_progress";

export const EMPIRE_PORTFOLIO_ID = "portfolio:empire:operations";

export interface FspmOperationalHealth {
  score: number;
  state: FspmOperationalHealthState;
  trend: FspmOperationalHealthTrend;
  measuredAt: number;
  evidence: string[];
}

/**
 * Legacy type name retained at decoder boundaries. This shape is operational
 * readiness telemetry, never an Activity-derived FSPM Quality Index.
 */
export type FspmQuality = FspmOperationalHealth;

export interface FspmOperationalHealthSample {
  tick: number;
  score: number;
  state: FspmOperationalHealthState;
}

/** @deprecated Use FspmOperationalHealthSample. */
export type FspmQualitySample = FspmOperationalHealthSample;

export interface FspmTaskKpiRubric {
  metric: string;
  exceptional: string;
  satisfactory: string;
  unsatisfactory: string;
}

export interface FspmProcedure {
  id: string;
  taskId: string;
  procedureKey: string;
  title: string;
}

export interface FspmActivityKpiSample {
  tick: number;
  activityId: string;
  activityType: string;
  actor: string;
  rating: FspmKpiRating;
  value: number | null;
  evidence: string;
  /** Present only for terminal, governed Activity KPI evidence. */
  source?: "terminal_activity_kpi";
  activityCompletedAtTick?: number;
  activityWeightPolicyId?: FspmActivityKpiAggregationPolicy["id"];
  outcome?: {
    metric: string;
    actual: number;
    target: number;
    unit: string;
    utilization: number;
  };
}

/**
 * Local research configuration for recurring Activity sample aggregation.
 * It is deliberately not part of approved Task authority: accountable approval
 * of concrete Activity weights/cohort semantics remains outstanding.
 */
interface FspmActivityKpiAggregationPolicyBase {
  id: "eqvm:activity-weight:equal-terminal-samples:v1";
  model: "equal_weight";
  evidenceScope: "terminal_activity_kpi_samples";
  activityWeightUnits: 1;
  historyLimit: 24;
  freshnessWindowTicks: 1_500;
  frameworkReferenceSha: string;
  rationale: string;
}

/**
 * Evidence that accountable management approved one exact EQVM policy.
 * A naked `approved` flag is intentionally insufficient: every canonical
 * quality index must retain who approved which policy, under which authority,
 * and when.
 */
export interface FspmEqvmPolicyApproval {
  status: "approved";
  approvalEventId: string;
  approvalAuthorityOuId: string;
  accountablePositionId: string;
  signerPrincipalId: string;
  approvedAtTick: number;
  approvedPolicyContentHash: string;
}

export interface FspmEqvmPolicyAuthorizationDebt {
  status: "unapproved";
  authorizationDebt: string;
}

export type FspmEqvmPolicyAuthorization =
  | FspmEqvmPolicyApproval
  | FspmEqvmPolicyAuthorizationDebt;

/**
 * Research configurations cannot silently acquire canonical authority. An
 * approved policy is a different, governed configuration with durable approval
 * provenance.
 */
export type FspmActivityKpiAggregationPolicy =
  FspmActivityKpiAggregationPolicyBase &
    (
      | {
          configurationClass: "implementation_research_configuration";
          policyAuthorization: FspmEqvmPolicyAuthorizationDebt;
        }
      | {
          configurationClass: "governed_configuration";
          policyAuthorization: FspmEqvmPolicyApproval;
        }
    );

export type FspmEqvmCoverageStatus =
  | "unavailable"
  | "partial"
  | "complete"
  | "stale"
  | "invalid";

interface FspmTaskQiEvidenceSummary {
  score: number | null;
  status: FspmEqvmCoverageStatus;
  measuredAt: number;
  activityWeightPolicyId: FspmActivityKpiAggregationPolicy["id"];
  activityWeightModel: FspmActivityKpiAggregationPolicy["model"];
  frameworkReferenceSha: string;
  evidenceWindowTicks: number;
  ratedActivities: number;
  totalActivities: number;
  freshActivities: number;
  staleActivities: number;
  unratedActivities: number;
  invalidActivities: number;
  exceptional: number;
  satisfactory: number;
  marginal: number;
  unsatisfactory: number;
  rejected: number;
  evidence: string[];
}

interface FspmApprovedTaskQiBase extends FspmTaskQiEvidenceSummary {
  configurationClass: "governed_configuration";
  policyAuthorization: FspmEqvmPolicyApproval;
  unavailabilityReason?: never;
}

/**
 * Canonical Task QI. Its discriminants make an unapproved numeric score or an
 * approved complete-without-score state unrepresentable in trusted code.
 */
export type FspmTaskQi =
  | (FspmApprovedTaskQiBase & { status: "complete"; score: number })
  | (FspmApprovedTaskQiBase & {
      status: Exclude<FspmEqvmCoverageStatus, "complete">;
      score: null;
    })
  | (FspmTaskQiEvidenceSummary & {
      score: null;
      status: "unavailable";
      configurationClass: "implementation_research_configuration";
      policyAuthorization: FspmEqvmPolicyAuthorizationDebt;
      unavailabilityReason: "activity_weight_policy_unapproved";
    });

/** Non-authoritative diagnostic only; never a canonical Task QI. */
export interface FspmEqvmResearchEstimate extends FspmTaskQiEvidenceSummary {
  configurationClass: "implementation_research_configuration";
  policyAuthorization: FspmEqvmPolicyAuthorizationDebt;
  unavailabilityReason?: never;
}

export interface FspmWeightedEqvmCoverage {
  status: FspmEqvmCoverageStatus;
  expectedWeightBasisPoints: number;
  coveredWeightBasisPoints: number;
  missingIds: string[];
  staleIds: string[];
  invalidIds: string[];
  evidence: string[];
}

export type FspmCanonicalEqvmRollupState =
  | {
      score: number;
      policyAuthorization: FspmEqvmPolicyApproval;
      coverage: FspmWeightedEqvmCoverage & { status: "complete" };
    }
  | {
      score: null;
      policyAuthorization: FspmEqvmPolicyApproval;
      coverage: FspmWeightedEqvmCoverage & {
        status: Exclude<FspmEqvmCoverageStatus, "complete">;
      };
    }
  | {
      score: null;
      policyAuthorization: FspmEqvmPolicyAuthorizationDebt;
      coverage: FspmWeightedEqvmCoverage & {
        status: Exclude<FspmEqvmCoverageStatus, "complete">;
      };
    };

interface FspmDeliverableQiBase {
  measuredAt: number;
  activityWeightPolicyId: FspmActivityKpiAggregationPolicy["id"];
  taskWeightBasisPoints: number;
}

export type FspmDeliverableQi = FspmDeliverableQiBase &
  FspmCanonicalEqvmRollupState;

interface FspmP3PqiBase {
  measuredAt: number;
  activityWeightPolicyId: FspmActivityKpiAggregationPolicy["id"];
  deliverableWeightBasisPoints: number;
}

export type FspmP3Pqi = FspmP3PqiBase & FspmCanonicalEqvmRollupState;

export interface FspmActivityMetrics {
  inProgressTicks: number;
  onHoldTicks: number;
  productiveTicks: number;
  travelTicks: number;
  idleTicks: number;
  holdCount: number;
  resumeCount: number;
  taskPreemptions: number;
  procedureTransitions: number;
}

export interface FspmActivityRecord {
  id: string;
  taskId: string;
  assignee: string;
  status: FspmActivityStatus;
  currentProcedureId: string;
  qualityDescription: string;
  qualityMetric: string;
  kpiMetric: FspmTaskKpiRubric;
  kpiScore?: Exclude<FspmKpiRating, "in_progress">;
  /** Rating reason/evidence retained with the terminal KPI decision. */
  kpiEvidence?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  holdReason?: string;
  metrics: FspmActivityMetrics;
}

interface FspmRecordBase {
  id: string;
  title: string;
  status: FspmStatus;
  completionCriterion: string;
  statusReason?: string;
  /** Room-state readiness signal; explicitly outside the EQVM hierarchy. */
  operationalHealth?: FspmOperationalHealth;
  /** Pre-v10 compatibility only; migration removes this synthetic label. */
  quality?: FspmQuality;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  retiredAt?: number;
  reopenedAt?: number;
}

interface PortfolioP3Base {
  id: string;
  type: "portfolio";
  subType: "ou_portfolio";
  name: string;
  description: string;
  parentP3Id: string | null;
  /** Screeps adaptation of FSPM Start Date. Runtime scheduling authority is game ticks. */
  temporalBasis: "game_tick";
  startTick: number;
  status: FspmStatus;
  statusReason: string;
  /** Room-state readiness signal; explicitly outside the EQVM hierarchy. */
  operationalHealth?: FspmOperationalHealth;
  /** Activity -> Task -> Deliverable -> P3 quality rollup. */
  pqi?: FspmP3Pqi;
  /** Pre-v10 compatibility only; migration removes this synthetic label. */
  quality?: FspmQuality;
  createdAt: number;
  updatedAt: number;
}

export interface EmpirePortfolioP3 extends PortfolioP3Base {
  id: typeof EMPIRE_PORTFOLIO_ID;
  parentP3Id: null;
}

export interface EmpireFspmPortfolio {
  p3: EmpirePortfolioP3;
}

export interface ColonyPortfolioP3 extends PortfolioP3Base {
  roomName: string;
  parentP3Id: typeof EMPIRE_PORTFOLIO_ID;
}

export function hasFspmPortfolioP3Shape(
  value: unknown,
): value is PortfolioP3Base {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.type === "portfolio" &&
    record.subType === "ou_portfolio" &&
    typeof record.name === "string" &&
    record.name.trim().length > 0 &&
    typeof record.description === "string" &&
    record.description.trim().length > 0 &&
    (record.parentP3Id === null || typeof record.parentP3Id === "string") &&
    record.temporalBasis === "game_tick" &&
    typeof record.startTick === "number" &&
    Number.isInteger(record.startTick) &&
    record.startTick >= 0 &&
    (record.status === "active" ||
      record.status === "completed" ||
      record.status === "cancelled" ||
      record.status === "retired")
  );
}

export function isCanonicalEmpirePortfolioP3(
  value: unknown,
): value is EmpirePortfolioP3 {
  return (
    hasFspmPortfolioP3Shape(value) &&
    value.id === EMPIRE_PORTFOLIO_ID &&
    value.parentP3Id === null
  );
}

export function isActiveCanonicalEmpirePortfolioP3(
  value: unknown,
): value is EmpirePortfolioP3 {
  return isCanonicalEmpirePortfolioP3(value) && value.status === "active";
}

export function isCanonicalColonyPortfolioP3(
  value: unknown,
  roomName: string,
): value is ColonyPortfolioP3 {
  return (
    hasFspmPortfolioP3Shape(value) &&
    typeof (value as { roomName?: unknown }).roomName === "string" &&
    (value as unknown as { roomName: string }).roomName === roomName &&
    value.id === `portfolio:colony:${roomName}` &&
    value.parentP3Id === EMPIRE_PORTFOLIO_ID
  );
}

export function isActiveCanonicalColonyPortfolioP3(
  value: unknown,
  roomName: string,
): value is ColonyPortfolioP3 {
  return (
    isCanonicalColonyPortfolioP3(value, roomName) && value.status === "active"
  );
}

/** Historical authority retained only to decode pre-migration evidence. */
export interface ColonyServiceProgram {
  id: string;
  type: "program";
  subType: "service_program";
  roomName: string;
  title: string;
  status: "active" | "retired";
  statusReason?: string;
  retiredAt?: number;
}

/** Historical synthetic authority retained only to decode pre-migration evidence. */
export interface ColonyContract extends FspmRecordBase {
  kind: "contract";
  roomName: string;
  programId?: string;
}

export interface ColonyRequirement extends FspmRecordBase {
  kind: "requirement";
  p3Id: string;
  /** Legacy authority retained on migrated records; new requirements omit it. */
  contractId?: string;
  domain: FspmDomain;
  revision: number;
  approvedContentHash: string;
  requestorId: string;
  requirementTrigger: FspmRequirementTrigger;
  requirementSource?: string;
  originatingAuthority?: string;
  requirementVerbiage: string;
  purposeStatement: string;
  strategicPriority: FspmStrategicPriority;
  strategicAlignment: string;
  applicableOuId: string;
  desiredOutcomes: string;
  businessCase: string;
  approvalAuthorityOuId: string;
  approval: boolean;
  approvalEventId: string;
  approvedBy: string;
  approvalSignature: string;
  dateApproved: string;
  createdBy: string;
  modifiedBy: string;
}

export interface ColonyDeliverable extends FspmRecordBase {
  kind: "deliverable";
  p3Id: string;
  requirementId: string;
  domain: FspmDomain;
  revision: number;
  approvedContentHash: string;
  category: FspmDeliverableCategory;
  deliverableType: FspmDeliverableType;
  details: string;
  output: string;
  requirementSource: string;
  requirementVerbiage: string;
  evaluationFactors: FspmEvaluationFactors;
  qualityDescription: string;
  qualityMetric: string;
  receiptValidation: FspmReceiptValidationContract;
  servicePrincipalAcceptance: FspmServicePrincipalAcceptancePolicy;
  siblingWeightBasisPoints: number;
  /** EQVM Deliverable Quality Index calculated only from verified Task QI. */
  dqi?: FspmDeliverableQi;
  parentDeliverableId?: string;
  childDeliverableIds: string[];
}

export interface FspmRequirementApprovalEvent {
  id: string;
  sequence: number;
  requirementId: string;
  requirementRevision: number;
  approvedContentHash: string;
  applicableOuId: string;
  approvalAuthorityOuId: string;
  accountablePositionId: string;
  signerPrincipalId: string;
  signatureType: "source_control_policy_attestation" | "human_typed_name";
  typedSignature: string;
  approvedAt: string;
  recordedAtTick: number;
  authorityPackageId: string;
  authorityPackageRevision: number;
  authorityPackageHash: string;
  previousEventHash: string | null;
  eventHash: string;
}

export interface FspmDeliverableReceipt {
  id: string;
  sequence: number;
  deliverableId: string;
  deliverableRevision: number;
  deliverableContentHash: string;
  evidenceForm: FspmReceiptValidationContract["evidenceForm"];
  evidenceReference: string;
  sourceActivityId: string;
  sourceTaskId: string;
  sourceActivityCreatedAtTick: number;
  sourceActivityStartedAtTick: number;
  sourceActivityCompletedAtTick: number;
  sourceActivityUpdatedAtTick: number;
  sourceActivityQualityMetric: string;
  sourceActivityKpiScore: Exclude<FspmKpiRating, "in_progress">;
  outcome: "received";
  storageLocation: string;
  capturedBy: string;
  capturedAtTick: number;
  previousReceiptHash: string | null;
  receiptHash: string;
}

/**
 * One immutable accountable decision over previously captured receipt
 * evidence. This is a Screeps service-principal adaptation; it is not a claim
 * that a human performed the framework's canonical acceptance step.
 */
export interface FspmDeliverableReceiptDecision {
  id: string;
  sequence: number;
  receiptId: string;
  receiptHash: string;
  deliverableId: string;
  deliverableRevision: number;
  deliverableContentHash: string;
  outcome: "accepted" | "rejected" | "disputed";
  reason: string;
  decisionAuthority: "screeps_accountable_service_principal";
  decidedBy: string;
  decidedAtTick: number;
  authorityPackageId: string;
  authorityPackageRevision: number;
  authorityPackageHash: string;
  previousDecisionHash: string | null;
  decisionHash: string;
}

export interface FspmAuthorityLifecycleEvent {
  id: string;
  sequence: number;
  recordId: string;
  recordKind: "requirement" | "deliverable";
  recordRevision: number;
  recordContentHash: string;
  transition: "retired";
  fromStatus: "active";
  toStatus: "retired";
  reason: string;
  actorPrincipalId: string;
  recordedAtTick: number;
  authorityPackageId: string;
  authorityPackageRevision: number;
  authorityPackageHash: string;
  previousEventHash: string | null;
  eventHash: string;
}

export interface FspmAuthorityLedgerAnchor {
  count: number;
  headHash: string | null;
}

export interface FspmAuthorityLedgerAnchors {
  deliverableReceipts: FspmAuthorityLedgerAnchor;
  deliverableReceiptDecisions: FspmAuthorityLedgerAnchor;
  authorityLifecycle: FspmAuthorityLedgerAnchor;
}

export interface FspmGovernanceBinding {
  schema: typeof FSPM_AUTHORITY_PACKAGE_SCHEMA;
  authorityPackageId: string;
  authorityPackageRevision: number;
  authorityPackageHash: string;
  governanceSha: string;
  effectiveDate: string;
  importedAtTick: number;
  issuerPrincipalId: string;
  departmentOuId: string;
  departmentCode: string;
  accountablePositionId: string;
  accountablePrincipalId: string;
  activationReceiptHash: string;
}

export interface FspmAuthorityQuarantine {
  schema: "screeps-fspm-authority-quarantine/v1";
  migratedFromVersion: number;
  reason: string;
  quarantinedAtTick: number;
  requirements: Partial<Record<FspmDomain, unknown>>;
  deliverables: Partial<Record<FspmDomain, unknown>>;
  tasks: Record<string, unknown>;
  activities: Record<string, unknown>;
  activityEvents: unknown[];
  activityEventSequence: number;
  qualityHistory: Record<string, unknown>;
  activityKpiHistory: Record<string, unknown>;
}

export interface ColonyTask {
  kind: "task";
  id: string;
  title: string;
  description?: string;
  status: FspmTaskStatus;
  statusReason?: string;
  deliverableId: string;
  domain: FspmDomain;
  taskKey: string;
  taskWeight?: number;
  qualityDescription: string;
  qualityMetric: string;
  kpiMetric: FspmTaskKpiRubric;
  procedures: FspmProcedure[];
  determination?: FspmTaskDetermination;
  qi?: FspmTaskQi;
  createdAt: number;
  updatedAt: number;
  retiredAt?: number;
}

export interface ColonyFspmPortfolio {
  /** Current P3 authority for all newly generated colony work. */
  p3: ColonyPortfolioP3;
  /** Legacy pre-migration Service Program, retained as historical evidence only. */
  program?: ColonyServiceProgram;
  /** Legacy synthetic contract, retained as historical evidence only. */
  contract?: ColonyContract;
  requirements: Partial<Record<FspmDomain, ColonyRequirement>>;
  deliverables: Partial<Record<FspmDomain, ColonyDeliverable>>;
  governanceBinding?: FspmGovernanceBinding;
  requirementApprovalLedger?: Record<string, FspmRequirementApprovalEvent>;
  deliverableReceipts?: Record<string, FspmDeliverableReceipt>;
  deliverableReceiptDecisions?: Record<string, FspmDeliverableReceiptDecision>;
  authorityLifecycleLedger?: Record<string, FspmAuthorityLifecycleEvent>;
  authorityLedgerAnchors?: FspmAuthorityLedgerAnchors;
  authorityQuarantine?: FspmAuthorityQuarantine[];
  tasks: Record<string, ColonyTask>;
  activities?: Record<string, FspmActivityRecord>;
  /** Pre-v10 synthetic-quality history retained only for migration/quarantine. */
  qualityHistory?: Record<string, FspmQualitySample[]>;
  operationalHealthHistory?: Record<string, FspmOperationalHealthSample[]>;
  activityKpiHistory?: Record<string, FspmActivityKpiSample[]>;
  /**
   * Non-authoritative diagnostics, segregated from governed Task records and
   * never consumed by DQI/PQI or execution authorization.
   */
  eqvmResearchTelemetry?: Record<string, FspmEqvmResearchEstimate>;
}

export type FspmAuthorityDenialCode =
  | "trace_missing"
  | "trace_p3_missing"
  | "empire_p3_missing"
  | "empire_p3_mismatch"
  | "empire_p3_inactive"
  | "p3_missing"
  | "p3_ambiguous"
  | "p3_mismatch"
  | "p3_inactive"
  | "requirement_missing"
  | "requirement_ambiguous"
  | "requirement_mismatch"
  | "requirement_inactive"
  | "deliverable_missing"
  | "deliverable_ambiguous"
  | "deliverable_mismatch"
  | "deliverable_inactive"
  | "task_missing"
  | "task_ambiguous"
  | "task_mismatch"
  | "task_catalog_mismatch"
  | "task_inactive"
  | "procedure_missing"
  | "procedure_ambiguous"
  | "procedure_mismatch"
  | "procedure_catalog_mismatch"
  | "authority_registry_invalid"
  | "intent_type_mismatch"
  | "scope_room_mismatch"
  | "scope_actor_missing"
  | "scope_actor_mismatch"
  | "scope_executor_missing"
  | "scope_executor_mismatch"
  | "scope_target_missing"
  | "scope_target_mismatch"
  | "snapshot_stale";

export interface ActiveFspmAuthority {
  authorized: true;
  roomName: string;
  portfolio: ColonyFspmPortfolio;
  requirement: ColonyRequirement;
  deliverable: ColonyDeliverable;
  task: ColonyTask;
  procedure: FspmProcedure;
}

export interface DeniedFspmAuthority {
  authorized: false;
  code: FspmAuthorityDenialCode;
  reason: string;
}

export type FspmAuthorityResolution = ActiveFspmAuthority | DeniedFspmAuthority;

export interface FspmAuthorityDenialEvidence {
  code: FspmAuthorityDenialCode;
  reason: string;
  intentType: Intent["type"];
  trace: IntentTrace | null;
}

export interface FspmAuthorityDenialSummary {
  total: number;
  byCode: Partial<Record<FspmAuthorityDenialCode, number>>;
  samples: FspmAuthorityDenialEvidence[];
}

export interface FspmAuthoritySnapshot {
  readonly tick: number;
  readonly stats: Readonly<{
    colonies: number;
    requirements: number;
    deliverables: number;
    tasks: number;
    procedures: number;
  }>;
  resolveTrace(trace: IntentTrace): FspmAuthorityResolution;
  resolveIntent(intent: Intent): FspmAuthorityResolution;
}

export interface AuthorizedFspmIntentBatch {
  accepted: Intent[];
  denied: FspmAuthorityDenialSummary;
  snapshot: FspmAuthoritySnapshot;
}

function denyAuthority(
  code: FspmAuthorityDenialCode,
  reason: string,
): DeniedFspmAuthority {
  return { authorized: false, code, reason };
}

interface IndexedPortfolio {
  colonyStorageKey: string;
  colony: Memory["colonies"][string];
  roomName: string;
  portfolio: ColonyFspmPortfolio;
  requirements: Map<string, Array<[string, ColonyRequirement]>>;
  deliverables: Map<string, Array<[string, ColonyDeliverable]>>;
  tasks: Map<string, IndexedTask[]>;
}

interface IndexedTask {
  storageId: string;
  task: ColonyTask;
  procedures: Map<string, FspmProcedure[]>;
  procedureArray: FspmProcedure[];
  procedureIndexesById: Map<string, number>;
}

const AUTHORITY_DENIAL_SAMPLE_LIMIT = 24;

export function createFspmAuthorityDenialSummary(): FspmAuthorityDenialSummary {
  return { total: 0, byCode: {}, samples: [] };
}

export function recordFspmAuthorityDenial(
  summary: FspmAuthorityDenialSummary,
  intent: Intent,
  denial: DeniedFspmAuthority,
): void {
  summary.total += 1;
  summary.byCode[denial.code] = (summary.byCode[denial.code] ?? 0) + 1;
  if (summary.samples.length < AUTHORITY_DENIAL_SAMPLE_LIMIT) {
    summary.samples.push({
      code: denial.code,
      reason: denial.reason,
      intentType: intent.type,
      trace: intent.trace ? { ...intent.trace } : null,
    });
  }
}

export function mergeFspmAuthorityDenials(
  ...summaries: FspmAuthorityDenialSummary[]
): FspmAuthorityDenialSummary {
  const merged = createFspmAuthorityDenialSummary();
  for (const summary of summaries) {
    merged.total += summary.total;
    for (const [code, count] of Object.entries(summary.byCode)) {
      const denialCode = code as FspmAuthorityDenialCode;
      merged.byCode[denialCode] =
        (merged.byCode[denialCode] ?? 0) + (count ?? 0);
    }
    merged.samples.push(
      ...summary.samples
        .slice(0, AUTHORITY_DENIAL_SAMPLE_LIMIT - merged.samples.length)
        .map((sample) => ({
          ...sample,
          trace: sample.trace ? { ...sample.trace } : null,
        })),
    );
  }
  return merged;
}

function appendIndex<T>(index: Map<string, T[]>, id: string, value: T): void {
  const values = index.get(id);
  if (values) values.push(value);
  else index.set(id, [value]);
}

function roomNameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    room?: { name?: unknown };
    pos?: { roomName?: unknown };
  };
  if (typeof candidate.room?.name === "string") return candidate.room.name;
  return typeof candidate.pos?.roomName === "string"
    ? candidate.pos.roomName
    : undefined;
}

function targetIdOf(intent: Intent): string | undefined {
  switch (intent.type) {
    case "move":
    case "withdraw":
    case "transfer":
    case "build":
    case "repair":
    case "towerAttack":
      return String(intent.targetId);
    case "linkTransfer":
      return String(intent.targetLinkId);
    case "harvest":
      return String(intent.sourceId);
    case "upgrade":
      return String(intent.controllerId);
    case "spawn":
    case "createConstructionSite":
      return undefined;
  }
}

function validateIntentScope(
  intent: Intent,
  authority: ActiveFspmAuthority,
): FspmAuthorityResolution {
  const governedRoom = authority.roomName;

  if ("creepName" in intent) {
    const actor = Game.creeps[intent.creepName];
    const actorRoom = roomNameOf(actor);
    if (!actor || !actorRoom) {
      return denyAuthority(
        "scope_actor_missing",
        `${intent.type} actor ${intent.creepName} cannot be resolved to governed room ${governedRoom}`,
      );
    }
    if (actorRoom !== governedRoom) {
      return denyAuthority(
        "scope_actor_mismatch",
        `${intent.type} actor ${intent.creepName} is in ${actorRoom}, outside governed room ${governedRoom}`,
      );
    }
  }

  if (intent.type === "createConstructionSite") {
    if (intent.roomName !== governedRoom) {
      return denyAuthority(
        "scope_room_mismatch",
        `construction room ${intent.roomName} is outside governed room ${governedRoom}`,
      );
    }
    const room = Game.rooms[governedRoom];
    if (!room) {
      return denyAuthority(
        "scope_executor_missing",
        `construction room ${governedRoom} is not currently visible`,
      );
    }
    return room.controller?.my === true
      ? authority
      : denyAuthority(
          "scope_executor_mismatch",
          `construction room ${governedRoom} is not currently owned`,
        );
  }

  if (intent.type === "spawn") {
    const executor = Game.spawns[intent.spawnName];
    const executorRoom = roomNameOf(executor);
    if (!executor || !executorRoom) {
      return denyAuthority(
        "scope_executor_missing",
        `spawn executor ${intent.spawnName} cannot be resolved to governed room ${governedRoom}`,
      );
    }
    return executorRoom === governedRoom
      ? authority
      : denyAuthority(
          "scope_executor_mismatch",
          `spawn executor ${intent.spawnName} is in ${executorRoom}, outside governed room ${governedRoom}`,
        );
  }

  if (intent.type === "towerAttack") {
    const executor = Game.getObjectById(intent.towerId);
    const executorRoom = roomNameOf(executor);
    if (!executor || !executorRoom) {
      return denyAuthority(
        "scope_executor_missing",
        `tower executor ${intent.towerId} cannot be resolved to governed room ${governedRoom}`,
      );
    }
    if (executorRoom !== governedRoom || executor.my !== true) {
      return denyAuthority(
        "scope_executor_mismatch",
        `tower executor ${intent.towerId} is not an owned tower in governed room ${governedRoom}`,
      );
    }
  }

  if (intent.type === "linkTransfer") {
    const executor = Game.getObjectById(intent.linkId);
    const target = Game.getObjectById(intent.targetLinkId);
    const executorRoom = roomNameOf(executor);
    const targetRoom = roomNameOf(target);
    if (!executor || !executorRoom) {
      return denyAuthority(
        "scope_executor_missing",
        `link executor ${intent.linkId} cannot be resolved to governed room ${governedRoom}`,
      );
    }
    if (
      executorRoom !== governedRoom ||
      executor.my !== true ||
      executor.structureType !== STRUCTURE_LINK
    ) {
      return denyAuthority(
        "scope_executor_mismatch",
        `link executor ${intent.linkId} is not an owned link in governed room ${governedRoom}`,
      );
    }
    if (
      !target ||
      !targetRoom ||
      targetRoom !== governedRoom ||
      target.my !== true ||
      target.structureType !== STRUCTURE_LINK
    ) {
      return denyAuthority(
        "scope_target_mismatch",
        `link target ${intent.targetLinkId} is not an owned link in governed room ${governedRoom}`,
      );
    }
  }

  const targetId = targetIdOf(intent);
  if (!targetId) return authority;
  const target = (
    Game.getObjectById as unknown as (id: string) => RoomObject | null
  )(targetId);
  const targetRoom = roomNameOf(target);
  if (!target || !targetRoom) {
    return denyAuthority(
      "scope_target_missing",
      `${intent.type} target ${targetId} cannot be resolved to governed room ${governedRoom}`,
    );
  }
  return targetRoom === governedRoom
    ? authority
    : denyAuthority(
        "scope_target_mismatch",
        `${intent.type} target ${targetId} is in ${targetRoom}, outside governed room ${governedRoom}`,
      );
}

/**
 * Build one read-only authority view for the current tick. All hierarchy scans
 * happen here; proposal authorization and Activity binding reuse its indexes.
 */
export function createFspmAuthoritySnapshot(): FspmAuthoritySnapshot {
  let globalRegistryError: string | null = null;
  try {
    currentFspmPlanningAuthorityContext();
    if (planningAuthorityViolationTick === Game.time) {
      globalRegistryError =
        "globally indexed authority changed outside the trace materialization transaction";
    }
  } catch (error) {
    globalRegistryError =
      error instanceof Error ? error.message : String(error);
  }
  const snapshotPlanningRevision = planningAuthorityRevision;
  const snapshotTick = Game.time;
  const empireContainer = Memory.empireFspm;
  const empireP3 = empireContainer?.p3;
  const portfolios = new Map<string, IndexedPortfolio[]>();
  const stats = {
    colonies: 0,
    requirements: 0,
    deliverables: 0,
    tasks: 0,
    procedures: 0,
  };

  for (const [colonyStorageKey, colony] of Object.entries(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (!portfolio?.p3) continue;
    stats.colonies += 1;
    const indexed: IndexedPortfolio = {
      colonyStorageKey,
      colony,
      roomName: colony.roomName,
      portfolio,
      requirements: new Map(),
      deliverables: new Map(),
      tasks: new Map(),
    };
    for (const [domain, requirement] of Object.entries(
      portfolio.requirements,
    )) {
      if (!requirement) continue;
      stats.requirements += 1;
      appendIndex(indexed.requirements, requirement.id, [domain, requirement]);
    }
    for (const [domain, deliverable] of Object.entries(
      portfolio.deliverables,
    )) {
      if (!deliverable) continue;
      stats.deliverables += 1;
      appendIndex(indexed.deliverables, deliverable.id, [domain, deliverable]);
    }
    for (const [id, task] of Object.entries(portfolio.tasks)) {
      if (!task) continue;
      stats.tasks += 1;
      stats.procedures += task.procedures?.length ?? 0;
      const procedures = new Map<string, FspmProcedure[]>();
      const procedureIndexesById = new Map<string, number>();
      for (const [index, procedure] of (task.procedures ?? []).entries()) {
        appendIndex(procedures, procedure.id, procedure);
        procedureIndexesById.set(procedure.id, index);
      }
      appendIndex(indexed.tasks, task.id, {
        storageId: id,
        task,
        procedures,
        procedureArray: task.procedures,
        procedureIndexesById,
      });
    }
    appendIndex(portfolios, portfolio.p3.id, indexed);
  }

  const frozenStats = Object.freeze({ ...stats });

  const resolveTrace = (trace: IntentTrace): FspmAuthorityResolution => {
    if (
      Game.time !== snapshotTick ||
      Memory.empireFspm !== empireContainer ||
      Memory.empireFspm?.p3 !== empireP3
    ) {
      return denyAuthority(
        "snapshot_stale",
        `authority snapshot from tick ${snapshotTick} no longer matches the live hierarchy at tick ${Game.time}`,
      );
    }
    if (!trace.p3Id) {
      return denyAuthority(
        "trace_p3_missing",
        "current execution requires explicit Portfolio/P3 authority; legacy contract authority is historical only",
      );
    }

    if (!empireP3) {
      return denyAuthority(
        "empire_p3_missing",
        "root Empire Portfolio authority is missing",
      );
    }
    if (!isCanonicalEmpirePortfolioP3(empireP3)) {
      return denyAuthority(
        "empire_p3_mismatch",
        "root Empire Portfolio does not match the canonical root P3 identity and parentage",
      );
    }
    if (empireP3.status !== "active") {
      return denyAuthority(
        "empire_p3_inactive",
        `root Empire Portfolio is ${empireP3.status}, not active`,
      );
    }

    const portfolioMatches = portfolios.get(trace.p3Id) ?? [];
    if (portfolioMatches.length === 0) {
      return denyAuthority(
        "p3_missing",
        `Portfolio/P3 ${trace.p3Id} is missing`,
      );
    }
    if (portfolioMatches.length !== 1) {
      return denyAuthority(
        "p3_ambiguous",
        `Portfolio/P3 ${trace.p3Id} is not unique`,
      );
    }

    const indexed = portfolioMatches[0];
    if (!indexed) {
      return denyAuthority(
        "p3_missing",
        `Portfolio/P3 ${trace.p3Id} is missing`,
      );
    }
    const { portfolio } = indexed;
    if (
      Memory.colonies[indexed.colonyStorageKey] !== indexed.colony ||
      indexed.colony.fspm !== portfolio
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Portfolio/P3 ${trace.p3Id} was removed or replaced after the authority snapshot was built`,
      );
    }
    if (
      !isCanonicalColonyPortfolioP3(portfolio.p3, indexed.roomName) ||
      portfolio.p3.id !== trace.p3Id ||
      portfolio.p3.parentP3Id !== empireP3.id
    ) {
      return denyAuthority(
        "p3_mismatch",
        `Portfolio/P3 ${trace.p3Id} does not belong to the canonical Empire-to-colony P3 chain`,
      );
    }
    if (portfolio.p3.status !== "active") {
      return denyAuthority(
        "p3_inactive",
        `Portfolio/P3 ${trace.p3Id} is ${portfolio.p3.status}, not active`,
      );
    }

    const requirementMatches =
      indexed.requirements.get(trace.requirementId) ?? [];
    if (requirementMatches.length === 0) {
      return denyAuthority(
        "requirement_missing",
        `Requirement ${trace.requirementId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (requirementMatches.length !== 1) {
      return denyAuthority(
        "requirement_ambiguous",
        `Requirement ${trace.requirementId} is not unique within Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const requirementMatch = requirementMatches[0];
    if (!requirementMatch) {
      return denyAuthority(
        "requirement_missing",
        `Requirement ${trace.requirementId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const [requirementDomain, requirement] = requirementMatch;
    if (
      portfolio.requirements[requirementDomain as FspmDomain] !== requirement
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Requirement ${trace.requirementId} was removed or replaced after the authority snapshot was built`,
      );
    }
    if (
      requirement.id !== trace.requirementId ||
      requirement.kind !== "requirement" ||
      requirementDomain !== requirement.domain ||
      requirement.p3Id !== portfolio.p3.id
    ) {
      return denyAuthority(
        "requirement_mismatch",
        `Requirement ${trace.requirementId} does not belong exactly to Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (requirement.status !== "active") {
      return denyAuthority(
        "requirement_inactive",
        `Requirement ${trace.requirementId} is ${requirement.status}, not active`,
      );
    }

    const deliverableMatches =
      indexed.deliverables.get(trace.deliverableId) ?? [];
    if (deliverableMatches.length === 0) {
      return denyAuthority(
        "deliverable_missing",
        `Deliverable ${trace.deliverableId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (deliverableMatches.length !== 1) {
      return denyAuthority(
        "deliverable_ambiguous",
        `Deliverable ${trace.deliverableId} is not unique within Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const deliverableMatch = deliverableMatches[0];
    if (!deliverableMatch) {
      return denyAuthority(
        "deliverable_missing",
        `Deliverable ${trace.deliverableId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const [deliverableDomain, deliverable] = deliverableMatch;
    if (
      portfolio.deliverables[deliverableDomain as FspmDomain] !== deliverable
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Deliverable ${trace.deliverableId} was removed or replaced after the authority snapshot was built`,
      );
    }
    if (
      deliverable.id !== trace.deliverableId ||
      deliverable.kind !== "deliverable" ||
      deliverableDomain !== deliverable.domain ||
      deliverable.domain !== requirement.domain ||
      deliverable.p3Id !== portfolio.p3.id ||
      deliverable.requirementId !== requirement.id
    ) {
      return denyAuthority(
        "deliverable_mismatch",
        `Deliverable ${trace.deliverableId} does not belong exactly to Requirement ${trace.requirementId}`,
      );
    }
    if (deliverable.status !== "active") {
      return denyAuthority(
        "deliverable_inactive",
        `Deliverable ${trace.deliverableId} is ${deliverable.status}, not active`,
      );
    }

    const taskMatches = indexed.tasks.get(trace.taskId) ?? [];
    if (taskMatches.length === 0) {
      return denyAuthority(
        "task_missing",
        `Task ${trace.taskId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    if (taskMatches.length !== 1) {
      return denyAuthority(
        "task_ambiguous",
        `Task ${trace.taskId} is not unique within Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const taskMatch = taskMatches[0];
    if (!taskMatch) {
      return denyAuthority(
        "task_missing",
        `Task ${trace.taskId} is missing from Portfolio/P3 ${trace.p3Id}`,
      );
    }
    const {
      storageId: taskId,
      task,
      procedures,
      procedureArray,
      procedureIndexesById,
    } = taskMatch;
    if (portfolio.tasks[taskId] !== task) {
      return denyAuthority(
        "snapshot_stale",
        `Task ${trace.taskId} was removed or replaced after the authority snapshot was built`,
      );
    }
    const definition = fspmTaskDefinition(task.domain, task.taskKey);
    const canonicalTaskId = `task:${indexed.roomName}:${task.domain}:${task.taskKey}`;
    if (
      taskId !== task.id ||
      task.kind !== "task" ||
      task.domain !== deliverable.domain ||
      task.deliverableId !== deliverable.id
    ) {
      return denyAuthority(
        "task_mismatch",
        `Task ${trace.taskId} does not belong exactly to Deliverable ${trace.deliverableId}`,
      );
    }
    if (
      !definition ||
      task.id !== canonicalTaskId ||
      task.id !== trace.taskId
    ) {
      return denyAuthority(
        "task_catalog_mismatch",
        `Task ${trace.taskId} is not the exact canonical catalog Task identity for ${indexed.roomName}`,
      );
    }
    if (task.status !== "active") {
      return denyAuthority(
        "task_inactive",
        `Task ${trace.taskId} is ${task.status}, not active`,
      );
    }

    const procedureMatches = procedures.get(trace.procedureId) ?? [];
    if (procedureMatches.length === 0) {
      return denyAuthority(
        "procedure_missing",
        `Procedure ${trace.procedureId} is missing from Task ${trace.taskId}`,
      );
    }
    if (procedureMatches.length !== 1) {
      return denyAuthority(
        "procedure_ambiguous",
        `Procedure ${trace.procedureId} is not unique within Task ${trace.taskId}`,
      );
    }
    const procedure = procedureMatches[0];
    if (!procedure) {
      return denyAuthority(
        "procedure_missing",
        `Procedure ${trace.procedureId} is missing from Task ${trace.taskId}`,
      );
    }
    const liveProcedureIndex = procedureIndexesById.get(trace.procedureId);
    if (
      task.procedures !== procedureArray ||
      task.procedures.length !== procedures.size ||
      liveProcedureIndex === undefined ||
      task.procedures[liveProcedureIndex] !== procedure
    ) {
      return denyAuthority(
        "snapshot_stale",
        `Procedure ${trace.procedureId} was removed or replaced after the authority snapshot was built`,
      );
    }
    const procedureDefinition = fspmProcedureDefinition(
      task.domain,
      task.taskKey,
      procedure.procedureKey,
    );
    const canonicalProcedureId = `procedure:${indexed.roomName}:${task.domain}:${task.taskKey}:${procedure.procedureKey}`;
    if (procedure.taskId !== task.id) {
      return denyAuthority(
        "procedure_mismatch",
        `Procedure ${trace.procedureId} does not belong exactly to Task ${trace.taskId}`,
      );
    }
    if (!procedureDefinition || procedure.id !== canonicalProcedureId) {
      return denyAuthority(
        "procedure_catalog_mismatch",
        `Procedure ${trace.procedureId} is not the exact canonical catalog Procedure identity for Task ${trace.taskId}`,
      );
    }

    if (
      globalRegistryError !== null ||
      planningAuthorityRevision !== snapshotPlanningRevision ||
      planningAuthorityViolationTick === Game.time
    ) {
      return denyAuthority(
        "authority_registry_invalid",
        globalRegistryError ??
          "the global FSPM authority registry changed after the execution snapshot was built",
      );
    }

    return {
      authorized: true,
      roomName: indexed.roomName,
      portfolio,
      requirement,
      deliverable,
      task,
      procedure,
    };
  };

  const resolveIntent = (intent: Intent): FspmAuthorityResolution => {
    if (!intent.trace) {
      return denyAuthority(
        "trace_missing",
        `${intent.type} intent has no FSPM authority trace`,
      );
    }
    const resolution = resolveTrace(intent.trace);
    if (!resolution.authorized) return resolution;
    const procedureDefinition = fspmProcedureDefinition(
      resolution.task.domain,
      resolution.task.taskKey,
      resolution.procedure.procedureKey,
    );
    if (!procedureDefinition?.allowedIntentTypes.includes(intent.type)) {
      return denyAuthority(
        "intent_type_mismatch",
        `Procedure ${resolution.procedure.id} does not authorize ${intent.type} intents`,
      );
    }
    return validateIntentScope(intent, resolution);
  };

  return Object.freeze({
    tick: snapshotTick,
    stats: frozenStats,
    resolveTrace,
    resolveIntent,
  });
}

/** Resolve against an explicit tick snapshot when available. */
export function resolveActiveFspmAuthority(
  trace: IntentTrace,
  snapshot: FspmAuthoritySnapshot = createFspmAuthoritySnapshot(),
): FspmAuthorityResolution {
  return snapshot.resolveTrace(trace);
}

export function validateFspmIntentAuthority(
  intent: Intent,
  snapshot: FspmAuthoritySnapshot = createFspmAuthoritySnapshot(),
): FspmAuthorityResolution {
  return snapshot.resolveIntent(intent);
}

export function authorizedFspmIntents(
  intents: Intent[],
  snapshot: FspmAuthoritySnapshot = createFspmAuthoritySnapshot(),
): AuthorizedFspmIntentBatch {
  const accepted: Intent[] = [];
  const denied = createFspmAuthorityDenialSummary();
  for (const intent of intents) {
    const resolution = snapshot.resolveIntent(intent);
    if (resolution.authorized) {
      accepted.push(intent);
      continue;
    }
    recordFspmAuthorityDenial(denied, intent, resolution);
  }
  return { accepted, denied, snapshot };
}

const recurringAuthorityCriterion =
  "remain active while the recurring obligation is authorized; closure requires a separately governed superseding decision";

function deliverableAuthorityCriterion(
  deliverableType: FspmDeliverableType,
): string {
  return deliverableType === "service"
    ? "remain active while the recurring service is authorized; accepted receipts close service occurrences, not the Deliverable definition"
    : "definition completion requires a separately governed closure event";
}

function earliestKnownColonyTick(): number {
  const discovered = Object.values(Memory.colonies).map(
    (colony) => colony.discoveredAt,
  );
  return discovered.length > 0 ? Math.min(...discovered) : Game.time;
}

function assertUniqueRegistryIds(
  label: string,
  ids: Map<string, string[]>,
): void {
  for (const [id, placements] of ids) {
    if (placements.length > 1) {
      throw new Error(
        `FSPM identity registry is ambiguous: ${label} ${id} appears at ${placements.join(", ")}`,
      );
    }
  }
}

export interface FspmPlanningAuthorityDiagnostics {
  readonly globalRegistryTraversals: number;
  readonly traceAuthorityChecks: number;
}

interface FspmPlanningTaskWitness {
  storageId: string;
  task: ColonyTask;
  procedures: FspmProcedure[];
  proceduresById: Map<string, FspmProcedure>;
  procedureIndexesById: Map<string, number>;
}

interface FspmPlanningRoomWitness {
  colony: Memory["colonies"][string];
  portfolio: ColonyFspmPortfolio | undefined;
  p3: ColonyPortfolioP3 | undefined;
  requirements: ColonyFspmPortfolio["requirements"] | undefined;
  deliverables: ColonyFspmPortfolio["deliverables"] | undefined;
  tasks: ColonyFspmPortfolio["tasks"] | undefined;
  requirementsByDomain: Map<string, ColonyRequirement>;
  deliverablesByDomain: Map<string, ColonyDeliverable>;
  tasksById: Map<string, FspmPlanningTaskWitness>;
}

interface FspmPlanningAuthorityContext {
  tick: number;
  memory: Memory;
  colonies: Memory["colonies"];
  empire: Memory["empireFspm"];
  empireP3: EmpirePortfolioP3 | undefined;
  revision: number;
  rooms: Map<string, FspmPlanningRoomWitness>;
}

const planningAuthorityDiagnostics = {
  globalRegistryTraversals: 0,
  traceAuthorityChecks: 0,
};

let planningAuthorityRevision = 0;
let traceCreationDepth = 0;
let planningAuthorityContext: FspmPlanningAuthorityContext | undefined;
let planningAuthorityGuardTick: number | undefined;
let planningAuthorityViolationTick: number | undefined;
let planningAuthorityGuardMemory: Memory | undefined;
let planningAuthorityViolationCheckedRevision: number | undefined;
let planningAuthorityViolationError: string | undefined;
let controlledAuthorityMutationDepth = 0;

const guardedAuthorityProperties = new WeakMap<object, Set<PropertyKey>>();
const guardedProcedureArrays = new WeakSet<FspmProcedure[]>();
const guardedAuthorityPortfolios = new WeakSet<ColonyFspmPortfolio>();
const guardedAuthorityTasks = new WeakSet<ColonyTask>();
const fspmDomains = [
  "economy",
  "spawning",
  "construction",
  "defense",
] as const satisfies readonly FspmDomain[];

/** Read-only counters used to prove planner authority work scales linearly. */
export function getFspmPlanningAuthorityDiagnostics(): FspmPlanningAuthorityDiagnostics {
  return Object.freeze({ ...planningAuthorityDiagnostics });
}

function invalidateFspmPlanningAuthorityContext(): void {
  if (traceCreationDepth > 0) return;
  planningAuthorityRevision += 1;
  planningAuthorityContext = undefined;
}

/**
 * Replace last tick's guarded authority containers with equivalent plain,
 * extensible containers before perception can discover a new colony. Screeps
 * normally rehydrates Memory between ticks; the explicit release also keeps
 * persistent-VM harnesses and same-process tests correct.
 */
export function prepareFspmPlanningTick(): void {
  if (
    planningAuthorityGuardMemory !== undefined &&
    planningAuthorityGuardMemory !== Memory
  ) {
    planningAuthorityGuardMemory = undefined;
    planningAuthorityGuardTick = undefined;
    planningAuthorityViolationTick = undefined;
    planningAuthorityViolationCheckedRevision = undefined;
    planningAuthorityViolationError = undefined;
    planningAuthorityRevision += 1;
    planningAuthorityContext = undefined;
    return;
  }
  if (
    planningAuthorityGuardTick === undefined ||
    planningAuthorityGuardTick === Game.time
  ) {
    return;
  }

  if (Memory.empireFspm) {
    const empire = { ...Memory.empireFspm };
    if (Memory.empireFspm.p3) empire.p3 = { ...Memory.empireFspm.p3 };
    Memory.empireFspm = empire;
  }

  Memory.colonies = Object.fromEntries(
    Object.entries(Memory.colonies).map(([roomName, colony]) => {
      const portfolio = colony.fspm;
      if (!portfolio) return [roomName, { ...colony }];

      const requirements = Object.fromEntries(
        Object.entries(portfolio.requirements).map(([domain, requirement]) => [
          domain,
          requirement ? { ...requirement } : requirement,
        ]),
      ) as ColonyFspmPortfolio["requirements"];
      const deliverables = Object.fromEntries(
        Object.entries(portfolio.deliverables).map(([domain, deliverable]) => [
          domain,
          deliverable
            ? {
                ...deliverable,
                evaluationFactors: { ...deliverable.evaluationFactors },
                receiptValidation: { ...deliverable.receiptValidation },
                servicePrincipalAcceptance: {
                  ...deliverable.servicePrincipalAcceptance,
                  acceptedKpiRatings: [
                    ...deliverable.servicePrincipalAcceptance
                      .acceptedKpiRatings,
                  ],
                },
                childDeliverableIds: [...deliverable.childDeliverableIds],
              }
            : deliverable,
        ]),
      ) as ColonyFspmPortfolio["deliverables"];
      const tasks = Object.fromEntries(
        Object.entries(portfolio.tasks).flatMap(([taskId, task]) =>
          task
            ? [
                [
                  taskId,
                  {
                    ...task,
                    procedures: task.procedures.map((procedure) => ({
                      ...procedure,
                    })),
                  },
                ] as const,
              ]
            : [],
        ),
      );

      const nextPortfolio = {
        ...portfolio,
        requirements,
        deliverables,
        tasks,
        ...(portfolio.governanceBinding
          ? { governanceBinding: { ...portfolio.governanceBinding } }
          : {}),
        requirementApprovalLedger: Object.fromEntries(
          Object.entries(portfolio.requirementApprovalLedger ?? {}).map(
            ([eventId, event]) => [eventId, { ...event }],
          ),
        ),
        deliverableReceipts: Object.fromEntries(
          Object.entries(portfolio.deliverableReceipts ?? {}).map(
            ([receiptId, receipt]) => [receiptId, { ...receipt }],
          ),
        ),
        deliverableReceiptDecisions: Object.fromEntries(
          Object.entries(portfolio.deliverableReceiptDecisions ?? {}).map(
            ([decisionId, decision]) => [decisionId, { ...decision }],
          ),
        ),
        authorityLifecycleLedger: Object.fromEntries(
          Object.entries(portfolio.authorityLifecycleLedger ?? {}).map(
            ([eventId, event]) => [eventId, { ...event }],
          ),
        ),
        ...(portfolio.authorityLedgerAnchors
          ? {
              authorityLedgerAnchors: {
                deliverableReceipts: {
                  ...portfolio.authorityLedgerAnchors.deliverableReceipts,
                },
                deliverableReceiptDecisions: {
                  ...portfolio.authorityLedgerAnchors
                    .deliverableReceiptDecisions,
                },
                authorityLifecycle: {
                  ...portfolio.authorityLedgerAnchors.authorityLifecycle,
                },
              },
            }
          : {}),
      };
      if (portfolio.p3) nextPortfolio.p3 = { ...portfolio.p3 };
      return [roomName, { ...colony, fspm: nextPortfolio }];
    }),
  );
  planningAuthorityGuardTick = undefined;
  planningAuthorityViolationTick = undefined;
  planningAuthorityViolationCheckedRevision = undefined;
  planningAuthorityViolationError = undefined;
  planningAuthorityGuardMemory = undefined;
  planningAuthorityRevision += 1;
  planningAuthorityContext = undefined;
}

function recordGuardedAuthorityMutation(): void {
  if (traceCreationDepth > 0 || controlledAuthorityMutationDepth > 0) return;
  if (planningAuthorityGuardTick === Game.time) {
    planningAuthorityViolationTick = Game.time;
    planningAuthorityViolationCheckedRevision = undefined;
    planningAuthorityViolationError = undefined;
  }
  invalidateFspmPlanningAuthorityContext();
}

function controlledAuthorityMutation<T>(operation: () => T): T {
  controlledAuthorityMutationDepth += 1;
  try {
    return operation();
  } finally {
    controlledAuthorityMutationDepth -= 1;
  }
}

function guardAuthorityProperty(
  target: object,
  key: PropertyKey,
  enumerableWhenMissing = true,
): void {
  let guarded = guardedAuthorityProperties.get(target);
  if (!guarded) {
    guarded = new Set();
    guardedAuthorityProperties.set(target, guarded);
  }
  if (guarded.has(key)) return;

  const record = target as Record<PropertyKey, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && descriptor.configurable === false) return;
  let value = record[key];
  const enumerable = descriptor?.enumerable ?? enumerableWhenMissing;
  guarded.add(key);

  const defineGuard = (): void => {
    Object.defineProperty(target, key, {
      configurable: false,
      enumerable,
      get: () => value,
      set: (next: unknown) => {
        if (Object.is(next, value)) return;
        value = next;
        recordGuardedAuthorityMutation();
      },
    });
  };
  defineGuard();
}

function guardAuthorityFields(
  record: object,
  fields: readonly PropertyKey[],
): void {
  for (const field of fields) guardAuthorityProperty(record, field);
}

function guardProcedureArray(procedures: FspmProcedure[]): void {
  if (guardedProcedureArrays.has(procedures)) return;
  guardedProcedureArrays.add(procedures);
  for (const index of procedures.keys()) {
    guardAuthorityProperty(procedures, index);
  }
  for (const method of [
    "copyWithin",
    "fill",
    "pop",
    "push",
    "reverse",
    "shift",
    "sort",
    "splice",
    "unshift",
  ] as const) {
    Object.defineProperty(procedures, method, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function guardedProcedureMutation(
        this: FspmProcedure[],
        ...args: unknown[]
      ) {
        recordGuardedAuthorityMutation();
        const result = (
          Array.prototype[method] as (...values: unknown[]) => unknown
        ).apply(this, args);
        return result;
      },
    });
  }
}

function guardTaskAuthority(task: ColonyTask): void {
  if (guardedAuthorityTasks.has(task)) return;
  guardedAuthorityTasks.add(task);
  guardAuthorityFields(task, [
    "kind",
    "id",
    "deliverableId",
    "domain",
    "taskKey",
    "title",
    "description",
    "taskWeight",
    "status",
    "statusReason",
    "qualityDescription",
    "qualityMetric",
    "kpiMetric",
    "determination",
    "procedures",
    "createdAt",
    "updatedAt",
    "retiredAt",
  ]);
  guardAuthorityFields(task.kpiMetric, Object.keys(task.kpiMetric));
  Object.preventExtensions(task.kpiMetric);
  if (task.determination) {
    guardAuthorityFields(task.determination, Object.keys(task.determination));
    Object.preventExtensions(task.determination);
  }
  guardProcedureArray(task.procedures);
  for (const procedure of task.procedures) {
    guardAuthorityFields(procedure, ["id", "taskId", "procedureKey", "title"]);
  }

  const definition = fspmTaskDefinition(task.domain, task.taskKey);
  const procedureIds = new Set(
    task.procedures.map((procedure) => procedure.id),
  );
  const hasCompleteCanonicalProcedureSet =
    definition !== undefined &&
    task.procedures.length === definition.procedures.length &&
    definition.procedures.every((procedure) =>
      procedureIds.has(
        `procedure:${task.id.slice("task:".length)}:${procedure.key}`,
      ),
    );
  if (hasCompleteCanonicalProcedureSet) {
    Object.preventExtensions(task.procedures);
  }
}

function guardPortfolioAuthority(
  roomName: string,
  portfolio: ColonyFspmPortfolio,
): void {
  if (guardedAuthorityPortfolios.has(portfolio)) return;
  guardedAuthorityPortfolios.add(portfolio);
  guardAuthorityProperty(portfolio, "p3");
  guardAuthorityProperty(portfolio, "requirements");
  guardAuthorityProperty(portfolio, "deliverables");
  guardAuthorityProperty(portfolio, "tasks");
  guardAuthorityProperty(portfolio, "governanceBinding");
  guardAuthorityProperty(portfolio, "requirementApprovalLedger");
  guardAuthorityProperty(portfolio, "deliverableReceipts");
  guardAuthorityProperty(portfolio, "deliverableReceiptDecisions");
  guardAuthorityProperty(portfolio, "authorityLifecycleLedger");
  guardAuthorityProperty(portfolio, "authorityLedgerAnchors");
  guardAuthorityFields(portfolio.p3, [
    "id",
    "type",
    "subType",
    "name",
    "description",
    "roomName",
    "parentP3Id",
    "temporalBasis",
    "startTick",
    "status",
  ]);

  for (const domain of fspmDomains) {
    const requirement = portfolio.requirements[domain];
    guardAuthorityProperty(portfolio.requirements, domain, true);
    if (requirement) {
      guardAuthorityFields(requirement, [
        "kind",
        "id",
        "p3Id",
        "domain",
        "status",
        "revision",
        "approvedContentHash",
        "title",
        "completionCriterion",
        "requestorId",
        "requirementTrigger",
        "requirementSource",
        "originatingAuthority",
        "requirementVerbiage",
        "purposeStatement",
        "strategicPriority",
        "strategicAlignment",
        "applicableOuId",
        "desiredOutcomes",
        "businessCase",
        "approvalAuthorityOuId",
        "approval",
        "approvalEventId",
        "approvedBy",
        "approvalSignature",
        "dateApproved",
        "createdBy",
        "modifiedBy",
        "statusReason",
        "createdAt",
        "updatedAt",
        "completedAt",
        "retiredAt",
        "reopenedAt",
      ]);
    }

    const deliverable = portfolio.deliverables[domain];
    guardAuthorityProperty(portfolio.deliverables, domain, true);
    if (deliverable) {
      guardAuthorityFields(deliverable, [
        "kind",
        "id",
        "p3Id",
        "requirementId",
        "domain",
        "status",
        "revision",
        "approvedContentHash",
        "title",
        "completionCriterion",
        "category",
        "deliverableType",
        "details",
        "output",
        "requirementSource",
        "requirementVerbiage",
        "evaluationFactors",
        "qualityDescription",
        "qualityMetric",
        "receiptValidation",
        "servicePrincipalAcceptance",
        "siblingWeightBasisPoints",
        "parentDeliverableId",
        "childDeliverableIds",
        "statusReason",
        "createdAt",
        "updatedAt",
        "completedAt",
        "retiredAt",
        "reopenedAt",
      ]);
      Object.freeze(deliverable.evaluationFactors);
      Object.freeze(deliverable.receiptValidation);
      Object.freeze(deliverable.servicePrincipalAcceptance.acceptedKpiRatings);
      Object.freeze(deliverable.servicePrincipalAcceptance);
      Object.freeze(deliverable.childDeliverableIds);
    }
  }

  if (portfolio.governanceBinding) {
    guardAuthorityFields(portfolio.governanceBinding, [
      "schema",
      "authorityPackageId",
      "authorityPackageRevision",
      "authorityPackageHash",
      "governanceSha",
      "effectiveDate",
      "importedAtTick",
      "issuerPrincipalId",
      "departmentOuId",
      "departmentCode",
      "accountablePositionId",
      "accountablePrincipalId",
      "activationReceiptHash",
    ]);
    Object.preventExtensions(portfolio.governanceBinding);
  }
  for (const [eventId, event] of Object.entries(
    portfolio.requirementApprovalLedger ?? {},
  )) {
    guardAuthorityProperty(
      portfolio.requirementApprovalLedger as Record<string, unknown>,
      eventId,
    );
    guardAuthorityFields(event, Object.keys(event));
    Object.preventExtensions(event);
  }
  if (portfolio.requirementApprovalLedger) {
    Object.preventExtensions(portfolio.requirementApprovalLedger);
  }
  for (const [receiptId, receipt] of Object.entries(
    portfolio.deliverableReceipts ?? {},
  )) {
    guardAuthorityProperty(
      portfolio.deliverableReceipts as Record<string, unknown>,
      receiptId,
    );
    guardAuthorityFields(receipt, Object.keys(receipt));
    Object.preventExtensions(receipt);
  }
  if (portfolio.deliverableReceipts) {
    Object.preventExtensions(portfolio.deliverableReceipts);
  }
  for (const [decisionId, decision] of Object.entries(
    portfolio.deliverableReceiptDecisions ?? {},
  )) {
    guardAuthorityProperty(
      portfolio.deliverableReceiptDecisions as Record<string, unknown>,
      decisionId,
    );
    guardAuthorityFields(decision, Object.keys(decision));
    Object.preventExtensions(decision);
  }
  if (portfolio.deliverableReceiptDecisions) {
    Object.preventExtensions(portfolio.deliverableReceiptDecisions);
  }
  for (const [eventId, event] of Object.entries(
    portfolio.authorityLifecycleLedger ?? {},
  )) {
    guardAuthorityProperty(
      portfolio.authorityLifecycleLedger as Record<string, unknown>,
      eventId,
    );
    guardAuthorityFields(event, Object.keys(event));
    Object.preventExtensions(event);
  }
  if (portfolio.authorityLifecycleLedger) {
    Object.preventExtensions(portfolio.authorityLifecycleLedger);
  }
  if (portfolio.authorityLedgerAnchors) {
    guardAuthorityFields(
      portfolio.authorityLedgerAnchors,
      Object.keys(portfolio.authorityLedgerAnchors),
    );
    for (const anchor of Object.values(portfolio.authorityLedgerAnchors)) {
      guardAuthorityFields(anchor, ["count", "headHash"]);
      Object.preventExtensions(anchor);
    }
    Object.preventExtensions(portfolio.authorityLedgerAnchors);
  }

  for (const definition of FSPM_TASK_CATALOG) {
    const taskId = `task:${roomName}:${definition.domain}:${definition.taskKey}`;
    guardAuthorityProperty(portfolio.tasks, taskId, true);
  }
  for (const task of Object.values(portfolio.tasks)) {
    if (task) guardTaskAuthority(task);
  }

  Object.preventExtensions(portfolio.requirements);
  Object.preventExtensions(portfolio.deliverables);
  Object.preventExtensions(portfolio.tasks);
}

function installFspmAuthorityMutationGuards(): void {
  guardAuthorityProperty(Memory, "empireFspm");
  if (Memory.empireFspm) {
    guardAuthorityProperty(Memory.empireFspm, "p3");
    guardAuthorityFields(Memory.empireFspm.p3, [
      "id",
      "type",
      "subType",
      "name",
      "description",
      "parentP3Id",
      "temporalBasis",
      "startTick",
      "status",
    ]);
  }

  for (const [roomName, colony] of Object.entries(Memory.colonies)) {
    guardAuthorityProperty(Memory.colonies, roomName);
    guardAuthorityProperty(colony, "fspm");
    if (colony.fspm) guardPortfolioAuthority(roomName, colony.fspm);
  }
  Object.preventExtensions(Memory.colonies);
  planningAuthorityGuardTick = Game.time;
  planningAuthorityGuardMemory = Memory;
}

function guardMaterializedAuthoritySpine(
  roomName: string,
  portfolio: ColonyFspmPortfolio,
  requirement: ColonyRequirement,
  deliverable: ColonyDeliverable,
  task: ColonyTask,
  procedure: FspmProcedure,
): void {
  guardAuthorityProperty(Memory, "empireFspm");
  if (Memory.empireFspm) {
    guardAuthorityProperty(Memory.empireFspm, "p3");
    guardAuthorityFields(Memory.empireFspm.p3, [
      "id",
      "type",
      "subType",
      "name",
      "description",
      "parentP3Id",
      "temporalBasis",
      "startTick",
      "status",
    ]);
  }
  const colony = Memory.colonies[roomName];
  if (colony) guardAuthorityProperty(colony, "fspm");

  if (!guardedAuthorityPortfolios.has(portfolio)) {
    guardPortfolioAuthority(roomName, portfolio);
    return;
  }
  guardAuthorityFields(requirement, ["kind", "id", "p3Id", "domain", "status"]);
  guardAuthorityFields(deliverable, [
    "kind",
    "id",
    "p3Id",
    "requirementId",
    "domain",
    "status",
  ]);
  guardTaskAuthority(task);
  guardAuthorityFields(procedure, ["id", "taskId", "procedureKey"]);
}

/**
 * Validate and index every persisted authority identity before planner ensure
 * paths mutate Memory. The returned witnesses retain live object references so
 * later trace requests can validate only their requested authority spine.
 */
function buildFspmPlanningAuthorityContext(): FspmPlanningAuthorityContext {
  prepareFspmPlanningTick();
  planningAuthorityDiagnostics.globalRegistryTraversals += 1;
  if (Memory.empireFspm && !Memory.empireFspm.p3) {
    throw new Error(
      "FSPM Empire authority container is missing its required root P3; refusing implicit approval",
    );
  }
  const empireP3 = Memory.empireFspm?.p3;
  if (empireP3 && !isActiveCanonicalEmpirePortfolioP3(empireP3)) {
    throw new Error(
      "FSPM Empire Portfolio identity is not canonical or active",
    );
  }

  const registries = {
    p3: new Map<string, string[]>(),
    requirement: new Map<string, string[]>(),
    deliverable: new Map<string, string[]>(),
    task: new Map<string, string[]>(),
    procedure: new Map<string, string[]>(),
  };
  const rooms = new Map<string, FspmPlanningRoomWitness>();
  const record = (
    index: Map<string, string[]>,
    id: string,
    placement: string,
  ) => {
    const placements = index.get(id);
    if (placements) placements.push(placement);
    else index.set(id, [placement]);
  };

  for (const [colonyKey, colony] of Object.entries(Memory.colonies)) {
    if (colonyKey !== colony.roomName) {
      throw new Error(
        `FSPM identity registry colony key ${colonyKey} disagrees with roomName ${colony.roomName}`,
      );
    }
    const portfolio = colony.fspm;
    const roomWitness: FspmPlanningRoomWitness = {
      colony,
      portfolio,
      p3: portfolio?.p3,
      requirements: portfolio?.requirements,
      deliverables: portfolio?.deliverables,
      tasks: portfolio?.tasks,
      requirementsByDomain: new Map(),
      deliverablesByDomain: new Map(),
      tasksById: new Map(),
    };
    rooms.set(colonyKey, roomWitness);
    if (!portfolio) continue;
    if (!portfolio.p3) {
      throw new Error(
        `FSPM colony authority container ${colonyKey} is missing its required root P3; refusing implicit approval`,
      );
    }
    const expectedP3Id = `portfolio:colony:${colony.roomName}`;
    record(registries.p3, portfolio.p3.id, `${colonyKey}.p3`);
    if (!isActiveCanonicalColonyPortfolioP3(portfolio.p3, colony.roomName)) {
      throw new Error(
        `FSPM colony Portfolio identity is not canonical or active at ${colonyKey}.p3`,
      );
    }
    const governanceErrors = validateColonyGovernanceAuthority(portfolio);
    if (governanceErrors.length > 0) {
      throw new Error(
        `FSPM colony governance is invalid at ${colonyKey}: ${governanceErrors.join("; ")}`,
      );
    }

    for (const [registryKey, requirement] of Object.entries(
      portfolio.requirements,
    )) {
      if (!requirement) continue;
      record(
        registries.requirement,
        requirement.id,
        `${colonyKey}.requirements.${registryKey}`,
      );
      if (
        registryKey !== requirement.domain ||
        requirement.id !==
          `requirement:${colony.roomName}:${requirement.domain}` ||
        requirement.p3Id !== expectedP3Id
      ) {
        throw new Error(
          `FSPM Requirement identity is not canonical at ${colonyKey}.requirements.${registryKey}`,
        );
      }
      roomWitness.requirementsByDomain.set(requirement.domain, requirement);
    }

    for (const [registryKey, deliverable] of Object.entries(
      portfolio.deliverables,
    )) {
      if (!deliverable) continue;
      record(
        registries.deliverable,
        deliverable.id,
        `${colonyKey}.deliverables.${registryKey}`,
      );
      if (
        registryKey !== deliverable.domain ||
        deliverable.id !==
          `deliverable:${colony.roomName}:${deliverable.domain}` ||
        deliverable.p3Id !== expectedP3Id ||
        deliverable.requirementId !==
          `requirement:${colony.roomName}:${deliverable.domain}`
      ) {
        throw new Error(
          `FSPM Deliverable identity is not canonical at ${colonyKey}.deliverables.${registryKey}`,
        );
      }
      roomWitness.deliverablesByDomain.set(deliverable.domain, deliverable);
    }

    for (const [storageId, task] of Object.entries(portfolio.tasks)) {
      if (!task) continue;
      const expectedTaskId = `task:${colony.roomName}:${task.domain}:${task.taskKey}`;
      record(registries.task, task.id, `${colonyKey}.tasks.${storageId}`);
      if (
        storageId !== task.id ||
        task.id !== expectedTaskId ||
        task.deliverableId !== `deliverable:${colony.roomName}:${task.domain}`
      ) {
        throw new Error(
          `FSPM Task identity is not canonical at ${colonyKey}.tasks.${storageId}`,
        );
      }
      const taskWitness: FspmPlanningTaskWitness = {
        storageId,
        task,
        procedures: task.procedures,
        proceduresById: new Map(),
        procedureIndexesById: new Map(),
      };
      roomWitness.tasksById.set(task.id, taskWitness);
      const definition = fspmTaskDefinition(task.domain, task.taskKey);
      if (
        task.status === "active" &&
        definition &&
        task.procedures.length !== definition.procedures.length
      ) {
        throw new Error(
          `FSPM Task ${task.id} does not contain the exact canonical Procedure set`,
        );
      }
      for (const [procedureIndex, procedure] of task.procedures.entries()) {
        const catalogProcedure = definition?.procedures[procedureIndex];
        const expectedProcedureKey =
          task.status === "active" && definition
            ? catalogProcedure?.key
            : procedure.procedureKey;
        const expectedProcedureId = `procedure:${colony.roomName}:${task.domain}:${task.taskKey}:${expectedProcedureKey}`;
        record(
          registries.procedure,
          procedure.id,
          `${colonyKey}.tasks.${storageId}.procedures.${procedureIndex}`,
        );
        if (
          !expectedProcedureKey ||
          procedure.procedureKey !== expectedProcedureKey ||
          procedure.id !== expectedProcedureId ||
          procedure.taskId !== task.id
        ) {
          throw new Error(
            `FSPM Procedure identity is not canonical at ${colonyKey}.tasks.${storageId}.procedures.${procedureIndex}`,
          );
        }
        taskWitness.proceduresById.set(procedure.id, procedure);
        taskWitness.procedureIndexesById.set(procedure.id, procedureIndex);
      }
    }
  }

  assertUniqueRegistryIds("Portfolio/P3", registries.p3);
  assertUniqueRegistryIds("Requirement", registries.requirement);
  assertUniqueRegistryIds("Deliverable", registries.deliverable);
  assertUniqueRegistryIds("Task", registries.task);
  assertUniqueRegistryIds("Procedure", registries.procedure);
  installFspmAuthorityMutationGuards();

  return {
    tick: Game.time,
    memory: Memory,
    colonies: Memory.colonies,
    empire: Memory.empireFspm,
    empireP3: Memory.empireFspm?.p3,
    revision: planningAuthorityRevision,
    rooms,
  };
}

function currentFspmPlanningAuthorityContext(): FspmPlanningAuthorityContext {
  prepareFspmPlanningTick();
  if (planningAuthorityViolationTick === Game.time) {
    if (
      planningAuthorityViolationCheckedRevision === planningAuthorityRevision
    ) {
      throw new Error(
        planningAuthorityViolationError ??
          "Cannot create FSPM trace: globally indexed authority changed outside the trace materialization transaction",
      );
    }
    try {
      const context = buildFspmPlanningAuthorityContext();
      planningAuthorityContext = context;
      planningAuthorityViolationCheckedRevision = planningAuthorityRevision;
      planningAuthorityViolationError =
        "Cannot create FSPM trace: globally indexed authority changed outside the trace materialization transaction";
      return context;
    } catch (error) {
      planningAuthorityViolationCheckedRevision = planningAuthorityRevision;
      planningAuthorityViolationError =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  const cached = planningAuthorityContext;
  if (
    cached &&
    cached.tick === Game.time &&
    cached.memory === Memory &&
    cached.revision === planningAuthorityRevision
  ) {
    if (
      cached.colonies !== Memory.colonies ||
      cached.empire !== Memory.empireFspm ||
      cached.empireP3 !== Memory.empireFspm?.p3
    ) {
      throw new Error(
        "Cannot create FSPM trace: authority containers changed after the tick index was built",
      );
    }
    return cached;
  }

  const context = buildFspmPlanningAuthorityContext();
  planningAuthorityContext = context;
  return context;
}

function planningRoomWitness(roomName: string): {
  context: FspmPlanningAuthorityContext;
  witness: FspmPlanningRoomWitness;
} {
  const context = currentFspmPlanningAuthorityContext();
  const colony = Memory.colonies[roomName];
  const witness = context.rooms.get(roomName);
  if (!colony) {
    throw new Error(`Cannot create FSPM trace for unknown colony ${roomName}`);
  }

  if (!witness) {
    throw new Error(
      `Cannot create FSPM trace: colony ${roomName} changed during authority indexing`,
    );
  }
  if (
    witness.colony !== colony ||
    witness.portfolio !== colony.fspm ||
    witness.p3 !== colony.fspm?.p3 ||
    witness.requirements !== colony.fspm?.requirements ||
    witness.deliverables !== colony.fspm?.deliverables ||
    witness.tasks !== colony.fspm?.tasks
  ) {
    throw new Error(
      `Cannot create FSPM trace: colony ${roomName} authority containers changed after the tick index was built`,
    );
  }
  return { context, witness };
}

/**
 * Planner-side read-only guard. If any existing authority record for the
 * requested canonical spine is inactive or contradictory, trace creation must
 * throw before compatibility/defaulting code can touch Memory.
 */
export function assertFspmTraceCreationAllowed(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): void {
  planningAuthorityDiagnostics.traceAuthorityChecks += 1;
  requireFspmTaskDefinition(domain, taskKey);
  if (!fspmProcedureDefinition(domain, taskKey, procedureKey)) {
    throw new Error(
      `Unknown FSPM Procedure ${domain}:${taskKey}:${procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }

  const { context, witness } = planningRoomWitness(roomName);
  const assertNoOutOfBandMutation = (): void => {
    if (planningAuthorityViolationTick === Game.time) {
      throw new Error(
        "Cannot create FSPM trace: globally indexed authority changed outside the trace materialization transaction",
      );
    }
  };
  const empire = context.empireP3;
  if (empire && !isCanonicalEmpirePortfolioP3(empire)) {
    throw new Error(
      "Cannot create FSPM trace: Empire Portfolio identity is not canonical",
    );
  }
  if (empire && empire.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Empire Portfolio is ${empire.status}`,
    );
  }
  const portfolio = witness.portfolio;
  if (!portfolio) {
    throw new Error(
      `Cannot create FSPM trace: colony ${roomName} has no approved governance package`,
    );
  }
  if (!isCanonicalColonyPortfolioP3(portfolio.p3, roomName)) {
    throw new Error(
      "Cannot create FSPM trace: colony Portfolio identity is not canonical",
    );
  }
  if (portfolio.p3.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: colony Portfolio is ${portfolio.p3.status}`,
    );
  }
  const requirement = portfolio.requirements[domain];
  if (requirement !== witness.requirementsByDomain.get(domain)) {
    throw new Error(
      "Cannot create FSPM trace: Requirement changed after the tick index was built",
    );
  }
  if (
    requirement &&
    (requirement.kind !== "requirement" ||
      requirement.id !== `requirement:${roomName}:${domain}` ||
      requirement.p3Id !== portfolio.p3.id ||
      requirement.domain !== domain)
  ) {
    throw new Error(
      "Cannot create FSPM trace: Requirement identity is not canonical",
    );
  }
  if (!requirement) {
    throw new Error(
      `Cannot create FSPM trace: approved ${domain} Requirement is missing`,
    );
  }
  if (requirement && requirement.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Requirement is ${requirement.status}`,
    );
  }
  const deliverable = portfolio.deliverables[domain];
  if (deliverable !== witness.deliverablesByDomain.get(domain)) {
    throw new Error(
      "Cannot create FSPM trace: Deliverable changed after the tick index was built",
    );
  }
  if (
    deliverable &&
    (deliverable.kind !== "deliverable" ||
      deliverable.id !== `deliverable:${roomName}:${domain}` ||
      deliverable.p3Id !== portfolio.p3.id ||
      deliverable.requirementId !== `requirement:${roomName}:${domain}` ||
      deliverable.domain !== domain)
  ) {
    throw new Error(
      "Cannot create FSPM trace: Deliverable identity is not canonical",
    );
  }
  if (!deliverable) {
    throw new Error(
      `Cannot create FSPM trace: approved ${domain} Deliverable is missing`,
    );
  }
  if (deliverable && deliverable.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Deliverable is ${deliverable.status}`,
    );
  }

  const canonicalTaskId = `task:${roomName}:${domain}:${taskKey}`;
  const task = portfolio.tasks[canonicalTaskId];
  const taskWitness = witness.tasksById.get(canonicalTaskId);
  if (!task && !taskWitness) {
    throw new Error(
      `Cannot create FSPM trace: approved Task ${canonicalTaskId} is missing`,
    );
  }
  if (!task || !taskWitness || taskWitness.task !== task) {
    throw new Error(
      `Cannot create FSPM trace: Task ${canonicalTaskId} changed after the tick index was built`,
    );
  }
  if (task.status !== "active") {
    throw new Error(
      `Cannot create FSPM trace: Task ${canonicalTaskId} is ${task.status}`,
    );
  }
  if (
    taskWitness.storageId !== canonicalTaskId ||
    task.id !== canonicalTaskId ||
    task.kind !== "task" ||
    task.domain !== domain ||
    task.taskKey !== taskKey ||
    task.deliverableId !== `deliverable:${roomName}:${domain}` ||
    !fspmTaskDefinition(domain, taskKey)
  ) {
    throw new Error(
      `Cannot create FSPM trace: Task ${canonicalTaskId} identity is not canonical`,
    );
  }

  const canonicalProcedureId = `procedure:${roomName}:${domain}:${taskKey}:${procedureKey}`;
  if (
    task.procedures !== taskWitness.procedures ||
    task.procedures.length !== taskWitness.proceduresById.size
  ) {
    throw new Error(
      `Cannot create FSPM trace: Procedures for ${canonicalTaskId} changed after the tick index was built`,
    );
  }
  const procedureIndex =
    taskWitness.procedureIndexesById.get(canonicalProcedureId);
  const procedure =
    procedureIndex === undefined ? undefined : task.procedures[procedureIndex];
  if (procedure !== taskWitness.proceduresById.get(canonicalProcedureId)) {
    throw new Error(
      `Cannot create FSPM trace: Procedure ${canonicalProcedureId} changed after the tick index was built`,
    );
  }
  if (
    procedure &&
    (procedure.id !== canonicalProcedureId ||
      procedure.taskId !== canonicalTaskId ||
      procedure.procedureKey !== procedureKey)
  ) {
    throw new Error(
      `Cannot create FSPM trace: Procedure ${canonicalProcedureId} identity is not canonical`,
    );
  }
  assertNoOutOfBandMutation();
}

export function createEmpirePortfolioP3(
  startTick: number,
  updatedAt: number,
): EmpirePortfolioP3 {
  return {
    id: EMPIRE_PORTFOLIO_ID,
    type: "portfolio",
    subType: "ou_portfolio",
    name: "EMPIRE-PORTFOLIO-Empire Operations",
    description:
      "Continuously manage owned colonies and subordinate P3 work by prioritizing and rebalancing empire resources against strategic operating objectives.",
    parentP3Id: null,
    temporalBasis: "game_tick",
    startTick,
    status: "active",
    statusReason: "root Empire Operations Portfolio is continuously managed",
    createdAt: startTick,
    updatedAt,
  };
}

export function createColonyPortfolioP3(
  roomName: string,
  startTick: number,
  updatedAt: number,
): ColonyPortfolioP3 {
  return {
    id: `portfolio:colony:${roomName}`,
    type: "portfolio",
    subType: "ou_portfolio",
    roomName,
    name: `COLONY-PORTFOLIO-${roomName} Operations`,
    description: `Continuously manage economy, workforce, construction, defense, expansion and operational priorities for owned colony ${roomName}.`,
    parentP3Id: EMPIRE_PORTFOLIO_ID,
    temporalBasis: "game_tick",
    startTick,
    status: "active",
    statusReason:
      "owned colony is continuously managed as subordinate Portfolio scope",
    createdAt: startTick,
    updatedAt,
  };
}

export function requirementApprovedContent(
  requirement: ColonyRequirement,
): unknown {
  return {
    kind: requirement.kind,
    id: requirement.id,
    p3Id: requirement.p3Id,
    domain: requirement.domain,
    revision: requirement.revision,
    title: requirement.title,
    completionCriterion: requirement.completionCriterion,
    requestorId: requirement.requestorId,
    requirementTrigger: requirement.requirementTrigger,
    ...(requirement.requirementSource
      ? { requirementSource: requirement.requirementSource }
      : {}),
    ...(requirement.originatingAuthority
      ? { originatingAuthority: requirement.originatingAuthority }
      : {}),
    requirementVerbiage: requirement.requirementVerbiage,
    purposeStatement: requirement.purposeStatement,
    strategicPriority: requirement.strategicPriority,
    strategicAlignment: requirement.strategicAlignment,
    applicableOuId: requirement.applicableOuId,
    desiredOutcomes: requirement.desiredOutcomes,
    businessCase: requirement.businessCase,
    approvalAuthorityOuId: requirement.approvalAuthorityOuId,
    createdBy: requirement.createdBy,
    modifiedBy: requirement.modifiedBy,
  };
}

export function deliverableApprovedContent(
  deliverable: ColonyDeliverable,
): unknown {
  return {
    kind: deliverable.kind,
    id: deliverable.id,
    p3Id: deliverable.p3Id,
    requirementId: deliverable.requirementId,
    domain: deliverable.domain,
    revision: deliverable.revision,
    title: deliverable.title,
    completionCriterion: deliverable.completionCriterion,
    category: deliverable.category,
    deliverableType: deliverable.deliverableType,
    details: deliverable.details,
    output: deliverable.output,
    requirementSource: deliverable.requirementSource,
    requirementVerbiage: deliverable.requirementVerbiage,
    evaluationFactors: deliverable.evaluationFactors,
    qualityDescription: deliverable.qualityDescription,
    qualityMetric: deliverable.qualityMetric,
    receiptValidation: deliverable.receiptValidation,
    servicePrincipalAcceptance: deliverable.servicePrincipalAcceptance,
    siblingWeightBasisPoints: deliverable.siblingWeightBasisPoints,
    ...(deliverable.parentDeliverableId
      ? { parentDeliverableId: deliverable.parentDeliverableId }
      : {}),
    childDeliverableIds: deliverable.childDeliverableIds,
  };
}

function requirementApprovalEventContent(
  event: Omit<FspmRequirementApprovalEvent, "eventHash">,
): unknown {
  return event;
}

function deliverableReceiptContent(
  receipt: Omit<FspmDeliverableReceipt, "receiptHash">,
): unknown {
  return receipt;
}

function deliverableReceiptDecisionContent(
  decision: Omit<FspmDeliverableReceiptDecision, "decisionHash">,
): unknown {
  return decision;
}

function authorityLifecycleEventContent(
  event: Omit<FspmAuthorityLifecycleEvent, "eventHash">,
): unknown {
  return event;
}

function governanceBindingContent(
  binding: Omit<FspmGovernanceBinding, "activationReceiptHash">,
): unknown {
  return binding;
}

function emptyAuthorityLedgerAnchors(): FspmAuthorityLedgerAnchors {
  return {
    deliverableReceipts: { count: 0, headHash: null },
    deliverableReceiptDecisions: { count: 0, headHash: null },
    authorityLifecycle: { count: 0, headHash: null },
  };
}

function authorityLedgerAnchorFor<T>(
  registry: Record<string, T>,
  entryHash: (entry: T) => string,
): FspmAuthorityLedgerAnchor {
  const entries = Object.entries(registry)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, entry]) => ({ id, entryHash: entryHash(entry) }));
  return {
    count: entries.length,
    headHash: entries.length > 0 ? governanceContentHash(entries) : null,
  };
}

function validateAuthorityLedgerAnchor(
  label: string,
  anchor: FspmAuthorityLedgerAnchor | undefined,
  expectedCount: number,
  expectedHeadHash: string | null,
): string[] {
  if (!anchor) return [`${label} ledger anchor is missing`];
  if (
    !Number.isInteger(anchor.count) ||
    anchor.count < 0 ||
    anchor.count !== expectedCount ||
    anchor.headHash !== expectedHeadHash
  ) {
    return [`${label} ledger anchor does not match its retained chain`];
  }
  return [];
}

interface ApprovedColonyGovernanceProjection {
  binding: FspmGovernanceBinding;
  requirements: Record<FspmDomain, ColonyRequirement>;
  deliverables: Record<FspmDomain, ColonyDeliverable>;
  approvalLedger: Record<string, FspmRequirementApprovalEvent>;
  tasks: Record<string, ColonyTask>;
}

function buildApprovedColonyGovernanceProjection(
  roomName: string,
  portfolio: ColonyFspmPortfolio,
  authorityPackage: FspmAuthorityPackage,
): ApprovedColonyGovernanceProjection {
  const packageErrors = validateAuthorityPackage(authorityPackage);
  if (packageErrors.length > 0) {
    throw new Error(
      `Cannot activate FSPM authority package: ${packageErrors.join("; ")}`,
    );
  }

  const applicableOuId = `ou:empire-operations:colony:${roomName}`;
  const requirements = {} as Record<FspmDomain, ColonyRequirement>;
  const deliverables = {} as Record<FspmDomain, ColonyDeliverable>;
  const approvalLedger: Record<string, FspmRequirementApprovalEvent> = {};
  const tasks: Record<string, ColonyTask> = {};

  for (const domain of fspmDomains) {
    const requirementTemplate = requirementTemplateForDomain(
      domain,
      authorityPackage,
    );
    const deliverableTemplate = deliverableTemplateForDomain(
      domain,
      authorityPackage,
    );
    if (!requirementTemplate || !deliverableTemplate) {
      throw new Error(
        `Cannot activate FSPM authority package: ${domain} authority is incomplete`,
      );
    }

    const requirementBase = {
      kind: "requirement",
      id: `requirement:${roomName}:${domain}`,
      p3Id: portfolio.p3.id,
      domain,
      revision: authorityPackage.revision,
      title: requirementTemplate.title,
      status: "active",
      completionCriterion: recurringAuthorityCriterion,
      statusReason:
        "binding obligation activated from the approved colony-operations authority package",
      requestorId: requirementTemplate.requestorId,
      requirementTrigger: requirementTemplate.requirementTrigger,
      ...(requirementTemplate.requirementSource
        ? { requirementSource: requirementTemplate.requirementSource }
        : {}),
      ...(requirementTemplate.originatingAuthority
        ? { originatingAuthority: requirementTemplate.originatingAuthority }
        : {}),
      requirementVerbiage: requirementTemplate.requirementVerbiage,
      purposeStatement: requirementTemplate.purposeStatement,
      strategicPriority: requirementTemplate.strategicPriority,
      strategicAlignment: requirementTemplate.strategicAlignment,
      applicableOuId,
      desiredOutcomes: requirementTemplate.desiredOutcomes,
      businessCase: requirementTemplate.businessCase,
      approvalAuthorityOuId:
        authorityPackage.organizationalAuthority.departmentOuId,
      approval: true,
      approvalEventId: "",
      approvedBy:
        authorityPackage.organizationalAuthority.accountablePrincipalId,
      approvalSignature: authorityPackage.approval.typedSignature,
      dateApproved: authorityPackage.approval.signedAt,
      createdBy: authorityPackage.issuer.principalId,
      modifiedBy: authorityPackage.issuer.principalId,
      createdAt: Game.time,
      updatedAt: Game.time,
      approvedContentHash: "",
    } as ColonyRequirement;
    requirementBase.approvedContentHash = governanceContentHash(
      requirementApprovedContent(requirementBase),
    );

    const approvalEventId = `approval:${requirementBase.id}:r${requirementBase.revision}`;
    const eventWithoutHash: Omit<FspmRequirementApprovalEvent, "eventHash"> = {
      id: approvalEventId,
      sequence: 1,
      requirementId: requirementBase.id,
      requirementRevision: requirementBase.revision,
      approvedContentHash: requirementBase.approvedContentHash,
      applicableOuId,
      approvalAuthorityOuId:
        authorityPackage.organizationalAuthority.departmentOuId,
      accountablePositionId:
        authorityPackage.organizationalAuthority.accountablePositionId,
      signerPrincipalId:
        authorityPackage.organizationalAuthority.accountablePrincipalId,
      signatureType: authorityPackage.approval.type,
      typedSignature: authorityPackage.approval.typedSignature,
      approvedAt: authorityPackage.approval.signedAt,
      recordedAtTick: Game.time,
      authorityPackageId: authorityPackage.id,
      authorityPackageRevision: authorityPackage.revision,
      authorityPackageHash: authorityPackage.contentHash,
      previousEventHash: null,
    };
    const approvalEvent: FspmRequirementApprovalEvent = {
      ...eventWithoutHash,
      eventHash: governanceContentHash(
        requirementApprovalEventContent(eventWithoutHash),
      ),
    };
    requirementBase.approvalEventId = approvalEventId;
    requirements[domain] = requirementBase;
    approvalLedger[approvalEventId] = approvalEvent;

    const deliverableBase = {
      kind: "deliverable",
      id: `deliverable:${roomName}:${domain}`,
      p3Id: portfolio.p3.id,
      requirementId: requirementBase.id,
      domain,
      revision: authorityPackage.revision,
      title: deliverableTemplate.title,
      status: "active",
      completionCriterion: deliverableAuthorityCriterion(
        deliverableTemplate.deliverableType,
      ),
      statusReason:
        "approved Corporate Deliverable is active; no completion is inferred from planner demand",
      category: deliverableTemplate.category,
      deliverableType: deliverableTemplate.deliverableType,
      details: deliverableTemplate.details,
      output: deliverableTemplate.output,
      requirementSource:
        requirementTemplate.requirementSource ??
        requirementTemplate.originatingAuthority ??
        "",
      requirementVerbiage: requirementTemplate.requirementVerbiage,
      evaluationFactors: { ...deliverableTemplate.evaluationFactors },
      qualityDescription: deliverableTemplate.qualityDescription,
      qualityMetric: deliverableTemplate.qualityMetric,
      receiptValidation: { ...deliverableTemplate.receiptValidation },
      servicePrincipalAcceptance: {
        ...deliverableTemplate.servicePrincipalAcceptance,
        acceptedKpiRatings: [
          ...deliverableTemplate.servicePrincipalAcceptance.acceptedKpiRatings,
        ] as ["exceptional", "satisfactory"],
      },
      siblingWeightBasisPoints: deliverableTemplate.siblingWeightBasisPoints,
      childDeliverableIds: [...deliverableTemplate.childDeliverableIds],
      createdAt: Game.time,
      updatedAt: Game.time,
      approvedContentHash: "",
    } as ColonyDeliverable;
    deliverableBase.approvedContentHash = governanceContentHash(
      deliverableApprovedContent(deliverableBase),
    );
    deliverables[domain] = deliverableBase;
  }

  if (Object.keys(portfolio.tasks).length > 0) {
    throw new Error(
      "Cannot activate the first governed authority package over pre-package Task records; versioned migration must quarantine the placeholder spine",
    );
  }
  for (const definition of FSPM_TASK_CATALOG) {
    const taskId = `task:${roomName}:${definition.domain}:${definition.taskKey}`;
    tasks[taskId] = {
      kind: "task",
      id: taskId,
      deliverableId: deliverables[definition.domain].id,
      domain: definition.domain,
      taskKey: definition.taskKey,
      title: definition.title,
      description: definition.description,
      taskWeight: definition.taskWeight,
      status: "active",
      statusReason:
        "canonical governed Task definition activated top-down with its authority package",
      qualityDescription: definition.qualityDescription,
      qualityMetric: definition.qualityMetric,
      kpiMetric: { ...definition.kpiMetric },
      procedures: definition.procedures.map((procedure) => ({
        id: `procedure:${roomName}:${definition.domain}:${definition.taskKey}:${procedure.key}`,
        taskId,
        procedureKey: procedure.key,
        title: procedure.title,
      })),
      determination: { ...definition.determination },
      createdAt: Game.time,
      updatedAt: Game.time,
    };
  }

  const bindingWithoutReceipt: Omit<
    FspmGovernanceBinding,
    "activationReceiptHash"
  > = {
    schema: authorityPackage.schema,
    authorityPackageId: authorityPackage.id,
    authorityPackageRevision: authorityPackage.revision,
    authorityPackageHash: authorityPackage.contentHash,
    governanceSha: authorityPackage.governanceSha,
    effectiveDate: authorityPackage.effectiveDate,
    importedAtTick: Game.time,
    issuerPrincipalId: authorityPackage.issuer.principalId,
    departmentOuId: authorityPackage.organizationalAuthority.departmentOuId,
    departmentCode: authorityPackage.organizationalAuthority.departmentCode,
    accountablePositionId:
      authorityPackage.organizationalAuthority.accountablePositionId,
    accountablePrincipalId:
      authorityPackage.organizationalAuthority.accountablePrincipalId,
  };
  const binding: FspmGovernanceBinding = {
    ...bindingWithoutReceipt,
    activationReceiptHash: governanceContentHash(
      governanceBindingContent(bindingWithoutReceipt),
    ),
  };
  return { binding, requirements, deliverables, approvalLedger, tasks };
}

/**
 * Import the reviewed authority package before planners run. This is the only
 * ordinary runtime path that may materialize binding Requirements and
 * Deliverables. It validates the complete package and builds every sibling in
 * temporary objects before making one atomic portfolio assignment.
 */
export function activateApprovedColonyGovernance(
  roomName: string,
  authorityPackage: FspmAuthorityPackage = APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE,
): ColonyFspmPortfolio {
  const packageErrors = validateAuthorityPackage(authorityPackage);
  if (packageErrors.length > 0) {
    throw new Error(
      `Cannot activate FSPM authority package: ${packageErrors.join("; ")}`,
    );
  }
  return controlledAuthorityMutation(() => {
    const colony = Memory.colonies[roomName];
    if (!colony) {
      throw new Error(
        `Cannot activate FSPM authority package for unknown colony ${roomName}`,
      );
    }
    const existing = colony.fspm;
    const existingEmpire = Memory.empireFspm;
    if (existingEmpire && !existingEmpire.p3) {
      throw new Error(
        "Cannot activate FSPM authority package under an Empire authority container with no root P3",
      );
    }
    const empireP3 = existingEmpire?.p3;
    if (empireP3 && !isActiveCanonicalEmpirePortfolioP3(empireP3)) {
      throw new Error(
        "Cannot activate FSPM authority package under a noncanonical or inactive Empire Portfolio",
      );
    }
    if (existing && !existing.p3) {
      throw new Error(
        `FSPM colony authority container ${roomName} is missing its required root P3; refusing implicit repair outside versioned migration`,
      );
    }
    if (
      existing?.p3 &&
      !isActiveCanonicalColonyPortfolioP3(existing.p3, roomName)
    ) {
      throw new Error(
        `Cannot activate FSPM authority package over a noncanonical or inactive colony Portfolio for ${roomName}`,
      );
    }
    if (existing?.governanceBinding) {
      if (!empireP3) {
        throw new Error(
          `Cannot reuse FSPM governance for ${roomName} without its required Empire root Portfolio`,
        );
      }
      const validation = validateColonyGovernanceAuthority(
        existing,
        authorityPackage,
      );
      if (validation.length > 0) {
        throw new Error(
          `Cannot reuse invalid FSPM governance for ${roomName}: ${validation.join("; ")}`,
        );
      }
      if (
        existing.governanceBinding.authorityPackageId !== authorityPackage.id ||
        existing.governanceBinding.authorityPackageRevision !==
          authorityPackage.revision ||
        existing.governanceBinding.authorityPackageHash !==
          authorityPackage.contentHash
      ) {
        throw new Error(
          `Cannot replace active FSPM authority package for ${roomName}; retire and supersede it through governed change control`,
        );
      }
      return existing;
    }
    if (
      Object.keys(existing?.requirements ?? {}).length > 0 ||
      Object.keys(existing?.deliverables ?? {}).length > 0 ||
      Object.keys(existing?.tasks ?? {}).length > 0 ||
      Object.keys(existing?.activities ?? {}).length > 0 ||
      Object.keys(existing?.requirementApprovalLedger ?? {}).length > 0 ||
      Object.keys(existing?.deliverableReceipts ?? {}).length > 0 ||
      Object.keys(existing?.deliverableReceiptDecisions ?? {}).length > 0 ||
      Object.keys(existing?.authorityLifecycleLedger ?? {}).length > 0 ||
      Object.values(existing?.authorityLedgerAnchors ?? {}).some(
        (anchor) => anchor.count !== 0 || anchor.headHash !== null,
      )
    ) {
      throw new Error(
        `Cannot activate FSPM authority package for ${roomName} over an unquarantined authority spine`,
      );
    }

    const portfolio: ColonyFspmPortfolio = existing
      ? {
          ...existing,
          requirements: {},
          deliverables: {},
          tasks: {},
          activities: existing.activities ?? {},
          operationalHealthHistory: existing.operationalHealthHistory ?? {},
          activityKpiHistory: existing.activityKpiHistory ?? {},
          requirementApprovalLedger: {},
          deliverableReceipts: {},
          deliverableReceiptDecisions: {},
          authorityLifecycleLedger: {},
          authorityLedgerAnchors: emptyAuthorityLedgerAnchors(),
        }
      : {
          p3: createColonyPortfolioP3(roomName, colony.discoveredAt, Game.time),
          requirements: {},
          deliverables: {},
          tasks: {},
          activities: {},
          operationalHealthHistory: {},
          activityKpiHistory: {},
          requirementApprovalLedger: {},
          deliverableReceipts: {},
          deliverableReceiptDecisions: {},
          authorityLifecycleLedger: {},
          authorityLedgerAnchors: emptyAuthorityLedgerAnchors(),
        };
    const projection = buildApprovedColonyGovernanceProjection(
      roomName,
      portfolio,
      authorityPackage,
    );
    portfolio.requirements = projection.requirements;
    portfolio.deliverables = projection.deliverables;
    portfolio.tasks = projection.tasks;
    portfolio.requirementApprovalLedger = projection.approvalLedger;
    portfolio.deliverableReceipts ??= {};
    portfolio.deliverableReceiptDecisions ??= {};
    portfolio.authorityLifecycleLedger ??= {};
    portfolio.authorityLedgerAnchors ??= emptyAuthorityLedgerAnchors();
    portfolio.governanceBinding = projection.binding;

    const projectionErrors = validateColonyGovernanceAuthority(
      portfolio,
      authorityPackage,
    );
    if (projectionErrors.length > 0) {
      throw new Error(
        `Cannot atomically activate invalid colony governance: ${projectionErrors.join("; ")}`,
      );
    }

    const empireAuthorityDescriptor = Object.getOwnPropertyDescriptor(
      Memory,
      "empireFspm",
    );
    const colonyAuthorityDescriptor = Object.getOwnPropertyDescriptor(
      colony,
      "fspm",
    );
    try {
      if (!existingEmpire) {
        Memory.empireFspm = {
          p3: createEmpirePortfolioP3(earliestKnownColonyTick(), Game.time),
        };
      }
      colony.fspm = portfolio;
    } catch (activationError) {
      const rollbackErrors: unknown[] = [];
      try {
        if (colonyAuthorityDescriptor) {
          Object.defineProperty(colony, "fspm", colonyAuthorityDescriptor);
        } else {
          delete colony.fspm;
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        if (empireAuthorityDescriptor) {
          Object.defineProperty(
            Memory,
            "empireFspm",
            empireAuthorityDescriptor,
          );
        } else {
          delete Memory.empireFspm;
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [activationError, ...rollbackErrors],
          "FSPM authority activation failed and rollback encountered an error",
        );
      }
      throw activationError;
    }
    invalidateFspmPlanningAuthorityContext();
    return portfolio;
  });
}

function sameGovernedValue(left: unknown, right: unknown): boolean {
  return governanceContentHash(left) === governanceContentHash(right);
}

type GovernedAuthorityRecord = ColonyRequirement | ColonyDeliverable;

function governedAuthorityRecords(
  portfolio: ColonyFspmPortfolio,
): GovernedAuthorityRecord[] {
  return [
    ...Object.values(portfolio.requirements),
    ...Object.values(portfolio.deliverables),
  ].flatMap((record) => (record ? [record] : []));
}

/**
 * Validate the append-only retirement history independently from execution
 * eligibility. A legitimate retirement is durable evidence that deliberately
 * blocks the current package projection; it must not be mistaken for an
 * executable package merely because Memory was serialized and loaded again.
 */
export function validateAuthorityLifecycleLedger(
  portfolio: ColonyFspmPortfolio,
): string[] {
  const errors: string[] = [];
  const binding = portfolio.governanceBinding;
  const ledger = portfolio.authorityLifecycleLedger ?? {};
  if (!binding) {
    if (Object.keys(ledger).length > 0) {
      errors.push(
        "authority lifecycle ledger exists without a governance binding",
      );
    }
    return errors;
  }

  const records = new Map(
    governedAuthorityRecords(portfolio).map((record) => [record.id, record]),
  );
  const eventByRecordId = new Map<string, FspmAuthorityLifecycleEvent>();
  const ordered = Object.entries(ledger)
    .map(([storageId, event]) => ({ storageId, event }))
    .sort(
      (left, right) =>
        left.event.sequence - right.event.sequence ||
        left.event.id.localeCompare(right.event.id),
    );

  const expectedAnchor = authorityLedgerAnchorFor(
    ledger,
    (event) => event.eventHash,
  );
  errors.push(
    ...validateAuthorityLedgerAnchor(
      "Authority lifecycle",
      portfolio.authorityLedgerAnchors?.authorityLifecycle,
      expectedAnchor.count,
      expectedAnchor.headHash,
    ),
  );

  let previousHash: string | null = null;
  let previousRecordedAtTick = Number.NEGATIVE_INFINITY;
  for (const [index, { storageId, event }] of ordered.entries()) {
    const expectedSequence = index + 1;
    const record = records.get(event.recordId);
    const { eventHash: _eventHash, ...eventContent } = event;
    if (storageId !== event.id) {
      errors.push(
        `Authority lifecycle event ${storageId} storage identity is invalid`,
      );
    }
    if (
      event.eventHash !==
      governanceContentHash(authorityLifecycleEventContent(eventContent))
    ) {
      errors.push(`Authority lifecycle event ${event.id} hash is invalid`);
    }
    if (
      event.sequence !== expectedSequence ||
      event.previousEventHash !== previousHash
    ) {
      errors.push(
        `Authority lifecycle ledger is not contiguous at sequence ${event.sequence}`,
      );
    }
    previousHash = event.eventHash;

    const hasValidRecordedAtTick =
      Number.isInteger(event.recordedAtTick) &&
      event.recordedAtTick >= binding.importedAtTick &&
      event.recordedAtTick <= Game.time;
    if (!hasValidRecordedAtTick) {
      errors.push(
        `Authority lifecycle event ${event.id} recorded tick is invalid`,
      );
    }
    if (
      Number.isInteger(event.recordedAtTick) &&
      event.recordedAtTick < previousRecordedAtTick
    ) {
      errors.push(
        `Authority lifecycle event chronology regresses at sequence ${event.sequence}`,
      );
    }
    if (Number.isInteger(event.recordedAtTick)) {
      previousRecordedAtTick = event.recordedAtTick;
    }

    if (!record) {
      errors.push(
        `Authority lifecycle event ${event.id} references an unknown record`,
      );
      continue;
    }
    if (eventByRecordId.has(record.id)) {
      errors.push(
        `Authority record ${record.id} has multiple retirement events`,
      );
    } else {
      eventByRecordId.set(record.id, event);
    }
    const expectedId = `lifecycle:${record.id}:r${record.revision}:retired:${event.sequence}`;
    if (
      event.id !== expectedId ||
      event.recordKind !== record.kind ||
      event.recordRevision !== record.revision ||
      event.recordContentHash !== record.approvedContentHash ||
      event.transition !== "retired" ||
      event.fromStatus !== "active" ||
      event.toStatus !== "retired" ||
      !event.reason.trim() ||
      event.reason !== event.reason.trim() ||
      event.actorPrincipalId !== binding.accountablePrincipalId ||
      event.authorityPackageId !== binding.authorityPackageId ||
      event.authorityPackageRevision !== binding.authorityPackageRevision ||
      event.authorityPackageHash !== binding.authorityPackageHash
    ) {
      errors.push(`Authority lifecycle event ${event.id} authority is invalid`);
    }
  }

  for (const record of records.values()) {
    const retirement = eventByRecordId.get(record.id);
    if (record.createdAt !== binding.importedAtTick) {
      errors.push(`${record.id} creation tick is not bound to package import`);
    }
    if (record.completedAt !== undefined) {
      errors.push(`${record.id} retains unsupported completion data`);
    }
    if (record.reopenedAt !== undefined) {
      errors.push(`${record.id} retains unsupported reopening data`);
    }
    if (record.status === "retired") {
      if (!retirement) {
        errors.push(`${record.id} is retired without a lifecycle event`);
      } else if (
        record.retiredAt !== retirement.recordedAtTick ||
        record.updatedAt !== retirement.recordedAtTick ||
        record.statusReason !== retirement.reason
      ) {
        errors.push(`${record.id} retirement projection is invalid`);
      }
      continue;
    }
    if (retirement) {
      errors.push(
        `${record.id} was retired by ${retirement.id} and cannot be reactivated`,
      );
    }
    if (record.retiredAt !== undefined) {
      errors.push(`${record.id} has a retirement tick without retired status`);
    }
    if (record.status === "active") {
      if (record.updatedAt !== binding.importedAtTick) {
        errors.push(
          `${record.id} active projection tick differs from package import`,
        );
      }
      continue;
    }
    errors.push(
      `${record.id} has unsupported lifecycle status ${record.status}`,
    );
  }
  return errors;
}

/**
 * Persist one or more accountable retirement transitions as one atomic,
 * deterministic batch. Retirement intentionally makes the current package
 * ineligible for execution until a separately reviewed superseding package is
 * implemented.
 */
export function retireGovernedAuthorityRecords(
  roomName: string,
  recordIds: readonly string[],
  reason: string,
): FspmAuthorityLifecycleEvent[] {
  return controlledAuthorityMutation(() => {
    const colony = Memory.colonies[roomName];
    const portfolio = colony?.fspm;
    if (!colony || !portfolio) {
      throw new Error(`Unknown FSPM portfolio ${roomName}`);
    }
    const governanceErrors = validateColonyGovernanceAuthority(portfolio);
    if (governanceErrors.length > 0) {
      throw new Error(
        `Cannot retire authority under an invalid package: ${governanceErrors.join("; ")}`,
      );
    }
    const normalizedReason = reason.trim();
    if (
      !normalizedReason ||
      normalizedReason !== reason ||
      reason.length > 500
    ) {
      throw new Error(
        "Authority retirement reason must be nonblank, trimmed, and at most 500 characters",
      );
    }
    const uniqueIds = [...new Set(recordIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    if (uniqueIds.length === 0 || uniqueIds.length !== recordIds.length) {
      throw new Error(
        "Authority retirement batch must contain unique record identities",
      );
    }
    const recordsById = new Map(
      governedAuthorityRecords(portfolio).map((record) => [record.id, record]),
    );
    const records = uniqueIds.map((recordId) => {
      const record = recordsById.get(recordId);
      if (!record) {
        throw new Error(`Unknown governed authority record ${recordId}`);
      }
      if (record.status !== "active") {
        throw new Error(
          `Authority record ${record.id} is ${record.status}, not active`,
        );
      }
      return record;
    });
    const existingRecordIds = new Set(
      Object.values(portfolio.authorityLifecycleLedger ?? {}).map(
        (event) => event.recordId,
      ),
    );
    for (const record of records) {
      if (existingRecordIds.has(record.id)) {
        throw new Error(`Authority record ${record.id} was already retired`);
      }
    }
    const binding = portfolio.governanceBinding;
    if (!binding) throw new Error("Governance binding is missing");
    if (Game.time < binding.importedAtTick) {
      throw new Error("Authority retirement tick predates package import");
    }

    const ledger = portfolio.authorityLifecycleLedger ?? {};
    let previous = Object.values(ledger)
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    const nextLedger = { ...ledger };
    const events: FspmAuthorityLifecycleEvent[] = [];
    const retiredRecords = new Map<string, GovernedAuthorityRecord>();
    for (const record of records) {
      const sequence = (previous?.sequence ?? 0) + 1;
      const id = `lifecycle:${record.id}:r${record.revision}:retired:${sequence}`;
      if (nextLedger[id]) {
        throw new Error(`Authority lifecycle event ${id} exists`);
      }
      const eventWithoutHash: Omit<FspmAuthorityLifecycleEvent, "eventHash"> = {
        id,
        sequence,
        recordId: record.id,
        recordKind: record.kind,
        recordRevision: record.revision,
        recordContentHash: record.approvedContentHash,
        transition: "retired",
        fromStatus: "active",
        toStatus: "retired",
        reason: normalizedReason,
        actorPrincipalId: binding.accountablePrincipalId,
        recordedAtTick: Game.time,
        authorityPackageId: binding.authorityPackageId,
        authorityPackageRevision: binding.authorityPackageRevision,
        authorityPackageHash: binding.authorityPackageHash,
        previousEventHash: previous?.eventHash ?? null,
      };
      const event: FspmAuthorityLifecycleEvent = {
        ...eventWithoutHash,
        eventHash: governanceContentHash(
          authorityLifecycleEventContent(eventWithoutHash),
        ),
      };
      nextLedger[event.id] = event;
      events.push(event);
      previous = event;
      retiredRecords.set(record.id, {
        ...record,
        status: "retired",
        statusReason: normalizedReason,
        updatedAt: Game.time,
        retiredAt: Game.time,
      });
    }
    const nextPortfolio: ColonyFspmPortfolio = {
      ...portfolio,
      requirements: Object.fromEntries(
        Object.entries(portfolio.requirements).map(([domain, record]) => [
          domain,
          record ? (retiredRecords.get(record.id) ?? record) : record,
        ]),
      ) as ColonyFspmPortfolio["requirements"],
      deliverables: Object.fromEntries(
        Object.entries(portfolio.deliverables).map(([domain, record]) => [
          domain,
          record ? (retiredRecords.get(record.id) ?? record) : record,
        ]),
      ) as ColonyFspmPortfolio["deliverables"],
      authorityLifecycleLedger: nextLedger,
      authorityLedgerAnchors: {
        ...(portfolio.authorityLedgerAnchors ?? emptyAuthorityLedgerAnchors()),
        authorityLifecycle: authorityLedgerAnchorFor(
          nextLedger,
          (event) => event.eventHash,
        ),
      },
    };
    const lifecycleErrors = validateAuthorityLifecycleLedger(nextPortfolio);
    if (lifecycleErrors.length > 0) {
      throw new Error(
        `Cannot atomically append invalid authority retirement: ${lifecycleErrors.join("; ")}`,
      );
    }
    colony.fspm = nextPortfolio;
    invalidateFspmPlanningAuthorityContext();
    return events;
  });
}

export function retireGovernedAuthorityRecord(
  roomName: string,
  recordId: string,
  reason: string,
): FspmAuthorityLifecycleEvent {
  const event = retireGovernedAuthorityRecords(roomName, [recordId], reason)[0];
  if (!event) throw new Error("Authority retirement did not emit an event");
  return event;
}

/** Validate the complete binding once for planning/snapshot indexing. */
export function validateColonyGovernanceAuthority(
  portfolio: ColonyFspmPortfolio,
  authorityPackage: FspmAuthorityPackage = APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE,
): string[] {
  const errors = validateAuthorityPackage(authorityPackage).map(
    (error) => `authority package: ${error}`,
  );
  const p3RoomName = (portfolio.p3 as { roomName?: unknown } | null)?.roomName;
  if (
    typeof p3RoomName !== "string" ||
    !isActiveCanonicalColonyPortfolioP3(portfolio.p3, p3RoomName)
  ) {
    return [...errors, "colony P3 is noncanonical or inactive"];
  }
  const binding = portfolio.governanceBinding;
  if (!binding) return [...errors, "governance binding is missing"];

  const knownDomains = new Set<string>(fspmDomains);
  const unexpectedRequirementKeys = Object.keys(portfolio.requirements).filter(
    (key) => !knownDomains.has(key),
  );
  const unexpectedDeliverableKeys = Object.keys(portfolio.deliverables).filter(
    (key) => !knownDomains.has(key),
  );
  if (unexpectedRequirementKeys.length > 0) {
    errors.push(
      `unexpected Requirement registry keys: ${unexpectedRequirementKeys.sort().join(", ")}`,
    );
  }
  if (unexpectedDeliverableKeys.length > 0) {
    errors.push(
      `unexpected Deliverable registry keys: ${unexpectedDeliverableKeys.sort().join(", ")}`,
    );
  }

  const { activationReceiptHash: _activationReceiptHash, ...bindingContent } =
    binding;
  if (
    binding.activationReceiptHash !==
    governanceContentHash(governanceBindingContent(bindingContent))
  ) {
    errors.push("governance activation receipt hash is invalid");
  }
  if (
    binding.schema !== authorityPackage.schema ||
    binding.authorityPackageId !== authorityPackage.id ||
    binding.authorityPackageRevision !== authorityPackage.revision ||
    binding.authorityPackageHash !== authorityPackage.contentHash ||
    binding.governanceSha !== authorityPackage.governanceSha ||
    binding.effectiveDate !== authorityPackage.effectiveDate ||
    binding.issuerPrincipalId !== authorityPackage.issuer.principalId ||
    binding.departmentOuId !==
      authorityPackage.organizationalAuthority.departmentOuId ||
    binding.departmentCode !==
      authorityPackage.organizationalAuthority.departmentCode ||
    binding.accountablePositionId !==
      authorityPackage.organizationalAuthority.accountablePositionId ||
    binding.accountablePrincipalId !==
      authorityPackage.organizationalAuthority.accountablePrincipalId
  ) {
    errors.push("governance binding does not match the approved package");
  }
  if (
    !Number.isInteger(binding.importedAtTick) ||
    binding.importedAtTick < 0 ||
    binding.importedAtTick > Game.time
  ) {
    errors.push("governance binding import tick is invalid");
  }
  errors.push(...validateAuthorityLifecycleLedger(portfolio));

  const ledger = portfolio.requirementApprovalLedger ?? {};
  const expectedApprovalIds = new Set<string>();
  let deliverableWeightBasisPoints = 0;
  const activeTaskWeightByDomain = new Map<FspmDomain, number>();

  for (const domain of fspmDomains) {
    const requirement = portfolio.requirements[domain];
    const requirementTemplate = requirementTemplateForDomain(
      domain,
      authorityPackage,
    );
    if (!requirement || !requirementTemplate) {
      errors.push(`${domain} Requirement authority is missing`);
      continue;
    }
    const hasSource = Boolean(requirement.requirementSource?.trim());
    const hasOrigin = Boolean(requirement.originatingAuthority?.trim());
    if (hasSource === hasOrigin) {
      errors.push(
        `${requirement.id} must have exactly one Requirement Source or Originating Authority`,
      );
    }
    if (
      requirement.requirementTrigger === "regulatoryCompliance" &&
      !hasSource
    ) {
      errors.push(`${requirement.id} regulatory authority is not derived`);
    }
    if (
      requirement.id !== `requirement:${portfolio.p3.roomName}:${domain}` ||
      requirement.kind !== "requirement" ||
      requirement.p3Id !== portfolio.p3.id ||
      requirement.domain !== domain ||
      requirement.revision !== authorityPackage.revision
    ) {
      errors.push(
        `${requirement.id} Requirement identity is not canonical or its ancestry is invalid`,
      );
    }
    if (
      requirement.title !== requirementTemplate.title ||
      requirement.completionCriterion !== recurringAuthorityCriterion ||
      requirement.requestorId !== requirementTemplate.requestorId ||
      requirement.requirementTrigger !==
        requirementTemplate.requirementTrigger ||
      requirement.requirementSource !== requirementTemplate.requirementSource ||
      requirement.originatingAuthority !==
        requirementTemplate.originatingAuthority ||
      requirement.requirementVerbiage !==
        requirementTemplate.requirementVerbiage ||
      requirement.purposeStatement !== requirementTemplate.purposeStatement ||
      requirement.strategicPriority !== requirementTemplate.strategicPriority ||
      requirement.strategicAlignment !==
        requirementTemplate.strategicAlignment ||
      requirement.desiredOutcomes !== requirementTemplate.desiredOutcomes ||
      requirement.businessCase !== requirementTemplate.businessCase ||
      requirement.createdBy !== authorityPackage.issuer.principalId ||
      requirement.modifiedBy !== authorityPackage.issuer.principalId
    ) {
      errors.push(
        `${requirement.id} approved content differs from its package`,
      );
    }
    if (requirement.status !== "active") {
      errors.push(`${requirement.id} Requirement is ${requirement.status}`);
    }
    if (
      requirement.applicableOuId !==
        `ou:empire-operations:colony:${portfolio.p3.roomName}` ||
      requirement.approvalAuthorityOuId !== binding.departmentOuId
    ) {
      errors.push(`${requirement.id} OU approval authority is invalid`);
    }
    const approvedContentHash = governanceContentHash(
      requirementApprovedContent(requirement),
    );
    if (requirement.approvedContentHash !== approvedContentHash) {
      errors.push(`${requirement.id} approved content hash is stale`);
    }

    const event = ledger[requirement.approvalEventId];
    expectedApprovalIds.add(requirement.approvalEventId);
    if (!event) {
      errors.push(`${requirement.id} approval ledger event is missing`);
    } else {
      const { eventHash: _eventHash, ...eventContent } = event;
      if (
        event.eventHash !==
        governanceContentHash(requirementApprovalEventContent(eventContent))
      ) {
        errors.push(`${event.id} approval ledger hash is invalid`);
      }
      if (
        event.id !== requirement.approvalEventId ||
        event.sequence !== 1 ||
        event.previousEventHash !== null ||
        event.requirementId !== requirement.id ||
        event.requirementRevision !== requirement.revision ||
        event.approvedContentHash !== requirement.approvedContentHash ||
        event.applicableOuId !== requirement.applicableOuId ||
        event.approvalAuthorityOuId !== requirement.approvalAuthorityOuId ||
        event.accountablePositionId !== binding.accountablePositionId ||
        event.signerPrincipalId !== binding.accountablePrincipalId ||
        event.signatureType !== authorityPackage.approval.type ||
        event.typedSignature !== authorityPackage.approval.typedSignature ||
        event.approvedAt !== authorityPackage.approval.signedAt ||
        event.recordedAtTick !== binding.importedAtTick ||
        event.authorityPackageId !== binding.authorityPackageId ||
        event.authorityPackageRevision !== binding.authorityPackageRevision ||
        event.authorityPackageHash !== binding.authorityPackageHash
      ) {
        errors.push(`${event.id} approval ledger authority is invalid`);
      }
      if (
        requirement.approval !== true ||
        requirement.approvedBy !== event.signerPrincipalId ||
        requirement.approvalSignature !== event.typedSignature ||
        requirement.dateApproved !== event.approvedAt
      ) {
        errors.push(`${requirement.id} approval projection is invalid`);
      }
    }

    const deliverable = portfolio.deliverables[domain];
    const deliverableTemplate = deliverableTemplateForDomain(
      domain,
      authorityPackage,
    );
    if (!deliverable || !deliverableTemplate) {
      errors.push(`${domain} Deliverable authority is missing`);
      continue;
    }
    if (
      deliverable.id !== `deliverable:${portfolio.p3.roomName}:${domain}` ||
      deliverable.kind !== "deliverable" ||
      deliverable.p3Id !== portfolio.p3.id ||
      deliverable.requirementId !== requirement.id ||
      deliverable.domain !== domain ||
      deliverable.revision !== authorityPackage.revision
    ) {
      errors.push(
        `${deliverable.id} Deliverable identity is not canonical or its ancestry is invalid`,
      );
    }
    if (deliverable.status !== "active") {
      errors.push(`${deliverable.id} Deliverable is ${deliverable.status}`);
    }
    if (requirement.status !== "active") {
      errors.push(
        `${deliverable.id} cannot remain ${deliverable.status} under ${requirement.id} Requirement status ${requirement.status}`,
      );
    }
    if (
      deliverable.category !== deliverableTemplate.category ||
      deliverable.deliverableType !== deliverableTemplate.deliverableType ||
      deliverable.title !== deliverableTemplate.title ||
      deliverable.completionCriterion !==
        deliverableAuthorityCriterion(deliverableTemplate.deliverableType) ||
      deliverable.details !== deliverableTemplate.details ||
      deliverable.output !== deliverableTemplate.output ||
      deliverable.requirementSource !==
        (requirementTemplate.requirementSource ??
          requirementTemplate.originatingAuthority) ||
      deliverable.requirementVerbiage !== requirement.requirementVerbiage ||
      !sameGovernedValue(
        deliverable.evaluationFactors,
        deliverableTemplate.evaluationFactors,
      ) ||
      deliverable.qualityDescription !==
        deliverableTemplate.qualityDescription ||
      deliverable.qualityMetric !== deliverableTemplate.qualityMetric ||
      !sameGovernedValue(
        deliverable.receiptValidation,
        deliverableTemplate.receiptValidation,
      ) ||
      !sameGovernedValue(
        deliverable.servicePrincipalAcceptance,
        deliverableTemplate.servicePrincipalAcceptance,
      ) ||
      deliverable.siblingWeightBasisPoints !==
        deliverableTemplate.siblingWeightBasisPoints ||
      deliverable.parentDeliverableId !== undefined ||
      !sameGovernedValue(
        deliverable.childDeliverableIds,
        deliverableTemplate.childDeliverableIds,
      )
    ) {
      errors.push(
        `${deliverable.id} approved content differs from its package`,
      );
    }
    if (
      deliverable.approvedContentHash !==
      governanceContentHash(deliverableApprovedContent(deliverable))
    ) {
      errors.push(`${deliverable.id} approved content hash is stale`);
    }
    if (deliverable.status === "active") {
      deliverableWeightBasisPoints += deliverable.siblingWeightBasisPoints;
    }
  }

  errors.push(...validateDeliverableReceiptRegistry(portfolio));
  errors.push(...validateDeliverableReceiptDecisionRegistry(portfolio));

  for (const eventId of Object.keys(ledger)) {
    if (!expectedApprovalIds.has(eventId)) {
      errors.push(`unexpected approval ledger event ${eventId}`);
    }
  }
  if (deliverableWeightBasisPoints !== FSPM_WEIGHT_BASIS_POINTS) {
    errors.push(
      `active Deliverable weights sum to ${deliverableWeightBasisPoints}, expected ${FSPM_WEIGHT_BASIS_POINTS}`,
    );
  }

  for (const [storageId, task] of Object.entries(portfolio.tasks)) {
    if (!task) continue;
    if (task.status !== "active") {
      errors.push(`Task ${task.id} is ${task.status}`);
      continue;
    }
    const definition = fspmTaskDefinition(task.domain, task.taskKey);
    const expectedProcedures = definition?.procedures.map((procedure) => ({
      id: `procedure:${portfolio.p3.roomName}:${task.domain}:${task.taskKey}:${procedure.key}`,
      taskId: task.id,
      procedureKey: procedure.key,
      title: procedure.title,
    }));
    if (
      !definition ||
      storageId !== task.id ||
      task.id !==
        `task:${portfolio.p3.roomName}:${task.domain}:${task.taskKey}` ||
      task.deliverableId !==
        `deliverable:${portfolio.p3.roomName}:${task.domain}` ||
      task.kind !== "task" ||
      task.title !== definition.title ||
      task.description !== definition.description ||
      task.taskWeight !== definition.taskWeight ||
      task.qualityDescription !== definition.qualityDescription ||
      task.qualityMetric !== definition.qualityMetric ||
      !sameGovernedValue(task.kpiMetric, definition.kpiMetric) ||
      !sameGovernedValue(task.determination, definition.determination) ||
      !sameGovernedValue(task.procedures, expectedProcedures) ||
      task.createdAt !== binding.importedAtTick ||
      task.updatedAt !== binding.importedAtTick ||
      task.retiredAt !== undefined
    ) {
      errors.push(`${storageId} Task definition is not canonical`);
      continue;
    }
    activeTaskWeightByDomain.set(
      task.domain,
      (activeTaskWeightByDomain.get(task.domain) ?? 0) +
        definition.taskWeight * 100,
    );
  }
  for (const domain of fspmDomains) {
    const taskWeight = activeTaskWeightByDomain.get(domain) ?? 0;
    if (taskWeight !== FSPM_WEIGHT_BASIS_POINTS) {
      errors.push(
        `${domain} active Task weights sum to ${taskWeight}, expected ${FSPM_WEIGHT_BASIS_POINTS}`,
      );
    }
  }
  return errors;
}

function deliverableReceiptEvidenceReference(
  activity: Pick<
    FspmActivityRecord,
    | "id"
    | "taskId"
    | "createdAt"
    | "startedAt"
    | "completedAt"
    | "updatedAt"
    | "qualityMetric"
    | "kpiScore"
  >,
): string | null {
  if (
    activity.startedAt === undefined ||
    activity.completedAt === undefined ||
    !activity.kpiScore
  ) {
    return null;
  }
  return `fspm-activity:${activity.id}:task:${activity.taskId}:created:${activity.createdAt}:started:${activity.startedAt}:completed:${activity.completedAt}:updated:${activity.updatedAt}:kpi:${activity.kpiScore}:quality:${governanceContentHash(activity.qualityMetric)}`;
}

function hasCanonicalReceiptActivityChronology(
  portfolio: ColonyFspmPortfolio,
  activity: FspmActivityRecord,
): boolean {
  const binding = portfolio.governanceBinding;
  return Boolean(
    binding &&
      Number.isInteger(activity.createdAt) &&
      Number.isInteger(activity.startedAt) &&
      Number.isInteger(activity.completedAt) &&
      Number.isInteger(activity.updatedAt) &&
      activity.createdAt >= binding.importedAtTick &&
      (activity.startedAt ?? -1) >= activity.createdAt &&
      (activity.completedAt ?? -1) >= (activity.startedAt ?? -1) &&
      activity.updatedAt === activity.completedAt &&
      (activity.completedAt ?? Number.POSITIVE_INFINITY) <= Game.time,
  );
}

export function validateDeliverableReceipt(
  portfolio: ColonyFspmPortfolio,
  receipt: FspmDeliverableReceipt,
): boolean {
  const deliverable = Object.values(portfolio.deliverables).find(
    (record) => record?.id === receipt.deliverableId,
  );
  if (!deliverable) return false;
  const sourceTask = portfolio.tasks[receipt.sourceTaskId];
  if (!sourceTask || sourceTask.deliverableId !== deliverable.id) return false;
  const sourceTaskDefinition = fspmTaskDefinition(
    sourceTask.domain,
    sourceTask.taskKey,
  );
  if (
    !sourceTaskDefinition ||
    receipt.sourceActivityQualityMetric !== sourceTaskDefinition.qualityMetric
  ) {
    return false;
  }
  const expectedReference = deliverableReceiptEvidenceReference({
    id: receipt.sourceActivityId,
    taskId: receipt.sourceTaskId,
    createdAt: receipt.sourceActivityCreatedAtTick,
    startedAt: receipt.sourceActivityStartedAtTick,
    completedAt: receipt.sourceActivityCompletedAtTick,
    updatedAt: receipt.sourceActivityUpdatedAtTick,
    qualityMetric: receipt.sourceActivityQualityMetric,
    kpiScore: receipt.sourceActivityKpiScore,
  });
  const binding = portfolio.governanceBinding;
  if (!binding) return false;
  const { receiptHash: _receiptHash, ...content } = receipt;
  return (
    Number.isInteger(receipt.sequence) &&
    receipt.sequence > 0 &&
    receipt.id ===
      `receipt:${deliverable.id}:r${deliverable.revision}:${receipt.sequence}` &&
    receipt.receiptHash ===
      governanceContentHash(deliverableReceiptContent(content)) &&
    receipt.deliverableRevision === deliverable.revision &&
    receipt.deliverableContentHash === deliverable.approvedContentHash &&
    receipt.evidenceForm === deliverable.receiptValidation.evidenceForm &&
    receipt.storageLocation === deliverable.receiptValidation.storageLocation &&
    receipt.capturedBy ===
      deliverable.receiptValidation.captureResponsibility &&
    receipt.outcome === "received" &&
    ["exceptional", "satisfactory", "unsatisfactory"].includes(
      receipt.sourceActivityKpiScore,
    ) &&
    receipt.sourceActivityQualityMetric === sourceTask.qualityMetric &&
    Number.isInteger(receipt.sourceActivityCreatedAtTick) &&
    Number.isInteger(receipt.sourceActivityStartedAtTick) &&
    Number.isInteger(receipt.sourceActivityCompletedAtTick) &&
    Number.isInteger(receipt.sourceActivityUpdatedAtTick) &&
    Number.isInteger(receipt.capturedAtTick) &&
    receipt.sourceActivityCreatedAtTick >= binding.importedAtTick &&
    receipt.sourceActivityStartedAtTick >=
      receipt.sourceActivityCreatedAtTick &&
    receipt.sourceActivityCompletedAtTick >=
      receipt.sourceActivityStartedAtTick &&
    receipt.sourceActivityUpdatedAtTick ===
      receipt.sourceActivityCompletedAtTick &&
    receipt.capturedAtTick >= binding.importedAtTick &&
    receipt.capturedAtTick <= Game.time &&
    receipt.sourceActivityCompletedAtTick <= receipt.capturedAtTick &&
    receipt.evidenceReference === expectedReference
  );
}

export function validateDeliverableReceiptRegistry(
  portfolio: ColonyFspmPortfolio,
): string[] {
  const errors: string[] = [];
  const registry = portfolio.deliverableReceipts ?? {};
  const expectedAnchor = authorityLedgerAnchorFor(
    registry,
    (receipt) => receipt.receiptHash,
  );
  errors.push(
    ...validateAuthorityLedgerAnchor(
      "Deliverable receipt",
      portfolio.authorityLedgerAnchors?.deliverableReceipts,
      expectedAnchor.count,
      expectedAnchor.headHash,
    ),
  );
  const grouped = new Map<string, FspmDeliverableReceipt[]>();
  const receiptedActivities = new Set<string>();
  for (const [storageId, receipt] of Object.entries(registry)) {
    if (storageId !== receipt.id) {
      errors.push(
        `Deliverable receipt ${storageId} storage identity is invalid`,
      );
    }
    if (!validateDeliverableReceipt(portfolio, receipt)) {
      errors.push(`Deliverable receipt ${receipt.id} evidence is invalid`);
    }
    const activityIdentity = `${receipt.deliverableId}\u0000${receipt.deliverableRevision}\u0000${receipt.sourceActivityId}`;
    if (receiptedActivities.has(activityIdentity)) {
      errors.push(
        `Activity ${receipt.sourceActivityId} has duplicate receipts for ${receipt.deliverableId} revision ${receipt.deliverableRevision}`,
      );
    }
    receiptedActivities.add(activityIdentity);
    const group = grouped.get(receipt.deliverableId) ?? [];
    group.push(receipt);
    grouped.set(receipt.deliverableId, group);
  }
  for (const [deliverableId, receipts] of grouped) {
    receipts.sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id),
    );
    let previousHash: string | null = null;
    let previousCapturedAtTick = Number.NEGATIVE_INFINITY;
    for (const [index, receipt] of receipts.entries()) {
      const expectedSequence = index + 1;
      if (
        receipt.sequence !== expectedSequence ||
        receipt.previousReceiptHash !== previousHash
      ) {
        errors.push(
          `Deliverable ${deliverableId} receipt chain is not contiguous at sequence ${receipt.sequence}`,
        );
      }
      if (receipt.capturedAtTick < previousCapturedAtTick) {
        errors.push(
          `Deliverable ${deliverableId} receipt chronology regresses at sequence ${receipt.sequence}`,
        );
      }
      previousHash = receipt.receiptHash;
      previousCapturedAtTick = receipt.capturedAtTick;
    }
  }
  return errors;
}

export function validateDeliverableReceiptDecision(
  portfolio: ColonyFspmPortfolio,
  decision: FspmDeliverableReceiptDecision,
): boolean {
  const binding = portfolio.governanceBinding;
  const receipt = portfolio.deliverableReceipts?.[decision.receiptId];
  if (!binding || !receipt || !validateDeliverableReceipt(portfolio, receipt)) {
    return false;
  }
  const deliverable = Object.values(portfolio.deliverables).find(
    (record) => record?.id === receipt.deliverableId,
  );
  if (!deliverable) return false;
  const { decisionHash: _decisionHash, ...content } = decision;
  return (
    Number.isInteger(decision.sequence) &&
    decision.sequence > 0 &&
    decision.id === `receipt-decision:${receipt.id}:${decision.sequence}` &&
    decision.decisionHash ===
      governanceContentHash(deliverableReceiptDecisionContent(content)) &&
    decision.receiptHash === receipt.receiptHash &&
    decision.deliverableId === deliverable.id &&
    decision.deliverableRevision === deliverable.revision &&
    decision.deliverableContentHash === deliverable.approvedContentHash &&
    ["accepted", "rejected", "disputed"].includes(decision.outcome) &&
    (decision.outcome !== "accepted" ||
      deliverable.servicePrincipalAcceptance.acceptedKpiRatings.includes(
        receipt.sourceActivityKpiScore as "exceptional" | "satisfactory",
      )) &&
    Boolean(decision.reason.trim()) &&
    decision.reason === decision.reason.trim() &&
    decision.reason.length <= 500 &&
    decision.decisionAuthority === "screeps_accountable_service_principal" &&
    decision.decidedBy === binding.accountablePrincipalId &&
    Number.isInteger(decision.decidedAtTick) &&
    decision.decidedAtTick >= receipt.capturedAtTick &&
    decision.decidedAtTick >= binding.importedAtTick &&
    decision.decidedAtTick <= Game.time &&
    decision.authorityPackageId === binding.authorityPackageId &&
    decision.authorityPackageRevision === binding.authorityPackageRevision &&
    decision.authorityPackageHash === binding.authorityPackageHash
  );
}

export function validateDeliverableReceiptDecisionRegistry(
  portfolio: ColonyFspmPortfolio,
): string[] {
  const errors: string[] = [];
  const registry = portfolio.deliverableReceiptDecisions ?? {};
  const expectedAnchor = authorityLedgerAnchorFor(
    registry,
    (decision) => decision.decisionHash,
  );
  errors.push(
    ...validateAuthorityLedgerAnchor(
      "Deliverable receipt decision",
      portfolio.authorityLedgerAnchors?.deliverableReceiptDecisions,
      expectedAnchor.count,
      expectedAnchor.headHash,
    ),
  );
  const decisions = Object.entries(registry)
    .map(([storageId, decision]) => ({ storageId, decision }))
    .sort(
      (left, right) =>
        left.decision.sequence - right.decision.sequence ||
        left.decision.id.localeCompare(right.decision.id),
    );
  if (!portfolio.governanceBinding && decisions.length > 0) {
    return ["Deliverable receipt decision ledger exists without governance"];
  }

  const decidedReceiptIds = new Set<string>();
  let previousHash: string | null = null;
  let previousDecidedAtTick = Number.NEGATIVE_INFINITY;
  for (const [index, { storageId, decision }] of decisions.entries()) {
    if (storageId !== decision.id) {
      errors.push(
        `Deliverable receipt decision ${storageId} storage identity is invalid`,
      );
    }
    if (!validateDeliverableReceiptDecision(portfolio, decision)) {
      errors.push(
        `Deliverable receipt decision ${decision.id} authority is invalid`,
      );
    }
    if (decidedReceiptIds.has(decision.receiptId)) {
      errors.push(
        `Deliverable receipt ${decision.receiptId} has multiple terminal decisions`,
      );
    }
    decidedReceiptIds.add(decision.receiptId);
    const expectedSequence = index + 1;
    if (
      decision.sequence !== expectedSequence ||
      decision.previousDecisionHash !== previousHash
    ) {
      errors.push(
        `Deliverable receipt decision ledger is not contiguous at sequence ${decision.sequence}`,
      );
    }
    if (decision.decidedAtTick < previousDecidedAtTick) {
      errors.push(
        `Deliverable receipt decision chronology regresses at sequence ${decision.sequence}`,
      );
    }
    previousHash = decision.decisionHash;
    previousDecidedAtTick = decision.decidedAtTick;
  }
  return errors;
}

/**
 * Capture one immutable terminal-Activity observation. This records received
 * system evidence only; it never fabricates accountable acceptance or marks a
 * Deliverable complete.
 */
export function recordDeliverableReceipt(
  roomName: string,
  deliverableId: string,
  sourceActivityId: string,
): FspmDeliverableReceipt {
  return controlledAuthorityMutation(() => {
    const colony = Memory.colonies[roomName];
    const portfolio = colony?.fspm;
    if (!colony || !portfolio) {
      throw new Error(`Unknown FSPM portfolio ${roomName}`);
    }
    const governanceErrors = validateColonyGovernanceAuthority(portfolio);
    if (governanceErrors.length > 0) {
      throw new Error(
        `Cannot record Deliverable receipt under invalid authority: ${governanceErrors.join("; ")}`,
      );
    }
    const deliverable = Object.values(portfolio.deliverables).find(
      (record) => record?.id === deliverableId,
    );
    if (!deliverable) throw new Error(`Unknown Deliverable ${deliverableId}`);
    if (deliverable.status !== "active") {
      throw new Error(
        `Deliverable ${deliverable.id} is ${deliverable.status}; receipt capture requires active authority`,
      );
    }
    const activity = portfolio.activities?.[sourceActivityId];
    if (activity && activity.id !== sourceActivityId) {
      throw new Error(
        `Activity storage identity ${sourceActivityId} does not match record identity ${activity.id}`,
      );
    }
    if (
      activity?.status !== "completed" ||
      activity.completedAt === undefined ||
      !activity.kpiScore
    ) {
      throw new Error(
        "Deliverable receipt requires a completed Activity with terminal KPI evidence",
      );
    }
    const sourceTask = portfolio.tasks[activity.taskId];
    if (!sourceTask || sourceTask.deliverableId !== deliverable.id) {
      throw new Error(
        `Activity ${sourceActivityId} does not belong to Deliverable ${deliverable.id}`,
      );
    }
    if (!hasCanonicalReceiptActivityChronology(portfolio, activity)) {
      throw new Error(
        `Activity ${sourceActivityId} chronology must begin at or after package import and end no later than the current tick`,
      );
    }
    const evidenceReference = deliverableReceiptEvidenceReference(activity);
    if (!evidenceReference) {
      throw new Error(`Activity ${sourceActivityId} has no terminal evidence`);
    }
    const receiptRegistry = portfolio.deliverableReceipts ?? {};
    if (
      Object.values(receiptRegistry).some(
        (receipt) =>
          receipt.deliverableId === deliverable.id &&
          receipt.deliverableRevision === deliverable.revision &&
          receipt.sourceActivityId === activity.id,
      )
    ) {
      throw new Error(
        `Activity ${activity.id} already has a receipt for ${deliverable.id} revision ${deliverable.revision}`,
      );
    }
    const previous = Object.values(receiptRegistry)
      .filter((receipt) => receipt.deliverableId === deliverable.id)
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    const sequence = (previous?.sequence ?? 0) + 1;
    const id = `receipt:${deliverable.id}:r${deliverable.revision}:${sequence}`;
    if (receiptRegistry[id]) {
      throw new Error(`Deliverable receipt ${id} already exists`);
    }
    const content: Omit<FspmDeliverableReceipt, "receiptHash"> = {
      id,
      sequence,
      deliverableId: deliverable.id,
      deliverableRevision: deliverable.revision,
      deliverableContentHash: deliverable.approvedContentHash,
      evidenceForm: deliverable.receiptValidation.evidenceForm,
      evidenceReference,
      sourceActivityId: activity.id,
      sourceTaskId: activity.taskId,
      sourceActivityCreatedAtTick: activity.createdAt,
      sourceActivityStartedAtTick: activity.startedAt as number,
      sourceActivityCompletedAtTick: activity.completedAt,
      sourceActivityUpdatedAtTick: activity.updatedAt,
      sourceActivityQualityMetric: activity.qualityMetric,
      sourceActivityKpiScore: activity.kpiScore,
      outcome: "received",
      storageLocation: deliverable.receiptValidation.storageLocation,
      capturedBy: deliverable.receiptValidation.captureResponsibility,
      capturedAtTick: Game.time,
      previousReceiptHash: previous?.receiptHash ?? null,
    };
    const receipt: FspmDeliverableReceipt = {
      ...content,
      receiptHash: governanceContentHash(deliverableReceiptContent(content)),
    };
    const nextRegistry = { ...receiptRegistry, [id]: receipt };
    const nextPortfolio: ColonyFspmPortfolio = {
      ...portfolio,
      deliverableReceipts: nextRegistry,
      authorityLedgerAnchors: {
        ...(portfolio.authorityLedgerAnchors ?? emptyAuthorityLedgerAnchors()),
        deliverableReceipts: authorityLedgerAnchorFor(
          nextRegistry,
          (entry) => entry.receiptHash,
        ),
      },
    };
    const registryErrors = validateDeliverableReceiptRegistry(nextPortfolio);
    if (registryErrors.length > 0) {
      throw new Error(
        `Cannot atomically append invalid Deliverable receipt: ${registryErrors.join("; ")}`,
      );
    }
    colony.fspm = nextPortfolio;
    invalidateFspmPlanningAuthorityContext();
    return receipt;
  });
}

/**
 * Record one terminal accountable decision over captured evidence. The actor is
 * the package-bound Screeps service principal; canonical human acceptance is a
 * separate, explicitly unimplemented integration.
 */
export function decideDeliverableReceipt(
  roomName: string,
  receiptId: string,
  outcome: FspmDeliverableReceiptDecision["outcome"],
  reason: string,
): FspmDeliverableReceiptDecision {
  return controlledAuthorityMutation(() => {
    const colony = Memory.colonies[roomName];
    const portfolio = colony?.fspm;
    if (!colony || !portfolio) {
      throw new Error(`Unknown FSPM portfolio ${roomName}`);
    }
    const governanceErrors = validateColonyGovernanceAuthority(portfolio);
    if (governanceErrors.length > 0) {
      throw new Error(
        `Cannot decide a Deliverable receipt under invalid authority: ${governanceErrors.join("; ")}`,
      );
    }
    if (!["accepted", "rejected", "disputed"].includes(outcome)) {
      throw new Error(`Unsupported Deliverable receipt decision ${outcome}`);
    }
    const normalizedReason = reason.trim();
    if (
      !normalizedReason ||
      normalizedReason !== reason ||
      reason.length > 500
    ) {
      throw new Error(
        "Deliverable receipt decision reason must be nonblank, trimmed, and at most 500 characters",
      );
    }
    const receipt = portfolio.deliverableReceipts?.[receiptId];
    if (!receipt || !validateDeliverableReceipt(portfolio, receipt)) {
      throw new Error(`Unknown or invalid Deliverable receipt ${receiptId}`);
    }
    const deliverable = Object.values(portfolio.deliverables).find(
      (record) => record?.id === receipt.deliverableId,
    );
    if (deliverable?.status !== "active") {
      throw new Error(
        `Deliverable ${receipt.deliverableId} is unavailable for a receipt decision`,
      );
    }
    if (
      outcome === "accepted" &&
      !deliverable.servicePrincipalAcceptance.acceptedKpiRatings.includes(
        receipt.sourceActivityKpiScore as "exceptional" | "satisfactory",
      )
    ) {
      throw new Error(
        `Deliverable receipt ${receipt.id} KPI ${receipt.sourceActivityKpiScore} does not satisfy the package-bound service-principal acceptance policy`,
      );
    }
    const decisions = portfolio.deliverableReceiptDecisions ?? {};
    if (
      Object.values(decisions).some(
        (decision) => decision.receiptId === receipt.id,
      )
    ) {
      throw new Error(
        `Deliverable receipt ${receipt.id} already has a terminal decision`,
      );
    }
    const previous = Object.values(decisions)
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    const sequence = (previous?.sequence ?? 0) + 1;
    const binding = portfolio.governanceBinding;
    if (!binding) throw new Error("Governance binding is missing");
    if (Game.time < receipt.capturedAtTick) {
      throw new Error("Receipt decision tick predates evidence capture");
    }
    const id = `receipt-decision:${receipt.id}:${sequence}`;
    if (decisions[id]) {
      throw new Error(`Deliverable receipt decision ${id} already exists`);
    }
    const content: Omit<FspmDeliverableReceiptDecision, "decisionHash"> = {
      id,
      sequence,
      receiptId: receipt.id,
      receiptHash: receipt.receiptHash,
      deliverableId: receipt.deliverableId,
      deliverableRevision: receipt.deliverableRevision,
      deliverableContentHash: receipt.deliverableContentHash,
      outcome,
      reason: normalizedReason,
      decisionAuthority: "screeps_accountable_service_principal",
      decidedBy: binding.accountablePrincipalId,
      decidedAtTick: Game.time,
      authorityPackageId: binding.authorityPackageId,
      authorityPackageRevision: binding.authorityPackageRevision,
      authorityPackageHash: binding.authorityPackageHash,
      previousDecisionHash: previous?.decisionHash ?? null,
    };
    const decision: FspmDeliverableReceiptDecision = {
      ...content,
      decisionHash: governanceContentHash(
        deliverableReceiptDecisionContent(content),
      ),
    };
    const nextDecisions = { ...decisions, [decision.id]: decision };
    const nextPortfolio: ColonyFspmPortfolio = {
      ...portfolio,
      deliverableReceiptDecisions: nextDecisions,
      authorityLedgerAnchors: {
        ...(portfolio.authorityLedgerAnchors ?? emptyAuthorityLedgerAnchors()),
        deliverableReceiptDecisions: authorityLedgerAnchorFor(
          nextDecisions,
          (entry) => entry.decisionHash,
        ),
      },
    };
    const decisionErrors =
      validateDeliverableReceiptDecisionRegistry(nextPortfolio);
    if (decisionErrors.length > 0) {
      throw new Error(
        `Cannot atomically append invalid Deliverable receipt decision: ${decisionErrors.join("; ")}`,
      );
    }
    colony.fspm = nextPortfolio;
    invalidateFspmPlanningAuthorityContext();
    return decision;
  });
}

function ensureEmpirePortfolioImpl(): EmpireFspmPortfolio {
  invalidateFspmPlanningAuthorityContext();
  Memory.empireFspm ??= {
    p3: createEmpirePortfolioP3(earliestKnownColonyTick(), Game.time),
  };
  if (Memory.empireFspm.p3.status === "active") {
    Memory.empireFspm.p3.statusReason =
      "root Empire Operations Portfolio is continuously managed";
    Memory.empireFspm.p3.updatedAt = Game.time;
  }
  return Memory.empireFspm;
}

export function ensureEmpirePortfolio(): EmpireFspmPortfolio {
  return controlledAuthorityMutation(ensureEmpirePortfolioImpl);
}

function retireLegacyAuthority(portfolio: ColonyFspmPortfolio): void {
  if (portfolio.program && portfolio.program.status !== "retired") {
    portfolio.program.status = "retired";
    portfolio.program.statusReason =
      "retired after governance audit determined colony operations are Portfolio scope, not a Service Program";
    portfolio.program.retiredAt = Game.time;
  }

  if (portfolio.contract && portfolio.contract.status !== "retired") {
    portfolio.contract.status = "retired";
    portfolio.contract.statusReason =
      "retired synthetic contract authority; no Federal customer award or contractual period of performance exists";
    portfolio.contract.updatedAt = Game.time;
  }
}

function ensureColonyPortfolioImpl(roomName: string): ColonyFspmPortfolio {
  invalidateFspmPlanningAuthorityContext();
  const colony = Memory.colonies[roomName];
  if (!colony)
    throw new Error(
      `Cannot create FSPM portfolio for unknown colony ${roomName}`,
    );
  if (colony.fspm && !colony.fspm.p3) {
    throw new Error(
      `FSPM colony authority container ${roomName} is missing its required root P3; refusing implicit repair outside versioned migration`,
    );
  }
  for (const task of Object.values(colony.fspm?.tasks ?? {})) {
    if (!task) continue;
    if (task.status !== "active" && task.status !== "retired") {
      throw new Error(
        `FSPM Task ${task.id} has invalid lifecycle state ${String(task.status)}; refusing implicit activation`,
      );
    }
  }
  ensureEmpirePortfolio();

  if (!colony.fspm) {
    colony.fspm = {
      p3: createColonyPortfolioP3(roomName, colony.discoveredAt, Game.time),
      requirements: {},
      deliverables: {},
      tasks: {},
      activities: {},
      operationalHealthHistory: {},
      activityKpiHistory: {},
      requirementApprovalLedger: {},
      deliverableReceipts: {},
      deliverableReceiptDecisions: {},
      authorityLifecycleLedger: {},
      authorityLedgerAnchors: emptyAuthorityLedgerAnchors(),
    };
  }

  const portfolio = colony.fspm;
  if (portfolio.p3.parentP3Id === undefined) {
    portfolio.p3.parentP3Id = EMPIRE_PORTFOLIO_ID;
  }
  portfolio.p3.temporalBasis = "game_tick";
  portfolio.p3.startTick ??= colony.discoveredAt;
  portfolio.p3.description ??= `Continuously manage economy, workforce, construction, defense, expansion and operational priorities for owned colony ${roomName}.`;
  portfolio.p3.name ??= `COLONY-PORTFOLIO-${roomName} Operations`;
  if (portfolio.p3.status === "active") {
    portfolio.p3.statusReason =
      "owned colony is continuously managed as subordinate Portfolio scope";
    portfolio.p3.updatedAt = Game.time;
  }
  portfolio.activities ??= {};
  portfolio.operationalHealthHistory ??= {};
  portfolio.activityKpiHistory ??= {};
  portfolio.requirementApprovalLedger ??= {};
  portfolio.deliverableReceipts ??= {};
  portfolio.deliverableReceiptDecisions ??= {};
  portfolio.authorityLifecycleLedger ??= {};
  portfolio.authorityLedgerAnchors ??= emptyAuthorityLedgerAnchors();

  retireLegacyAuthority(portfolio);

  return portfolio;
}

export function ensureColonyPortfolio(roomName: string): ColonyFspmPortfolio {
  return controlledAuthorityMutation(() => ensureColonyPortfolioImpl(roomName));
}

function ensureDomainHierarchyImpl(roomName: string, domain: FspmDomain) {
  const portfolio = ensureColonyPortfolio(roomName);
  const errors = validateColonyGovernanceAuthority(portfolio);
  if (errors.length > 0) {
    throw new Error(
      `Cannot resolve governed ${domain} hierarchy for ${roomName}: ${errors.join("; ")}`,
    );
  }
  const requirement = portfolio.requirements[domain];
  const deliverable = portfolio.deliverables[domain];
  if (!requirement || !deliverable) {
    throw new Error(
      `Cannot resolve governed ${domain} hierarchy for ${roomName}: approved authority is missing`,
    );
  }

  return { portfolio, requirement, deliverable };
}

export function ensureDomainHierarchy(roomName: string, domain: FspmDomain) {
  return controlledAuthorityMutation(() =>
    ensureDomainHierarchyImpl(roomName, domain),
  );
}

function ensureTaskImpl(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
): ColonyTask {
  requireFspmTaskDefinition(domain, taskKey);
  const { portfolio } = ensureDomainHierarchy(roomName, domain);
  const id = `task:${roomName}:${domain}:${taskKey}`;
  const existing = portfolio.tasks[id];
  if (!existing) throw new Error(`Approved FSPM Task ${id} is missing`);
  if (existing.status !== "active") {
    throw new Error(`Cannot use inactive FSPM Task ${id} (${existing.status})`);
  }
  return existing;
}

export function ensureTask(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
): ColonyTask {
  return controlledAuthorityMutation(() =>
    ensureTaskImpl(roomName, domain, taskKey),
  );
}

function ensureProcedureImpl(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): FspmProcedure {
  const definition = requireFspmTaskDefinition(domain, taskKey);
  const procedureDefinition = definition.procedures.find(
    (candidate) => candidate.key === procedureKey,
  );
  if (!procedureDefinition) {
    throw new Error(
      `Unknown FSPM Procedure ${domain}:${taskKey}:${procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }

  const task = ensureTask(roomName, domain, taskKey);
  const id = `procedure:${roomName}:${domain}:${taskKey}:${procedureKey}`;
  const existing = task.procedures.find((procedure) => procedure.id === id);
  if (!existing) throw new Error(`Approved FSPM Procedure ${id} is missing`);
  return existing;
}

export function ensureProcedure(
  roomName: string,
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): FspmProcedure {
  return controlledAuthorityMutation(() =>
    ensureProcedureImpl(roomName, domain, taskKey, procedureKey),
  );
}

function synchronizeFspmPlanningAuthoritySpine(
  roomName: string,
  domain: FspmDomain,
  portfolio: ColonyFspmPortfolio,
  requirement: ColonyRequirement,
  deliverable: ColonyDeliverable,
  task: ColonyTask,
  procedure: FspmProcedure,
): void {
  const context = planningAuthorityContext;
  const colony = Memory.colonies[roomName];
  if (
    !context ||
    !colony ||
    context.tick !== Game.time ||
    context.memory !== Memory ||
    context.colonies !== Memory.colonies ||
    context.revision !== planningAuthorityRevision
  ) {
    return;
  }

  context.empire = Memory.empireFspm;
  context.empireP3 = Memory.empireFspm?.p3;
  let witness = context.rooms.get(roomName);
  if (!witness) {
    witness = {
      colony,
      portfolio,
      p3: portfolio.p3,
      requirements: portfolio.requirements,
      deliverables: portfolio.deliverables,
      tasks: portfolio.tasks,
      requirementsByDomain: new Map(),
      deliverablesByDomain: new Map(),
      tasksById: new Map(),
    };
    context.rooms.set(roomName, witness);
  }

  witness.colony = colony;
  witness.portfolio = portfolio;
  witness.p3 = portfolio.p3;
  witness.requirements = portfolio.requirements;
  witness.deliverables = portfolio.deliverables;
  witness.tasks = portfolio.tasks;
  witness.requirementsByDomain.set(domain, requirement);
  witness.deliverablesByDomain.set(domain, deliverable);
  let taskWitness = witness.tasksById.get(task.id);
  if (!taskWitness || taskWitness.task !== task) {
    taskWitness = {
      storageId: task.id,
      task,
      procedures: task.procedures,
      proceduresById: new Map(),
      procedureIndexesById: new Map(),
    };
    for (const [index, candidate] of task.procedures.entries()) {
      taskWitness.proceduresById.set(candidate.id, candidate);
      taskWitness.procedureIndexesById.set(candidate.id, index);
    }
    witness.tasksById.set(task.id, taskWitness);
  } else {
    taskWitness.procedures = task.procedures;
    taskWitness.proceduresById.set(procedure.id, procedure);
    const procedureIndex = fspmProcedureIndex(
      task.domain,
      task.taskKey,
      procedure.procedureKey,
    );
    if (procedureIndex === undefined) {
      throw new Error(
        `Cannot index unknown FSPM Procedure ${procedure.id} after trace materialization`,
      );
    }
    taskWitness.procedureIndexesById.set(procedure.id, procedureIndex);
  }
  guardMaterializedAuthoritySpine(
    roomName,
    portfolio,
    requirement,
    deliverable,
    task,
    procedure,
  );
}

function materializeFspmTraceSpine(input: FspmTraceLineageInput): {
  portfolio: ColonyFspmPortfolio;
  requirement: ColonyRequirement;
  deliverable: ColonyDeliverable;
  task: ColonyTask;
  procedure: FspmProcedure;
} {
  const colony = Memory.colonies[input.roomName];
  if (!colony) {
    throw new Error(
      `Cannot create FSPM portfolio for unknown colony ${input.roomName}`,
    );
  }
  const portfolio = colony.fspm;
  if (!portfolio) {
    throw new Error(
      `Cannot create FSPM trace for ${input.roomName}: approved governance is missing`,
    );
  }
  const requirement = portfolio.requirements[input.domain];
  const deliverable = portfolio.deliverables[input.domain];
  if (!requirement || !deliverable) {
    throw new Error(
      `Cannot create FSPM trace for ${input.roomName}:${input.domain}: approved Requirement or Deliverable is missing`,
    );
  }

  requireFspmTaskDefinition(input.domain, input.taskKey);
  const taskId = `task:${input.roomName}:${input.domain}:${input.taskKey}`;
  const task = portfolio.tasks[taskId];
  if (!task) throw new Error(`Approved FSPM Task ${taskId} is missing`);

  const procedureDefinition = fspmProcedureDefinition(
    input.domain,
    input.taskKey,
    input.procedureKey,
  );
  if (!procedureDefinition) {
    throw new Error(
      `Unknown FSPM Procedure ${input.domain}:${input.taskKey}:${input.procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }
  const procedureId = `procedure:${input.roomName}:${input.domain}:${input.taskKey}:${input.procedureKey}`;
  const procedureIndex = fspmProcedureIndex(
    input.domain,
    input.taskKey,
    input.procedureKey,
  );
  if (procedureIndex === undefined) {
    throw new Error(
      `Unknown FSPM Procedure ${input.domain}:${input.taskKey}:${input.procedureKey}; Procedure definitions are governed by the canonical Task catalog`,
    );
  }
  const procedure = task.procedures[procedureIndex];
  if (!procedure || procedure.id !== procedureId) {
    throw new Error(`Approved FSPM Procedure ${procedureId} is missing`);
  }

  return { portfolio, requirement, deliverable, task, procedure };
}

export interface FspmTraceLineageInput {
  roomName: string;
  domain: FspmDomain;
  taskKey: string;
  procedureKey: string;
  workKey?: string;
}

/**
 * Validate and resolve one governed trace as a single indexed operation.
 * Requirements, Deliverables, Tasks, and Procedures already exist because the
 * approved package was activated before planners. Intent creation is read-only.
 */
export function ensureFspmTraceLineage(
  input: FspmTraceLineageInput,
): IntentTrace {
  traceCreationDepth += 1;
  try {
    assertFspmTraceCreationAllowed(
      input.roomName,
      input.domain,
      input.taskKey,
      input.procedureKey,
    );
    const { portfolio, requirement, deliverable, task, procedure } =
      materializeFspmTraceSpine(input);
    synchronizeFspmPlanningAuthoritySpine(
      input.roomName,
      input.domain,
      portfolio,
      requirement,
      deliverable,
      task,
      procedure,
    );

    return {
      p3Id: portfolio.p3.id,
      requirementId: requirement.id,
      deliverableId: deliverable.id,
      taskId: task.id,
      procedureId: procedure.id,
      ...(input.workKey ? { workKey: input.workKey } : {}),
    };
  } catch (error) {
    if (planningAuthorityViolationTick !== Game.time) {
      planningAuthorityRevision += 1;
      planningAuthorityContext = undefined;
    }
    throw error;
  } finally {
    traceCreationDepth -= 1;
  }
}

function reconcileFspmLifecycleImpl(_intents: Intent[]): void {
  invalidateFspmPlanningAuthorityContext();
  for (const colony of Object.values(Memory.colonies)) {
    if (colony.fspm && !colony.fspm.p3) {
      throw new Error(
        `FSPM colony authority container ${colony.roomName} is missing its required root P3; refusing lifecycle reconciliation`,
      );
    }
    for (const task of Object.values(colony.fspm?.tasks ?? {})) {
      if (!task) continue;
      if (task.status !== "active" && task.status !== "retired") {
        throw new Error(
          `FSPM Task ${task.id} has invalid lifecycle state ${String(task.status)}; refusing lifecycle reconciliation`,
        );
      }
    }
  }
  ensureEmpirePortfolio();

  for (const colony of Object.values(Memory.colonies)) {
    const portfolio = colony.fspm;
    if (!portfolio) continue;

    ensureColonyPortfolio(colony.roomName);
    const governanceErrors = validateColonyGovernanceAuthority(portfolio);
    if (governanceErrors.length > 0) {
      throw new Error(
        `Cannot reconcile invalid FSPM governance for ${colony.roomName}: ${governanceErrors.join("; ")}`,
      );
    }

    if (portfolio.p3.status === "active") {
      portfolio.p3.statusReason =
        "owned colony is continuously managed as subordinate Portfolio scope";
      portfolio.p3.updatedAt = Game.time;
    }
  }
}

export function reconcileFspmLifecycle(intents: Intent[]): void {
  controlledAuthorityMutation(() => reconcileFspmLifecycleImpl(intents));
}
