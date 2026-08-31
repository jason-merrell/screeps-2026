import type { Intent } from "../intents/types";
import {
  FSPM_GOVERNANCE_SHA,
  type FspmTaskDetermination,
} from "./fspm-catalog";
import {
  canonicalGovernanceJson,
  FSPM_WEIGHT_BASIS_POINTS,
  type FspmEvaluationFactors,
  type FspmReceiptValidationContract,
  type FspmServicePrincipalAcceptancePolicy,
  governanceContentHash,
  isCanonicalRequirementSource,
} from "./fspm-governance";
import {
  ROOM_DEVELOPMENT_STAGES,
  ROOM_PLAN_HORIZON_RCL,
  ROOM_PLAN_PLANNER_REVISION,
  ROOM_PLAN_VERSION,
  type RoomDevelopmentStageId,
} from "./room-plan";

/**
 * This module is deliberately absent from the World loop and Memory schema.
 * It defines and validates a detached authority candidate; it cannot activate
 * a P3, create an Activity, authorize an intent, or manufacture old evidence.
 */

export const MATURE_BASE_PROJECT_PACKAGE_SCHEMA =
  "screeps-fspm-mature-base-project-authority-package/v1" as const;
export const MATURE_BASE_PROJECT_PACKAGE_ID =
  "authority-package:empire:world-mature-base-development:v1" as const;
export const MATURE_BASE_PROJECT_PACKAGE_REVISION = 1 as const;
export const MATURE_BASE_PROJECT_PACKAGE_EFFECTIVE_DATE = "2026-08-31" as const;
export const MATURE_BASE_PROJECT_POLICY_ID =
  "2026.08.31-Screeps World Mature Base Development Policy v1" as const;
export const MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR =
  "§ Binding obligation" as const;
export const MATURE_BASE_PROJECT_POLICY_OBLIGATION =
  "Each owned Screeps World colony shall be developed through an accepted deterministic RCL8 room-development plan and independently evidenced Bootstrap, Logistics, Core Economy, Advanced Operations, and Mature RCL8 base states before the temporary development Project is complete. Controller level is an eligibility condition only and shall not constitute evidence that a base state has been achieved." as const;
export const MATURE_BASE_PROJECT_POLICY_VERBIAGE =
  `${MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR}\n${MATURE_BASE_PROJECT_POLICY_OBLIGATION}` as const;
export const MATURE_BASE_PROJECT_CANDIDATE_SCHEMA =
  "screeps-fspm-mature-base-project-candidate/v1" as const;
export const MATURE_BASE_QUALITY_METRIC_SCHEMA =
  "screeps-fspm-mature-base-quality-metric/v1" as const;
export const MATURE_BASE_EVIDENCE_SCHEMA =
  "screeps-fspm-mature-base-evidence/v1" as const;

const ACCOUNTABLE_PRINCIPAL_ID = "principal:repository-governance-owner";
const ACCOUNTABLE_POSITION_ID = "position:empire-operations:accountable";
const EVIDENCE_CAPTURE_PRINCIPAL_ID = "principal:runtime-evidence-recorder";
const MAX_VALIDATION_STRING_LENGTH = 32_768;
const MAX_VALIDATION_NODES = 20_000;

export type MatureBaseDeliverableKey =
  | "room-development-plan"
  | "mature-base-state"
  | "bootstrap"
  | "logistics"
  | "core-economy"
  | "advanced-operations"
  | "mature-rcl8";

export type MatureBaseMilestoneKey =
  | "roomDevelopmentPlan"
  | RoomDevelopmentStageId;

export interface MatureBaseMilestoneTicks {
  readonly roomDevelopmentPlan: number;
  readonly bootstrap: number;
  readonly logistics: number;
  readonly "core-economy": number;
  readonly "advanced-operations": number;
  readonly "mature-rcl8": number;
}

export interface MatureBaseProjectCandidateInput {
  readonly roomName: string;
  readonly parentP3Id: string;
  readonly projectGeneration: number;
  readonly startTick: number;
  readonly initialDueTick: number;
  readonly initialMilestoneTicks: MatureBaseMilestoneTicks;
  readonly scheduleAttestationId: string;
  readonly attestedBy: string;
  readonly attestedAtTick: number;
  readonly typedAttestation: string;
}

export type MatureBaseValidationRule =
  | "MBP-DAT-001"
  | "MBP-INP-001"
  | "MBP-INP-002"
  | "MBP-INP-003"
  | "MBP-INP-004"
  | "MBP-INP-005"
  | "MBP-INP-006"
  | "MBP-INP-007"
  | "MBP-INP-008"
  | "MBP-PKG-001"
  | "MBP-PKG-002"
  | "MBP-PKG-003"
  | "MBP-PKG-004"
  | "MBP-PKG-005"
  | "MBP-PKG-006"
  | "MBP-PKG-007"
  | "MBP-PKG-008"
  | "MBP-PKG-009"
  | "MBP-AUT-001"
  | "MBP-AUT-002"
  | "MBP-PRJ-001"
  | "MBP-REQ-001"
  | "MBP-DLV-001"
  | "MBP-DLV-002"
  | "MBP-DLV-003"
  | "MBP-DLV-004"
  | "MBP-TSK-001"
  | "MBP-TSK-002"
  | "MBP-BND-001"
  | "MBP-HSH-001"
  | "MBP-EXA-001";

export interface MatureBaseValidationFinding {
  readonly rule: MatureBaseValidationRule;
  readonly canonicalRules: readonly string[];
  readonly severity: "blocker" | "error" | "warning";
  readonly path: string;
  readonly message: string;
}

export interface MatureBasePlanMetricPolicy {
  readonly schema: typeof MATURE_BASE_QUALITY_METRIC_SCHEMA;
  readonly evaluator: "room_plan_projection_v1";
  readonly roomPlanVersion: typeof ROOM_PLAN_VERSION;
  readonly horizonRcl: typeof ROOM_PLAN_HORIZON_RCL;
  readonly plannerRevision: typeof ROOM_PLAN_PLANNER_REVISION;
  readonly clauses: readonly [
    "immutable_artifact_hash_present",
    "projection_room_matches_project",
    "projection_is_current_and_usable",
    "projection_fingerprint_is_valid",
    "room_plan_validation_has_no_issues",
    "artifact_captured_at_or_after_project_start",
  ];
  readonly controllerLevelIsReceiptEvidence: false;
  readonly artifactEvidence: {
    readonly state: "blocked_pending_content_recomputing_verifier";
    readonly issue: "#176";
  };
}

export interface MatureBaseStageMetricPolicy {
  readonly schema: typeof MATURE_BASE_QUALITY_METRIC_SCHEMA;
  readonly evaluator: "room_development_stage_v1";
  readonly stageId: RoomDevelopmentStageId;
  readonly minimumControllerLevel: number;
  readonly prerequisiteStageIds: readonly RoomDevelopmentStageId[];
  readonly requiredAcceptedDeliverableKeys: readonly ["room-development-plan"];
  readonly blueprintClauses: readonly [
    "evidence_captured_at_or_after_project_start",
    "accepted_plan_product_is_current",
    "plan_horizon_is_valid",
    "controller_is_eligible",
    "prerequisites_are_currently_realized",
    "stage_status_is_realized",
    "realized_weight_equals_eligible_weight",
    "realization_percentage_is_100",
    "no_missing_or_blocked_eligible_structure",
  ];
  readonly controllerLevelIsReceiptEvidence: false;
  readonly blueprintEvidence: {
    readonly state: "blocked_pending_content_recomputing_verifier";
    readonly issue: "#176";
  };
  readonly operationalEvidence: {
    readonly state: "blocked_pending_governed_evaluator";
    readonly requiredEvidenceKinds: readonly MatureBaseOperationalEvidenceKind[];
    readonly issue: "#176";
  };
}

export type MatureBaseOperationalEvidenceKind =
  | "bootstrap_recovery"
  | "source_throughput"
  | "transport_continuity"
  | "storage_logistics"
  | "defensive_readiness"
  | "advanced_service_operation"
  | "mature_capability_readiness";

export interface MatureBaseAggregateMetricPolicy {
  readonly schema: typeof MATURE_BASE_QUALITY_METRIC_SCHEMA;
  readonly evaluator: "mature_base_integration_v1";
  readonly requiredAcceptedDeliverableKeys: readonly MatureBaseDeliverableKey[];
  readonly clauses: readonly [
    "plan_product_is_accepted",
    "all_five_stage_results_are_accepted",
    "all_five_stage_blueprints_are_currently_realized",
    "next_milestone_is_mature_outcome_realized",
    "no_missing_or_blocked_planned_structure",
    "all_stage_operational_evidence_is_current_and_fresh",
    "all_applicable_mature_capabilities_are_authorized_and_implemented",
    "active_defense_evidence_is_complete_and_without_readiness_debt",
  ];
  readonly matureCapabilityManifest: "MATURE_CAPABILITY_GATES";
  readonly activeDefenseEvaluator: "assessPreparedActiveDefense";
  readonly requiredCurrentOperationalEvidenceKinds: readonly MatureBaseOperationalEvidenceKind[];
  readonly controllerLevelIsReceiptEvidence: false;
  readonly operationalEvidence: {
    readonly state: "blocked_pending_governed_evaluator";
    readonly freshnessPolicy: "blocked_pending_governed_threshold";
    readonly issue: "#176";
  };
}

export type MatureBaseQualityMetricPolicy =
  | MatureBasePlanMetricPolicy
  | MatureBaseStageMetricPolicy
  | MatureBaseAggregateMetricPolicy;

export interface MatureBaseReceiptValidationContract
  extends FspmReceiptValidationContract {
  readonly evidenceSchema: typeof MATURE_BASE_EVIDENCE_SCHEMA;
  readonly storageState: "blocked_pending_durable_append_only_store";
}

export interface MatureBaseAcceptanceDecisionContract {
  readonly state: "not_authorized";
  readonly decisionResponsibility: typeof ACCOUNTABLE_PRINCIPAL_ID;
  readonly evidenceCaptureSeparationRequired: true;
  readonly canonicalHumanAcceptance: false;
}

export interface MatureBaseRequirementTemplate {
  readonly templateKey: "mature-base-development";
  readonly titleTemplate: "Develop {roomName} to a Mature Operating Base";
  readonly requestorId: typeof ACCOUNTABLE_PRINCIPAL_ID;
  readonly requirementTrigger: "strategicBusinessObjective";
  readonly requirementSource: typeof MATURE_BASE_PROJECT_POLICY_ID;
  readonly requirementVerbiage: typeof MATURE_BASE_PROJECT_POLICY_VERBIAGE;
  readonly purposeStatement: string;
  readonly strategicPriority: "SERVE";
  readonly strategicAlignment: string;
  readonly desiredOutcomes: string;
  readonly businessCase: string;
}

