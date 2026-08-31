import { sanitizeStoredObservabilitySnapshot } from "../../../supabase/functions/_shared/eqvm-snapshot.mjs";
import {
  type BenchmarkRow,
  buildControlPlaneProvenance,
  type ExperimentEvidenceRow,
  findCorrelatedExperiment,
  mapBenchmarkSample,
  type SnapshotEvidence,
} from "./data-trust";

export type {
  BenchmarkMetrics,
  BenchmarkSample,
  ControlPlaneProvenance,
} from "./data-trust";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://nflcqzcqpodnfkzjarwv.supabase.co";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_2g6FV2odRFonTpEDZ0rzSw_0MaZSAUt";

type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;

let supabaseClientPromise: Promise<SupabaseClient> | null = null;

const loadSupabaseClient = () => {
  supabaseClientPromise ??= import("@supabase/supabase-js").then(
    ({ createClient }) =>
      createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  );
  return supabaseClientPromise;
};

export type Point = { x: number; y: number };
export type EncodedRoomTerrain = {
  encoding: "screeps-terrain-mask/v1";
  width: 50;
  height: 50;
  /** Row-major Screeps terrain masks: 0 plain, 1 wall, 2 swamp, 3 wall + swamp. */
  cells: string;
};
export type RoomPlanIntegrityEvidence = {
  projectionScheme: "room-plan-fingerprint/v1";
  declaredFingerprint: string | null;
  runtimeComputedFingerprint: string | null;
  runtimeVerified: boolean;
  snapshotDigestScheme: "screeps-lab-room-plan-digest/v1";
  snapshotDigest: string | null;
};
export type SnapshotCaptureConsistency = {
  status: "matched" | "mixed" | "unverified";
  initialTick: number | null;
  finalTick: number | null;
  reason: string;
};
export type RoomDevelopmentStageId =
  | "bootstrap"
  | "logistics"
  | "core-economy"
  | "advanced-operations"
  | "mature-rcl8";
export type RoomDevelopmentStage = {
  id: RoomDevelopmentStageId;
  title: string;
  minRcl: number;
  weight: number;
  prerequisiteStageIds: RoomDevelopmentStageId[];
  objective?: string | null;
};
export type PlannedStructure = Point & {
  id?: string | null;
  structureType?: string | null;
  minRcl?: number | null;
  priority?: number | null;
  activation?: "automatic" | "demand" | "defense" | null;
  phase?: string | null;
  stage?: RoomDevelopmentStageId | null;
  strategicWeight?: number | null;
  requiredForStage?: boolean | null;
};
export type PlannedRoad = Point & {
  id?: string | null;
  minRcl?: number | null;
  activation?: "automatic" | "demand" | "defense" | null;
  phase?: string | null;
  stage?: RoomDevelopmentStageId | null;
  strategicWeight?: number | null;
  requiredForStage?: boolean | null;
};
export type RoomPlan = {
  planId?: string | null;
  deliverableId?: string | null;
  plannerRevision?: number | null;
  projectionRevision?: number | null;
  projectionFingerprint?: string | null;
  version?: number | null;
  horizonRcl?: number | null;
  generatedAt?: number | null;
  generatedReason?: string | null;
  stages?: RoomDevelopmentStage[] | null;
  anchors?: {
    spawn?: (Point & { name?: string | null }) | null;
    hub?: Point | null;
    controller?: (Point & { service?: Point | null }) | null;
    sources?: Array<Point & { container?: Point | null }>;
  };
  structures?: PlannedStructure[];
  roads?: PlannedRoad[];
  defense?: {
    strategy?: "pending-mincut" | "terrain-mincut-v1" | null;
    protectedTiles?: Point[] | null;
    perimeter?: Point[] | null;
  } | null;
};

export type SettlementProjectionFault = {
  roomName?: string | null;
  kind?: "room-plan-generation" | null;
  status?: "active" | "superseded" | null;
  firstTick?: number | null;
  lastTick?: number | null;
  attemptCount?: number | null;
  retryDelayTicks?: number | null;
  nextRetryTick?: number | null;
  reason?: string | null;
  remediation?: string | null;
  retainedPlannerRevision?: number | null;
  targetPlannerRevision?: number | null;
  retainedProjectionRevision?: number | null;
  retainedProjectionFingerprint?: string | null;
  resolvedAtTick?: number | null;
  supersededByRevision?: number | null;
  supersededByFingerprint?: string | null;
};

