import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { projectBootstrapState } from "./lib/bootstrap-state.mjs";
import { evaluateBootstrapWindow } from "./lib/bootstrap-window.mjs";
import { decodeScreepsSegment, summarizeSegmentResponse } from "./lib/screeps-memory.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const defaultShard = process.env.SCREEPS_SHARD || "shard3";
const requestedShard = process.env.SCREEPS_REQUESTED_SHARD || "";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/experiment bootstrap-rcl3 target=ptr";
const experimentName = process.env.SCREEPS_EXPERIMENT || "bootstrap-rcl3";
const sampleCount = Math.max(1, Math.min(24, Number(process.env.SCREEPS_EXPERIMENT_SAMPLES || 12)));
const intervalMs = Math.max(1000, Math.min(30_000, Number(process.env.SCREEPS_EXPERIMENT_INTERVAL_MS || 5000)));
const telemetryUrl = process.env.SUPABASE_TELEMETRY_URL || "";
const runtimeSha = process.env.GITHUB_SHA || null;
const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL || "";
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || "";
const githubOutput = process.env.GITHUB_OUTPUT || "";
const PTR_PREFIX = "/ptr";
const OBSERVABILITY_SEGMENT = 99;

if (!token) throw new Error("SCREEPS_TOKEN is required for PTR experiments");
if (!telemetryUrl) throw new Error("SUPABASE_TELEMETRY_URL is required for PTR experiments");
if (!oidcRequestUrl || !oidcRequestToken) {
  throw new Error("GitHub Actions OIDC environment is required for PTR telemetry persistence");
}
if (experimentName !== "bootstrap-rcl3") {
  throw new Error(`Unsupported PTR experiment '${experimentName}'`);
}
if (!/^\d+$/.test(requestId)) throw new Error(`Invalid experiment request id '${requestId}'`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const setOutput = async (name, value) => {
  if (githubOutput) await appendFile(githubOutput, `${name}=${value}\n`, "utf8");
};

const mintTelemetryToken = async () => {
  const url = new URL(oidcRequestUrl);
  url.searchParams.set("audience", "screeps-supabase-telemetry");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${oidcRequestToken}` },
  });
  if (!response.ok) throw new Error(`GitHub OIDC token request failed with HTTP ${response.status}`);
  const body = await response.json();
  if (!body?.value) throw new Error("GitHub OIDC response did not contain a token");
  return body.value;
};

const telemetryToken = await mintTelemetryToken();
const publishTelemetry = async (payload) => {
  const response = await fetch(telemetryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${telemetryToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok || body?.ok !== true) {
    throw new Error(`Supabase telemetry publish failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
};

const requestJson = async (path, params = {}) => {
  const url = new URL(`${PTR_PREFIX}${path}`, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Token": token },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep text for diagnostics.
  }

  return { ok: response.ok, status: response.status, body };
};

const requireOk = (label, response) => {
  if (!response.ok || response.body?.ok === 0) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body;
};

const parseRoomRef = (value) => {
  if (typeof value !== "string") return null;
  const qualified = value.match(/^(shard[^/]+)\/([WE]\d+[NS]\d+)$/i);
  if (qualified) return { shard: qualified[1].toLowerCase(), room: qualified[2].toUpperCase() };
  if (/^[WE]\d+[NS]\d+$/i.test(value)) return { shard: defaultShard, room: value.toUpperCase() };
  return null;
};

const average = (values) =>
  values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;

const buildLocalResult = (samples, transitions, ref) => {
  const first = samples[0];
  const final = samples.at(-1);
  const traces = samples.map((sample) => sample.observability).filter((trace) => trace?.version === 1);
  const plannerNames = ["defense", "spawning", "construction", "economy"];
  const latestTrace = traces.at(-1) ?? null;
  const observabilitySummary = {
    transport: { kind: "memory-segment", segment: OBSERVABILITY_SEGMENT },
    samplesWithTrace: traces.length,
    latestTick: latestTrace?.tick ?? null,
    latestDiagnostic: final?.observabilityDiagnostic ?? null,
    cpu: {
      averageTotal: average(traces.map((trace) => trace.cpu.total)),
      maxTotal: traces.length ? Math.max(...traces.map((trace) => trace.cpu.total)) : null,
      averagePerception: average(traces.map((trace) => trace.cpu.perception)),
      averageArbitration: average(traces.map((trace) => trace.cpu.arbitration)),
      averageExecution: average(traces.map((trace) => trace.cpu.execution)),
      averageObservability: average(traces.map((trace) => trace.cpu.observability)),
      averagePlanners: Object.fromEntries(
        plannerNames.map((name) => [
          name,
          average(traces.map((trace) => trace.cpu.planners?.[name] ?? 0)),
        ]),
      ),
      bucket: latestTrace?.cpu.bucket ?? null,
    },
    spatial: {
      averageRoomsIndexed: average(traces.map((trace) => trace.spatial?.roomsIndexed ?? 0)),
      averageDistanceLookups: average(traces.map((trace) => trace.spatial?.distanceLookups ?? 0)),
      averageDistanceCacheHits: average(traces.map((trace) => trace.spatial?.distanceCacheHits ?? 0)),
      averageDistanceCacheMisses: average(traces.map((trace) => trace.spatial?.distanceCacheMisses ?? 0)),
      latest: latestTrace?.spatial ?? null,
    },
    intents: {
      averageProposed: average(traces.map((trace) => trace.intents.proposed)),
      averageAccepted: average(traces.map((trace) => trace.intents.accepted)),
      averageRejected: average(traces.map((trace) => trace.intents.rejected)),
      latestAcceptedSample: latestTrace?.intents.acceptedSample ?? [],
      latestRejectedSample: latestTrace?.intents.rejectedSample ?? [],
    },
  };

  return {
    request: {
      id: requestId,
      command: requestCommand,
      mode: "experiment",
      target: "ptr",
    },
    experiment: {
      name: experimentName,
      room: ref.room,
      shard: ref.shard,
      sampleCount: samples.length,
      intervalMs,
      startedAt: first?.collectedAt ?? null,
      completedAt: final?.collectedAt ?? null,
      status: final?.evaluation.status ?? "failed",
      transitions,
      delta: first && final
        ? {
            rcl: (final.state.controller?.level ?? 0) - (first.state.controller?.level ?? 0),
            controllerProgress: (final.state.controller?.progress ?? 0) - (first.state.controller?.progress ?? 0),
            workforce: final.state.workforce.total - first.state.workforce.total,
            harvested: final.state.energy.harvestedTotal - first.state.energy.harvestedTotal,
            constructionSpend:
              final.state.energy.constructionSpendTotal - first.state.energy.constructionSpendTotal,
            controllerSpend: final.state.energy.controllerSpendTotal - first.state.energy.controllerSpendTotal,
          }
        : null,
      observability: observabilitySummary,
      final: final ?? null,
      samples,
    },
  };
};

const status = requireOk("PTR world status", await requestJson("/api/user/world-status"));
if (status.status !== "normal") {
  throw new Error(`PTR bootstrap experiment requires an active colony; world status is '${status.status}'`);
}

const startRoom = requireOk("PTR start room", await requestJson("/api/user/world-start-room"));
const roomRefs = Array.isArray(startRoom.room) ? startRoom.room.map(parseRoomRef).filter(Boolean) : [];
const ref = roomRefs.find((candidate) => !requestedShard || candidate.shard === requestedShard) ?? roomRefs[0];
if (!ref) throw new Error("PTR returned no active room for bootstrap experiment");

const collectionKey = `ptr-experiment:${requestId}:telemetry:v1`;
const samples = [];
const transitions = {};
let collectionStarted = false;

try {
  const started = await publishTelemetry({
    operation: "start_run",
    collectionKey,
    requestId,
    experimentName,
    target: "ptr",
    shard: ref.shard,
    room: ref.room,
    runtimeSha,
    expectedSamples: sampleCount,
    intervalMs,
    metadata: { command: requestCommand, observabilitySegment: OBSERVABILITY_SEGMENT },
  });
  collectionStarted = true;
  console.log(`Supabase collection run ${started.collectionRunId} started for ${ref.room}/${ref.shard}.`);

  for (let index = 0; index < sampleCount; index += 1) {
    const [
      objects,
      overview,
      terrain,
      gameTimeResponse,
      worldStatus,
      observabilityResponse,
    ] = await Promise.all([
      requestJson("/api/game/room-objects", { room: ref.room, shard: ref.shard }),
      requestJson("/api/game/room-overview", { room: ref.room, shard: ref.shard, interval: 8 }),
      requestJson("/api/game/room-terrain", {
        room: ref.room,
        shard: ref.shard,
        encoded: 1,
      }),
      requestJson("/api/game/time", { shard: ref.shard }),
      requestJson("/api/user/world-status"),
      requestJson("/api/user/memory-segment", {
        segment: OBSERVABILITY_SEGMENT,
        shard: ref.shard,
      }),
    ]);

    requireOk("PTR room objects", objects);
    requireOk("PTR room overview", overview);
    requireOk("PTR room terrain", terrain);
    requireOk("PTR game time", gameTimeResponse);
    requireOk("PTR world status sample", worldStatus);

    const collectedAt = new Date().toISOString();
    const rawSnapshot = {
      request: {
        id: requestId,
        mode: "experiment",
        command: requestCommand,
        target: "ptr",
        room: ref.room,
        shard: ref.shard,
      },
      collectedAt,
      target: "ptr",
      gameTime: gameTimeResponse.body?.time ?? gameTimeResponse.body,
      worldStatus,
      roomSnapshots: {
        [ref.room]: {
          shard: ref.shard,
          overview,
          terrain,
          objects,
        },
      },
    };

    const state = projectBootstrapState(rawSnapshot, ref.room);
    const firstState = samples[0]?.state ?? state;
    const evaluation = evaluateBootstrapWindow(firstState, state);
    const observability = observabilityResponse.ok
      ? decodeScreepsSegment(observabilityResponse.body)
      : null;
    const observabilityDiagnostic = observability
      ? null
      : summarizeSegmentResponse(observabilityResponse);
    const sample = { index, collectedAt, state, evaluation, observability, observabilityDiagnostic };

    await publishTelemetry({
      operation: "ingest_sample",
      collectionKey,
      sequence: index,
      sample: {
        schema: "screeps-telemetry-sample/v1",
        schemaVersion: 1,
        collectedAt,
        target: "ptr",
        shard: ref.shard,
        room: ref.room,
        experimentName,
        state,
        evaluation,
        runtimeTrace: observability,
        observabilityDiagnostic,
      },
    });
    samples.push(sample);

    for (const [milestone, reached] of Object.entries(evaluation.milestones)) {
      if (reached && transitions[milestone] === undefined) {
        transitions[milestone] = { sample: index, collectedAt };
      }
    }

    const traceSuffix = observability
      ? ` cpu=${observability.cpu?.total ?? "?"} proposed=${observability.intents?.proposed ?? "?"} accepted=${observability.intents?.accepted ?? "?"} distanceLookups=${observability.spatial?.distanceLookups ?? "?"}`
      : ` trace=unavailable status=${observabilityDiagnostic.status} data=${observabilityDiagnostic.hasData}`;
    console.log(
      `sample ${index + 1}/${sampleCount}: persisted; RCL${evaluation.summary.rcl} workforce=${evaluation.summary.workforce} spawnEnergy=${evaluation.summary.spawnEnergy} sites=${evaluation.summary.constructionSites} energyActive=${evaluation.energyActivity.active}${traceSuffix}`,
    );

    if (evaluation.status === "passed") break;
    if (index < sampleCount - 1) await sleep(intervalMs);
  }

  const finalized = await publishTelemetry({ operation: "complete_run", collectionKey });
  const localResult = buildLocalResult(samples, transitions, ref);
  const result = {
    ...localResult,
    publication: {
      destination: "supabase-telemetry",
      collectionKey,
      collectionRunId: finalized.collectionRunId,
      experimentId: finalized.experimentId,
      authoritativeResult: finalized.result,
    },
  };

  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/screeps-insights.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await setOutput("telemetry_persisted", "true");
  await setOutput("collection_run_id", finalized.collectionRunId ?? "");
  await setOutput("experiment_id", finalized.experimentId ?? "");

  console.log(
    `PTR experiment ${experimentName} finalized from ${samples.length} persisted Supabase samples; status=${finalized.result?.outcomeStatus ?? localResult.experiment.status}.`,
  );
} catch (error) {
  const partial = buildLocalResult(samples, transitions, ref);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/screeps-insights.json",
    `${JSON.stringify({ ...partial, publication: { destination: "artifact-fallback", collectionKey, error: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`,
    "utf8",
  );
  await setOutput("telemetry_persisted", "false");
  if (collectionStarted) {
    try {
      await publishTelemetry({
        operation: "fail_run",
        collectionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (failurePublishError) {
      console.error("Failed to mark Supabase collection run failed:", failurePublishError);
    }
  }
  throw error;
}
