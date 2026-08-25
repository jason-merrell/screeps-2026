import { mkdir, writeFile } from "node:fs/promises";
import { findOwnedSpawnInObjects } from "./lib/owned-colony.mjs";
import { rankStartRooms } from "./lib/start-room-recommender.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const target = (process.env.SCREEPS_TARGET || "ptr").toLowerCase();
const requestedShard = process.env.SCREEPS_REQUESTED_SHARD || "";
const defaultShard = process.env.SCREEPS_SHARD || "shard3";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand =
  process.env.SCREEPS_COMMAND || `/place-start target=${target}`;
const allowWorldPlacement = process.env.SCREEPS_ALLOW_WORLD_PLACEMENT === "true";
const apiPrefix = target === "ptr" ? "/ptr" : "";
const targetLabel = target === "ptr" ? "PTR" : "World";
const spawnName = `${target === "ptr" ? "PTR" : "WORLD"}-${requestId}`;

if (!token) {
  throw new Error("SCREEPS_TOKEN is required for start placement");
}
if (target !== "ptr" && target !== "world") {
  throw new Error(`Unsupported placement target '${target}'`);
}
if (target === "world" && !allowWorldPlacement) {
  throw new Error(
    "World placement requires SCREEPS_ALLOW_WORLD_PLACEMENT=true; refusing live mutation",
  );
}

const requestJson = async (path, { method = "GET", params = {}, body } = {}) => {
  const url = new URL(`${apiPrefix}${path}`, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
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
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Keep raw text for diagnostics.
  }

  return { ok: response.ok, status: response.status, body: parsed };
};

const requireOk = (label, response) => {
  if (!response.ok || response.body?.ok === 0) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body;
};

const parseRoomRef = (value, fallbackShard = defaultShard) => {
  if (typeof value !== "string" || value.length === 0) return null;
  const qualified = value.match(/^(shard[^/]+)\/([WE]\d+[NS]\d+)$/i);
  if (qualified) {
    return { shard: qualified[1].toLowerCase(), room: qualified[2].toUpperCase() };
  }
  if (/^[WE]\d+[NS]\d+$/i.test(value)) {
    return { shard: fallbackShard, room: value.toUpperCase() };
  }
  return null;
};

const sectorRooms = (anchor) => {
  const match = anchor.match(/^([WE])(\d+)([NS])(\d+)$/i);
  if (!match) throw new Error(`Invalid sector anchor '${anchor}'`);

  const [, horizontal, horizontalValue, vertical, verticalValue] = match;
  const xBase = Math.floor(Number(horizontalValue) / 10) * 10;
  const yBase = Math.floor(Number(verticalValue) / 10) * 10;
  const rooms = [];

  for (let xOffset = 1; xOffset <= 9; xOffset += 1) {
    for (let yOffset = 1; yOffset <= 9; yOffset += 1) {
      const inKeeperCluster =
        xOffset >= 4 && xOffset <= 6 && yOffset >= 4 && yOffset <= 6;
      if (inKeeperCluster) continue;
      rooms.push(
        `${horizontal.toUpperCase()}${xBase + xOffset}${vertical.toUpperCase()}${yBase + yOffset}`,
      );
    }
  }

  return rooms;
};

const scanSector = async (sector, shard) => {
  const candidates = [];
  const rooms = sectorRooms(sector);

  for (const room of rooms) {
    const objectsResponse = await requestJson("/api/game/room-objects", {
      params: { room, shard },
    });
    if (!objectsResponse.ok) continue;

    const objects = Array.isArray(objectsResponse.body?.objects)
      ? objectsResponse.body.objects
      : [];
    const controller = objects.find((object) => object.type === "controller");
    const sources = objects.filter((object) => object.type === "source");

    if (!controller || controller.user || controller.reservation || sources.length < 2) {
      continue;
    }

    const terrainResponse = await requestJson("/api/game/room-terrain", {
      params: { room, shard, encoded: 1 },
    });
    const terrain = terrainResponse.body?.terrain?.[0]?.terrain;
    if (!terrainResponse.ok || typeof terrain !== "string") continue;

    candidates.push({
      room,
      shard,
      controller: { x: controller.x, y: controller.y },
      sources: sources.map((source) => ({ x: source.x, y: source.y })),
      terrain,
    });
  }

  return {
    sector,
    shard,
    scannedRooms: rooms.length,
    eligibleRooms: candidates.length,
    candidates,
  };
};

const findExistingOwnedSpawn = async (shard) => {
  const roomTargets = new Map();
  const addRoom = (value, fallbackShard = shard) => {
    if (typeof value === "string") {
      const ref = parseRoomRef(value, fallbackShard);
      if (ref && (!requestedShard || ref.shard === requestedShard)) {
        roomTargets.set(`${ref.shard}/${ref.room}`, ref);
      }
      return;
    }

    const roomName = value?.room || value?._id;
    if (typeof roomName === "string") addRoom(roomName, fallbackShard);
  };

  const roomsResponse = await requestJson("/api/user/rooms", {
    params: { interval: 8 },
  });
  if (roomsResponse.ok && roomsResponse.body?.shards) {
    for (const [shardName, shardRooms] of Object.entries(roomsResponse.body.shards)) {
      if (!Array.isArray(shardRooms)) continue;
      for (const value of shardRooms) addRoom(value, shardName);
    }
  }

  const startRoomResponse = await requestJson("/api/user/world-start-room");
  if (startRoomResponse.ok && Array.isArray(startRoomResponse.body?.room)) {
    for (const value of startRoomResponse.body.room) addRoom(value, shard);
  }

  for (const ref of roomTargets.values()) {
    const objectsResponse = await requestJson("/api/game/room-objects", {
      params: { room: ref.room, shard: ref.shard },
    });
    if (!objectsResponse.ok) continue;

    const owned = findOwnedSpawnInObjects(objectsResponse.body?.objects, spawnName);
    if (owned) {
      return {
        room: ref.room,
        shard: ref.shard,
        name: owned.name,
        x: owned.x,
        y: owned.y,
        user: owned.user,
        controller: owned.controller,
      };
    }
  }

  return null;
};