export type FspmStatus = "active" | "completed" | "cancelled" | "retired";
export type FspmOperationalHealthState = "healthy" | "watch" | "degraded";
export type FspmTrend = "new" | "improving" | "stable" | "declining";
export type FspmKpiRating =
  | "exceptional"
  | "satisfactory"
  | "marginal"
  | "unsatisfactory"
  | "rejected"
  | "in_progress";
export type FspmOperationalHealth = {
  score: number;
  state: FspmOperationalHealthState;
  trend: FspmTrend;
  measuredAt: number;
  evidence: string[];
};
export type FspmRecord = {
  id: string;
  title?: string;
  status: FspmStatus;
  operationalHealth?: FspmOperationalHealth;
};
type LegacyFspmRecord = Omit<FspmRecord, "operationalHealth"> & {
  quality?: FspmOperationalHealth;
};
export type FspmPortfolioP3 = {
  id: string;
  type: "portfolio";
  subType: "ou_portfolio";
  name: string;
  description?: string;
  parentP3Id: string | null;
  temporalBasis: "game_tick";
  startTick: number;
  status: FspmStatus;
  operationalHealth?: FspmOperationalHealth;
  pqi?: FspmP3Pqi;
};
export type FspmRequirement = FspmRecord & {
  p3Id?: string;
  contractId?: string;
  domain?: string;
  revision?: number;
  strategicPriority?: "SELL" | "STAFF" | "SERVE";
  requirementSource?: string | null;
  originatingAuthority?: string | null;
  applicableOuId?: string;
  approvalAuthorityOuId?: string;
  approval?: boolean;
  approvedBy?: string;
  dateApproved?: string;
  approvalEventId?: string;
  activationStatus?: "valid" | "missing" | "invalid";
};
export type FspmDeliverable = FspmRecord & {
  p3Id?: string;
  requirementId?: string;
  domain?: string;
  revision?: number;
  category?: "corporate";
  deliverableType?: "product" | "service" | "result";
  output?: string;
  qualityDescription?: string;
  qualityMetric?: string;
  siblingWeightBasisPoints?: number;
  expectedSiblingWeightBasisPoints?: number;
  weightStatus?: "valid" | "invalid";
  taskWeightBasisPoints?: number;
  dqi?: FspmDeliverableQi;
  receiptValidation?: {
    evidenceForm: string;
    storageLocation: string;
    captureResponsibility: string;
  };
  servicePrincipalAcceptance?: {
    model: "terminal_activity_kpi_threshold";
    acceptedKpiRatings: ["exceptional", "satisfactory"];
    canonicalHumanAcceptance: false;
  };
  receiptContractStatus?: "valid" | "invalid";
  servicePrincipalAcceptanceStatus?: "valid" | "invalid";
  receiptEvidenceStatus?: "pending" | "missing" | "validated" | "invalid";
  receiptAcceptanceStatus?:
    | "pending"
    | "missing"
    | "accepted"
    | "rejected"
    | "disputed"
    | "invalid";
  /** Compatibility field for snapshots published before governed receipt telemetry. */
  receiptStatus?: "missing" | "validated" | "invalid";
  childDeliverableIds?: string[];
};
export type FspmTaskKpiMetric = {
  metric: string;
  exceptional: string;
  satisfactory: string;
  unsatisfactory: string;
};
export type FspmEqvmPolicyApproval = {
  status: "approved";
  approvalEventId: string;
  approvalAuthorityOuId: string;
  accountablePositionId: string;
  signerPrincipalId: string;
  approvedAtTick: number;
  approvedPolicyContentHash: string;
};
export type FspmEqvmPolicyAuthorizationDebt = {
  status: "unapproved";
  authorizationDebt: string;
};
export type FspmEqvmPolicyAuthorization =
  | FspmEqvmPolicyApproval
  | FspmEqvmPolicyAuthorizationDebt;