export interface MatureBaseDeliverableTemplate {
  readonly key: MatureBaseDeliverableKey;
  readonly idSuffix: string;
  readonly category: "corporate";
  readonly deliverableType: "product" | "result";
  readonly title: string;
  readonly details: string;
  readonly output: string;
  readonly requirementTemplateKey: "mature-base-development";
  readonly requirementSource: typeof MATURE_BASE_PROJECT_POLICY_ID;
  readonly requirementVerbiage: typeof MATURE_BASE_PROJECT_POLICY_VERBIAGE;
  readonly evaluationFactors: FspmEvaluationFactors;
  readonly qualityDescription: string;
  readonly qualityMetric: string;
  readonly metricPolicy: MatureBaseQualityMetricPolicy;
  readonly receiptValidation: MatureBaseReceiptValidationContract;
  readonly servicePrincipalAcceptance: FspmServicePrincipalAcceptancePolicy;
  readonly acceptanceDecision: MatureBaseAcceptanceDecisionContract;
  readonly p3WeightBasisPoints: number;
  readonly parentKey: MatureBaseDeliverableKey | null;
  readonly childKeys: readonly MatureBaseDeliverableKey[];
}

export interface MatureBaseProcedureCandidate {
  readonly key: string;
  readonly title: string;
  readonly allowedIntentTypes: readonly Intent["type"][];
}

export interface MatureBaseTaskCandidateTemplate {
  /** Not a live FSPM Task record; no ID, status, or timestamps are present. */
  readonly candidateKind: "task_definition_candidate";
  readonly key: string;
  readonly deliverableKey: MatureBaseDeliverableKey;
  readonly title: string;
  readonly description: string;
  readonly taskWeightBasisPoints: typeof FSPM_WEIGHT_BASIS_POINTS;
  readonly qualityDescription: string;
  readonly qualityMetric: string;
  readonly kpiMetric: {
    readonly metric: string;
    readonly exceptional: string;
    readonly satisfactory: string;
    readonly unsatisfactory: string;
    readonly scaleAuthority: "existing_runtime_three_rating_adaptation_not_canonical_resolution";
  };
  readonly procedures: readonly MatureBaseProcedureCandidate[];
  readonly determination: FspmTaskDetermination;
  readonly executionEligibility: "not_authorized";
}

export interface MatureBaseProjectDefinitionPackage {
  readonly schema: typeof MATURE_BASE_PROJECT_PACKAGE_SCHEMA;
  readonly id: typeof MATURE_BASE_PROJECT_PACKAGE_ID;
  readonly revision: typeof MATURE_BASE_PROJECT_PACKAGE_REVISION;
  readonly governanceSha: typeof FSPM_GOVERNANCE_SHA;
  readonly effectiveDate: typeof MATURE_BASE_PROJECT_PACKAGE_EFFECTIVE_DATE;
  readonly authorityState: "definition_only";
  readonly grantsRuntimeAuthority: false;
  readonly issuer: {
    readonly principalId: typeof ACCOUNTABLE_PRINCIPAL_ID;
    readonly organizationalUnitId: "ou:empire-operations";
    readonly accountablePositionId: typeof ACCOUNTABLE_POSITION_ID;
  };
  readonly approval: {
    readonly type: "source_control_policy_attestation";
    readonly signedBy: typeof ACCOUNTABLE_PRINCIPAL_ID;
    readonly typedSignature: "APPROVE WORLD MATURE BASE PROJECT DEFINITION PACKAGE V1";
    readonly signedAt: typeof MATURE_BASE_PROJECT_PACKAGE_EFFECTIVE_DATE;
    readonly signedContentHash: string;
    readonly canonicalHumanApproval: false;
  };
  readonly requirement: MatureBaseRequirementTemplate;
  readonly deliverables: readonly MatureBaseDeliverableTemplate[];
  readonly taskCandidates: readonly MatureBaseTaskCandidateTemplate[];
  readonly contentHash: string;
}

export interface MatureBaseProjectCandidate {
  readonly schema: typeof MATURE_BASE_PROJECT_CANDIDATE_SCHEMA;
  readonly publicationState: "detached_candidate";
  readonly authorityPackage: {
    readonly id: typeof MATURE_BASE_PROJECT_PACKAGE_ID;
    readonly revision: typeof MATURE_BASE_PROJECT_PACKAGE_REVISION;
    readonly governanceSha: typeof FSPM_GOVERNANCE_SHA;
    readonly contentHash: string;
  };
  readonly scheduleAttestation: {
    readonly type: "proposed_colony_project_schedule_attestation";
    readonly attestationId: string;
    readonly roomName: string;
    readonly parentP3Id: string;
    readonly projectGeneration: number;
    readonly startTick: number;
    readonly initialDueTick: number;
    readonly initialMilestoneTicks: MatureBaseMilestoneTicks;
    readonly attestedBy: string;
    readonly attestedAtTick: number;
    readonly typedAttestation: string;
    readonly canonicalHumanAuthorization: false;
    readonly grantsProjectAuthority: false;
    readonly attestedContentHash: string;
  };
  readonly project: {
    readonly candidateKind: "p3_candidate";
    readonly id: string;
    readonly type: "project";
    readonly subType: "general_project";
    readonly roomName: string;
    readonly projectGeneration: number;
    readonly name: string;
    readonly description: string;
    readonly parentP3Id: string;
    readonly temporalBasis: "game_tick";
    readonly startTick: number;
    readonly initialDueTick: number;
    readonly initialMilestoneTicks: MatureBaseMilestoneTicks;
    readonly initialScheduleRevision: 1;
    readonly plannedInitialStatus: "active_after_canonical_authorization_and_atomic_publication";
    readonly creationTest: {
      readonly temporaryEndeavor: true;
      readonly authorizationStatus: "pending";
      readonly servicePrincipalScheduleAttestationPresent: true;
      readonly definedStartAndEnd: true;
      readonly specifiedDeliverableIds: readonly string[];
      readonly uniqueResult: string;
      readonly excludesOngoingMaintenance: true;
    };
    readonly revision: 1;
    readonly definitionHash: string;
  };
  readonly requirement: {
    readonly candidateKind: "requirement_candidate";
    readonly id: string;
    readonly p3Id: string;
    readonly title: string;
    readonly requestorId: string;
    readonly requirementTrigger: "strategicBusinessObjective";
    readonly requirementSource: typeof MATURE_BASE_PROJECT_POLICY_ID;
    readonly requirementVerbiage: typeof MATURE_BASE_PROJECT_POLICY_VERBIAGE;
    readonly originatingAuthority?: never;
    readonly purposeStatement: string;
    readonly strategicPriority: "SERVE";
    readonly strategicAlignment: string;
    readonly applicableOuId: string;
    readonly desiredOutcomes: string;
    readonly businessCase: string;
    readonly approvalContract: {
      readonly state: "requires_canonical_authorization_and_atomic_publication";
      readonly authorityPackageId: typeof MATURE_BASE_PROJECT_PACKAGE_ID;
      readonly authorityPackageRevision: typeof MATURE_BASE_PROJECT_PACKAGE_REVISION;
      readonly authorityPackageHash: string;
      readonly accountablePositionId: typeof ACCOUNTABLE_POSITION_ID;
      readonly packageAttestationPrincipalId: typeof ACCOUNTABLE_PRINCIPAL_ID;
      readonly canonicalHumanApproval: false;
    };
    readonly revision: 1;
    readonly definitionHash: string;
  };
  readonly deliverables: readonly MatureBaseDeliverableCandidate[];
  readonly taskCandidates: readonly MatureBaseMaterializedTaskCandidate[];
  readonly runtimeBoundary: {
    readonly grantsP3Authority: false;
    readonly grantsTaskAuthority: false;
    readonly grantsIntentAuthority: false;
    readonly permitsEvidenceCapture: false;
    readonly permitsReceiptOrDecision: false;
    readonly permitsRetroactiveEvidence: false;
    readonly qi: null;
    readonly dqi: null;
    readonly pqi: null;
    readonly activationIssue: "#176";
    readonly requiredActivationPreconditions: readonly [
      "canonical_authorization_exists",
      "canonical_ou_position_and_arci_assignments_exist",
      "activation_tick_equals_canonical_authorization_tick",
      "schedule_attestation_tick_is_no_later_than_activation_tick",
      "activation_tick_is_no_later_than_start_tick",
      "no_activity_or_evidence_before_start_tick",
      "room_is_currently_owned",
      "exact_active_colony_portfolio_exists",
      "project_generation_is_monotonic_and_unused",
      "durable_append_only_evidence_store_is_bound",
      "append_only_schedule_revision_ledger_exists",
      "atomic_compact_persistence_schema_exists",
      "deliverable_weights_confirmed_by_accountable_position",
      "mature_quality_evaluator_contracts_are_content_bound",
      "mature_capability_manifest_is_content_bound",
    ];
  };
  readonly contentHash: string;
}

export interface MatureBaseDeliverableCandidate {
  readonly candidateKind: "deliverable_candidate";
  readonly id: string;
  readonly key: MatureBaseDeliverableKey;
  readonly p3Id: string;
  readonly requirementId: string;
  readonly category: "corporate";
  readonly deliverableType: "product" | "result";
  readonly title: string;
  readonly details: string;
  readonly output: string;
  readonly requirementSource: typeof MATURE_BASE_PROJECT_POLICY_ID;
  readonly requirementVerbiage: typeof MATURE_BASE_PROJECT_POLICY_VERBIAGE;
  readonly evaluationFactors: FspmEvaluationFactors;
  readonly qualityDescription: string;
  readonly qualityMetric: string;
  readonly metricPolicy: MatureBaseQualityMetricPolicy;
  readonly receiptValidation: MatureBaseReceiptValidationContract;
  readonly servicePrincipalAcceptance: FspmServicePrincipalAcceptancePolicy;
  readonly acceptanceDecision: MatureBaseAcceptanceDecisionContract;
  readonly p3WeightBasisPoints: number;
  readonly parentDeliverableId: string | null;
  readonly childDeliverableIds: readonly string[];
  readonly initialMilestoneTick: number;
  readonly revision: 1;
  readonly definitionHash: string;
}

export interface MatureBaseMaterializedTaskCandidate
  extends MatureBaseTaskCandidateTemplate {
  readonly deliverableId: string;
  readonly definitionHash: string;
}

const deliverableOrder = [
  "room-development-plan",
  "mature-base-state",
  "bootstrap",
  "logistics",
  "core-economy",
  "advanced-operations",
  "mature-rcl8",
] as const satisfies readonly MatureBaseDeliverableKey[];

const aggregatePrerequisiteDeliverableKeys = [
  "room-development-plan",
  "bootstrap",
  "logistics",
  "core-economy",
  "advanced-operations",
  "mature-rcl8",
] as const satisfies readonly MatureBaseDeliverableKey[];

const stageByDeliverableKey = {
  bootstrap: "bootstrap",
  logistics: "logistics",
  "core-economy": "core-economy",
  "advanced-operations": "advanced-operations",
  "mature-rcl8": "mature-rcl8",
} as const satisfies Readonly<
  Record<
    Exclude<
      MatureBaseDeliverableKey,
      "room-development-plan" | "mature-base-state"
    >,
    RoomDevelopmentStageId
  >
>;

const operationalEvidenceByStage = {
  bootstrap: ["bootstrap_recovery", "defensive_readiness"],
  logistics: ["source_throughput", "transport_continuity"],
  "core-economy": ["storage_logistics", "defensive_readiness"],
  "advanced-operations": ["advanced_service_operation"],
  "mature-rcl8": ["mature_capability_readiness", "defensive_readiness"],
} as const satisfies Readonly<
  Record<RoomDevelopmentStageId, readonly MatureBaseOperationalEvidenceKind[]>
>;

