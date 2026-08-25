import { appendFile } from "node:fs/promises";

import { findOwnedSpawnInObjects } from "./lib/owned-colony.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const target = process.env.SCREEPS_TARGET || "ptr";
const requestedRoom = (process.env.SCREEPS_ROOM || "").toUpperCase();
const requestedShard = (process.env.SCREEPS_REQUESTED_SHARD || process.env.SCREEPS_SHARD || "shard3").toLowerCase();
const outputPath = process.env.GITHUB_OUTPUT || "";
const envPath = process.env.GITHUB_ENV || "";
const apiPrefix = target === "ptr" ? "/ptr" : "";

if (!token) throw new Error("SCREEPS_TOKEN is required to resolve an observability room");
if (target !== "ptr") throw new Error("Observability room resolution is currently restricted to PTR");
if (!/^shard\d+$/.test(requestedShard)) throw new Error(`Invalid shard '${requestedShard}'`);
if (requestedRoom && !/^[WE]\d+[NS]\d+$/.test(requestedRoom)) throw new Error(`Invalid room '${requestedRoom}'`);

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

const parseStartRoomRefs = (body) => {
  const values = Array.isArray(body)
    ? body
    : Array.isArray(body?.rooms)
      ? body.rooms
      : Array.isArray(body?.room)
        ? body.room
        : Array.isArray(body?.data)
          ? body.data
          : typeof body?.room === "string"
            ? [body.room]
            : [];

  return values
    .map((value) => String(value))
    .map((value) => {
      const match = value.match(/^(shard\d+)\/([WE]\d+[NS]\d+)$/i);
      return match ? { shard: match[1].toLowerCase(), room: match[2].toUpperCase() } : null;
    })
    .filter(Boolean);
};

const candidates = [];
if (requestedRoom) {
  candidates.push({ room: requestedRoom, shard: requestedShard, source: "requested" });
} else {
  const startRooms = parseStartRoomRefs(await requestJson("/api/user/world-start-room"));
  for (const candidate of startRooms) {
    if (candidate.shard === requestedShard) candidates.push({ ...candidate, source: "world-start-room" });
  }
}

if (candidates.length === 0) {
  throw new Error(`No owned start-room candidate found for ${target}/${requestedShard}`);
}

let resolved = null;
for (const candidate of candidates) {
  const roomObjects = await requestJson("/api/game/room-objects", {
    room: candidate.room,
    shard: candidate.shard,
  });
  const owned = findOwnedSpawnInObjects(roomObjects.objects);
  if (owned) {
    resolved = { ...candidate, spawn: owned.name, user: owned.user, controllerLevel: owned.controller.level };
    break;
  }
}

if (!resolved) {
  if (requestedRoom) {
    throw new Error(`Refusing snapshot: ${requestedShard}/${requestedRoom} is not an owned colony for the authenticated Screeps account`);
  }
  throw new Error(`Could not verify an owned colony from Screeps start-room state on ${requestedShard}`);
}

const lines = [
  `room=${resolved.room}`,
  `shard=${resolved.shard}`,
  `source=${resolved.source}`,
  `spawn=${resolved.spawn}`,
];
if (outputPath) await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");
if (envPath) {
  await appendFile(envPath, `SCREEPS_ROOM=${resolved.room}\nSCREEPS_REQUESTED_SHARD=${resolved.shard}\n`, "utf8");
}

console.log(
  `Resolved observability colony ${resolved.shard}/${resolved.room} via ${resolved.source}; owned spawn ${resolved.spawn}, RCL${resolved.controllerLevel ?? "?"}`,
);