type FspmTaskQiEvidence = {
  score: number | null;
  status: FspmEqvmCoverageStatus;
  measuredAt: number;
  activityWeightPolicyId: "eqvm:activity-weight:equal-terminal-samples:v1";
  activityWeightModel: "equal_weight";
  configurationClass:
    | "implementation_research_configuration"
    | "governed_configuration";
  frameworkReferenceSha: string;
  unavailabilityReason?: "activity_weight_policy_unapproved";
  policyAuthorization: FspmEqvmPolicyAuthorization;
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
};
export type FspmTaskQi =
  | (FspmTaskQiEvidence & {
      score: number;
      status: "complete";
      configurationClass: "governed_configuration";
      policyAuthorization: FspmEqvmPolicyApproval;
      unavailabilityReason?: never;
    })
  | (FspmTaskQiEvidence & {
      score: null;
      status: Exclude<FspmEqvmCoverageStatus, "complete">;
      configurationClass: "governed_configuration";
      policyAuthorization: FspmEqvmPolicyApproval;
      unavailabilityReason?: never;
    })
  | (FspmTaskQiEvidence & {
      score: null;
      status: "unavailable";
      configurationClass: "implementation_research_configuration";
      policyAuthorization: FspmEqvmPolicyAuthorizationDebt;
      unavailabilityReason: "activity_weight_policy_unapproved";
    });
export type FspmEqvmCoverageStatus =
  | "unavailable"
  | "partial"
  | "complete"
  | "stale"
  | "invalid";
export type FspmWeightedEqvmCoverage = {
  status: FspmEqvmCoverageStatus;
  expectedWeightBasisPoints: number;
  coveredWeightBasisPoints: number;
  missingIds: string[];
  staleIds: string[];
  invalidIds: string[];
  evidence: string[];
};
type FspmCanonicalEqvmRollup =
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
export type FspmDeliverableQi = FspmCanonicalEqvmRollup & {
  measuredAt: number;
  activityWeightPolicyId: "eqvm:activity-weight:equal-terminal-samples:v1";
  taskWeightBasisPoints: number;
};
export type FspmP3Pqi = FspmCanonicalEqvmRollup & {
  measuredAt: number;
  activityWeightPolicyId: "eqvm:activity-weight:equal-terminal-samples:v1";
  deliverableWeightBasisPoints: number;
};
export type FspmActivityKpi = {
  tick: number;
  activityId: string;
  activityType: string;
  actor: string;
  rating: FspmKpiRating;
  value: number | null;
  evidence: string;
  source?: "terminal_activity_kpi";
  activityCompletedAtTick?: number;
  activityWeightPolicyId?: "eqvm:activity-weight:equal-terminal-samples:v1";
  outcome?: {
    metric: string;
    actual: number;
    target: number;
    unit: string;
    utilization: number;
  };
};
export type FspmTask = FspmRecord & {
  deliverableId?: string;
  domain?: string;
  taskKey?: string;
  taskWeightBasisPoints?: number;
  qualityDescription?: string;
  qualityMetric?: string;
  kpiMetric?: FspmTaskKpiMetric;
  procedures?: Array<{ id: string; procedureKey: string; title: string }>;
  qi?: FspmTaskQi;
  recentActivities?: FspmActivityKpi[];
};
export type FspmHistorySample = {
  tick: number;
  score: number;
  state: FspmOperationalHealthState;
};
export type FspmProgram = {
  id: string;
  title: string;
  type: "program";
  subType: "service_program";
  status: FspmStatus;
};
export type FspmColonySummary = {
  roomName: string;
  /** Optional at the decoder boundary so pre-v6 snapshots remain readable during rollout. */
  p3?: FspmPortfolioP3;
  /** Compatibility projection for the pre-P3 dashboard. Mirrors current P3 operational health after v6. */
  contract: FspmRecord;
  /** Legacy authority is preserved separately and never drives current health after v6. */
  legacyProgram?: FspmProgram | null;
  legacyContract?: LegacyFspmRecord | null;
  program?: FspmProgram | null;
  governance?: {
    packageId: string;
    packageRevision: number;
    packageHash: string;
    governanceSha: string;
    effectiveDate: string;
    importedAtTick: number;
    signerPrincipalId: string;
    accountablePositionId: string;
    approvalEvents: number;
    receiptEvidenceEvents?: number;
    receiptDecisionEvents?: number;
    deliverableWeightBasisPoints: number;
    approvalModel?: "source_control_service_principal";
    canonicalHumanApproval?: false;
    checks?: {
      empireRoot?: boolean;
      packageProjection: boolean;
      approvalLedger: boolean;
      ancestry: boolean;
      relationships: boolean;
      exactWeights: boolean;
      receiptContracts: boolean;
      acceptancePolicies?: boolean;
      receiptLedgers?: boolean;
    };
    valid: boolean;
    executionEligible?: boolean;
  } | null;
  requirements: FspmRequirement[];
  deliverables: FspmDeliverable[];
  tasks: FspmTask[];
  p3OperationalHealthHistory?: FspmHistorySample[];
  contractOperationalHealthHistory?: FspmHistorySample[];
};