const governedStageContract = {
  bootstrap: {
    minimumControllerLevel: 1,
    prerequisiteStageIds: [],
    p3WeightBasisPoints: 1200,
  },
  logistics: {
    minimumControllerLevel: 2,
    prerequisiteStageIds: ["bootstrap"],
    p3WeightBasisPoints: 1200,
  },
  "core-economy": {
    minimumControllerLevel: 4,
    prerequisiteStageIds: ["bootstrap", "logistics"],
    p3WeightBasisPoints: 2000,
  },
  "advanced-operations": {
    minimumControllerLevel: 6,
    prerequisiteStageIds: ["core-economy"],
    p3WeightBasisPoints: 1600,
  },
  "mature-rcl8": {
    minimumControllerLevel: 8,
    prerequisiteStageIds: ["advanced-operations"],
    p3WeightBasisPoints: 2000,
  },
} as const satisfies Readonly<
  Record<
    RoomDevelopmentStageId,
    {
      readonly minimumControllerLevel: number;
      readonly prerequisiteStageIds: readonly RoomDevelopmentStageId[];
      readonly p3WeightBasisPoints: number;
    }
  >
>;

const receiptValidation = Object.freeze({
  evidenceForm: "logged_system_record",
  evidenceSchema: MATURE_BASE_EVIDENCE_SCHEMA,
  storageLocation: "unresolved://issue/176/mature-base-evidence",
  storageState: "blocked_pending_durable_append_only_store",
  captureResponsibility: EVIDENCE_CAPTURE_PRINCIPAL_ID,
} as const satisfies MatureBaseReceiptValidationContract);

const servicePrincipalAcceptance = Object.freeze({
  model: "terminal_activity_kpi_threshold",
  acceptedKpiRatings: Object.freeze(["exceptional", "satisfactory"]),
  canonicalHumanAcceptance: false,
} as const satisfies FspmServicePrincipalAcceptancePolicy);

const acceptanceDecision = Object.freeze({
  state: "not_authorized",
  decisionResponsibility: ACCOUNTABLE_PRINCIPAL_ID,
  evidenceCaptureSeparationRequired: true,
  canonicalHumanAcceptance: false,
} as const satisfies MatureBaseAcceptanceDecisionContract);

function evaluationFactors(subject: string): FspmEvaluationFactors {
  return {
    primaryStrategicPriority: "SERVE",
    strategicAlignment: `${subject} advances the temporary Project's governed mature-operating-base outcome.`,
    operationalEffectiveness: `${subject} is evaluated against explicit, replayable completion gates without substituting activity or controller level for an outcome.`,
    dataIntegrityAndUsability: `${subject} retains content-addressed evidence suitable for deterministic replay and independent acceptance review.`,
    adoptionAndEngagement: `${subject} is usable by the governed World colony and its operators after delivery.`,
    scalabilityAndMaintainability: `${subject} remains room-scoped, versioned, deterministic, and bounded as the empire grows.`,
  };
}

function stageMetricPolicy(
  stageId: RoomDevelopmentStageId,
): MatureBaseStageMetricPolicy {
  const stage = ROOM_DEVELOPMENT_STAGES.find((entry) => entry.id === stageId);
  if (!stage) throw new Error(`unknown room development stage ${stageId}`);
  return {
    schema: MATURE_BASE_QUALITY_METRIC_SCHEMA,
    evaluator: "room_development_stage_v1",
    stageId,
    minimumControllerLevel: stage.minRcl,
    prerequisiteStageIds: [...stage.prerequisiteStageIds],
    requiredAcceptedDeliverableKeys: ["room-development-plan"],
    blueprintClauses: [
      "evidence_captured_at_or_after_project_start",
      "accepted_plan_product_is_current",
      "plan_horizon_is_valid",
      "controller_is_eligible",
      "prerequisites_are_currently_realized",
      "stage_status_is_realized",
      "realized_weight_equals_eligible_weight",
      "realization_percentage_is_100",
      "no_missing_or_blocked_eligible_structure",
    ],
    controllerLevelIsReceiptEvidence: false,
    blueprintEvidence: {
      state: "blocked_pending_content_recomputing_verifier",
      issue: "#176",
    },
    operationalEvidence: {
      state: "blocked_pending_governed_evaluator",
      requiredEvidenceKinds: [...operationalEvidenceByStage[stageId]],
      issue: "#176",
    },
  };
}

const planMetricPolicy: MatureBasePlanMetricPolicy = {
  schema: MATURE_BASE_QUALITY_METRIC_SCHEMA,
  evaluator: "room_plan_projection_v1",
  roomPlanVersion: ROOM_PLAN_VERSION,
  horizonRcl: ROOM_PLAN_HORIZON_RCL,
  plannerRevision: ROOM_PLAN_PLANNER_REVISION,
  clauses: [
    "immutable_artifact_hash_present",
    "projection_room_matches_project",
    "projection_is_current_and_usable",
    "projection_fingerprint_is_valid",
    "room_plan_validation_has_no_issues",
    "artifact_captured_at_or_after_project_start",
  ],
  controllerLevelIsReceiptEvidence: false,
  artifactEvidence: {
    state: "blocked_pending_content_recomputing_verifier",
    issue: "#176",
  },
};

const aggregateMetricPolicy: MatureBaseAggregateMetricPolicy = {
  schema: MATURE_BASE_QUALITY_METRIC_SCHEMA,
  evaluator: "mature_base_integration_v1",
  requiredAcceptedDeliverableKeys: [...aggregatePrerequisiteDeliverableKeys],
  clauses: [
    "plan_product_is_accepted",
    "all_five_stage_results_are_accepted",
    "all_five_stage_blueprints_are_currently_realized",
    "next_milestone_is_mature_outcome_realized",
    "no_missing_or_blocked_planned_structure",
    "all_stage_operational_evidence_is_current_and_fresh",
    "all_applicable_mature_capabilities_are_authorized_and_implemented",
    "active_defense_evidence_is_complete_and_without_readiness_debt",
  ],
  matureCapabilityManifest: "MATURE_CAPABILITY_GATES",
  activeDefenseEvaluator: "assessPreparedActiveDefense",
  requiredCurrentOperationalEvidenceKinds: [
    "bootstrap_recovery",
    "source_throughput",
    "transport_continuity",
    "storage_logistics",
    "defensive_readiness",
    "advanced_service_operation",
    "mature_capability_readiness",
  ],
  controllerLevelIsReceiptEvidence: false,
  operationalEvidence: {
    state: "blocked_pending_governed_evaluator",
    freshnessPolicy: "blocked_pending_governed_threshold",
    issue: "#176",
  },
};

function stageTemplate(
  key: keyof typeof stageByDeliverableKey,
  idSuffix: string,
): MatureBaseDeliverableTemplate {
  const stageId = stageByDeliverableKey[key];
  const stage = ROOM_DEVELOPMENT_STAGES.find((entry) => entry.id === stageId);
  if (!stage) throw new Error(`unknown room development stage ${stageId}`);
  return {
    key,
    idSuffix,
    category: "corporate",
    deliverableType: "result",
    title: `${stage.title} State`,
    details: `${stage.objective} This Result is an independently scheduled Project stage, not a controller-level badge or a recurrence instance.`,
    output: `An independently evidenced ${stage.title} state in the governed colony.`,
    requirementTemplateKey: "mature-base-development",
    requirementSource: MATURE_BASE_PROJECT_POLICY_ID,
    requirementVerbiage: MATURE_BASE_PROJECT_POLICY_VERBIAGE,
    evaluationFactors: evaluationFactors(`${stage.title} state`),
    qualityDescription: `The ${stage.title} state has its exact v${ROOM_PLAN_VERSION}/RCL${ROOM_PLAN_HORIZON_RCL} blueprint outcome realized and its separately governed operational evidence satisfied; RCL ${stage.minRcl} is eligibility only.`,
    qualityMetric: `At or after Project start, the ${stage.title} evaluator binds a currently accepted Room Development Plan and reports controller eligibility, realized stage prerequisites, 100% eligible blueprint realization, and no missing or blocked eligible structure, while every required operational evidence policy reports satisfied through an independently validated record; acceptance may precede its planned milestone.`,
    metricPolicy: stageMetricPolicy(stageId),
    receiptValidation,
    servicePrincipalAcceptance,
    acceptanceDecision,
    p3WeightBasisPoints: stage.weight * 80,
    parentKey: "mature-base-state",
    childKeys: [],
  };
}

const requirementTemplate: MatureBaseRequirementTemplate = {
  templateKey: "mature-base-development",
  titleTemplate: "Develop {roomName} to a Mature Operating Base",
  requestorId: ACCOUNTABLE_PRINCIPAL_ID,
  requirementTrigger: "strategicBusinessObjective",
  requirementSource: MATURE_BASE_PROJECT_POLICY_ID,
  requirementVerbiage: MATURE_BASE_PROJECT_POLICY_VERBIAGE,
  purposeStatement:
    "Create a bounded, accepted transition from an owned World colony to a genuinely mature operating base.",
  strategicPriority: "SERVE",
  strategicAlignment:
    "A mature operating base supplies resilient economic, logistical, construction, defense, and advanced-service capacity to the empire.",
  desiredOutcomes:
    "An immutable accepted RCL8 room-development plan and five independently evidenced base states culminate in an integrated mature base with governed capabilities and defensive readiness.",
  businessCase:
    "A colony that merely survives or reaches a controller level leaves strategic capacity unrealized; explicit staged outcomes prevent local stability from being mistaken for completion.",
};

const deliverableTemplates = [
  {
    key: "room-development-plan",
    idSuffix: "room-development-plan",
    category: "corporate",
    deliverableType: "product",
    title: "Room Development Plan",
    details:
      "A persistent, content-addressed RCL8 room-development artifact that can be replayed and evaluated independently of mutable planner state.",
    output:
      "An immutable accepted room-development artifact for the exact colony, planner revision, projection revision, and fingerprint.",
    requirementTemplateKey: "mature-base-development",
    requirementSource: MATURE_BASE_PROJECT_POLICY_ID,
    requirementVerbiage: MATURE_BASE_PROJECT_POLICY_VERBIAGE,
    evaluationFactors: evaluationFactors("Room Development Plan"),
    qualityDescription:
      "The Product is a current, usable, deterministic room-development artifact with an exact v4/RCL8 horizon and no validation, invalidation, fingerprint, or development issue.",
    qualityMetric:
      "A content-addressed artifact snapshot captured no earlier than Project start binds the exact room, plan version, RCL horizon, planner revision, projection revision, projection fingerprint, and complete plan content; independent validation reports current and zero issues.",
    metricPolicy: planMetricPolicy,
    receiptValidation,
    servicePrincipalAcceptance,
    acceptanceDecision,
    p3WeightBasisPoints: 1000,
    parentKey: null,
    childKeys: [],
  },
  {
    key: "mature-base-state",
    idSuffix: "mature-base-state",
    category: "corporate",
    deliverableType: "result",
    title: "Mature Base State",
    details:
      "The final integrated Project Result joining the accepted plan, all five stage Results, current blueprint integrity, mature operational capability, and active defensive readiness.",
    output:
      "An independently accepted mature operating base ready to transition from temporary development into ongoing Colony Portfolio service management.",
    requirementTemplateKey: "mature-base-development",
    requirementSource: MATURE_BASE_PROJECT_POLICY_ID,
    requirementVerbiage: MATURE_BASE_PROJECT_POLICY_VERBIAGE,
    evaluationFactors: evaluationFactors("Mature Base State"),
    qualityDescription:
      "The accepted plan and all five stage Results remain valid together, all applicable mature services are governed and implemented, and complete active-defense evidence reports no readiness debt.",
    qualityMetric:
      "The integrated evaluator verifies accepted decisions for the plan and every stage, current realization of all five blueprints, the mature-outcome milestone, zero missing or blocked planned structures, complete mature-capability coverage, and complete debt-free active-defense readiness.",
    metricPolicy: aggregateMetricPolicy,
    receiptValidation,
    servicePrincipalAcceptance,
    acceptanceDecision,
    p3WeightBasisPoints: 1000,
    parentKey: null,
    childKeys: [
      "bootstrap",
      "logistics",
      "core-economy",
      "advanced-operations",
      "mature-rcl8",
    ],
  },
  stageTemplate("bootstrap", "bootstrap"),
  stageTemplate("logistics", "logistics"),
  stageTemplate("core-economy", "core-economy"),
  stageTemplate("advanced-operations", "advanced-operations"),
  stageTemplate("mature-rcl8", "mature-rcl8"),
] as const satisfies readonly MatureBaseDeliverableTemplate[];

