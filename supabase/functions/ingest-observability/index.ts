import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const jwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);
const expectedRepository = "jason-merrell/screeps-2026";
const expectedWorkflow =
  `${expectedRepository}/.github/workflows/screeps-observability.yml@refs/heads/main`;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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
        audience: "screeps-supabase-ingest",
      },
    );

    if (payload.repository !== expectedRepository) {
      return json({ error: "repository_not_allowed" }, 403);
    }
    if (payload.workflow_ref !== expectedWorkflow) {
      return json({ error: "workflow_not_allowed" }, 403);
    }

    const body = await req.json();
    const requestId = String(body?.requestId ?? "");
    const snapshot = body?.snapshot;

    if (!/^\d+$/.test(requestId)) {
      return json({ error: "invalid_request_id" }, 400);
    }
    if (
      !snapshot ||
      snapshot.schema !== "screeps-observability-snapshot/v1" ||
      snapshot.schemaVersion !== 1
    ) {
      return json({ error: "invalid_snapshot_schema" }, 400);
    }
    if (snapshot.target !== "ptr") return json({ error: "invalid_target" }, 400);
    if (!/^shard\d+$/.test(snapshot.shard ?? "")) {
      return json({ error: "invalid_shard" }, 400);
    }
    if (!/^[WE]\d+[NS]\d+$/.test(snapshot.room ?? "")) {
      return json({ error: "invalid_room" }, 400);
    }

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!secretKey || !supabaseUrl) {
      return json({ error: "server_configuration_error" }, 500);
    }

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: colony, error: colonyError } = await admin
      .from("colonies")
      .upsert(
        {
          target: snapshot.target,
          shard: snapshot.shard,
          room_name: snapshot.room,
        },
        { onConflict: "target,shard,room_name" },
      )
      .select("id")
      .single();
    if (colonyError || !colony) {
      throw colonyError ?? new Error("colony_upsert_failed");
    }

    const { data: row, error: snapshotError } = await admin
      .from("observability_snapshots")
      .upsert(
        {
          schema: snapshot.schema,
          schema_version: snapshot.schemaVersion,
          colony_id: colony.id,
          captured_at: snapshot.capturedAt,
          game_tick: snapshot.gameTick ?? null,
          source_request_id: requestId,
          payload: snapshot,
        },
        { onConflict: "source_request_id" },
      )
      .select("id")
      .single();
    if (snapshotError || !row) {
      throw snapshotError ?? new Error("snapshot_upsert_failed");
    }

    return json({ ok: true, colonyId: colony.id, snapshotId: row.id });
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      401,
    );
  }
});