export type RuntimeRoomDevelopmentStageStatus =
  | "horizon_gap"
  | "invalid_plan"
  | "controller_ineligible"
  | "prerequisite_blocked"
  | "not_started"
  | "in_progress"
  | "blocked"
  | "realized";

export type RuntimeRoomDevelopmentRequirement = {
  plannedStructureId: string;
  stageId: RoomDevelopmentStageId;
  structureType: string;
  x: number;
  y: number;
  minRcl: number;
  priority: number;
  strategicWeight: number;
  underConstruction: boolean;
  blocked: boolean;
  blockerReasons: string[];
};

export type RuntimeRoomDevelopmentSummary = {
  source: "runtime_room_development_evaluator";
  evaluatedAt: number;
  horizonStatus: "v4_rcl8" | "legacy_horizon_gap" | "invalid_v4_plan";
  validationIssues: string[];
  activeStageId: RoomDevelopmentStageId | null;
  nextStageId: RoomDevelopmentStageId | null;
  realizationPercentage: number | null;
  missingStructures: number;
  blockedStructures: number;
  stages: Array<{
    id: RoomDevelopmentStageId;
    title: string;
    minRcl: number;
    stageWeight: number;
    status: RuntimeRoomDevelopmentStageStatus;
    controllerEligible: boolean;
    prerequisitesSatisfied: boolean;
    realizationPercentage: number | null;
    realizedStructures: number;
    eligibleStructures: number;
    missingStructures: number;
    blockedStructures: number;
  }>;
  missingCriticalStructures: RuntimeRoomDevelopmentRequirement[];
  nextMilestone: {
    kind:
      | "replace_legacy_plan"
      | "repair_v4_plan"
      | "resolve_structure_blocker"
      | "complete_structure_site"
      | "realize_structure"
      | "reach_controller_level"
      | "mature_outcome_realized";
    stageId: RoomDevelopmentStageId | null;
    plannedStructureId: string | null;
    reason: string;
  };
};

export type RuntimeTrace = {
  tick?: number | null;
  runtimeSha?: string | null;
  fspm?: {
    rootP3?: FspmPortfolioP3 | null;
    colonies?: FspmColonySummary[];
  } | null;
  settlement?: {
    plans?: Array<{
      roomName?: string | null;
      projectionUsability?: {
        usable?: boolean | null;
        status?:
          | "missing"
          | "room_mismatch"
          | "version_horizon_mismatch"
          | "planner_stale"
          | "epoch_missing"
          | "fingerprint_mismatch"
          | "schema_invalid"
          | "invalidated"
          | "generation_fault"
          | "current"
          | null;
        reason?: string | null;
      } | null;
      deliverableId?: string | null;
      plannerRevision?: number | null;
      projectionRevision?: number | null;
      projectionFingerprint?: string | null;
      controllerLevel?: number | null;
      horizonStatus?: RuntimeRoomDevelopmentSummary["horizonStatus"] | null;
      activeStageId?: RoomDevelopmentStageId | null;
      nextStageId?: RoomDevelopmentStageId | null;
      realizationPercentage?: number | null;
      missingStructures?: number | null;
      blockedStructures?: number | null;
      development?: RuntimeRoomDevelopmentSummary | null;
      defense?: {
        strategy?: string | null;
        protectedTiles?: number | null;
        perimeterPlanned?: number | null;
        perimeterBuilt?: number | null;
        perimeterAtTarget?: number | null;
        targetHits?: number | null;
        underAttack?: boolean | null;
        nextMissingTile?: Point | null;
      } | null;
      energyTopology?: {
        status?:
          | "authorization-debt"
          | "incomplete"
          | "fault"
          | "unavailable"
          | null;
        reason?: string | null;
        sourceLinks?: number | null;
        controllerLinkPlanId?: string | null;
        coreLinkPlanId?: string | null;
      } | null;
    }>;
    faults?: SettlementProjectionFault[];
  } | null;
};