function taskCandidate(
  deliverable: MatureBaseDeliverableTemplate,
  title: string,
  procedureKey: string,
): MatureBaseTaskCandidateTemplate {
  return {
    candidateKind: "task_definition_candidate",
    key: procedureKey,
    deliverableKey: deliverable.key,
    title,
    description: `Produce and independently validate the ${deliverable.title} output defined by the mature-base Project authority package.`,
    taskWeightBasisPoints: FSPM_WEIGHT_BASIS_POINTS,
    qualityDescription: deliverable.qualityDescription,
    qualityMetric: deliverable.qualityMetric,
    kpiMetric: {
      metric: `${deliverable.title} terminal quality`,
      exceptional:
        "The exact governed output passes every quality clause with complete, current evidence and no material rework.",
      satisfactory:
        "The exact governed output passes every required quality clause with complete, current evidence.",
      unsatisfactory:
        "The output is missing, stale, incomplete, self-asserted, or fails any required quality clause.",
      scaleAuthority:
        "existing_runtime_three_rating_adaptation_not_canonical_resolution",
    },
    procedures: [
      {
        key: procedureKey,
        title,
        allowedIntentTypes: [],
      },
    ],
    determination: {
      output: deliverable.output,
      composition: "compound",
      outputIndependence: "independent",
      independentlyMeasurable: true,
      rationale: `${deliverable.title} is a distinct recipient-visible Project output with its own metric, schedule, and acceptance evidence; its future execution steps are contributory but are intentionally not authorized by this definition-only package.`,
      governanceSha: FSPM_GOVERNANCE_SHA,
    },
    executionEligibility: "not_authorized",
  };
}

const taskCandidates = [
  taskCandidate(
    deliverableTemplates[0],
    "Produce Room Development Plan",
    "produce-room-development-plan",
  ),
  taskCandidate(
    deliverableTemplates[1],
    "Validate Mature Base State",
    "validate-mature-base-state",
  ),
  taskCandidate(
    deliverableTemplates[2],
    "Achieve Bootstrap Base State",
    "achieve-bootstrap-base-state",
  ),
  taskCandidate(
    deliverableTemplates[3],
    "Achieve Logistics Base State",
    "achieve-logistics-base-state",
  ),
  taskCandidate(
    deliverableTemplates[4],
    "Achieve Core Economy Base State",
    "achieve-core-economy-base-state",
  ),
  taskCandidate(
    deliverableTemplates[5],
    "Achieve Advanced Operations Base State",
    "achieve-advanced-operations-base-state",
  ),
  taskCandidate(
    deliverableTemplates[6],
    "Achieve Mature RCL8 Base State",
    "achieve-mature-rcl8-base-state",
  ),
] as const satisfies readonly MatureBaseTaskCandidateTemplate[];

const unsignedDefinitionPackage = {
  schema: MATURE_BASE_PROJECT_PACKAGE_SCHEMA,
  id: MATURE_BASE_PROJECT_PACKAGE_ID,
  revision: MATURE_BASE_PROJECT_PACKAGE_REVISION,
  governanceSha: FSPM_GOVERNANCE_SHA,
  effectiveDate: MATURE_BASE_PROJECT_PACKAGE_EFFECTIVE_DATE,
  authorityState: "definition_only",
  grantsRuntimeAuthority: false,
  issuer: {
    principalId: ACCOUNTABLE_PRINCIPAL_ID,
    organizationalUnitId: "ou:empire-operations",
    accountablePositionId: ACCOUNTABLE_POSITION_ID,
  },
  requirement: requirementTemplate,
  deliverables: deliverableTemplates,
  taskCandidates,
} as const;

const definitionPackageAttestation = {
  type: "source_control_policy_attestation",
  signedBy: ACCOUNTABLE_PRINCIPAL_ID,
  typedSignature: "APPROVE WORLD MATURE BASE PROJECT DEFINITION PACKAGE V1",
  signedAt: MATURE_BASE_PROJECT_PACKAGE_EFFECTIVE_DATE,
  canonicalHumanApproval: false,
} as const;

const definitionPackageHash = governanceContentHash({
  ...unsignedDefinitionPackage,
  approval: definitionPackageAttestation,
});

export const APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE = deepFreeze(
  {
    ...unsignedDefinitionPackage,
    approval: {
      ...definitionPackageAttestation,
      signedContentHash: definitionPackageHash,
    },
    contentHash: definitionPackageHash,
  },
) satisfies MatureBaseProjectDefinitionPackage;

export function matureBaseProjectPackageUnsignedContent(
  authorityPackage: MatureBaseProjectDefinitionPackage,
): unknown {
  return {
    schema: authorityPackage.schema,
    id: authorityPackage.id,
    revision: authorityPackage.revision,
    governanceSha: authorityPackage.governanceSha,
    effectiveDate: authorityPackage.effectiveDate,
    authorityState: authorityPackage.authorityState,
    grantsRuntimeAuthority: authorityPackage.grantsRuntimeAuthority,
    issuer: authorityPackage.issuer,
    approval: {
      type: authorityPackage.approval.type,
      signedBy: authorityPackage.approval.signedBy,
      typedSignature: authorityPackage.approval.typedSignature,
      signedAt: authorityPackage.approval.signedAt,
      canonicalHumanApproval: authorityPackage.approval.canonicalHumanApproval,
    },
    requirement: authorityPackage.requirement,
    deliverables: authorityPackage.deliverables,
    taskCandidates: authorityPackage.taskCandidates,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
    Object.freeze(value);
  }
  return value;
}

function finding(
  rule: MatureBaseValidationRule,
  path: string,
  message: string,
): MatureBaseValidationFinding {
  const canonicalRulesByRule: Partial<
    Record<MatureBaseValidationRule, readonly string[]>
  > = {
    "MBP-REQ-001": [
      "DLV-PRES-004",
      "DLV-PRES-005",
      "DLV-FMT-002",
      "DLV-FMT-003",
      "DLV-SEM-001",
    ],
    "MBP-DLV-001": ["DLV-PRES-001", "DLV-WGT-004"],
    "MBP-DLV-002": ["DLV-REF-001", "DLV-STR-001", "DLV-STR-002"],
    "MBP-DLV-003": ["DLV-WGT-002", "DLV-WGT-004"],
    "MBP-DLV-004": [
      "DLV-PRES-001",
      "DLV-PRES-002",
      "DLV-PRES-003",
      "DLV-PRES-004",
      "DLV-PRES-005",
      "DLV-PRES-011",
      "DLV-PRES-012",
      "DLV-PRES-013",
      "DLV-PRES-014",
      "DLV-FMT-001",
      "DLV-FMT-002",
      "DLV-FMT-003",
      "DLV-FMT-005",
      "DLV-REF-003",
      "DLV-STR-006",
      "DLV-SEM-001",
      "DLV-SEM-002",
      "DLV-SEM-003",
      "DLV-SEM-004",
      "DLV-SEM-005",
      "DLV-SEM-007",
      "DLV-SEM-009",
      "DLV-SEM-010",
    ],
    "MBP-TSK-001": ["DLV-WGT-003", "DLV-REF-004"],
    "MBP-TSK-002": ["DLV-WGT-001", "DLV-REF-004", "DLV-STR-003"],
    "MBP-BND-001": ["DLV-ARC-001", "DLV-ARC-002"],
  };
  const blockerRules = new Set<MatureBaseValidationRule>([
    "MBP-DAT-001",
    "MBP-PKG-006",
    "MBP-DLV-001",
    "MBP-DLV-002",
    "MBP-BND-001",
  ]);
  return {
    rule,
    canonicalRules: canonicalRulesByRule[rule] ?? [],
    severity: blockerRules.has(rule) ? "blocker" : "error",
    path,
    message,
  };
}

interface CloneBudget {
  nodes: number;
  readonly ancestors: Set<object>;
}

function cloneUntrustedPlainData(
  value: unknown,
  path: string,
  budget: CloneBudget,
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_VALIDATION_NODES) {
    throw new Error("plain-data node limit exceeded");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (
      typeof value === "string" &&
      value.length > MAX_VALIDATION_STRING_LENGTH
    ) {
      throw new Error(`${path} string exceeds validation limit`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} is not finite`);
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} has unsupported ${typeof value} value`);
  }
  if (budget.ancestors.has(value)) throw new Error(`${path} contains a cycle`);
  budget.ancestors.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    const isArray = Array.isArray(value);
    if (
      (!isArray && prototype !== Object.prototype && prototype !== null) ||
      (isArray && prototype !== Array.prototype)
    ) {
      throw new Error(`${path} has a non-plain prototype`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new Error(`${path} has a symbol key`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (isArray) {
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error(`${path} has an invalid array length`);
      }
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) {
          throw new Error(`${path}[${index}] is missing or accessor-backed`);
        }
        result.push(
          cloneUntrustedPlainData(
            descriptor.value,
            `${path}[${index}]`,
            budget,
          ),
        );
      }
      const customKeys = keys.filter(
        (key) =>
          key !== "length" &&
          !(
            typeof key === "string" &&
            /^(0|[1-9][0-9]*)$/.test(key) &&
            Number(key) < length
          ),
      );
      if (customKeys.length > 0) {
        throw new Error(`${path} has custom array properties`);
      }
      return result;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      if (key === "__proto__") {
        throw new Error(`${path} has a forbidden prototype key`);
      }
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor)) {
        throw new Error(`${path}.${key} is accessor-backed`);
      }
      result[key] = cloneUntrustedPlainData(
        descriptor.value,
        `${path}.${key}`,
        budget,
      );
    }
    return result;
  } finally {
    budget.ancestors.delete(value);
  }
}

function safePlainClone(value: unknown): {
  readonly value?: unknown;
  readonly finding?: MatureBaseValidationFinding;
} {
  try {
    return {
      value: cloneUntrustedPlainData(value, "$", {
        nodes: 0,
        ancestors: new Set<object>(),
      }),
    };
  } catch (error) {
    return {
      finding: finding(
        "MBP-DAT-001",
        "$",
        `authority input must be bounded plain data: ${error instanceof Error ? error.message : "unknown validation error"}`,
      ),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  return (
    canonicalGovernanceJson(actual) ===
    canonicalGovernanceJson(normalizedExpected)
  );
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalGovernanceJson(left) === canonicalGovernanceJson(right);
  } catch {
    return false;
  }
}

function validRoomName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 15 &&
    /^[WE](0|[1-9][0-9]*)[NS](0|[1-9][0-9]*)$/.test(value)
  );
}

