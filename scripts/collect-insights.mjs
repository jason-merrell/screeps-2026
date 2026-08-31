import { mkdir, writeFile } from "node:fs/promises";
import {
  buildPtrRuntimeReadiness,
  DEFAULT_PTR_MEMORY_VERSION,
  sanitizePtrBranchesResponse,
} from "./lib/ptr-runtime-readiness.mjs";
import { rankStartRooms } from "./lib/start-room-recommender.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const defaultShard = process.env.SCREEPS_SHARD || "shard3";
const requestedRoom = process.env.SCREEPS_ROOM || "";
const requestedSector = process.env.SCREEPS_SECTOR || "";
const requestedShard = process.env.SCREEPS_REQUESTED_SHARD || "";
const requestedTarget = process.env.SCREEPS_TARGET || "world";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/collect";
const requestMode = process.env.SCREEPS_MODE || "collect";
const expectedBranch = process.env.SCREEPS_BRANCH || "default";
const expectedRuntimeSha =
  process.env.SCREEPS_EXPECTED_RUNTIME_SHA || process.env.GITHUB_SHA || "";
const expectedMemoryVersion = Number(
  process.env.SCREEPS_EXPECTED_MEMORY_VERSION ||
    String(DEFAULT_PTR_MEMORY_VERSION),
);
const observabilitySegment = Number(
  process.env.SCREEPS_OBSERVABILITY_SEGMENT || "99",
);
const apiPrefix = requestedTarget === "ptr" ? "/ptr" : "";
const collectedAtMs = Date.now();
const collectedAt = new Date(collectedAtMs).toISOString();

if (!token) {
  throw new Error("SCREEPS_TOKEN is required to collect insights");
}
if (requestedTarget !== "world" && requestedTarget !== "ptr") {
  throw new Error(`Unsupported Screeps target '${requestedTarget}'`);
}
if (
  requestedTarget === "ptr" &&
  (requestMode === "collect" || requestMode === "snapshot") &&
  (!requestedRoom || !requestedShard)
) {
  throw new Error(
    "PTR runtime preflight requires an explicit SCREEPS_ROOM and SCREEPS_REQUESTED_SHARD",
  );
}
if (
  !Number.isInteger(observabilitySegment) ||
  observabilitySegment < 0 ||
  observabilitySegment > 99
) {
  throw new Error(
    "SCREEPS_OBSERVABILITY_SEGMENT must be an integer from 0 through 99",
  );
}

const requestJson = async (path, params = {}) => {
  const url = new URL(`${apiPrefix}${path}`, host);
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

    const hasExplicitError =
      body !== null &&
      typeof body === "object" &&
      Object.hasOwn(body, "error") &&
      body.error !== null &&
      body.error !== "";
    const apiRejected =
      body === null || typeof body !== "object" || body.ok !== 1;

    return {
      ok: response.ok && !hasExplicitError && !apiRejected,
      httpOk: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      httpOk: false,
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
      "name",
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

const parseRoomRef = (value, fallbackShard = defaultShard) => {
  if (typeof value !== "string" || value.length === 0) return null;
  const qualified = value.match(/^(shard[^/]+)\/([WE]\d+[NS]\d+)$/i);
  if (qualified) {
    return {
      shard: qualified[1].toLowerCase(),
      room: qualified[2].toUpperCase(),
    };
  }
  if (/^[WE]\d+[NS]\d+$/i.test(value)) {
    return { shard: fallbackShard, room: value.toUpperCase() };
  }
  return null;
};

const scanSector = async (sector, shard) => {
  const candidates = [];
  const scannedRooms = sectorRooms(sector);

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

    if (
      !controller ||
      controller.user ||
      controller.reservation ||
      sources.length < 2
    ) {
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
          [
            "controller",
            "source",
            "mineral",
            "portal",
            "constructedWall",
          ].includes(object.type),
        ),
      ),
    });
  }

  return {
    sector,
    shard,
    scannedRooms: scannedRooms.length,
    eligibleRooms: candidates.length,
    candidates,
  };
};

const shard = requestedShard || defaultShard;
let snapshot;