export type Snapshot = {
  schema?: "screeps-observability-snapshot/v1";
  schemaVersion?: 1;
  capturedAt?: string;
  gameTick?: number | null;
  target?: string;
  shard?: string;
  room?: string;
  /** Optional at the decoder boundary so snapshots captured before terrain rollout remain readable. */
  terrain?: EncodedRoomTerrain | null;
  captureConsistency?: SnapshotCaptureConsistency | null;
  colony?: {
    controller?: {
      x?: number | null;
      y?: number | null;
      level?: number | null;
      progress?: number | null;
      progressTotal?: number | null;
    } | null;
    energy?: { available?: number | null; capacity?: number | null } | null;
    creeps?: number | null;
    sources?: Point[];
    minerals?: Point[];
    structures?: Array<
      Point & {
        type?: string | null;
        owned?: boolean | null;
        hits?: number | null;
        hitsMax?: number | null;
      }
    >;
    constructionSites?: Array<
      Point & {
        structureType?: string | null;
        owned?: boolean | null;
        progress?: number | null;
        progressTotal?: number | null;
      }
    >;
  };
  roomPlan?: RoomPlan | null;
  roomPlanIntegrity?: RoomPlanIntegrityEvidence | null;
  runtimeTrace?: RuntimeTrace | null;
};
export type Experiment = ExperimentEvidenceRow;

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function normalizeFspmAuthority(value: unknown): Snapshot | null {
  // Supabase JSON is an untrusted persistence boundary. Clone and strictly
  // decode every nested EQVM claim before any React render can receive it.
  const snapshot = sanitizeStoredObservabilitySnapshot<Snapshot>(value);
  if (!snapshot) return null;
  const fspm = snapshot.runtimeTrace?.fspm;
  const untrustedColonies = (fspm as { colonies?: unknown } | null)?.colonies;
  const colonies = Array.isArray(untrustedColonies)
    ? untrustedColonies.filter(isRecordValue)
    : [];
  if (fspm) fspm.colonies = colonies as unknown as FspmColonySummary[];

  for (const colonyValue of colonies) {
    const colony = colonyValue as unknown as FspmColonySummary;
    colony.requirements = Array.isArray(colony.requirements)
      ? colony.requirements.filter(isRecordValue)
      : [];
    colony.deliverables = Array.isArray(colony.deliverables)
      ? colony.deliverables.filter(isRecordValue)
      : [];
    colony.tasks = Array.isArray(colony.tasks)
      ? colony.tasks.filter(isRecordValue)
      : [];
    const raw = colony as FspmColonySummary & {
      contract?: (FspmRecord & { quality?: FspmOperationalHealth }) | null;
      program?: FspmProgram | null;
      p3History?: FspmHistorySample[];
      contractHistory?: FspmHistorySample[];
    };
    const rawContract = raw.contract ?? null;
    const legacyProgram = raw.program ?? null;
    const legacyOperationalHealth =
      rawContract?.operationalHealth ?? rawContract?.quality;

    // Keep pre-v6 snapshots readable, but normalize their old `quality` field
    // into explicitly named operational-health telemetry at the UI boundary.
    if (!colony.p3) {
      if (rawContract) {
        colony.legacyContract = {
          id: rawContract.id,
          title: rawContract.title,
          status: rawContract.status,
          ...(legacyOperationalHealth
            ? { quality: legacyOperationalHealth }
            : {}),
        };
        colony.contract = {
          id: rawContract.id,
          title: rawContract.title,
          status: rawContract.status,
          ...(legacyOperationalHealth
            ? { operationalHealth: legacyOperationalHealth }
            : {}),
        };
      }
      colony.contractOperationalHealthHistory =
        colony.contractOperationalHealthHistory ?? raw.contractHistory ?? [];
      continue;
    }

    colony.legacyContract = rawContract
      ? {
          id: rawContract.id,
          title: rawContract.title,
          status: rawContract.status,
          ...(legacyOperationalHealth
            ? { quality: legacyOperationalHealth }
            : {}),
        }
      : null;
    colony.legacyProgram = legacyProgram;
    colony.program = null;
    colony.contract = {
      id: colony.p3.id,
      title: colony.p3.name,
      status: colony.p3.status,
      ...(colony.p3.operationalHealth
        ? { operationalHealth: colony.p3.operationalHealth }
        : {}),
    };
    colony.p3OperationalHealthHistory =
      colony.p3OperationalHealthHistory ?? raw.p3History ?? [];
    colony.contractOperationalHealthHistory = colony.p3OperationalHealthHistory;
  }
  return snapshot;
}