function safeTick(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
  );
}

function expectedAttestationId(
  roomName: string,
  projectGeneration: number,
  startTick: number,
  initialDueTick: number,
): string {
  return `attestation:colony:${roomName}:mature-base-development:g${projectGeneration}:${startTick}:${initialDueTick}`;
}

function expectedAttestation(
  roomName: string,
  projectGeneration: number,
  startTick: number,
  initialDueTick: number,
): string {
  return `ATTEST PROPOSED ${roomName} MATURE BASE DEVELOPMENT G${projectGeneration} ${startTick}-${initialDueTick}`;
}

export function validateMatureBaseProjectCandidateInput(
  input: unknown,
): MatureBaseValidationFinding[] {
  const cloned = safePlainClone(input);
  if (cloned.finding) return [cloned.finding];
  const value = cloned.value;
  if (!isRecord(value)) {
    return [finding("MBP-INP-001", "$", "candidate input must be an object")];
  }
  const findings: MatureBaseValidationFinding[] = [];
  if (
    !exactKeys(value, [
      "roomName",
      "parentP3Id",
      "projectGeneration",
      "startTick",
      "initialDueTick",
      "initialMilestoneTicks",
      "scheduleAttestationId",
      "attestedBy",
      "attestedAtTick",
      "typedAttestation",
    ])
  ) {
    findings.push(
      finding(
        "MBP-INP-001",
        "$",
        "candidate input fields are incomplete or contain unknown fields",
      ),
    );
  }
  if (!validRoomName(value.roomName)) {
    findings.push(
      finding("MBP-INP-002", "$.roomName", "roomName is not canonical"),
    );
  }
  const roomName = typeof value.roomName === "string" ? value.roomName : "";
  if (value.parentP3Id !== `portfolio:colony:${roomName}`) {
    findings.push(
      finding(
        "MBP-INP-003",
        "$.parentP3Id",
        "Project must be a direct child of the exact Colony Portfolio",
      ),
    );
  }
  if (
    !Number.isSafeInteger(value.projectGeneration) ||
    Number(value.projectGeneration) <= 0
  ) {
    findings.push(
      finding(
        "MBP-INP-004",
        "$.projectGeneration",
        "projectGeneration must be an explicit positive safe integer",
      ),
    );
  }
  if (!safeTick(value.startTick) || !safeTick(value.initialDueTick)) {
    findings.push(
      finding(
        "MBP-INP-004",
        "$.startTick",
        "startTick and initialDueTick must be safe non-negative integers",
      ),
    );
  }
  if (!isRecord(value.initialMilestoneTicks)) {
    findings.push(
      finding(
        "MBP-INP-005",
        "$.initialMilestoneTicks",
        "every milestone tick must be supplied explicitly",
      ),
    );
  } else {
    const milestoneTicks = value.initialMilestoneTicks;
    const milestoneKeys = [
      "roomDevelopmentPlan",
      "bootstrap",
      "logistics",
      "core-economy",
      "advanced-operations",
      "mature-rcl8",
    ] as const;
    if (!exactKeys(value.initialMilestoneTicks, milestoneKeys)) {
      findings.push(
        finding(
          "MBP-INP-005",
          "$.initialMilestoneTicks",
          "milestone set must contain exactly the plan and five canonical stages",
        ),
      );
    }
    const ticks = milestoneKeys.map((key) => milestoneTicks[key]);
    if (ticks.some((tick) => !safeTick(tick))) {
      findings.push(
        finding(
          "MBP-INP-005",
          "$.initialMilestoneTicks",
          "milestones must be safe non-negative integers",
        ),
      );
    } else if (
      safeTick(value.startTick) &&
      safeTick(value.initialDueTick) &&
      !(
        value.startTick < Number(ticks[0]) &&
        ticks.every(
          (tick, index) =>
            index === 0 || Number(ticks[index - 1]) < Number(tick),
        ) &&
        Number(ticks.at(-1)) === value.initialDueTick
      )
    ) {
      findings.push(
        finding(
          "MBP-INP-006",
          "$.initialMilestoneTicks",
          "baseline schedule must be strictly ordered after start and Mature RCL8 must equal initialDueTick",
        ),
      );
    }
  }
  if (
    value.scheduleAttestationId !==
    expectedAttestationId(
      roomName,
      Number(value.projectGeneration),
      Number(value.startTick),
      Number(value.initialDueTick),
    )
  ) {
    findings.push(
      finding(
        "MBP-INP-007",
        "$.scheduleAttestationId",
        "schedule attestation identity is not deterministic",
      ),
    );
  }
  if (
    value.attestedBy !== ACCOUNTABLE_PRINCIPAL_ID ||
    !safeTick(value.attestedAtTick) ||
    (safeTick(value.startTick) &&
      Number(value.attestedAtTick) > value.startTick) ||
    value.typedAttestation !==
      expectedAttestation(
        roomName,
        Number(value.projectGeneration),
        Number(value.startTick),
        Number(value.initialDueTick),
      )
  ) {
    findings.push(
      finding(
        "MBP-INP-008",
        "$.attestedBy",
        "schedule must be explicitly attested by the disclosed service principal no later than proposed Project start",
      ),
    );
  }
  return findings;
}

function definitionHash<T extends Record<string, unknown>>(
  record: T,
): T & {
  definitionHash: string;
} {
  return {
    ...record,
    definitionHash: governanceContentHash(record),
  };
}

function deliverableId(
  roomName: string,
  projectGeneration: number,
  key: MatureBaseDeliverableKey,
): string {
  return `deliverable:${roomName}:mature-base:g${projectGeneration}:${key}`;
}

function initialMilestoneTickForDeliverable(
  key: MatureBaseDeliverableKey,
  initialDueTick: number,
  milestones: MatureBaseMilestoneTicks,
): number {
  if (key === "room-development-plan") return milestones.roomDevelopmentPlan;
  if (key === "mature-base-state") return initialDueTick;
  return milestones[stageByDeliverableKey[key]];
}

function scheduleAttestationUnsignedContent(
  attestation: Omit<
    MatureBaseProjectCandidate["scheduleAttestation"],
    "attestedContentHash"
  >,
): unknown {
  return attestation;
}

function candidateUnsignedContent(
  candidate: Omit<MatureBaseProjectCandidate, "contentHash">,
): unknown {
  return candidate;
}

function buildMatureBaseProjectCandidate(
  input: MatureBaseProjectCandidateInput,
): MatureBaseProjectCandidate {
  const projectId = `project:colony:${input.roomName}:mature-base-development:g${input.projectGeneration}`;
  const requirementId = `requirement:${input.roomName}:mature-base-development:g${input.projectGeneration}`;
  const scheduleAttestationBase = {
    type: "proposed_colony_project_schedule_attestation",
    attestationId: input.scheduleAttestationId,
    roomName: input.roomName,
    parentP3Id: input.parentP3Id,
    projectGeneration: input.projectGeneration,
    startTick: input.startTick,
    initialDueTick: input.initialDueTick,
    initialMilestoneTicks: { ...input.initialMilestoneTicks },
    attestedBy: input.attestedBy,
    attestedAtTick: input.attestedAtTick,
    typedAttestation: input.typedAttestation,
    canonicalHumanAuthorization: false as const,
    grantsProjectAuthority: false as const,
  } as const;
  const scheduleAttestation = {
    ...scheduleAttestationBase,
    attestedContentHash: governanceContentHash(
      scheduleAttestationUnsignedContent(scheduleAttestationBase),
    ),
  };

  const deliverableIds = deliverableOrder.map((key) =>
    deliverableId(input.roomName, input.projectGeneration, key),
  );
  const project = definitionHash({
    candidateKind: "p3_candidate" as const,
    id: projectId,
    type: "project" as const,
    subType: "general_project" as const,
    roomName: input.roomName,
    projectGeneration: input.projectGeneration,
    name: `COLONY-${input.roomName}-PROJ-Mature Operating Base Development G${input.projectGeneration}`,
    description:
      "Temporary development of the exact owned World colony through an accepted RCL8 plan, five independently evidenced stage Results, and an integrated mature-base acceptance gate; post-acceptance maintenance remains ongoing Colony Portfolio work.",
    parentP3Id: input.parentP3Id,
    temporalBasis: "game_tick" as const,
    startTick: input.startTick,
    initialDueTick: input.initialDueTick,
    initialMilestoneTicks: { ...input.initialMilestoneTicks },
    initialScheduleRevision: 1 as const,
    plannedInitialStatus:
      "active_after_canonical_authorization_and_atomic_publication" as const,
    creationTest: {
      temporaryEndeavor: true as const,
      authorizationStatus: "pending" as const,
      servicePrincipalScheduleAttestationPresent: true as const,
      definedStartAndEnd: true as const,
      specifiedDeliverableIds: deliverableIds,
      uniqueResult:
        "one accepted, independently evidenced mature operating base in the exact colony",
      excludesOngoingMaintenance: true as const,
    },
    revision: 1 as const,
  });
  const requirement = definitionHash({
    candidateKind: "requirement_candidate" as const,
    id: requirementId,
    p3Id: projectId,
    title: requirementTemplate.titleTemplate.replace(
      "{roomName}",
      input.roomName,
    ),
    requestorId: requirementTemplate.requestorId,
    requirementTrigger: requirementTemplate.requirementTrigger,
    requirementSource: requirementTemplate.requirementSource,
    requirementVerbiage: requirementTemplate.requirementVerbiage,
    purposeStatement: requirementTemplate.purposeStatement,
    strategicPriority: requirementTemplate.strategicPriority,
    strategicAlignment: requirementTemplate.strategicAlignment,
    applicableOuId: `ou:empire-operations:colony:${input.roomName}`,
    desiredOutcomes: requirementTemplate.desiredOutcomes,
    businessCase: requirementTemplate.businessCase,
    approvalContract: {
      state: "requires_canonical_authorization_and_atomic_publication" as const,
      authorityPackageId: MATURE_BASE_PROJECT_PACKAGE_ID,
      authorityPackageRevision: MATURE_BASE_PROJECT_PACKAGE_REVISION,
      authorityPackageHash:
        APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.contentHash,
      accountablePositionId: ACCOUNTABLE_POSITION_ID,
      packageAttestationPrincipalId: ACCOUNTABLE_PRINCIPAL_ID,
      canonicalHumanApproval: false as const,
    } as const,
    revision: 1 as const,
  });
  const deliverables = deliverableTemplates.map((template) =>
    definitionHash({
      candidateKind: "deliverable_candidate" as const,
      id: deliverableId(input.roomName, input.projectGeneration, template.key),
      key: template.key,
      p3Id: projectId,
      requirementId,
      category: template.category,
      deliverableType: template.deliverableType,
      title: template.title,
      details: template.details,
      output: template.output,
      requirementSource: template.requirementSource,
      requirementVerbiage: template.requirementVerbiage,
      evaluationFactors: template.evaluationFactors,
      qualityDescription: template.qualityDescription,
      qualityMetric: template.qualityMetric,
      metricPolicy: template.metricPolicy,
      receiptValidation: template.receiptValidation,
      servicePrincipalAcceptance: template.servicePrincipalAcceptance,
      acceptanceDecision: template.acceptanceDecision,
      p3WeightBasisPoints: template.p3WeightBasisPoints,
      parentDeliverableId:
        template.parentKey === null
          ? null
          : deliverableId(
              input.roomName,
              input.projectGeneration,
              template.parentKey,
            ),
      childDeliverableIds: template.childKeys.map((key) =>
        deliverableId(input.roomName, input.projectGeneration, key),
      ),
      initialMilestoneTick: initialMilestoneTickForDeliverable(
        template.key,
        input.initialDueTick,
        input.initialMilestoneTicks,
      ),
      revision: 1 as const,
    }),
  );
  const taskCandidateRecords = taskCandidates.map((task) =>
    definitionHash({
      ...task,
      deliverableId: deliverableId(
        input.roomName,
        input.projectGeneration,
        task.deliverableKey,
      ),
    }),
  );
  const base: Omit<MatureBaseProjectCandidate, "contentHash"> = {
    schema: MATURE_BASE_PROJECT_CANDIDATE_SCHEMA,
    publicationState: "detached_candidate" as const,
    authorityPackage: {
      id: MATURE_BASE_PROJECT_PACKAGE_ID,
      revision: MATURE_BASE_PROJECT_PACKAGE_REVISION,
      governanceSha: FSPM_GOVERNANCE_SHA,
      contentHash:
        APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.contentHash,
    },
    scheduleAttestation,
    project,
    requirement,
    deliverables,
    taskCandidates: taskCandidateRecords,
    runtimeBoundary: {
      grantsP3Authority: false as const,
      grantsTaskAuthority: false as const,
      grantsIntentAuthority: false as const,
      permitsEvidenceCapture: false as const,
      permitsReceiptOrDecision: false as const,
      permitsRetroactiveEvidence: false as const,
      qi: null,
      dqi: null,
      pqi: null,
      activationIssue: "#176" as const,
      requiredActivationPreconditions: [
        "canonical_authorization_exists",
        "canonical_ou_position_and_arci_assignments_exist",
        "activation_tick_equals_canonical_authorization_tick",
        "schedule_attestation_tick_is_no_later_than_activation_tick",
        "activation_tick_is_no_later_than_start_tick",
        "no_activity_or_evidence_before_start_tick",
        "room_is_currently_owned",
        "exact_active_colony_portfolio_exists",
        "project_generation_is_monotonic_and_unused",
        "durable_append_only_evidence_store_is_bound",
        "append_only_schedule_revision_ledger_exists",
        "atomic_compact_persistence_schema_exists",
        "deliverable_weights_confirmed_by_accountable_position",
        "mature_quality_evaluator_contracts_are_content_bound",
        "mature_capability_manifest_is_content_bound",
      ],
    },
  };
  return deepFreeze({
    ...base,
    contentHash: governanceContentHash(candidateUnsignedContent(base)),
  });
}

