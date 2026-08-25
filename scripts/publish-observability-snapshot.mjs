import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const room = process.env.SCREEPS_ROOM || "";
const shard = process.env.SCREEPS_REQUESTED_SHARD || process.env.SCREEPS_SHARD || "shard3";
const target = process.env.SCREEPS_TARGET || "ptr";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/snapshot";
const apiPrefix = target === "ptr" ? "/ptr" : "";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseSecret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

const sanitizePlan = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  const controller = plan.anchors?.controller;
  return {
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

const supabaseRequest = async (path, { method = "GET", body, prefer } = {}) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: supabaseSecret,
      Authorization: `Bearer ${supabaseSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Supabase ${method} ${path} failed with HTTP ${response.status}: ${text}`);
  }
  return parsed;
};

const memory = await requestJson("/api/user/memory", {
  path: `colonies.${room}.roomPlan`,
  shard,
});
const roomObjects = await requestJson("/api/game/room-objects", { room, shard });
const plan = sanitizePlan(decodeMemory(memory.data));
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
};

let publication = {
  destination: "artifact-only",
  configured: false,
};

if (supabaseUrl && supabaseSecret) {
  const colonies = await supabaseRequest("colonies?on_conflict=target,shard,room_name", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{ target, shard, room_name: room }],
  });
  const colonyId = colonies?.[0]?.id;
  if (!colonyId) throw new Error("Supabase colony upsert returned no colony id");

  const rows = await supabaseRequest("observability_snapshots?on_conflict=source_request_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        schema: snapshot.schema,
        schema_version: snapshot.schemaVersion,
        colony_id: colonyId,
        captured_at: snapshot.capturedAt,
        source_request_id: requestId,
        payload: snapshot,
      },
    ],
  });
  publication = {
    destination: "supabase",
    configured: true,
    colonyId,
    snapshotId: rows?.[0]?.id ?? null,
  };
}

const artifact = {
  request: {
    id: requestId,
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
