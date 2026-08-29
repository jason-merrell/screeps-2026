import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://nflcqzcqpodnfkzjarwv.supabase.co";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_2g6FV2odRFonTpEDZ0rzSw_0MaZSAUt";

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Point = { x: number; y: number };
export type RoomPlan = {
  version?: number | null;
  horizonRcl?: number | null;
  anchors?: {
    spawn?: (Point & { name?: string | null }) | null;
    hub?: Point | null;
    controller?: (Point & { service?: Point | null }) | null;
    sources?: Array<Point & { container?: Point | null }>;
  };
  structures?: Array<Point & { structureType?: string | null }>;
  roads?: Point[];
};

export type FspmStatus = "active" | "completed" | "cancelled" | "retired";
export type FspmQualityState = "healthy" | "watch" | "degraded";
export type FspmTrend = "new" | "improving" | "stable" | "declining";
export type FspmKpiRating = "exceptional" | "satisfactory" | "unsatisfactory" | "in_progress";
export type FspmQuality = {
  score: number;
  state: FspmQualityState;
  trend?: FspmTrend;
  evidence?: string[];
};
export type FspmRecord = {
  id: string;
  title?: string;
  status: FspmStatus;
  quality?: FspmQuality;
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
  quality?: FspmQuality;
};
export type FspmRequirement = FspmRecord & {
  p3Id?: string;
  contractId?: string;
  domain?: string;
};
export type FspmDeliverable = FspmRecord & {
  requirementId?: string;
  domain?: string;
};
export type FspmTaskKpiMetric = {
  metric: string;
  exceptional: string;
  satisfactory: string;
  unsatisfactory: string;
};
export type FspmTaskQi = {
  score: number;
  measuredAt: number;
  ratedActivities: number;
  totalActivities: number;
  exceptional: number;
  satisfactory: number;
  unsatisfactory: number;
};
export type FspmActivityKpi = {
  tick: number;
  activityId: string;
  activityType: string;
  actor: string;
  rating: FspmKpiRating;
  value: number | null;
  evidence: string;
  outcome?: { metric: string; actual: number; target: number; unit: string; utilization: number };
};
export type FspmTask = FspmRecord & {
  deliverableId?: string;
  domain?: string;
  taskKey?: string;
  kpiMetric?: FspmTaskKpiMetric;
  qi?: FspmTaskQi;
  recentActivities?: FspmActivityKpi[];
};
export type FspmHistorySample = {
  tick: number;
  score: number;
  state: FspmQualityState;
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
  /** Compatibility projection for the pre-P3 dashboard. Mirrors current P3 quality after v6. */
  contract: FspmRecord;
  /** Legacy authority is preserved separately and never drives current health after v6. */
  legacyProgram?: FspmProgram | null;
  legacyContract?: FspmRecord | null;
  program?: FspmProgram | null;
  requirements: FspmRequirement[];
  deliverables: FspmDeliverable[];
  tasks: FspmTask[];
  p3History?: FspmHistorySample[];
  contractHistory?: FspmHistorySample[];
};
export type RuntimeTrace = {
  tick?: number | null;
  fspm?: {
    rootP3?: FspmPortfolioP3 | null;
    colonies?: FspmColonySummary[];
  } | null;
};

export type Snapshot = {
  target?: string;
  shard?: string;
  room?: string;
  colony?: {
    controller?: { level?: number | null; progress?: number | null; progressTotal?: number | null } | null;
    energy?: { available?: number | null; capacity?: number | null } | null;
    creeps?: number | null;
    structures?: Array<Point & { type?: string | null }>;
    constructionSites?: Array<Point & { structureType?: string | null }>;
  };
  roomPlan?: RoomPlan | null;
  runtimeTrace?: RuntimeTrace | null;
};
export type Experiment = {
  experiment_key: string;
  name: string;
  runtime_sha: string | null;
  completed_at: string | null;
  status: string;
};
export type BenchmarkMetrics = {
  perception: number;
  economy: number;
  arbitration: number;
  execution: number;
  observability: number;
};

export const benchmarkFallback: BenchmarkMetrics = {
  perception: 0.036,
  economy: 0.165,
  arbitration: 0.018,
  execution: 0.76,
  observability: 0.033,
};

function normalizeFspmAuthority(snapshot: Snapshot | null): Snapshot | null {
  for (const colony of snapshot?.runtimeTrace?.fspm?.colonies ?? []) {
    // A pre-v6 snapshot has no P3 yet. Leave its legacy contract/program projection
    // untouched so Screeps Lab stays readable throughout the rolling migration.
    if (!colony.p3) continue;

    const raw = colony as FspmColonySummary & {
      contract?: FspmRecord | null;
      program?: FspmProgram | null;
    };
    const legacyContract = raw.contract ?? null;
    const legacyProgram = raw.program ?? null;

    colony.legacyContract = legacyContract;
    colony.legacyProgram = legacyProgram;
    colony.program = null;
    colony.contract = {
      id: colony.p3.id,
      title: colony.p3.name,
      status: colony.p3.status,
      ...(colony.p3.quality ? { quality: colony.p3.quality } : {}),
    };
    colony.contractHistory = colony.p3History ?? [];
  }
  return snapshot;
}

export async function loadControlPlane() {
  const [snapshotResult, experimentsResult, benchmarkResult] = await Promise.all([
    supabase.from("observability_snapshots").select("payload,captured_at").order("captured_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("experiments").select("experiment_key,name,runtime_sha,completed_at,status").eq("status", "succeeded").order("completed_at", { ascending: false }).limit(12),
    supabase.from("benchmark_samples").select("metrics,captured_at").order("captured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const snapshot = normalizeFspmAuthority(
    (snapshotResult.data?.payload as Snapshot | undefined) ?? null,
  );
  const experiments = (experimentsResult.data as Experiment[] | null) ?? [];
  const metrics = {
    ...benchmarkFallback,
    ...((benchmarkResult.data?.metrics as Partial<BenchmarkMetrics> | undefined) ?? {}),
  };

  return {
    snapshot,
    experiments,
    metrics,
    sourceHealthy: !snapshotResult.error && !benchmarkResult.error,
  };
}
