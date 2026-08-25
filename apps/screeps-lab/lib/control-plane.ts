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

export type FspmStatus = "active" | "completed" | "cancelled";
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
export type FspmRequirement = FspmRecord & {
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
  program?: FspmProgram | null;
  contract: FspmRecord;
  requirements: FspmRequirement[];
  deliverables: FspmDeliverable[];
  tasks: FspmTask[];
  contractHistory?: FspmHistorySample[];
};
export type RuntimeTrace = {
  tick?: number | null;
  fspm?: {
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

export async function loadControlPlane() {
  const [snapshotResult, experimentsResult, benchmarkResult] = await Promise.all([
    supabase.from("observability_snapshots").select("payload,captured_at").order("captured_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("experiments").select("experiment_key,name,runtime_sha,completed_at,status").eq("status", "succeeded").order("completed_at", { ascending: false }).limit(12),
    supabase.from("benchmark_samples").select("metrics,captured_at").order("captured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const snapshot = (snapshotResult.data?.payload as Snapshot | undefined) ?? null;
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
