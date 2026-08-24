import { mkdir, writeFile } from "node:fs/promises";
import { rankStartRooms } from "./lib/start-room-recommender.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const requestedShard = process.env.SCREEPS_REQUESTED_SHARD || "";
const defaultShard = process.env.SCREEPS_SHARD || "shard3";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/place-start target=ptr";
const spawnName = `PTR-${requestId}`;
const PTR_PREFIX = "/ptr";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required for PTR placement");
}

const requestJson = async (path, { method = "GET", params = {}, body } = {}) => {
  const url = new URL(`${PTR_PREFIX}${path}`, host);
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

const findExistingRequestSpawn = async (shard) => {
  const roomsResponse = await requestJson("/api/user/rooms", {
    params: { interval: 8 },
  });
  if (!roomsResponse.ok) return null;

  const shardRooms = roomsResponse.body?.shards?.[shard];
  if (!Array.isArray(shardRooms)) return null;

  for (const value of shardRooms) {
    const roomName =
      typeof value === "string" ? value : value?.room || value?._id || null;
    if (typeof roomName !== "string") continue;

    const objectsResponse = await requestJson("/api/game/room-objects", {
      params: { room: roomName, shard },
    });
    if (!objectsResponse.ok) continue;

    const objects = Array.isArray(objectsResponse.body?.objects)
      ? objectsResponse.body.objects
      : [];
    const spawn = objects.find(
      (object) => object.type === "spawn" && object.name === spawnName,
    );
    if (spawn) {
      return { room: roomName, x: spawn.x, y: spawn.y, name: spawn.name, shard };
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

const initialStatus = requireOk(
  "PTR world status",
  await requestJson("/api/user/world-status"),
);
const shard = requestedShard || defaultShard;

if (initialStatus.status !== "empty") {
  const existing = await findExistingRequestSpawn(shard);
  if (!existing) {
    throw new Error(
      `PTR is not empty (status=${initialStatus.status}) and no spawn for request ${requestId} exists; refusing to mutate it`,
    );
  }

  await writeSnapshot({
    request: { id: requestId, command: requestCommand, mode: "place-start", target: "ptr" },
    collectedAt: new Date().toISOString(),
    host,
    target: "ptr",
    result: "already-placed",
    spawn: existing,
    worldStatus: initialStatus,
  });
  console.log(`PTR request ${requestId} was already placed at ${existing.room} (${existing.x},${existing.y}).`);
  process.exit(0);
}

const startRoomBody = requireOk(
  "PTR start sectors",
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
  throw new Error("PTR returned no usable start sectors");
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
  throw new Error("PTR has no eligible neutral two-source start room in the offered sectors");
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
requireOk("PTR place-spawn", placement);

let verifiedSpawn = null;
let finalStatus = null;
for (let attempt = 0; attempt < 5; attempt += 1) {
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
  throw new Error(
    `PTR place-spawn was acknowledged but spawn ${spawnName} was not observable at ${best.room} (${bestSpawn.x},${bestSpawn.y})`,
  );
}

await writeSnapshot({
  request: { id: requestId, command: requestCommand, mode: "place-start", target: "ptr" },
  collectedAt: new Date().toISOString(),
  host,
  target: "ptr",
  result: "placed-and-verified",
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
  `Placed and verified PTR spawn ${spawnName} in ${best.room} at (${bestSpawn.x},${bestSpawn.y}).`,
);
