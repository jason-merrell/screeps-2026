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

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!secretKey || !supabaseUrl) {
      return json({ error: "server_configuration_error" }, 500);
    }

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json();
    const operation = body?.operation ?? "ingest_snapshot";

    if (operation === "register_command") {
      const requestId = String(body?.requestId ?? "");
      const commandKey = `github-comment:${requestId}`;
      if (!/^\d+$/.test(requestId)) return json({ error: "invalid_request_id" }, 400);
      const { data, error } = await admin.rpc("register_command", {
        p_command_key: commandKey,
        p_command_type: body?.commandType ?? "snapshot",
        p_target: body?.target ?? "ptr",
        p_shard: body?.shard ?? null,
        p_room_name: body?.room ?? null,
        p_payload: { command: body?.command ?? null, requestId },
      });
      if (error || !data) throw error ?? new Error("command_register_failed");
      return json({ ok: true, command: data, duplicate: data.status === "succeeded" });
    }

    if (operation === "transition_command") {
      const requestId = String(body?.requestId ?? "");
      if (!/^\d+$/.test(requestId)) return json({ error: "invalid_request_id" }, 400);
      const { data, error } = await admin.rpc("transition_command", {
        p_command_key: `github-comment:${requestId}`,
        p_status: body?.status,
        p_event_type: body?.eventType ?? body?.status,
        p_detail: body?.detail ?? {},
      });
      if (error || !data) throw error ?? new Error("command_transition_failed");
      return json({ ok: true, command: data });
    }

    const requestId = String(body?.requestId ?? "");
    const snapshot = body?.snapshot;
    if (!/^\d+$/.test(requestId)) return json({ error: "invalid_request_id" }, 400);
    if (
      !snapshot ||
      snapshot.schema !== "screeps-observability-snapshot/v1" ||
      snapshot.schemaVersion !== 1
    ) {
      return json({ error: "invalid_snapshot_schema" }, 400);
    }
    if (snapshot.target !== "ptr") return json({ error: "invalid_target" }, 400);
    if (!/^shard\d+$/.test(snapshot.shard ?? "")) return json({ error: "invalid_shard" }, 400);
    if (!/^[WE]\d+[NS]\d+$/.test(snapshot.room ?? "")) return json({ error: "invalid_room" }, 400);

    const { error: executingError } = await admin.rpc("transition_command", {
      p_command_key: `github-comment:${requestId}`,
      p_status: "executing",
      p_event_type: "executing",
      p_detail: { source: "snapshot-publisher" },
    });
    if (executingError) throw executingError;

    const { data: colony, error: colonyError } = await admin
      .from("colonies")
      .upsert(
        { target: snapshot.target, shard: snapshot.shard, room_name: snapshot.room },
        { onConflict: "target,shard,room_name" },
      )
      .select("id")
      .single();
    if (colonyError || !colony) throw colonyError ?? new Error("colony_upsert_failed");

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
    if (snapshotError || !row) throw snapshotError ?? new Error("snapshot_upsert_failed");

    const { error: completedError } = await admin.rpc("transition_command", {
      p_command_key: `github-comment:${requestId}`,
      p_status: "succeeded",
      p_event_type: "succeeded",
      p_detail: { snapshotId: row.id },
    });
    if (completedError) throw completedError;

    return json({ ok: true, colonyId: colony.id, snapshotId: row.id });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 401);
  }
});