export class MatureBaseProjectValidationError extends Error {
  public constructor(
    public readonly findings: readonly MatureBaseValidationFinding[],
  ) {
    super(
      `invalid mature-base Project candidate: ${findings.map((entry) => entry.rule).join(", ")}`,
    );
    this.name = "MatureBaseProjectValidationError";
  }
}

export function createMatureBaseProjectCandidate(
  input: MatureBaseProjectCandidateInput,
): MatureBaseProjectCandidate {
  const cloned = safePlainClone(input);
  const findings = cloned.finding
    ? [cloned.finding]
    : validateMatureBaseProjectCandidateInput(cloned.value);
  if (findings.length > 0) throw new MatureBaseProjectValidationError(findings);
  return buildMatureBaseProjectCandidate(
    cloned.value as MatureBaseProjectCandidateInput,
  );
}

function validateDefinitionPackageSemantics(
  value: Record<string, unknown>,
  findings: MatureBaseValidationFinding[],
): void {
  const requirement = isRecord(value.requirement) ? value.requirement : null;
  if (
    requirement?.templateKey !== "mature-base-development" ||
    requirement.titleTemplate !==
      "Develop {roomName} to a Mature Operating Base" ||
    requirement.requestorId !== ACCOUNTABLE_PRINCIPAL_ID ||
    requirement.requirementTrigger !== "strategicBusinessObjective" ||
    requirement.requirementSource !== MATURE_BASE_PROJECT_POLICY_ID ||
    requirement.requirementVerbiage !== MATURE_BASE_PROJECT_POLICY_VERBIAGE ||
    typeof requirement.requirementSource !== "string" ||
    !isCanonicalRequirementSource(requirement.requirementSource) ||
    [
      requirement.purposeStatement,
      requirement.strategicAlignment,
      requirement.desiredOutcomes,
      requirement.businessCase,
    ].some((field) => typeof field !== "string" || field.trim().length === 0) ||
    "originatingAuthority" in (requirement ?? {})
  ) {
    findings.push(
      finding(
        "MBP-REQ-001",
        "$.requirement",
        "definition must retain one canonical source and Requirement Verbiage whose first line is the exact locator followed by the verbatim binding obligation",
      ),
    );
  }

  const rawDeliverables = Array.isArray(value.deliverables)
    ? value.deliverables
    : [];
  const deliverables = rawDeliverables.filter(isRecord);
  const keys = deliverables.map((entry) => entry.key);
  const idSuffixes = deliverables.map((entry) => entry.idSuffix);
  if (
    rawDeliverables.length !== deliverableOrder.length ||
    deliverables.length !== deliverableOrder.length ||
    new Set(keys).size !== deliverableOrder.length ||
    new Set(idSuffixes).size !== deliverableOrder.length ||
    !canonicalEqual(keys, deliverableOrder)
  ) {
    findings.push(
      finding(
        "MBP-DLV-001",
        "$.deliverables",
        "definition must contain the exact unique two-root/five-child Deliverable set in canonical order",
      ),
    );
  }

  const byKey = new Map(
    deliverables.map(
      (entry, index) =>
        [
          typeof entry.key === "string" ? entry.key : `<invalid:${index}>`,
          entry,
        ] as const,
    ),
  );
  const matureParent = byKey.get("mature-base-state");
  const planRoot = byKey.get("room-development-plan");
  const stageKeys = deliverableOrder.slice(2);
  const hierarchyValid =
    planRoot?.parentKey === null &&
    canonicalEqual(planRoot.childKeys, []) &&
    matureParent?.parentKey === null &&
    canonicalEqual(matureParent.childKeys, stageKeys) &&
    stageKeys.every((key) => {
      const stage = byKey.get(key);
      return (
        stage?.parentKey === "mature-base-state" &&
        canonicalEqual(stage.childKeys, [])
      );
    });
  if (!hierarchyValid) {
    findings.push(
      finding(
        "MBP-DLV-002",
        "$.deliverables",
        "definition must enforce exact bidirectional one-level decomposition with no orphan or grandchild",
      ),
    );
  }

  const stageContractValid = Object.entries(governedStageContract).every(
    ([stageId, expected]) => {
      const deliverable = byKey.get(stageId);
      const policy = isRecord(deliverable?.metricPolicy)
        ? deliverable.metricPolicy
        : null;
      return (
        deliverable?.p3WeightBasisPoints === expected.p3WeightBasisPoints &&
        policy?.evaluator === "room_development_stage_v1" &&
        policy.stageId === stageId &&
        policy.minimumControllerLevel === expected.minimumControllerLevel &&
        canonicalEqual(
          policy.prerequisiteStageIds,
          expected.prerequisiteStageIds,
        ) &&
        canonicalEqual(policy.requiredAcceptedDeliverableKeys, [
          "room-development-plan",
        ]) &&
        policy.controllerLevelIsReceiptEvidence === false &&
        isRecord(policy.blueprintEvidence) &&
        policy.blueprintEvidence.state ===
          "blocked_pending_content_recomputing_verifier" &&
        isRecord(policy.operationalEvidence) &&
        policy.operationalEvidence.state ===
          "blocked_pending_governed_evaluator"
      );
    },
  );
  if (!stageContractValid) {
    findings.push(
      finding(
        "MBP-DLV-004",
        "$.deliverables",
        "stage identity, eligibility, prerequisites, weights, or blueprint/operational evidence blockers differ from the governed v1 contract",
      ),
    );
  }

  const weights = deliverables.map((entry) => entry.p3WeightBasisPoints);
  const weightTotal = weights.reduce<number>(
    (sum, weight) => sum + (Number.isSafeInteger(weight) ? Number(weight) : 0),
    0,
  );
  const expectedWeights = [1000, 1000, 1200, 1200, 2000, 1600, 2000];
  if (
    weightTotal !== FSPM_WEIGHT_BASIS_POINTS ||
    !canonicalEqual(weights, expectedWeights) ||
    weights.some(
      (weight) => !Number.isSafeInteger(weight) || Number(weight) <= 0,
    )
  ) {
    findings.push(
      finding(
        "MBP-DLV-003",
        "$.deliverables",
        "all seven Deliverables must participate exactly once in the proposed flat 10,000-basis-point pool",
      ),
    );
  }

  const contentValid = deliverables.every((entry) => {
    const factors = isRecord(entry.evaluationFactors)
      ? entry.evaluationFactors
      : null;
    const receipt = isRecord(entry.receiptValidation)
      ? entry.receiptValidation
      : null;
    const decision = isRecord(entry.acceptanceDecision)
      ? entry.acceptanceDecision
      : null;
    const narrativeFields = [
      entry.title,
      entry.details,
      entry.output,
      entry.qualityDescription,
      entry.qualityMetric,
    ];
    return (
      entry.category === "corporate" &&
      (entry.deliverableType === "product" ||
        entry.deliverableType === "result") &&
      narrativeFields.every(
        (field) => typeof field === "string" && field.trim().length > 0,
      ) &&
      typeof entry.title === "string" &&
      !/^(achieve|build|create|develop|produce|validate|verify)\b/i.test(
        entry.title,
      ) &&
      entry.qualityDescription !== entry.qualityMetric &&
      entry.requirementTemplateKey === "mature-base-development" &&
      entry.requirementSource === MATURE_BASE_PROJECT_POLICY_ID &&
      entry.requirementVerbiage === MATURE_BASE_PROJECT_POLICY_VERBIAGE &&
      factors !== null &&
      Object.keys(factors).length === 6 &&
      Object.values(factors).every(
        (factor) => typeof factor === "string" && factor.trim().length > 0,
      ) &&
      receipt?.evidenceForm === "logged_system_record" &&
      receipt.evidenceSchema === MATURE_BASE_EVIDENCE_SCHEMA &&
      receipt.storageState === "blocked_pending_durable_append_only_store" &&
      receipt.storageLocation ===
        "unresolved://issue/176/mature-base-evidence" &&
      receipt.captureResponsibility === EVIDENCE_CAPTURE_PRINCIPAL_ID &&
      decision?.state === "not_authorized" &&
      decision.decisionResponsibility === ACCOUNTABLE_PRINCIPAL_ID &&
      (decision.decisionResponsibility as unknown) !==
        (receipt.captureResponsibility as unknown)
    );
  });
  if (!contentValid) {
    findings.push(
      finding(
        "MBP-DLV-004",
        "$.deliverables",
        "Deliverable presence, source, evaluation, metric, or blocked receipt contract is incomplete",
      ),
    );
  }

  const aggregatePolicy = isRecord(matureParent?.metricPolicy)
    ? matureParent.metricPolicy
    : null;
  const planPolicy = isRecord(planRoot?.metricPolicy)
    ? planRoot.metricPolicy
    : null;
  const requiredOperationalEvidenceKinds = [
    "bootstrap_recovery",
    "source_throughput",
    "transport_continuity",
    "storage_logistics",
    "defensive_readiness",
    "advanced_service_operation",
    "mature_capability_readiness",
  ];
  if (
    !aggregatePolicy ||
    !canonicalEqual(
      aggregatePolicy.requiredAcceptedDeliverableKeys,
      aggregatePrerequisiteDeliverableKeys,
    ) ||
    (Array.isArray(aggregatePolicy.requiredAcceptedDeliverableKeys) &&
      aggregatePolicy.requiredAcceptedDeliverableKeys.includes(
        "mature-base-state",
      )) ||
    !canonicalEqual(
      aggregatePolicy.requiredCurrentOperationalEvidenceKinds,
      requiredOperationalEvidenceKinds,
    ) ||
    !isRecord(aggregatePolicy.operationalEvidence) ||
    aggregatePolicy.operationalEvidence.state !==
      "blocked_pending_governed_evaluator" ||
    aggregatePolicy.operationalEvidence.freshnessPolicy !==
      "blocked_pending_governed_threshold" ||
    planPolicy?.evaluator !== "room_plan_projection_v1" ||
    !isRecord(planPolicy.artifactEvidence) ||
    planPolicy.artifactEvidence.state !==
      "blocked_pending_content_recomputing_verifier"
  ) {
    findings.push(
      finding(
        "MBP-DLV-004",
        "$.deliverables[1].metricPolicy.requiredAcceptedDeliverableKeys",
        "integrated acceptance must require the plan and five children without circular self-acceptance",
      ),
    );
  }

  const rawTasks = Array.isArray(value.taskCandidates)
    ? value.taskCandidates
    : [];
  const tasks = rawTasks.filter(isRecord);
  const taskKeys = tasks.map((entry) => entry.deliverableKey);
  if (
    rawTasks.length !== deliverableOrder.length ||
    tasks.length !== deliverableOrder.length ||
    !canonicalEqual(taskKeys, deliverableOrder) ||
    new Set(taskKeys).size !== deliverableOrder.length
  ) {
    findings.push(
      finding(
        "MBP-TSK-001",
        "$.taskCandidates",
        "every Deliverable must have exactly one direct Task definition candidate",
      ),
    );
  }
  if (
    tasks.some((entry) => {
      const determination = isRecord(entry.determination)
        ? entry.determination
        : null;
      const kpi = isRecord(entry.kpiMetric) ? entry.kpiMetric : null;
      return (
        entry.candidateKind !== "task_definition_candidate" ||
        entry.taskWeightBasisPoints !== FSPM_WEIGHT_BASIS_POINTS ||
        entry.executionEligibility !== "not_authorized" ||
        "id" in entry ||
        "status" in entry ||
        "createdAt" in entry ||
        "updatedAt" in entry ||
        determination?.governanceSha !== FSPM_GOVERNANCE_SHA ||
        determination.independentlyMeasurable !== true ||
        determination.outputIndependence !== "independent" ||
        (determination.composition !== "atomic" &&
          determination.composition !== "compound") ||
        typeof determination.output !== "string" ||
        !determination.output.trim() ||
        typeof determination.rationale !== "string" ||
        !determination.rationale.trim() ||
        !kpi ||
        [
          kpi.metric,
          kpi.exceptional,
          kpi.satisfactory,
          kpi.unsatisfactory,
        ].some((field) => typeof field !== "string" || !field.trim()) ||
        !Array.isArray(entry.procedures) ||
        entry.procedures.length === 0 ||
        entry.procedures.some(
          (procedure) =>
            !isRecord(procedure) ||
            !Array.isArray(procedure.allowedIntentTypes) ||
            procedure.allowedIntentTypes.length !== 0,
        )
      );
    })
  ) {
    findings.push(
      finding(
        "MBP-TSK-002",
        "$.taskCandidates",
        "Task candidates must be complete, direct, 100%-weighted, and non-executable",
      ),
    );
  }
}

