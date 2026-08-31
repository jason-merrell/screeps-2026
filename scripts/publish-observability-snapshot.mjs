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

const sanitizeQuality = (value) => {
  if (!value || typeof value !== "object") return null;
  const score = finiteNumber(value.score);
  const state = ["healthy", "watch", "degraded"].includes(value.state) ? value.state : null;
  const trend = ["new", "improving", "stable", "declining"].includes(value.trend)
    ? value.trend
    : null;
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.slice(0, 8).map((item) => boundedString(item, 160)).filter(Boolean)
    : [];
  return score !== null && score >= 0 && score <= 100 && state && trend
    ? { score, state, trend, evidence }
    : null;
};

const sanitizeQualitySample = (value) => {
  if (!value || typeof value !== "object") return null;
  const tick = Number.isInteger(value.tick) && value.tick >= 0 ? value.tick : null;
  const score = finiteNumber(value.score);
  const state = ["healthy", "watch", "degraded"].includes(value.state) ? value.state : null;
  return tick !== null && score !== null && score >= 0 && score <= 100 && state
    ? { tick, score, state }
    : null;
};

const sanitizeFspmRecord = (value) => {
  if (!value || typeof value !== "object") return null;
  const id = boundedString(value.id);
  const title = boundedString(value.title, 160) ?? id;
  const status = ["active", "completed", "cancelled"].includes(value.status)
    ? value.status
    : null;
  if (!id || !status) return null;
  const quality = sanitizeQuality(value.quality);
  return { id, title, status, ...(quality ? { quality } : {}) };
};

const sanitizeProgram = (value) => {
  if (!value || typeof value !== "object") return null;
  const id = boundedString(value.id);
  const title = boundedString(value.title, 160);
  const status = ["active", "completed", "cancelled"].includes(value.status) ? value.status : null;
  if (!id || !title || value.type !== "program" || value.subType !== "service_program" || !status) return null;
  return { id, title, type: "program", subType: "service_program", status };
};

const sanitizeKpiMetric = (value) => {
  if (!value || typeof value !== "object") return null;
  const metric = boundedString(value.metric, 240);
  const exceptional = boundedString(value.exceptional, 320);
  const satisfactory = boundedString(value.satisfactory, 320);
  const unsatisfactory = boundedString(value.unsatisfactory, 320);
  return metric && exceptional && satisfactory && unsatisfactory
    ? { metric, exceptional, satisfactory, unsatisfactory }
    : null;
};

const sanitizeTaskQi = (value) => {
  if (!value || typeof value !== "object") return null;
  const score = finiteNumber(value.score);
  const measuredAt = Number.isInteger(value.measuredAt) ? value.measuredAt : null;
  const ratedActivities = Number.isInteger(value.ratedActivities) ? value.ratedActivities : null;
  const totalActivities = Number.isInteger(value.totalActivities) ? value.totalActivities : null;
  const exceptional = Number.isInteger(value.exceptional) ? value.exceptional : null;
  const satisfactory = Number.isInteger(value.satisfactory) ? value.satisfactory : null;
  const unsatisfactory = Number.isInteger(value.unsatisfactory) ? value.unsatisfactory : null;
  return score !== null && score >= 0 && score <= 1.5 && measuredAt !== null && ratedActivities !== null && totalActivities !== null && exceptional !== null && satisfactory !== null && unsatisfactory !== null
    ? { score, measuredAt, ratedActivities, totalActivities, exceptional, satisfactory, unsatisfactory }
    : null;
};

const sanitizeActivityKpi = (value) => {
  if (!value || typeof value !== "object") return null;
  const tick = Number.isInteger(value.tick) ? value.tick : null;
  const activityId = boundedString(value.activityId);
  const activityType = boundedString(value.activityType, 64);
  const actor = boundedString(value.actor, 160);
  const rating = ["exceptional", "satisfactory", "unsatisfactory", "in_progress"].includes(value.rating)
    ? value.rating
    : null;
  const evidence = boundedString(value.evidence, 240);
  const numeric = value.value === null ? null : finiteNumber(value.value);
  const outcome = value.outcome && typeof value.outcome === "object" ? {
    metric: boundedString(value.outcome.metric, 96),
    actual: finiteNumber(value.outcome.actual),
    target: finiteNumber(value.outcome.target),
    unit: boundedString(value.outcome.unit, 32),
    utilization: finiteNumber(value.outcome.utilization),
  } : null;
  if (tick === null || !activityId || !activityType || !actor || !rating || !evidence) return null;
  if (numeric !== null && (numeric < 0 || numeric > 1.5)) return null;
  const sanitizedOutcome = outcome?.metric && outcome.actual !== null && outcome.actual >= 0 && outcome.target !== null && outcome.target > 0 && outcome.unit && outcome.utilization !== null && outcome.utilization >= 0 && outcome.utilization <= 1 ? outcome : null;
  return { tick, activityId, activityType, actor, rating, value: numeric, evidence, ...(sanitizedOutcome ? { outcome: sanitizedOutcome } : {}) };
};

const sanitizeFspm = (value) => {
  const colonies = Array.isArray(value?.colonies) ? value.colonies.slice(0, 16) : [];
  return {
    colonies: colonies
      .map((colony) => {
        const contract = sanitizeFspmRecord(colony?.contract);
        const roomName = boundedString(colony?.roomName, 32);
        if (!contract || !roomName) return null;
        const contractHistory = Array.isArray(colony.contractHistory)
          ? colony.contractHistory.slice(-12).map(sanitizeQualitySample).filter(Boolean)
          : [];
        const requirements = Array.isArray(colony.requirements)
          ? colony.requirements.slice(0, 128).map((record) => {
              const base = sanitizeFspmRecord(record);
              const contractId = boundedString(record?.contractId);
              const domain = boundedString(record?.domain, 32);
              return base && contractId && domain ? { ...base, contractId, domain } : null;
            }).filter(Boolean)
          : [];
        const deliverables = Array.isArray(colony.deliverables)
          ? colony.deliverables.slice(0, 128).map((record) => {
              const base = sanitizeFspmRecord(record);
              const requirementId = boundedString(record?.requirementId);
              const domain = boundedString(record?.domain, 32);
              return base && requirementId && domain ? { ...base, requirementId, domain } : null;
            }).filter(Boolean)
          : [];
        const tasks = Array.isArray(colony.tasks)
          ? colony.tasks.slice(0, 256).map((record) => {
              const base = sanitizeFspmRecord(record);
              const deliverableId = boundedString(record?.deliverableId);
              const domain = boundedString(record?.domain, 32);
              const taskKey = boundedString(record?.taskKey, 120);
              const kpiMetric = sanitizeKpiMetric(record?.kpiMetric);
              if (!base || !deliverableId || !domain || !taskKey || !kpiMetric) return null;
              const qi = sanitizeTaskQi(record?.qi);
              const recentActivities = Array.isArray(record?.recentActivities)
                ? record.recentActivities.slice(-8).map(sanitizeActivityKpi).filter(Boolean)
                : [];
              return {
                ...base,
                deliverableId,
                domain,
                taskKey,
                kpiMetric,
                ...(qi ? { qi } : {}),
                recentActivities,
              };
            }).filter(Boolean)
          : [];
        return {
          roomName,
          program: sanitizeProgram(colony.program),
          contract,
          contractHistory,
          requirements,
          deliverables,
          tasks,
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
    runtimeSha: boundedString(value.runtimeSha, 80),
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
