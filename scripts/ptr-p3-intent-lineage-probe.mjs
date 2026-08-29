import { mkdir, writeFile } from "node:fs/promises";
import { decodeScreepsSegment } from "./lib/screeps-memory.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const room = "E52N38";
const shard = "shard3";
const x = 38;
const y = 18;
const expectedP3Id = `portfolio:colony:${room}`;

if (!token) throw new Error("SCREEPS_TOKEN is required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(path, { method = "GET", params = {}, body } = {}) {
  const url = new URL(`/ptr${path}`, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "X-Token": token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

const before = await requestJson("/api/game/room-objects", { params: { room, shard } });
if (!before.ok) throw new Error(`room objects failed (${before.status})`);
const objects = Array.isArray(before.body?.objects) ? before.body.objects : [];
const occupants = objects.filter((object) => object.x === x && object.y === y);
const blocking = occupants.filter((object) => !["creep", "powerCreep", "resource", "tombstone", "ruin"].includes(object.type));
if (blocking.length) {
  throw new Error(`probe tile ${room}@${x},${y} is no longer empty: ${JSON.stringify(blocking.map((entry) => entry.type))}`);
}

const created = await requestJson("/api/game/create-construction", {
  method: "POST",
  body: { room, shard, x, y, structureType: "road" },
});
if (!created.ok || created.body?.ok === 0) {
  throw new Error(`create construction failed (${created.status}): ${JSON.stringify(created.body)}`);
}

let receipt = null;
const observations = [];
for (let attempt = 0; attempt < 40; attempt += 1) {
  const response = await requestJson("/api/user/memory-segment", {
    params: { segment: 99, shard },
  });
  const trace = response.ok ? decodeScreepsSegment(response.body) : null;
  if (trace?.version === 1) {
    const accepted = Array.isArray(trace.intents?.acceptedSample) ? trace.intents.acceptedSample : [];
    const matching = accepted.find((entry) => entry?.trace?.p3Id === expectedP3Id);
    observations.push({
      tick: trace.tick,
      proposed: trace.intents?.proposed ?? null,
      accepted: trace.intents?.accepted ?? null,
      acceptedSample: accepted,
    });
    if (matching) {
      if (Object.prototype.hasOwnProperty.call(matching.trace, "contractId")) {
        throw new Error(`current accepted intent unexpectedly contains legacy contractId: ${JSON.stringify(matching)}`);
      }
      receipt = {
        tick: trace.tick,
        intentType: matching.type,
        actor: matching.actor,
        planner: matching.planner,
        p3Id: matching.trace.p3Id,
        requirementId: matching.trace.requirementId,
        deliverableId: matching.trace.deliverableId,
        taskId: matching.trace.taskId,
        procedureId: matching.trace.procedureId,
        activityId: matching.trace.activityId,
        contractIdPresent: false,
      };
      break;
    }
  }
  await sleep(1500);
}

const after = await requestJson("/api/game/room-objects", { params: { room, shard } });
const afterObjects = Array.isArray(after.body?.objects) ? after.body.objects : [];
const targetState = afterObjects
  .filter((object) => object.x === x && object.y === y)
  .map((object) => ({ type: object.type, structureType: object.structureType ?? null, progress: object.progress ?? null }));

const result = {
  schema: "screeps-p3-intent-lineage-probe/v1",
  deployedRuntimeSha: "51f2de7d9905921261ecd8482c123a7b9c57c050",
  room,
  shard,
  stimulus: { type: "road-construction-site", x, y },
  expectedP3Id,
  receipt,
  targetState,
  observationCount: observations.length,
  observations,
};

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/p3-intent-lineage-probe.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");

if (!receipt) {
  throw new Error(`no accepted intent carrying ${expectedP3Id} observed after ${observations.length} trace samples`);
}

console.log(`P3 intent lineage accepted at tick ${receipt.tick}: ${receipt.intentType} ${receipt.activityId}`);
