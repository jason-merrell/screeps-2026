import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const defaultShard = process.env.SCREEPS_SHARD || "shard3";
const requestedRoom = process.env.SCREEPS_ROOM || "";
const requestedShard = process.env.SCREEPS_REQUESTED_SHARD || "";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/collect";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required to collect insights");
}

const requestJson = async (path, params = {}) => {
  const url = new URL(path, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Token": token,
      },
    });
    const text = await response.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Preserve non-JSON responses for diagnostics.
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  }
};

const worldStatus = await requestJson("/api/user/world-status");
const startRoom = await requestJson("/api/user/world-start-room");
const rooms = await requestJson("/api/user/rooms", { interval: 8 });
const branches = await requestJson("/api/user/branches");
const stats = await requestJson("/api/user/stats", { interval: 8 });

const roomTargets = new Map();
const addRoom = (value, fallbackShard = defaultShard) => {
  if (typeof value !== "string" || value.length === 0) return;

  const match = value.match(/^(shard[^/]+)\/([WE]\d+[NS]\d+)$/i);
  if (match) {
    roomTargets.set(match[2].toUpperCase(), match[1]);
    return;
  }

  if (/^[WE]\d+[NS]\d+$/i.test(value)) {
    roomTargets.set(value.toUpperCase(), fallbackShard);
  }
};

if (requestedRoom) addRoom(requestedRoom, requestedShard || defaultShard);

if (Array.isArray(startRoom?.body?.room)) {
  for (const room of startRoom.body.room) addRoom(room, defaultShard);
}

if (rooms?.body?.shards && typeof rooms.body.shards === "object") {
  for (const [shardName, shardRooms] of Object.entries(rooms.body.shards)) {
    if (!Array.isArray(shardRooms)) continue;
    for (const room of shardRooms) {
      if (typeof room === "string") addRoom(room, shardName);
      else if (room && typeof room._id === "string") addRoom(room._id, shardName);
      else if (room && typeof room.room === "string") addRoom(room.room, shardName);
    }
  }
}

const roomSnapshots = {};
for (const [roomName, roomShard] of [...roomTargets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  roomSnapshots[roomName] = {
    shard: roomShard,
    status: await requestJson("/api/game/room-status", { room: roomName }),
    overview: await requestJson("/api/game/room-overview", { room: roomName, shard: roomShard }),
    terrain: await requestJson("/api/game/room-terrain", {
      room: roomName,
      shard: roomShard,
      encoded: 1,
    }),
    objects: await requestJson("/api/game/room-objects", { room: roomName, shard: roomShard }),
  };
}

const snapshot = {
  request: {
    id: requestId,
    command: requestCommand,
    room: requestedRoom || null,
    shard: requestedShard || null,
  },
  collectedAt: new Date().toISOString(),
  host,
  defaultShard,
  worldStatus,
  startRoom,
  rooms,
  branches,
  stats,
  roomSnapshots,
};

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/screeps-insights.json",
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);

console.log(`Collected Screeps insights request ${requestId} for ${roomTargets.size} room(s).`);