export function validateMatureBaseProjectAuthorityPackage(
  input: unknown,
): MatureBaseValidationFinding[] {
  const cloned = safePlainClone(input);
  if (cloned.finding) return [cloned.finding];
  if (!isRecord(cloned.value)) {
    return [finding("MBP-PKG-001", "$", "authority package must be an object")];
  }
  const value = cloned.value;
  const findings: MatureBaseValidationFinding[] = [];
  if (value.schema !== MATURE_BASE_PROJECT_PACKAGE_SCHEMA) {
    findings.push(
      finding("MBP-PKG-001", "$.schema", "package schema is invalid"),
    );
  }
  if (value.id !== MATURE_BASE_PROJECT_PACKAGE_ID) {
    findings.push(
      finding("MBP-PKG-002", "$.id", "package identity is invalid"),
    );
  }
  if (value.revision !== MATURE_BASE_PROJECT_PACKAGE_REVISION) {
    findings.push(
      finding("MBP-PKG-003", "$.revision", "package revision is invalid"),
    );
  }
  if (value.governanceSha !== FSPM_GOVERNANCE_SHA) {
    findings.push(
      finding("MBP-PKG-004", "$.governanceSha", "governance pin is stale"),
    );
  }
  if (value.effectiveDate !== MATURE_BASE_PROJECT_PACKAGE_EFFECTIVE_DATE) {
    findings.push(
      finding("MBP-PKG-005", "$.effectiveDate", "effective date is invalid"),
    );
  }
  if (
    value.authorityState !== "definition_only" ||
    value.grantsRuntimeAuthority !== false
  ) {
    findings.push(
      finding(
        "MBP-PKG-006",
        "$.authorityState",
        "definition package must not grant runtime authority",
      ),
    );
  }
  validateDefinitionPackageSemantics(value, findings);
  const approval = isRecord(value.approval) ? value.approval : undefined;
  const issuer = isRecord(value.issuer) ? value.issuer : undefined;
  if (
    !approval ||
    !issuer ||
    approval.type !== "source_control_policy_attestation" ||
    approval.signedBy !== ACCOUNTABLE_PRINCIPAL_ID ||
    typeof approval.typedSignature !== "string" ||
    !approval.typedSignature.trim() ||
    approval.signedAt !== MATURE_BASE_PROJECT_PACKAGE_EFFECTIVE_DATE ||
    issuer.principalId !== ACCOUNTABLE_PRINCIPAL_ID ||
    issuer.organizationalUnitId !== "ou:empire-operations" ||
    issuer.accountablePositionId !== ACCOUNTABLE_POSITION_ID ||
    approval.canonicalHumanApproval !== false
  ) {
    findings.push(
      finding(
        "MBP-PKG-007",
        "$.approval",
        "package signer ancestry or human-approval disclosure is invalid",
      ),
    );
  }
  try {
    const calculatedHash = governanceContentHash(
      matureBaseProjectPackageUnsignedContent(
        value as unknown as MatureBaseProjectDefinitionPackage,
      ),
    );
    if (
      value.contentHash !== calculatedHash ||
      approval?.signedContentHash !== calculatedHash
    ) {
      findings.push(
        finding(
          "MBP-PKG-008",
          "$.contentHash",
          "package content hash or attestation is invalid",
        ),
      );
    }
  } catch {
    findings.push(
      finding(
        "MBP-PKG-008",
        "$.contentHash",
        "package content cannot be hashed",
      ),
    );
  }
  if (
    canonicalGovernanceJson(value) !==
    canonicalGovernanceJson(
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE,
    )
  ) {
    findings.push(
      finding(
        "MBP-PKG-009",
        "$",
        "package is not the exact source-controlled approved definition",
      ),
    );
  }
  return findings;
}

function candidateInput(
  value: Record<string, unknown>,
): MatureBaseProjectCandidateInput | null {
  const attestation = isRecord(value.scheduleAttestation)
    ? value.scheduleAttestation
    : null;
  if (!attestation || !isRecord(attestation.initialMilestoneTicks)) return null;
  return {
    roomName: attestation.roomName as string,
    parentP3Id: attestation.parentP3Id as string,
    projectGeneration: attestation.projectGeneration as number,
    startTick: attestation.startTick as number,
    initialDueTick: attestation.initialDueTick as number,
    initialMilestoneTicks:
      attestation.initialMilestoneTicks as unknown as MatureBaseMilestoneTicks,
    scheduleAttestationId: attestation.attestationId as string,
    attestedBy: attestation.attestedBy as string,
    attestedAtTick: attestation.attestedAtTick as number,
    typedAttestation: attestation.typedAttestation as string,
  };
}

function pushSectionFinding(
  findings: MatureBaseValidationFinding[],
  rule: MatureBaseValidationRule,
  path: string,
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (!canonicalEqual(actual, expected)) {
    findings.push(finding(rule, path, message));
  }
}

/**
 * Validates an untrusted detached candidate without reading World state. The
 * expected candidate is rebuilt solely from its attested proposed schedule,
 * so unknown fields, altered ancestry, hierarchy, weights, prose, metrics,
 * hashes, task candidates, or runtime capability all fail closed.
 */
