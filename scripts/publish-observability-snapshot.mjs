import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const room = process.env.SCREEPS_ROOM || "";
const shard = process.env.SCREEPS_REQUESTED_SHARD || process.env.SCREEPS_SHARD || "shard3";
const target = process.env.SCREEPS_TARGET || "ptr";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const commandKey = process.env.SCREEPS_COMMAND_KEY || "";
const requestCommand = process.env.SCREEPS_COMMAND || "/snapshot";
const apiPrefix = target === "ptr" ? "/ptr" : "";
const supabaseIngestUrl = process.env.SUPABASE_INGEST_URL || "";
const githubOidcToken = process.env.GITHUB_OIDC_TOKEN || "";
const observabilitySegment = 99;

if (!token) throw new Error("SCREEPS_TOKEN is required to publish an observability snapshot");
if (!/^[WE]\d+[NS]\d+$/.test(room)) throw new Error("SCREEPS_ROOM is required for /snapshot");
if (!/^shard\d+$/.test(shard)) throw new Error(`Invalid shard '${shard}'`);
if (target !== "ptr") throw new Error("Observability snapshots are currently restricted to PTR");

const requestJson = async (path, params = {}) => {
  const url = new URL(`${apiPrefix}${path}`, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
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
    throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
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

const point = (value) =>
  value && Number.isInteger(value.x) && Number.isInteger(value.y)
    ? { x: value.x, y: value.y }
    : null;

const finiteNumber = (value) => (Number.isFinite(value) ? value : null);
const boundedString = (value, max = 240) =>
  typeof value === "string" && value.length <= max ? value : null;

const sanitizePlan = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  const controller = plan.anchors?.controller;
  return {
    planId: boundedString(plan.planId),
    deliverableId: boundedString(plan.deliverableId),
    version: plan.version ?? null,
    horizonRcl: plan.horizonRcl ?? null,
    roomName: plan.roomName ?? room,
    generatedAt: plan.generatedAt ?? null,
    anchors: {
      spawn: plan.anchors?.spawn
        ? { ...point(plan.anchors.spawn), name: plan.anchors.spawn.name ?? null }
        : null,
      hub: point(plan.anchors?.hub),
      controller: controller
        ? { ...point(controller), service: point(controller.service) }
        : null,
      sources: Array.isArray(plan.anchors?.sources)
        ? plan.anchors.sources.map((source) => ({
            ...point(source),
            container: point(source.container),
          }))
        : [],
    },
    reservations: Array.isArray(plan.reservations)
      ? plan.reservations.map((reservation) => ({
          ...point(reservation),
          kind: reservation.kind ?? null,
        }))
      : [],
    structures: Array.isArray(plan.structures)
      ? plan.structures.map((structure) => ({
          ...point(structure),
          structureType: structure.structureType ?? null,
          minRcl: structure.minRcl ?? null,
          activation: structure.activation ?? null,
          reservation: structure.reservation ?? null,
          phase: structure.phase ?? null,
        }))
      : [],
    roads: Array.isArray(plan.roads)
      ? plan.roads.map((road) => ({
          ...point(road),
          minRcl: road.minRcl ?? null,
          activation: road.activation ?? null,
        }))
      : [],
    defense: {
      protectedTiles: Array.isArray(plan.defense?.protectedTiles)
        ? plan.defense.protectedTiles.map(point).filter(Boolean)
        : [],
      perimeter: Array.isArray(plan.defense?.perimeter)
        ? plan.defense.perimeter.map(point).filter(Boolean)
        : [],
    },
  };
};

const sanitizeLineage = (value) => {
  if (!value || typeof value !== "object") return null;
  const lineage = {
    contractId: boundedString(value.contractId),
    requirementId: boundedString(value.requirementId),
    deliverableId: boundedString(value.deliverableId),
    taskId: boundedString(value.taskId),
    activityId: boundedString(value.activityId),
  };
  return Object.values(lineage).every(Boolean) ? lineage : null;
};

const sanitizeIntentTrace = (value) => {
  if (!value || typeof value !== "object") return null;
  const lineage = sanitizeLineage(value.trace);
  return {
    type: boundedString(value.type, 64),
    planner: boundedString(value.planner, 64),
    priority: finiteNumber(value.priority),
    reason: boundedString(value.reason, 500),
    actor: boundedString(value.actor, 240),
    conflictKey: boundedString(value.conflictKey, 240),
    ...(lineage ? { trace: lineage } : {}),
  };
};

const sanitizeFspmRecord = (value) => {
  if (!value || typeof value !== "object") return null;
  const id = boundedString(value.id);
  const status = ["active", "completed", "cancelled"].includes(value.status)
    ? value.status
    : null;
  return id && status ? { id, status } : null;
};

const sanitizeFspm = (value) => {
  const colonies = Array.isArray(value?.colonies) ? value.colonies.slice(0, 16) : [];
  return {
    colonies: colonies
      .map((colony) => {
        const contract = sanitizeFspmRecord(colony?.contract);
        const roomName = boundedString(colony?.roomName, 32);
        if (!contract || !roomName) return null;
        const clean = (records) =>
          Array.isArray(records)
            ? records.slice(0, 128).map(sanitizeFspmRecord).filter(Boolean)
            : [];
        return {
          roomName,
          contract,
          requirements: clean(colony.requirements),
          deliverables: clean(colony.deliverables),
          tasks: clean(colony.tasks),
        };
      })
      .filter(Boolean),
  };
};

const sanitizeRuntimeTrace = (value) => {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const intents = value.intents && typeof value.intents === "object" ? value.intents : {};
  return {
    version: 1,
    tick: Number.isInteger(value.tick) ? value.tick : null,
    cpu:
      value.cpu && typeof value.cpu === "object"
        ? {
            limit: finiteNumber(value.cpu.limit),
            bucket: finiteNumber(value.cpu.bucket),
            perception: finiteNumber(value.cpu.perception),
            settlement: finiteNumber(value.cpu.settlement),
            arbitration: finiteNumber(value.cpu.arbitration),
            execution: finiteNumber(value.cpu.execution),
            observability: finiteNumber(value.cpu.observability),
            total: finiteNumber(value.cpu.total),
          }
        : null,
    fspm: sanitizeFspm(value.fspm),
    intents: {
      proposed: finiteNumber(intents.proposed),
      accepted: finiteNumber(intents.accepted),
      rejected: finiteNumber(intents.rejected),
      acceptedSample: Array.isArray(intents.acceptedSample)
        ? intents.acceptedSample.slice(0, 24).map(sanitizeIntentTrace).filter(Boolean)
        : [],
      rejectedSample: Array.isArray(intents.rejectedSample)
        ? intents.rejectedSample.slice(0, 24).map((rejection) => ({
            conflictKey: boundedString(rejection?.conflictKey, 240),
            winner: sanitizeIntentTrace(rejection?.winner),
            loser: sanitizeIntentTrace(rejection?.loser),
          }))
        : [],
    },
  };
};

const memory = await requestJson("/api/user/memory", {
  path: `colonies.${room}.roomPlan`,
  shard,
});
const traceMemory = await requestJson("/api/user/memory-segment", {
  segment: observabilitySegment,
  shard,
});
const roomObjects = await requestJson("/api/game/room-objects", { room, shard });
const plan = sanitizePlan(decodeMemory(memory.data));
const runtimeTrace = sanitizeRuntimeTrace(decodeMemory(traceMemory.data));
if (!plan) throw new Error(`No durable room plan exists at Memory.colonies.${room}.roomPlan`);

const objects = Array.isArray(roomObjects.objects) ? roomObjects.objects : [];
const controller = objects.find((object) => object.type === "controller") ?? null;
const sources = objects.filter((object) => object.type === "source");
const structures = objects.filter((object) =>
  ["spawn", "extension", "tower", "road", "container", "rampart", "storage"].includes(object.type),
);
const constructionSites = objects.filter(
  (object) => object.type === "constructionSite" || object.type === "construction-site",
);
const energyStructures = structures.filter((object) => ["spawn", "extension"].includes(object.type));

const snapshot = {
  schema: "screeps-observability-snapshot/v1",
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  target,
  shard,
  room,
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
      available: energyStructures.reduce((sum, object) => sum + (Number(object.energy) || 0), 0),
      capacity: energyStructures.reduce(
        (sum, object) => sum + (Number(object.energyCapacity) || 0),
        0,
      ),
    },
    creeps: objects.filter((object) => object.type === "creep").length,
    sources: sources.map((source) => ({ x: source.x, y: source.y })),
    structures: structures.map((structure) => ({
      type: structure.type,
      x: structure.x,
      y: structure.y,
    })),
    constructionSites: constructionSites.map((site) => ({
      structureType: site.structureType ?? null,
      x: site.x,
      y: site.y,
      progress: site.progress ?? null,
      progressTotal: site.progressTotal ?? null,
    })),
  },
  roomPlan: plan,
  runtimeTrace,
};

let publication = {
  destination: "artifact-only",
  configured: false,
};

if (supabaseIngestUrl && githubOidcToken) {
  const response = await fetch(supabaseIngestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubOidcToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId, commandKey: commandKey || undefined, snapshot }),
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
await writeFile("artifacts/screeps-insights.json", `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile("artifacts/screeps-public-snapshot.json", `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(
  `Published sanitized observability snapshot v1 for ${room}/${shard} (${publication.destination}).`,
);
