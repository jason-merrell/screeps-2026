import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { enforceEqvmSnapshotBoundary } from "./lib/eqvm-snapshot.mjs";
import { roomPlanIntegrityEvidence } from "./lib/room-plan-integrity.mjs";
import { captureConsistencyEvidence } from "./lib/snapshot-capture-consistency.mjs";
import {
  isOwnedSnapshotObject,
  snapshotOwnership,
} from "./lib/snapshot-ownership.mjs";
import { traceFencedCapture } from "./lib/trace-fenced-capture.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const room = process.env.SCREEPS_ROOM || "";
const shard =
  process.env.SCREEPS_REQUESTED_SHARD || process.env.SCREEPS_SHARD || "shard3";
const target = process.env.SCREEPS_TARGET || "ptr";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const commandKey = process.env.SCREEPS_COMMAND_KEY || "";
const requestCommand = process.env.SCREEPS_COMMAND || "/snapshot";
const supabaseIngestUrl = process.env.SUPABASE_INGEST_URL || "";
const githubOidcToken = process.env.GITHUB_OIDC_TOKEN || "";
const githubOutput = process.env.GITHUB_OUTPUT || "";
const apiPrefix = target === "ptr" ? "/ptr" : "";
const observabilitySegment = 99;

if (!token)
  throw new Error(
    "SCREEPS_TOKEN is required to publish an observability snapshot",
  );
if (!/^[WE]\d+[NS]\d+$/.test(room))
  throw new Error("SCREEPS_ROOM is required for /snapshot");
if (!/^shard\d+$/.test(shard)) throw new Error(`Invalid shard '${shard}'`);
if (target !== "ptr")
  throw new Error("Observability snapshots are currently restricted to PTR");

const setOutput = async (name, value) => {
  if (githubOutput)
    await appendFile(githubOutput, `${name}=${value ?? ""}\n`, "utf8");
};