export async function loadControlPlane() {
  const supabase = await loadSupabaseClient();
  const [snapshotResult, experimentsResult, benchmarkResult] =
    await Promise.all([
      supabase
        .from("observability_snapshots")
        .select("id,colony_id,payload,captured_at,source_request_id")
        .not("captured_at", "is", null)
        .order("captured_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("experiments")
        .select(
          "experiment_key,name,target,shard,room_name,runtime_sha,completed_at,status,result",
        )
        .eq("status", "succeeded")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false, nullsFirst: false })
        .order("experiment_key", { ascending: false })
        .limit(12),
      supabase
        .from("benchmark_samples")
        .select(
          "id,sample_key,colony_id,benchmark_name,runtime_sha,captured_at,metrics,source,source_ref,inserted_at,colony:colonies(target,shard,room_name)",
        )
        .not("captured_at", "is", null)
        .order("captured_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const snapshotRow = snapshotResult.data as {
    id: number;
    colony_id: string | null;
    payload: unknown;
    captured_at: string | null;
    source_request_id: string | null;
  } | null;
  const snapshot = normalizeFspmAuthority(snapshotRow?.payload ?? null);
  const experiments = (experimentsResult.data as Experiment[] | null) ?? [];
  const benchmarkRow = (benchmarkResult.data as BenchmarkRow | null) ?? null;
  let correlatedExperiment = findCorrelatedExperiment(
    benchmarkRow,
    experiments,
  );
  let correlationQueryError: { code?: string } | null = null;
  if (
    benchmarkRow?.sample_key &&
    !correlatedExperiment &&
    !experimentsResult.error
  ) {
    const correlationResult = await supabase
      .from("experiments")
      .select(
        "experiment_key,name,target,shard,room_name,runtime_sha,completed_at,status,result",
      )
      .eq("status", "succeeded")
      .eq("experiment_key", benchmarkRow.sample_key)
      .maybeSingle();
    correlatedExperiment =
      (correlationResult.data as Experiment | null) ?? null;
    correlationQueryError = correlationResult.error;
  }
  const benchmark = mapBenchmarkSample(benchmarkRow, correlatedExperiment);
  const snapshotEvidence: SnapshotEvidence | null = snapshotRow
    ? {
        capturedAt: snapshotRow.captured_at,
        sourceRequestId: snapshotRow.source_request_id,
        colonyId: snapshotRow.colony_id,
        target: snapshot?.target ?? null,
        shard: snapshot?.shard ?? null,
        room: snapshot?.room ?? null,
        runtimeTick:
          typeof snapshot?.runtimeTrace?.tick === "number"
            ? snapshot.runtimeTrace.tick
            : null,
        runtimeSha: snapshot?.runtimeTrace?.runtimeSha ?? null,
        hasFspm: Boolean(snapshot?.runtimeTrace?.fspm),
      }
    : null;
  const errorCode = (error: { code?: string } | null) =>
    error ? error.code || "query_failed" : null;
  const provenance = buildControlPlaneProvenance({
    snapshot: snapshotEvidence,
    experiments,
    benchmark,
    correlatedExperiment,
    errors: {
      snapshot: errorCode(snapshotResult.error),
      experiments: errorCode(experimentsResult.error ?? correlationQueryError),
      benchmark: errorCode(benchmarkResult.error),
    },
  });

  return {
    snapshot,
    experiments: experiments.slice(0, 12),
    benchmark,
    provenance,
  };
}