export function validateMatureBaseProjectCandidate(
  input: unknown,
): MatureBaseValidationFinding[] {
  const cloned = safePlainClone(input);
  if (cloned.finding) return [cloned.finding];
  if (!isRecord(cloned.value)) {
    return [finding("MBP-EXA-001", "$", "candidate must be an object")];
  }
  const value = cloned.value;
  const explicitInput = candidateInput(value);
  if (!explicitInput) {
    return [
      finding(
        "MBP-AUT-001",
        "$.scheduleAttestation",
        "candidate has no complete proposed-schedule attestation",
      ),
    ];
  }
  const findings = validateMatureBaseProjectCandidateInput(explicitInput);
  if (findings.length > 0) return findings;
  const expected = buildMatureBaseProjectCandidate(explicitInput);
  const attestation = value.scheduleAttestation as Record<string, unknown>;
  const attestationBase = { ...attestation };
  delete attestationBase.attestedContentHash;
  if (
    attestation.attestedContentHash !==
    governanceContentHash(
      scheduleAttestationUnsignedContent(attestationBase as never),
    )
  ) {
    findings.push(
      finding(
        "MBP-AUT-002",
        "$.scheduleAttestation.attestedContentHash",
        "schedule attestation content hash is invalid",
      ),
    );
  }
  pushSectionFinding(
    findings,
    "MBP-PRJ-001",
    "$.project",
    value.project,
    expected.project,
    "Project classification, creation test, ancestry, name, or attested baseline schedule differs",
  );
  pushSectionFinding(
    findings,
    "MBP-REQ-001",
    "$.requirement",
    value.requirement,
    expected.requirement,
    "Requirement source, verbatim obligation, approval contract, or lineage differs",
  );
  const deliverables = Array.isArray(value.deliverables)
    ? value.deliverables
    : [];
  if (deliverables.length !== deliverableOrder.length) {
    findings.push(
      finding(
        "MBP-DLV-001",
        "$.deliverables",
        "candidate must contain exactly two roots and five stage children",
      ),
    );
  }
  pushSectionFinding(
    findings,
    "MBP-DLV-002",
    "$.deliverables",
    deliverables.map((entry) =>
      isRecord(entry)
        ? {
            id: entry.id,
            key: entry.key,
            parentDeliverableId: entry.parentDeliverableId,
            childDeliverableIds: entry.childDeliverableIds,
          }
        : entry,
    ),
    expected.deliverables.map((entry) => ({
      id: entry.id,
      key: entry.key,
      parentDeliverableId: entry.parentDeliverableId,
      childDeliverableIds: entry.childDeliverableIds,
    })),
    "Deliverable order or one-level bidirectional hierarchy differs",
  );
  const totalWeight = deliverables.reduce(
    (sum, entry) =>
      sum +
      (isRecord(entry) && safeTick(entry.p3WeightBasisPoints)
        ? Number(entry.p3WeightBasisPoints)
        : 0),
    0,
  );
  if (
    totalWeight !== FSPM_WEIGHT_BASIS_POINTS ||
    deliverables.some(
      (entry) =>
        !isRecord(entry) ||
        !Number.isSafeInteger(entry.p3WeightBasisPoints) ||
        Number(entry.p3WeightBasisPoints) <= 0,
    )
  ) {
    findings.push(
      finding(
        "MBP-DLV-003",
        "$.deliverables",
        "all seven Deliverables must participate once in one exact 10,000-basis-point P3 pool",
      ),
    );
  }
  pushSectionFinding(
    findings,
    "MBP-DLV-004",
    "$.deliverables",
    value.deliverables,
    expected.deliverables,
    "Deliverable definition, metric, receipt contract, schedule, or content hash differs",
  );
  const tasks = Array.isArray(value.taskCandidates) ? value.taskCandidates : [];
  if (tasks.length !== deliverableOrder.length) {
    findings.push(
      finding(
        "MBP-TSK-001",
        "$.taskCandidates",
        "every Deliverable must have exactly one direct Task definition candidate",
      ),
    );
  }
  if (
    tasks.some(
      (entry) =>
        !isRecord(entry) ||
        entry.candidateKind !== "task_definition_candidate" ||
        entry.executionEligibility !== "not_authorized" ||
        entry.taskWeightBasisPoints !== FSPM_WEIGHT_BASIS_POINTS ||
        "status" in entry ||
        "createdAt" in entry ||
        "updatedAt" in entry ||
        "id" in entry ||
        !Array.isArray(entry.procedures) ||
        entry.procedures.length === 0 ||
        entry.procedures.some(
          (procedure) =>
            !isRecord(procedure) ||
            !Array.isArray(procedure.allowedIntentTypes) ||
            procedure.allowedIntentTypes.length !== 0,
        ),
    )
  ) {
    findings.push(
      finding(
        "MBP-TSK-002",
        "$.taskCandidates",
        "Task candidates must remain complete but non-record and non-executable",
      ),
    );
  }
  pushSectionFinding(
    findings,
    "MBP-TSK-002",
    "$.taskCandidates",
    tasks,
    expected.taskCandidates,
    "Task definition candidate content or lineage differs",
  );
  pushSectionFinding(
    findings,
    "MBP-BND-001",
    "$.runtimeBoundary",
    value.runtimeBoundary,
    expected.runtimeBoundary,
    "detached candidate must grant no authority, evidence, receipt, score, or retroactive claim",
  );
  if (
    value.schema !== MATURE_BASE_PROJECT_CANDIDATE_SCHEMA ||
    value.publicationState !== "detached_candidate" ||
    !canonicalEqual(value.authorityPackage, expected.authorityPackage)
  ) {
    findings.push(
      finding(
        "MBP-AUT-001",
        "$",
        "candidate schema, package binding, or detached publication state differs",
      ),
    );
  }
  const unsigned = { ...value };
  delete unsigned.contentHash;
  if (
    value.contentHash !==
      governanceContentHash(candidateUnsignedContent(unsigned as never)) ||
    value.contentHash !== expected.contentHash
  ) {
    findings.push(
      finding(
        "MBP-HSH-001",
        "$.contentHash",
        "candidate content hash is invalid",
      ),
    );
  }
  if (canonicalGovernanceJson(value) !== canonicalGovernanceJson(expected)) {
    findings.push(
      finding(
        "MBP-EXA-001",
        "$",
        "candidate is not the exact deterministic projection of its attested proposed baseline schedule",
      ),
    );
  }
  return findings;
}

export interface MatureBaseBlueprintEvidence {
  readonly controllerLevel: number;
  readonly projectStartTick: number;
  readonly capturedAtTick: number;
  readonly acceptedPlanProductIsCurrent?: boolean;
  readonly horizonStatus: string;
  readonly validationIssues: readonly string[];
  readonly stageId?: RoomDevelopmentStageId;
  readonly controllerEligible?: boolean;
  readonly prerequisitesSatisfied?: boolean;
  readonly status?: string;
  readonly eligibleRequiredWeight?: number;
  readonly realizedRequiredWeight?: number;
  readonly realizationPercentage?: number | null;
  readonly missingEligibleStructures?: number;
  readonly blockedEligibleStructures?: number;
}

export interface MatureBasePlanEvidence {
  readonly projectRoomName: string;
  readonly projectStartTick: number;
  readonly capturedAtTick: number;
  readonly roomName: string;
  readonly artifactHash: string | null;
  readonly version: number;
  readonly horizonRcl: number;
  readonly plannerRevision: number;
  readonly projectionRevision: number;
  readonly projectionFingerprint: string;
  readonly currentAndUsable: boolean;
  readonly fingerprintValid: boolean;
  readonly validationIssues: readonly string[];
}

export interface MatureBaseMetricEvaluation {
  readonly satisfied: boolean;
  readonly clauses: readonly {
    readonly clause: string;
    readonly satisfied: boolean;
    readonly reason: string;
  }[];
}

/**
 * A deliberately conservative shape-consistency diagnostic over untrusted
 * caller-supplied data. It does not recompute a plan or blueprint and cannot
 * manufacture the governed operational evidence still open under #176. In
 * particular, an RCL8 controller never makes a stage pass.
 */
export function evaluateMatureBaseQualityMetric(
  policy: MatureBaseQualityMetricPolicy,
  evidence: unknown,
): MatureBaseMetricEvaluation {
  const clonedEvidence = safePlainClone(evidence);
  if (clonedEvidence.finding || !isRecord(clonedEvidence.value)) {
    return {
      satisfied: false,
      clauses: [
        {
          clause: "evidence_is_bounded_plain_data",
          satisfied: false,
          reason: "quality evidence is missing, malformed, or unsafe",
        },
      ],
    };
  }
  const evidenceRecord = clonedEvidence.value;
  if (policy.evaluator === "room_plan_projection_v1") {
    const plan = evidenceRecord as unknown as MatureBasePlanEvidence;
    const clauses = [
      {
        clause: "immutable_artifact_hash_present",
        satisfied:
          typeof plan.artifactHash === "string" &&
          /^sha256:[0-9a-f]{64}$/.test(plan.artifactHash),
        reason: "plan Product requires a content-addressed persistent artifact",
      },
      {
        clause: "projection_room_matches_project",
        satisfied:
          validRoomName(plan.projectRoomName) &&
          plan.roomName === plan.projectRoomName,
        reason: "plan artifact room must equal the Project colony",
      },
      {
        clause: "artifact_captured_at_or_after_project_start",
        satisfied:
          safeTick(plan.projectStartTick) &&
          safeTick(plan.capturedAtTick) &&
          plan.capturedAtTick >= plan.projectStartTick,
        reason:
          "pre-start observations cannot be backfilled as Product evidence",
      },
      {
        clause: "projection_is_current_and_usable",
        satisfied: plan.currentAndUsable === true,
        reason: "mutable or stale planner state is not an accepted Product",
      },
      {
        clause: "projection_fingerprint_is_valid",
        satisfied:
          plan.fingerprintValid === true &&
          Number.isSafeInteger(plan.projectionRevision) &&
          plan.projectionRevision >= 1 &&
          /^rpf1-[0-9a-f]{16}$/.test(plan.projectionFingerprint),
        reason: "projection fingerprint must validate",
      },
      {
        clause: "room_plan_contract",
        satisfied:
          plan.version === policy.roomPlanVersion &&
          plan.horizonRcl === policy.horizonRcl &&
          plan.plannerRevision === policy.plannerRevision &&
          Array.isArray(plan.validationIssues) &&
          plan.validationIssues.length === 0,
        reason:
          "plan version, horizon, planner revision, and validation must match",
      },
      {
        clause: "content_recomputing_artifact_verifier",
        satisfied: false,
        reason:
          "no governed verifier yet accepts full artifact bytes, recomputes both hashes, and persists the immutable Product under #176",
      },
    ];
    return {
      satisfied: false,
      clauses,
    };
  }
  if (policy.evaluator === "room_development_stage_v1") {
    const stage = evidenceRecord as unknown as MatureBaseBlueprintEvidence;
    const blueprintShapeConsistent =
      stage.stageId === policy.stageId &&
      Number.isSafeInteger(stage.controllerLevel) &&
      stage.controllerLevel >= policy.minimumControllerLevel &&
      stage.controllerLevel <= 8 &&
      safeTick(stage.projectStartTick) &&
      safeTick(stage.capturedAtTick) &&
      stage.capturedAtTick >= stage.projectStartTick &&
      stage.acceptedPlanProductIsCurrent === true &&
      stage.horizonStatus === "v4_rcl8" &&
      Array.isArray(stage.validationIssues) &&
      stage.validationIssues.length === 0 &&
      stage.controllerEligible === true &&
      stage.prerequisitesSatisfied === true &&
      stage.status === "realized" &&
      Number.isSafeInteger(stage.eligibleRequiredWeight) &&
      Number(stage.eligibleRequiredWeight) > 0 &&
      Number.isSafeInteger(stage.realizedRequiredWeight) &&
      Number(stage.realizedRequiredWeight) >= 0 &&
      stage.realizedRequiredWeight === stage.eligibleRequiredWeight &&
      stage.realizationPercentage === 100 &&
      stage.missingEligibleStructures === 0 &&
      stage.blockedEligibleStructures === 0;
    const clauses = [
      {
        clause: "caller_supplied_blueprint_shape_consistency",
        satisfied: blueprintShapeConsistent,
        reason:
          "caller-supplied stage fields are internally consistent; this diagnostic is not receipt evidence",
      },
      {
        clause: "content_recomputing_stage_evidence_verifier",
        satisfied: false,
        reason:
          "no governed verifier yet binds the exact room and plan artifact, recomputes blueprint realization from world evidence, and persists the result under #176",
      },
      {
        clause: "controller_level_is_eligibility_only",
        satisfied: false,
        reason:
          "separately governed operational evidence evaluator remains unimplemented under #176",
      },
    ];
    return { satisfied: false, clauses };
  }
  const clauses = [
    {
      clause: "integrated_mature_base_evidence",
      satisfied: false,
      reason:
        "accepted child decisions, mature capability coverage, and active-defense evidence remain unimplemented under #176",
    },
  ];
  return { satisfied: false, clauses };
}