const requestJson = async (path, params = {}) => {
  const url = new URL(`${apiPrefix}${path}`, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "")
      url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Token": token },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok || body?.ok === 0) {
    throw new Error(
      `${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
};

const decodeMemory = (data) => {
  if (data === undefined || data === null) return null;
  if (typeof data !== "string") return data;
  const json = data.startsWith("gz:")
    ? gunzipSync(Buffer.from(data.slice(3), "base64")).toString("utf8")
    : data;
  return JSON.parse(json);
};

const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 512;
const MAX_OBJECT_KEYS = 256;
const MAX_STRING_LENGTH = 1200;
const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);

const sanitizeJson = (value, depth = 0) => {
  if (depth > MAX_DEPTH || value === undefined) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeJson(item, depth + 1));
  }
  if (typeof value !== "object") return null;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blockedKeys.has(key))
      .slice(0, MAX_OBJECT_KEYS)
      .map(([key, child]) => [key, sanitizeJson(child, depth + 1)]),
  );
};

const {
  initialTrace: traceMemory,
  payload: { memory, roomObjects, roomTerrain },
  finalTrace: traceFenceMemory,
} = await traceFencedCapture(
  () =>
    requestJson("/api/user/memory-segment", {
      segment: observabilitySegment,
      shard,
    }),
  async () => {
    const [memory, roomObjects, roomTerrain] = await Promise.all([
      requestJson("/api/user/memory", {
        path: `colonies.${room}.roomPlan`,
        shard,
      }),
      requestJson("/api/game/room-objects", { room, shard }),
      requestJson("/api/game/room-terrain", { room, shard, encoded: 1 }),
    ]);
    return { memory, roomObjects, roomTerrain };
  },
);

const rawPlan = decodeMemory(memory.data);
const rawInitialTrace = decodeMemory(traceMemory.data);
const rawRuntimeTrace = decodeMemory(traceFenceMemory.data);
if (!rawPlan || typeof rawPlan !== "object") {
  throw new Error(
    `No durable room plan exists at Memory.colonies.${room}.roomPlan`,
  );
}
if (
  rawRuntimeTrace !== null &&
  (typeof rawRuntimeTrace !== "object" || rawRuntimeTrace.version !== 1)
) {
  throw new Error(
    "Observability segment contains an unsupported runtime trace schema",
  );
}

const roomPlan = sanitizeJson({
  ...rawPlan,
  plannerRevision: Number.isInteger(rawPlan.plannerRevision)
    ? rawPlan.plannerRevision
    : null,
  projectionRevision: Number.isInteger(rawPlan.projectionRevision)
    ? rawPlan.projectionRevision
    : null,
  projectionFingerprint:
    typeof rawPlan.projectionFingerprint === "string"
      ? rawPlan.projectionFingerprint.slice(0, 40)
      : null,
});
// The generic bounded trace sanitizer preserves settlement projection epochs
// and per-room fault/backoff evidence, including rooms with no current plan.
const runtimeTrace = rawRuntimeTrace
  ? enforceEqvmSnapshotBoundary(sanitizeJson(rawRuntimeTrace))
  : null;
const captureConsistency = captureConsistencyEvidence(
  rawInitialTrace,
  rawRuntimeTrace,
  room,
);
const objects = Array.isArray(roomObjects.objects) ? roomObjects.objects : [];
const encodedTerrain = roomTerrain?.terrain?.[0]?.terrain;
const terrain =
  typeof encodedTerrain === "string" &&
  encodedTerrain.length === 2_500 &&
  /^[0-3]+$/.test(encodedTerrain)
    ? {
        encoding: "screeps-terrain-mask/v1",
        width: 50,
        height: 50,
        cells: encodedTerrain,
      }
    : null;
const controller =
  objects.find((object) => object.type === "controller") ?? null;
const sources = objects.filter((object) => object.type === "source");
const minerals = objects.filter((object) => object.type === "mineral");
const structureTypes = new Set([
  "spawn",
  "extension",
  "road",
  "constructedWall",
  "rampart",
  "link",
  "storage",
  "tower",
  "observer",
  "powerSpawn",
  "extractor",
  "lab",
  "terminal",
  "container",
  "nuker",
  "factory",
]);
const structures = objects.filter((object) => structureTypes.has(object.type));
const constructionSites = objects.filter(
  (object) =>
    object.type === "constructionSite" || object.type === "construction-site",
);
const controllerUser =
  typeof controller?.user === "string" ? controller.user : null;
const isColonyOwned = (object) => isOwnedSnapshotObject(object, controllerUser);
const energyStructures = structures.filter(
  (object) =>
    ["spawn", "extension"].includes(object.type) && isColonyOwned(object),
);

const snapshot = {
  schema: "screeps-observability-snapshot/v1",
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  gameTick: Number.isInteger(runtimeTrace?.tick) ? runtimeTrace.tick : null,
  target,
  shard,
  room,
  terrain,
  captureConsistency,
  colony: {
    controller: controller
      ? {
          x: controller.x,
          y: controller.y,
          level: controller.level ?? null,
          progress: controller.progress ?? null,
          progressTotal: controller.progressTotal ?? null,
        }
      : null,
    energy: {
      available: energyStructures.reduce(
        (sum, object) => sum + (Number(object.energy) || 0),
        0,
      ),
      capacity: energyStructures.reduce(
        (sum, object) => sum + (Number(object.energyCapacity) || 0),
        0,
      ),
    },
    creeps: objects.filter(
      (object) => object.type === "creep" && isColonyOwned(object),
    ).length,
    sources: sources.map((source) => ({ x: source.x, y: source.y })),
    minerals: minerals.map((mineral) => ({ x: mineral.x, y: mineral.y })),
    structures: structures.map((structure) => ({
      type: structure.type,
      x: structure.x,
      y: structure.y,
      hits: Number.isFinite(structure.hits) ? structure.hits : null,
      hitsMax: Number.isFinite(structure.hitsMax) ? structure.hitsMax : null,
      owned: snapshotOwnership(structure, controllerUser),
    })),
    constructionSites: constructionSites.map((site) => ({
      structureType: site.structureType ?? null,
      x: site.x,
      y: site.y,
      progress: site.progress ?? null,
      progressTotal: site.progressTotal ?? null,
      owned: snapshotOwnership(site, controllerUser),
    })),
  },
  roomPlan,
  roomPlanIntegrity: roomPlanIntegrityEvidence(rawPlan, roomPlan),
  runtimeTrace,
};

let publication = { destination: "artifact-only", configured: false };
let publicationError = null;

if (supabaseIngestUrl && githubOidcToken) {
  try {
    const response = await fetch(supabaseIngestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubOidcToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId,
        commandKey: commandKey || undefined,
        snapshot,
      }),
    });
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = { raw: text };
    }
    if (!response.ok || result?.ok !== true) {
      throw new Error(
        `Supabase ingest failed with HTTP ${response.status}: ${JSON.stringify(result)}`,
      );
    }
    publication = {
      destination: "supabase-edge-oidc",
      configured: true,
      colonyId: result.colonyId ?? null,
      snapshotId: result.snapshotId ?? null,
    };
  } catch (error) {
    publicationError = error;
    publication = {
      destination: "artifact-fallback",
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const artifact = {
  request: {
    id: requestId,
    commandKey: commandKey || null,
    mode: "snapshot",
    command: requestCommand,
    room,
    shard,
    target,
  },
  publication,
  snapshot,
};

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/screeps-insights.json",
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
await writeFile(
  "artifacts/screeps-public-snapshot.json",
  `${JSON.stringify(snapshot)}\n`,
  "utf8",
);
await setOutput(
  "supabase_persisted",
  publication.destination === "supabase-edge-oidc" ? "true" : "false",
);
await setOutput("snapshot_id", publication.snapshotId ?? "");
await setOutput("colony_id", publication.colonyId ?? "");

console.log(
  `Published sanitized observability snapshot for ${room}/${shard} (${publication.destination}, tick=${snapshot.gameTick ?? "unknown"}).`,
);

if (publicationError) throw publicationError;
