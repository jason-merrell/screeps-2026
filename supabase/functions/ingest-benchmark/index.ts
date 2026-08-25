import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const jwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);
const expectedRepository = "jason-merrell/screeps-2026";
const expectedWorkflow =
  `${expectedRepository}/.github/workflows/screeps-insights.yml@refs/heads/main`;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const validRoom = (value: unknown): value is string =>
  typeof value === "string" && /^[WE]\d+[NS]\d+$/.test(value);
const validShard = (value: unknown): value is string =>
  typeof value === "string" && /^shard\d+$/.test(value);
const validSampleKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 240 && /^[A-Za-z0-9:._-]+$/.test(value);
const validRuntimeSha = (value: unknown): value is string | null =>
  value === null || value === undefined || (typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value));

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "missing_bearer_token" }, 401);
  }

  try {
    const { payload } = await jwtVerify(
      authorization.slice("Bearer ".length),
      jwks,
      {
        issuer: "https://token.actions.githubusercontent.com",
        audience: "screeps-supabase-benchmark",
      },
    );

    if (payload.repository !== expectedRepository) {
      return json({ error: "repository_not_allowed" }, 403);
    }
    if (payload.workflow_ref !== expectedWorkflow) {
      return json({ error: "workflow_not_allowed" }, 403);
    }

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!secretKey || !supabaseUrl) {
      return json({ error: "server_configuration_error" }, 500);
    }

    const body = await req.json();
    const benchmark = body?.benchmark;
    if (
      !benchmark ||
      benchmark.schema !== "screeps-benchmark-sample/v1" ||
      benchmark.schemaVersion !== 1
    ) {
      return json({ error: "invalid_benchmark_schema" }, 400);
    }
    if (benchmark.target !== "ptr") return json({ error: "invalid_target" }, 400);
    if (!validShard(benchmark.shard)) return json({ error: "invalid_shard" }, 400);
    if (!validRoom(benchmark.room)) return json({ error: "invalid_room" }, 400);
    if (!validSampleKey(benchmark.sampleKey)) return json({ error: "invalid_sample_key" }, 400);
    if (!validRuntimeSha(benchmark.runtimeSha)) return json({ error: "invalid_runtime_sha" }, 400);
    if (typeof benchmark.benchmarkName !== "string" || benchmark.benchmarkName.length > 160) {
      return json({ error: "invalid_benchmark_name" }, 400);
    }
    if (!benchmark.metrics || typeof benchmark.metrics !== "object" || Array.isArray(benchmark.metrics)) {
      return json({ error: "invalid_metrics" }, 400);
    }
    if (!benchmark.result || typeof benchmark.result !== "object" || Array.isArray(benchmark.result)) {
      return json({ error: "invalid_result" }, 400);
    }

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: colony, error: colonyError } = await admin
      .from("colonies")
      .upsert(
        { target: benchmark.target, shard: benchmark.shard, room_name: benchmark.room },
        { onConflict: "target,shard,room_name" },
      )
      .select("id")
      .single();
    if (colonyError || !colony) throw colonyError ?? new Error("colony_upsert_failed");

    const completedAt = benchmark.capturedAt ?? new Date().toISOString();
    const startedAt = benchmark.result?.startedAt ?? null;
    const { data: experiment, error: experimentError } = await admin
      .from("experiments")
      .upsert(
        {
          experiment_key: benchmark.sampleKey,
          name: benchmark.benchmarkName,
          target: benchmark.target,
          shard: benchmark.shard,
          room_name: benchmark.room,
          runtime_sha: benchmark.runtimeSha ?? null,
          status: "succeeded",
          started_at: startedAt,
          completed_at: completedAt,
          result: benchmark.result,
        },
        { onConflict: "experiment_key" },
      )
      .select("id")
      .single();
    if (experimentError || !experiment) {
      throw experimentError ?? new Error("experiment_upsert_failed");
    }

    const { data: sample, error: sampleError } = await admin
      .from("benchmark_samples")
      .upsert(
        {
          sample_key: benchmark.sampleKey,
          colony_id: colony.id,
          benchmark_name: benchmark.benchmarkName,
          runtime_sha: benchmark.runtimeSha ?? null,
          captured_at: completedAt,
          metrics: benchmark.metrics,
          source: "ptr-experiment",
          source_ref: benchmark.sourceRef ?? benchmark.sampleKey,
        },
        { onConflict: "sample_key" },
      )
      .select("id")
      .single();
    if (sampleError || !sample) throw sampleError ?? new Error("benchmark_upsert_failed");

    return json({
      ok: true,
      colonyId: colony.id,
      experimentId: experiment.id,
      benchmarkSampleId: sample.id,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 401);
  }
});
