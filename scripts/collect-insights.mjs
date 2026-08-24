import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const defaultShard = process.env.SCREEPS_SHARD || "shard3";
const requestedRoom = process.env.SCREEPS_ROOM || "";
const requestedSector = process.env.SCREEPS_SECTOR || "";
const requestedShard = process.env.SCREEPS_REQUESTED_SHARD || "";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/collect";
const requestMode = process.env.SCREEPS_MODE || "collect";

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

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  }
};

const compactObjects = (objects) =>
  objects.map((object) => {
    const compact = {
      type: object.type,
      x: object.x,
      y: object.y,
    };
    for (const key of [
      "_id",
      "user",
      "level",
      "reservation",
      "sign",
      "energyCapacity",
      "mineralType",
    ]) {
      if (object[key] !== undefined) compact[key] = object[key];
    }
    return compact;
  });

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

const shard = requestedShard || defaultShard;
let snapshot;

if (requestMode === "scan") {
  if (!requestedSector) throw new Error("SCREEPS_SECTOR is required for sector scan");

  const candidates = [];
  const scannedRooms = sectorRooms(requestedSector);

  for (const roomName of scannedRooms) {
    const objectsResponse = await requestJson("/api/game/room-objects", {
      room: roomName,
      shard,
    });
    const objects = Array.isArray(objectsResponse?.body?.objects)
      ? objectsResponse.body.objects
      : [];
    const controller = objects.find((object) => object.type === "controller");
    const sources = objects.filter((object) => object.type === "source");

    if (!controller || controller.user || controller.reservation || sources.length < 2) {
      continue;
    }

    const terrainResponse = await requestJson("/api/game/room-terrain", {
      room: roomName,
      shard,
      encoded: 1,
    });
    const terrain = terrainResponse?.body?.terrain?.[0]?.terrain;
    if (typeof terrain !== "string") continue;

    candidates.push({
      room: roomName,
      shard,
      controller: {
        id: controller._id,
        x: controller.x,
        y: controller.y,
        sign: controller.sign || null,
      },
      sources: sources.map((source) => ({
        id: source._id,
        x: source.x,
        y: source.y,
        energyCapacity: source.energyCapacity,
      })),
      terrain,
      objects: compactObjects(
        objects.filter((object) =>
          ["controller", "source", "mineral", "portal", "constructedWall"].includes(
            object.type,
          ),
        ),
      ),
    });
  }

  snapshot = {
    request: {
      id: requestId,
      mode: requestMode,
      command: requestCommand,
      sector: requestedSector,
      shard,
    },
    collectedAt: new Date().toISOString(),
    host,
    scan: {
      sector: requestedSector,
      shard,
      scannedRooms: scannedRooms.length,
      eligibleRooms: candidates.length,
      candidates,
    },
  };
} else {
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

  if (requestedRoom) addRoom(requestedRoom, shard);

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
  for (const [roomName, roomShard] of [...roomTargets.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    roomSnapshots[roomName] = {
      shard: roomShard,
      status: await requestJson("/api/game/room-status", { room: roomName }),
      overview: await requestJson("/api/game/room-overview", {
        room: roomName,
        shard: roomShard,
      }),
      terrain: await requestJson("/api/game/room-terrain", {
        room: roomName,
        shard: roomShard,
        encoded: 1,
      }),
      objects: await requestJson("/api/game/room-objects", {
        room: roomName,
        shard: roomShard,
      }),
    };
  }

  snapshot = {
    request: {
      id: requestId,
      mode: requestMode,
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
}

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/screeps-insights.json",
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);

console.log(`Collected Screeps insights request ${requestId} (${requestMode}).`);
