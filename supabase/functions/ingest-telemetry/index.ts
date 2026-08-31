import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

import { sanitizeStoredTelemetrySample } from "../_shared/eqvm-snapshot.mjs";

type RuntimeTraceSample = {
  version?: number;
  tick?: number;
  cpu?: {
    total?: number;
    perception?: number;
    arbitration?: number;
    execution?: number;
    observability?: number;
    planners?: Record<string, number | undefined>;
    bucket?: number;
  };
  spatial?: {
    roomsIndexed?: number;
    distanceLookups?: number;
    distanceCacheHits?: number;
    distanceCacheMisses?: number;
    [key: string]: unknown;
  };
  intents?: {
    proposed?: number;
    accepted?: number;
    rejected?: number;
    acceptedSample?: unknown[];
    rejectedSample?: unknown[];
  };
  [key: string]: unknown;
};

type InboundTelemetrySample = {
  schema?: string;
  schemaVersion?: number;
  collectedAt?: string;
  runtimeTrace?: RuntimeTraceSample;
  observabilityDiagnostic?: unknown;
  state?: {
    controller?: { level?: number; progress?: number };
    workforce?: { total?: number };
    energy?: {
      harvestedTotal?: number;
      constructionSpendTotal?: number;
      controllerSpendTotal?: number;
    };
  };
  evaluation?: {
    status?: string;
    milestones?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

type StoredTelemetryRow = {
  sequence: number;
  payload: InboundTelemetrySample;
};

type CollectionRun = {
  interval_ms?: number | null;
};

const jwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);
const expectedRepository = "jason-merrell/screeps-2026";
const allowedWorkflows = new Set([
  `${expectedRepository}/.github/workflows/screeps-insights.yml@refs/heads/main`,
  `${expectedRepository}/.github/workflows/screeps-observability.yml@refs/heads/main`,
]);
const audience = "screeps-supabase-telemetry";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const finite = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const avg = (values: unknown[]) => {
  const xs = values.map(finite).filter((v): v is number => v !== null);
  return xs.length
    ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000
    : null;
};
const validRoom = (v: string) => /^[WE]\d+[NS]\d+$/.test(v);
const validShard = (v: string) => /^shard\d+$/.test(v);
const validKey = (v: string) =>
  v.length > 0 && v.length <= 240 && /^[A-Za-z0-9:._-]+$/.test(v);

function deriveResult(samples: StoredTelemetryRow[], run: CollectionRun) {
  const first = samples[0]?.payload;
  const final = samples.at(-1)?.payload;
  if (!first || !final) throw new Error("cannot finalize empty telemetry run");
  const transitions: Record<string, unknown> = {};
  for (const row of samples) {
    const p = row.payload;
    for (const [milestone, reached] of Object.entries(
      p?.evaluation?.milestones ?? {},
    )) {
      if (reached && transitions[milestone] === undefined)
        transitions[milestone] = {
          sample: row.sequence,
          collectedAt: p.collectedAt,
        };
    }
  }
  const traces = samples
    .map((row) => row.payload?.runtimeTrace)
    .filter((trace): trace is RuntimeTraceSample => trace?.version === 1);
  const latestTrace = traces.at(-1) ?? null;
  const plannerNames = ["defense", "spawning", "construction", "economy"];
  const state0 = first.state;
  const state1 = final.state;
  const observability = {
    transport: { kind: "memory-segment", segment: 99 },
    samplesWithTrace: traces.length,
    latestTick: latestTrace?.tick ?? null,
    latestDiagnostic: final.observabilityDiagnostic ?? null,
    cpu: {
      averageTotal: avg(traces.map((t) => t.cpu?.total)),
      maxTotal: traces.length
        ? Math.max(...traces.map((t) => finite(t.cpu?.total) ?? 0))
        : null,
      averagePerception: avg(traces.map((t) => t.cpu?.perception)),
      averageArbitration: avg(traces.map((t) => t.cpu?.arbitration)),
      averageExecution: avg(traces.map((t) => t.cpu?.execution)),
      averageObservability: avg(traces.map((t) => t.cpu?.observability)),
      averagePlanners: Object.fromEntries(
        plannerNames.map((name) => [
          name,
          avg(traces.map((t) => t.cpu?.planners?.[name] ?? 0)),
        ]),
      ),
      bucket: latestTrace?.cpu?.bucket ?? null,
    },
    spatial: {
      averageRoomsIndexed: avg(traces.map((t) => t.spatial?.roomsIndexed ?? 0)),
      averageDistanceLookups: avg(
        traces.map((t) => t.spatial?.distanceLookups ?? 0),
      ),
      averageDistanceCacheHits: avg(
        traces.map((t) => t.spatial?.distanceCacheHits ?? 0),
      ),
      averageDistanceCacheMisses: avg(
        traces.map((t) => t.spatial?.distanceCacheMisses ?? 0),
      ),
      latest: latestTrace?.spatial ?? null,
    },
    intents: {
      averageProposed: avg(traces.map((t) => t.intents?.proposed)),
      averageAccepted: avg(traces.map((t) => t.intents?.accepted)),
      averageRejected: avg(traces.map((t) => t.intents?.rejected)),
      latestAcceptedSample: latestTrace?.intents?.acceptedSample ?? [],
      latestRejectedSample: latestTrace?.intents?.rejectedSample ?? [],
    },
  };
  return {
    delta: {
      rcl: (state1?.controller?.level ?? 0) - (state0?.controller?.level ?? 0),
      controllerProgress:
        (state1?.controller?.progress ?? 0) -
        (state0?.controller?.progress ?? 0),
      workforce:
        (state1?.workforce?.total ?? 0) - (state0?.workforce?.total ?? 0),
      harvested:
        (state1?.energy?.harvestedTotal ?? 0) -
        (state0?.energy?.harvestedTotal ?? 0),
      constructionSpend:
        (state1?.energy?.constructionSpendTotal ?? 0) -
        (state0?.energy?.constructionSpendTotal ?? 0),
      controllerSpend:
        (state1?.energy?.controllerSpendTotal ?? 0) -
        (state0?.energy?.controllerSpendTotal ?? 0),
    },
    final: {
      state: final.state,
      evaluation: final.evaluation,
      collectedAt: final.collectedAt,
    },
    startedAt: first.collectedAt,
    intervalMs: run.interval_ms,
    completedAt: final.collectedAt,
    sampleCount: samples.length,
    transitions,
    evidenceClass: "live-ptr-longitudinal",
    observability,
    outcomeStatus: final?.evaluation?.status ?? "failed",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer "))
    return json({ error: "missing_bearer_token" }, 401);
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, {
      issuer: "https://token.actions.githubusercontent.com",
      audience,
    });
    if (payload.repository !== expectedRepository)
      return json({ error: "repository_not_allowed" }, 403);
    if (!allowedWorkflows.has(String(payload.workflow_ref ?? "")))
      return json({ error: "workflow_not_allowed" }, 403);

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey =
      secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!secretKey || !supabaseUrl)
      return json({ error: "server_configuration_error" }, 500);
    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json();
    const operation = String(body?.operation ?? "");
    const collectionKey = String(body?.collectionKey ?? "");
    if (!validKey(collectionKey))
      return json({ error: "invalid_collection_key" }, 400);

    if (operation === "start_run") {
      const requestId = String(body?.requestId ?? "");
      const target = String(body?.target ?? "ptr");
      const shard = String(body?.shard ?? "");
      const room = String(body?.room ?? "");
      const name = String(body?.experimentName ?? "");
      if (
        !/^\d+$/.test(requestId) ||
        target !== "ptr" ||
        !validShard(shard) ||
        !validRoom(room) ||
        !name
      ) {
        return json({ error: "invalid_run_identity" }, 400);
      }
      const { data: colony, error: colonyError } = await admin
        .from("colonies")
        .upsert(
          {
            target,
            shard,
            room_name: room,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "target,shard,room_name" },
        )
        .select("id")
        .single();
      if (colonyError || !colony)
        throw colonyError ?? new Error("colony_upsert_failed");
      const experimentKey = `ptr-experiment:${requestId}`;
      const startedAt = new Date().toISOString();
      const { data: experiment, error: experimentError } = await admin
        .from("experiments")
        .upsert(
          {
            experiment_key: experimentKey,
            name,
            target,
            shard,
            room_name: room,
            runtime_sha: body?.runtimeSha ?? null,
            status: "running",
            started_at: startedAt,
            completed_at: null,
            result: null,
          },
          { onConflict: "experiment_key" },
        )
        .select("id")
        .single();
      if (experimentError || !experiment)
        throw experimentError ?? new Error("experiment_upsert_failed");
      const { data: run, error: runError } = await admin
        .from("collection_runs")
        .upsert(
          {
            collection_key: collectionKey,
            colony_id: colony.id,
            experiment_id: experiment.id,
            collector: body?.collector ?? "github-actions:ptr-experiment",
            runtime_sha: body?.runtimeSha ?? null,
            status: "running",
            source_request_id: requestId,
            expected_samples: body?.expectedSamples ?? null,
            interval_ms: body?.intervalMs ?? null,
            started_at: startedAt,
            completed_at: null,
            metadata: body?.metadata ?? {},
            updated_at: startedAt,
          },
          { onConflict: "collection_key" },
        )
        .select("id,experiment_id,colony_id")
        .single();
      if (runError || !run)
        throw runError ?? new Error("collection_run_upsert_failed");
      return json({
        ok: true,
        collectionRunId: run.id,
        experimentId: experiment.id,
        colonyId: colony.id,
      });
    }

    const { data: run, error: runError } = await admin
      .from("collection_runs")
      .select("*")
      .eq("collection_key", collectionKey)
      .single();
    if (runError || !run)
      throw runError ?? new Error("collection_run_not_found");

    if (operation === "ingest_sample") {
      const sample = sanitizeStoredTelemetrySample<InboundTelemetrySample>(
        body?.sample,
      );
      const sequence = Number(body?.sequence);
      if (!Number.isInteger(sequence) || sequence < 0 || !sample) {
        return json({ error: "invalid_sample" }, 400);
      }
      const sampleKey = `${collectionKey}:${sequence}`;
      const { data: row, error: sampleError } = await admin
        .from("telemetry_samples")
        .upsert(
          {
            sample_key: sampleKey,
            collection_run_id: run.id,
            colony_id: run.colony_id,
            experiment_id: run.experiment_id,
            sequence,
            captured_at: sample.collectedAt,
            game_tick: sample.runtimeTrace?.tick ?? null,
            runtime_sha: run.runtime_sha,
            schema: sample.schema,
            schema_version: sample.schemaVersion,
            payload: sample,
          },
          { onConflict: "sample_key" },
        )
        .select("id")
        .single();
      if (sampleError || !row)
        throw sampleError ?? new Error("sample_upsert_failed");
      const { count, error: countError } = await admin
        .from("telemetry_samples")
        .select("id", { count: "exact", head: true })
        .eq("collection_run_id", run.id);
      if (countError) throw countError;
      await admin
        .from("collection_runs")
        .update({
          sample_count: count ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      return json({ ok: true, sampleId: row.id, sampleCount: count ?? 0 });
    }

    if (operation === "complete_run") {
      const { data: rows, error: rowsError } = await admin
        .from("telemetry_samples")
        .select("sequence,payload")
        .eq("collection_run_id", run.id)
        .order("sequence", { ascending: true });
      if (rowsError) throw rowsError;
      const safeRows = (rows ?? []).map((row) => {
        const payload = sanitizeStoredTelemetrySample<InboundTelemetrySample>(
          row.payload,
        );
        if (!payload) throw new Error("invalid_stored_telemetry_sample");
        return { ...row, payload };
      });
      const result = deriveResult(safeRows, run);
      const completedAt = result.completedAt ?? new Date().toISOString();
      const finalStatus =
        result.outcomeStatus === "failed" ? "failed" : "succeeded";
      const { error: updateRunError } = await admin
        .from("collection_runs")
        .update({
          status: finalStatus,
          sample_count: rows?.length ?? 0,
          completed_at: completedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      if (updateRunError) throw updateRunError;
      if (run.experiment_id) {
        const { error: expError } = await admin
          .from("experiments")
          .update({
            status: finalStatus,
            completed_at: completedAt,
            result,
          })
          .eq("id", run.experiment_id);
        if (expError) throw expError;
      }
      return json({
        ok: true,
        collectionRunId: run.id,
        experimentId: run.experiment_id,
        result,
      });
    }

    if (operation === "fail_run") {
      const completedAt = new Date().toISOString();
      await admin
        .from("collection_runs")
        .update({
          status: "failed",
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", run.id);
      if (run.experiment_id)
        await admin
          .from("experiments")
          .update({
            status: "failed",
            completed_at: completedAt,
            result: {
              error: String(body?.error ?? "collector_failed"),
              sampleCount: run.sample_count,
            },
          })
          .eq("id", run.experiment_id);
      return json({ ok: true });
    }

    return json({ error: "unsupported_operation" }, 400);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      401,
    );
  }
});