const writeSnapshot = async (snapshot) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/screeps-insights.json",
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
};

const activation =
  target === "ptr"
    ? requireOk(
        "PTR activation",
        await requestJson("/api/user/activate-ptr", { method: "POST", body: {} }),
      )
    : null;

const initialStatus = requireOk(
  `${targetLabel} world status`,
  await requestJson("/api/user/world-status"),
);
const shard = requestedShard || defaultShard;

if (initialStatus.status !== "empty") {
  const existing = await findExistingOwnedSpawn(shard);
  if (!existing) {
    throw new Error(
      `${targetLabel} is not empty (status=${initialStatus.status}) but no authenticated owned spawn was discovered; refusing to mutate it`,
    );
  }

  await writeSnapshot({
    request: { id: requestId, command: requestCommand, mode: "place-start", target },
    collectedAt: new Date().toISOString(),
    host,
    target,
    result: "already-owned",
    activation,
    spawn: existing,
    worldStatus: initialStatus,
  });
  console.log(
    `${targetLabel} already owns spawn ${existing.name} at ${existing.room} (${existing.x},${existing.y}); no placement needed.`,
  );
  process.exit(0);
}

const startRoomBody = requireOk(
  `${targetLabel} start sectors`,
  await requestJson("/api/user/world-start-room"),
);
const refs = Array.isArray(startRoomBody.room) ? startRoomBody.room : [];
const sectors = [];

for (const value of refs) {
  const ref = parseRoomRef(value, defaultShard);
  if (!ref) continue;
  if (requestedShard && ref.shard !== requestedShard) continue;
  if (!sectors.some((candidate) => candidate.room === ref.room && candidate.shard === ref.shard)) {
    sectors.push(ref);
  }
}

if (sectors.length === 0) {
  throw new Error(`${targetLabel} returned no usable start sectors`);
}

const scans = [];
const candidates = [];
for (const sector of sectors) {
  const scan = await scanSector(sector.room, sector.shard);
  scans.push({
    sector: scan.sector,
    shard: scan.shard,
    scannedRooms: scan.scannedRooms,
    eligibleRooms: scan.eligibleRooms,
  });
  candidates.push(...scan.candidates);
}

const ranking = rankStartRooms(candidates, 5);
const best = ranking[0];
const bestSpawn = best?.bestSpawn;
if (!best || !bestSpawn) {
  throw new Error(
    `${targetLabel} has no eligible neutral two-source start room in the offered sectors`,
  );
}

const placement = await requestJson("/api/game/place-spawn", {
  method: "POST",
  body: {
    room: best.room,
    name: spawnName,
    x: bestSpawn.x,
    y: bestSpawn.y,
    shard: best.shard,
  },
});
requireOk(`${targetLabel} place-spawn`, placement);

let verifiedSpawn = null;
let finalStatus = null;
for (let attempt = 0; attempt < 15; attempt += 1) {
  const objectsResponse = await requestJson("/api/game/room-objects", {
    params: { room: best.room, shard: best.shard },
  });
  const objects = Array.isArray(objectsResponse.body?.objects)
    ? objectsResponse.body.objects
    : [];
  const spawn = objects.find(
    (object) =>
      object.type === "spawn" &&
      object.name === spawnName &&
      object.x === bestSpawn.x &&
      object.y === bestSpawn.y,
  );

  const statusResponse = await requestJson("/api/user/world-status");
  if (statusResponse.ok) finalStatus = statusResponse.body;

  if (spawn) {
    verifiedSpawn = {
      room: best.room,
      shard: best.shard,
      name: spawnName,
      x: spawn.x,
      y: spawn.y,
    };
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (!verifiedSpawn) {
  await writeSnapshot({
    request: { id: requestId, command: requestCommand, mode: "place-start", target },
    collectedAt: new Date().toISOString(),
    host,
    target,
    result: "placement-acknowledged-unverified",
    activation,
    recommendation: { startSectors: sectors, scans, best, ranking },
    placement: placement.body,
    worldStatus: { before: initialStatus, after: finalStatus },
  });
  throw new Error(
    `${targetLabel} place-spawn was acknowledged but spawn ${spawnName} was not observable at ${best.room} (${bestSpawn.x},${bestSpawn.y})`,
  );
}

await writeSnapshot({
  request: { id: requestId, command: requestCommand, mode: "place-start", target },
  collectedAt: new Date().toISOString(),
  host,
  target,
  result: "placed-and-verified",
  activation,
  recommendation: {
    startSectors: sectors,
    scans,
    best,
    ranking,
  },
  placement: placement.body,
  spawn: verifiedSpawn,
  worldStatus: {
    before: initialStatus,
    after: finalStatus,
  },
});

console.log(
  `Placed and verified ${targetLabel} spawn ${spawnName} in ${best.room} at (${bestSpawn.x},${bestSpawn.y}).`,
);
