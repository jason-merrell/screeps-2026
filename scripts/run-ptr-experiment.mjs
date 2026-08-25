import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { evaluateBootstrapState, projectBootstrapState } from "./lib/bootstrap-state.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const defaultShard = process.env.SCREEPS_SHARD || "shard3";
const requestedShard = process.env.SCREEPS_REQUESTED_SHARD || "";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/experiment bootstrap-rcl3 target=ptr";
const experimentName = process.env.SCREEPS_EXPERIMENT || "bootstrap-rcl3";
const sampleCount = Math.max(1, Math.min(24, Number(process.env.SCREEPS_EXPERIMENT_SAMPLES || 12)));
const intervalMs = Math.max(1000, Math.min(30_000, Number(process.env.SCREEPS_EXPERIMENT_INTERVAL_MS || 5000)));
const PTR_PREFIX = "/ptr";

if (!token) throw new Error("SCREEPS_TOKEN is required for PTR experiments");
if (experimentName !== "bootstrap-rcl3") {
  throw new Error(`Unsupported PTR experiment '${experimentName}'`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const decodeMemoryData = (body) => {
  const data = body?.data;
  if (typeof data !== "string" || data.length === 0) return null;

  try {
    const json = data.startsWith("gz:")
      ? gunzipSync(Buffer.from(data.slice(3), "base64")).toString("utf8")
      : data;
    return JSON.parse(json);
  } catch {
    return null;
  }
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

const status = requireOk("PTR world status", await requestJson("/api/user/world-status"));
if (status.status !== "normal") {
  throw new Error(`PTR bootstrap experiment requires an active colony; world status is '${status.status}'`);
}

const startRoom = requireOk("PTR start room", await requestJson("/api/user/world-start-room"));
const roomRefs = Array.isArray(startRoom.room) ? startRoom.room.map(parseRoomRef).filter(Boolean) : [];
const ref = roomRefs.find((candidate) => !requestedShard || candidate.shard === requestedShard) ?? roomRefs[0];
if (!ref) throw new Error("PTR returned no active room for bootstrap experiment");

const samples = [];
const transitions = {};

for (let index = 0; index < sampleCount; index += 1) {
  const [objects, overview, worldStatus, observabilityResponse] = await Promise.all([
    requestJson("/api/game/room-objects", { room: ref.room, shard: ref.shard }),
    requestJson("/api/game/room-overview", { room: ref.room, shard: ref.shard, interval: 8 }),
    requestJson("/api/user/world-status"),
    requestJson("/api/user/memory", { path: "stats.observability" }),
  ]);

  requireOk("PTR room objects", objects);
  requireOk("PTR room overview", overview);
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
    worldStatus,
    roomSnapshots: {
      [ref.room]: {
        shard: ref.shard,
        overview,
        objects,
      },
    },
  };

  const state = projectBootstrapState(rawSnapshot, ref.room);
  const evaluation = evaluateBootstrapState(state);
  const observability = observabilityResponse.ok
    ? decodeMemoryData(observabilityResponse.body)
    : null;
  samples.push({ index, collectedAt, state, evaluation, observability });

  for (const [milestone, reached] of Object.entries(evaluation.milestones)) {
    if (reached && transitions[milestone] === undefined) {
      transitions[milestone] = { sample: index, collectedAt };
    }
  }

  const traceSuffix = observability
    ? ` cpu=${observability.cpu?.total ?? "?"} proposed=${observability.intents?.proposed ?? "?"} accepted=${observability.intents?.accepted ?? "?"}`
    : " trace=unavailable";
  console.log(
    `sample ${index + 1}/${sampleCount}: RCL${evaluation.summary.rcl} workforce=${evaluation.summary.workforce} spawnEnergy=${evaluation.summary.spawnEnergy} sites=${evaluation.summary.constructionSites}${traceSuffix}`,
  );

  if (evaluation.status === "passed") break;
  if (index < sampleCount - 1) await sleep(intervalMs);
}

const first = samples[0];
const final = samples.at(-1);
const traces = samples.map((sample) => sample.observability).filter((trace) => trace?.version === 1);
const plannerNames = ["defense", "spawning", "construction", "economy"];
const latestTrace = traces.at(-1) ?? null;
const observabilitySummary = {
  samplesWithTrace: traces.length,
  latestTick: latestTrace?.tick ?? null,
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
  intents: {
    averageProposed: average(traces.map((trace) => trace.intents.proposed)),
    averageAccepted: average(traces.map((trace) => trace.intents.accepted)),
    averageRejected: average(traces.map((trace) => trace.intents.rejected)),
    latestAcceptedSample: latestTrace?.intents.acceptedSample ?? [],
    latestRejectedSample: latestTrace?.intents.rejectedSample ?? [],
  },
};

const result = {
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

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/screeps-insights.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(
  `PTR experiment ${experimentName} finished with status=${result.experiment.status} after ${samples.length} samples; traces=${traces.length}.`,
);