if (requestMode === "recommend") {
  const startRoom = await requestJson("/api/user/world-start-room");
  const refs = Array.isArray(startRoom?.body?.room) ? startRoom.body.room : [];
  const startSectors = [];

  for (const value of refs) {
    const ref = parseRoomRef(value, defaultShard);
    if (!ref) continue;
    if (requestedShard && ref.shard !== requestedShard) continue;
    if (
      !startSectors.some(
        (candidate) =>
          candidate.room === ref.room && candidate.shard === ref.shard,
      )
    ) {
      startSectors.push(ref);
    }
  }

  if (startSectors.length === 0) {
    throw new Error(
      "Screeps returned no usable start sectors for recommendation",
    );
  }

  const scans = [];
  const allCandidates = [];
  for (const sector of startSectors) {
    const scan = await scanSector(sector.room, sector.shard);
    scans.push({
      sector: scan.sector,
      shard: scan.shard,
      scannedRooms: scan.scannedRooms,
      eligibleRooms: scan.eligibleRooms,
    });
    allCandidates.push(...scan.candidates);
  }

  const ranking = rankStartRooms(allCandidates, 5);
  if (ranking.length === 0) {
    throw new Error(
      "No neutral two-source rooms were eligible in the offered start sectors",
    );
  }

  snapshot = {
    request: {
      id: requestId,
      mode: requestMode,
      command: requestCommand,
      shard: requestedShard || null,
      target: requestedTarget,
    },
    collectedAt,
    host,
    target: requestedTarget,
    recommendation: {
      startSectors,
      scans,
      scannedRooms: scans.reduce((sum, scan) => sum + scan.scannedRooms, 0),
      eligibleRooms: ranking.length,
      best: ranking[0],
      ranking,
    },
  };
} else if (requestMode === "scan") {
  if (!requestedSector)
    throw new Error("SCREEPS_SECTOR is required for sector scan");

  const scan = await scanSector(requestedSector, shard);
  snapshot = {
    request: {
      id: requestId,
      mode: requestMode,
      command: requestCommand,
      sector: requestedSector,
      shard,
      target: requestedTarget,
    },
    collectedAt,
    host,
    target: requestedTarget,
    scan,
  };
} else {
  const account =
    requestedTarget === "ptr" ? await requestJson("/api/auth/me") : null;
  const accountId =
    account?.ok && typeof account.body?._id === "string"
      ? account.body._id
      : undefined;
  const unavailableAccountScopedResponse = {
    ok: false,
    httpOk: false,
    status: 0,
    body: { error: "authenticated account id unavailable" },
  };
  const [
    worldStatus,
    startRoom,
    rooms,
    branches,
    stats,
    gameTime,
    memoryVersion,
    observability,
  ] = await Promise.all([
    requestJson("/api/user/world-status"),
    requestJson("/api/user/world-start-room"),
    requestedTarget === "ptr"
      ? accountId
        ? requestJson("/api/user/rooms", { id: accountId, interval: 8 })
        : unavailableAccountScopedResponse
      : requestJson("/api/user/rooms", { interval: 8 }),
    requestJson("/api/user/branches"),
    requestedTarget === "ptr"
      ? accountId
        ? requestJson("/api/user/stats", { id: accountId, interval: 8 })
        : unavailableAccountScopedResponse
      : requestJson("/api/user/stats", { interval: 8 }),
    requestedTarget === "ptr" ? requestJson("/api/game/time", { shard }) : null,
    requestedTarget === "ptr"
      ? requestJson("/api/user/memory", { path: "version", shard })
      : null,
    requestedTarget === "ptr"
      ? requestJson("/api/user/memory-segment", {
          segment: observabilitySegment,
          shard,
        })
      : null,
  ]);

  const roomTargets = new Map();
  const addRoom = (value, fallbackShard = defaultShard) => {
    const ref = parseRoomRef(value, fallbackShard);
    // roomSnapshots is keyed by room name for compatibility. Keep the first
    // authoritative shard binding so an explicit room/shard request cannot be
    // silently replaced by the same room name reported on another shard.
    if (ref && !roomTargets.has(ref.room)) roomTargets.set(ref.room, ref.shard);
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
        else if (room && typeof room._id === "string")
          addRoom(room._id, shardName);
        else if (room && typeof room.room === "string")
          addRoom(room.room, shardName);
      }
    }
  }

  const roomSnapshots = {};
  for (const [roomName, roomShard] of [...roomTargets.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    roomSnapshots[roomName] = {
      shard: roomShard,
      status: await requestJson("/api/game/room-status", {
        room: roomName,
        shard: roomShard,
      }),
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

  const readinessRoom =
    requestedRoom ||
    [...roomTargets.keys()].sort((a, b) => a.localeCompare(b))[0];
  const runtimeReadiness =
    requestedTarget === "ptr" && readinessRoom
      ? buildPtrRuntimeReadiness({
          expectedBranch,
          expectedRuntimeSha,
          expectedMemoryVersion,
          shard: roomSnapshots[readinessRoom].shard,
          room: readinessRoom,
          worldStatusResponse: worldStatus,
          branchesResponse: branches,
          accountResponse: account,
          gameTimeResponse: gameTime,
          memoryVersionResponse: memoryVersion,
          observabilityResponse: observability,
          roomsResponse: rooms,
          roomObjectsResponse: roomSnapshots[readinessRoom].objects,
          observabilitySegment,
          collectedAtMs,
        })
      : null;

  snapshot = {
    request: {
      id: requestId,
      mode: requestMode,
      command: requestCommand,
      room: requestedRoom || null,
      shard: requestedShard || null,
      target: requestedTarget,
    },
    collectedAt,
    host,
    target: requestedTarget,
    defaultShard,
    worldStatus,
    startRoom,
    rooms,
    // Branch module source and opaque branch metadata are never required for
    // an insights artifact. Preserve only activation evidence on every target.
    branches: sanitizePtrBranchesResponse(branches),
    stats,
    ...(runtimeReadiness ? { runtimeReadiness } : {}),
    roomSnapshots,
  };
}

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/screeps-insights.json",
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);

console.log(
  `Collected Screeps insights request ${requestId} (${requestMode}, target=${requestedTarget}).`,
);
