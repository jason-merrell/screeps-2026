import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const shard = process.env.SCREEPS_SHARD || "shard3";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required to collect insights");
}

const requestJson = async (path, params = {}) => {
  const url = new URL(path, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
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

const roomNames = new Set();
const startRoomName = startRoom?.body?.room?.[0];
if (typeof startRoomName === "string") roomNames.add(startRoomName);

if (Array.isArray(rooms?.body?.rooms)) {
  for (const room of rooms.body.rooms) {
    if (typeof room === "string") roomNames.add(room);
    else if (room && typeof room._id === "string") roomNames.add(room._id);
    else if (room && typeof room.room === "string") roomNames.add(room.room);
  }
}

const roomSnapshots = {};
for (const roomName of [...roomNames].sort()) {
  roomSnapshots[roomName] = {
    status: await requestJson("/api/game/room-status", { room: roomName, shard }),
    overview: await requestJson("/api/game/room-overview", { room: roomName, shard }),
    terrain: await requestJson("/api/game/room-terrain", {
      room: roomName,
      shard,
      encoded: 1,
    }),
    objects: await requestJson("/api/game/room-objects", { room: roomName, shard }),
  };
}

const snapshot = {
  collectedAt: new Date().toISOString(),
  host,
  shard,
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

console.log(`Collected Screeps insights for ${roomNames.size} room(s).`);
