export const BOOTSTRAP_STATE_VERSION = 3;

const ROOM_SIZE = 50;
const TERRAIN_WALL = 1;
const BODY_PARTS = new Set(["work", "carry", "move", "attack", "ranged_attack", "heal", "claim", "tough"]);

const desiredWorkforce = (level, sourceCount, constructionSiteCount) => {
  const base =
    level <= 1
      ? Math.max(3, sourceCount + 1)
      : level === 2
        ? Math.max(4, sourceCount + 2)
        : Math.max(5, sourceCount + 3);

  return Math.min(7, base + (constructionSiteCount > 0 ? 1 : 0));
};

const energyOf = (object) => object?.store?.energy ?? object?.energy ?? 0;
const capacityOf = (object) =>
  object?.storeCapacityResource?.energy ??
  object?.storeCapacity ??
  object?.energyCapacity ??
  0;

const countBy = (objects, predicate) => objects.filter(predicate).length;

const terrainStringOf = (roomSnapshot) => {
  const value =
    roomSnapshot?.terrain?.body?.terrain?.[0]?.terrain ??
    roomSnapshot?.terrain?.terrain?.[0]?.terrain ??
    roomSnapshot?.terrain;
  return typeof value === "string" && value.length === ROOM_SIZE * ROOM_SIZE
    ? value
    : null;
};

const terrainWalkable = (terrain, x, y) => {
  if (!terrain || x < 0 || y < 0 || x >= ROOM_SIZE || y >= ROOM_SIZE)
    return false;
  return (Number(terrain[y * ROOM_SIZE + x]) & TERRAIN_WALL) === 0;
};

const adjacent = (x, y) => {
  const points = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const next = { x: x + dx, y: y + dy };
      if (
        next.x >= 0 &&
        next.y >= 0 &&
        next.x < ROOM_SIZE &&
        next.y < ROOM_SIZE
      ) {
        points.push(next);
      }
    }
  }
  return points;
};

const terrainRouteExists = (terrain, start, goals) => {
  if (
    !terrain ||
    !Number.isInteger(start?.x) ||
    !Number.isInteger(start?.y) ||
    goals.length === 0
  ) {
    return null;
  }
  const goalKeys = new Set(goals.map(({ x, y }) => `${x}:${y}`));
  const queue = [start];
  const visited = new Set([`${start.x}:${start.y}`]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (goalKeys.has(`${current.x}:${current.y}`)) return true;
    for (const next of adjacent(current.x, current.y)) {
      const key = `${next.x}:${next.y}`;
      if (visited.has(key) || !terrainWalkable(terrain, next.x, next.y))
        continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
};

const bodyPartType = (part) =>
  typeof part === "string"
    ? part.toLowerCase()
    : typeof part?.type === "string"
      ? part.type.toLowerCase()
      : null;

const activeBodyPartCount = (creep, wanted) => {
  if (!Array.isArray(creep?.body)) return 0;
  return creep.body.filter((part) => {
    const type = bodyPartType(part);
    return BODY_PARTS.has(type) && type === wanted && Number(part?.hits ?? 100) > 0;
  }).length;
};

const ticksToLiveOf = (creep, gameTime) => {
  if (Number.isFinite(Number(creep?.ticksToLive)))
    return Math.max(0, Number(creep.ticksToLive));
  if (Number.isFinite(Number(creep?.ageTime)) && Number.isFinite(gameTime))
    return Math.max(0, Number(creep.ageTime) - gameTime);
  return null;
};

export function projectBootstrapState(snapshot, requestedRoom = "") {
  const roomEntries = Object.entries(snapshot?.roomSnapshots ?? {});
  const [roomName, roomSnapshot] = requestedRoom
    ? (roomEntries.find(([name]) => name === requestedRoom) ?? [])
    : (roomEntries[0] ?? []);

  if (!roomName || !roomSnapshot) {
    throw new Error("Bootstrap replay requires at least one room snapshot");
  }

  const objects = Array.isArray(roomSnapshot?.objects?.body?.objects)
    ? roomSnapshot.objects.body.objects
    : [];
  const controller =
    objects.find((object) => object.type === "controller") ?? null;
  const spawns = objects.filter((object) => object.type === "spawn");
  const ownerId = controller?.user ?? spawns[0]?.user ?? null;
  const creeps = objects.filter((object) => object.type === "creep");
  const myCreeps = ownerId
    ? creeps.filter((creep) => creep.user === ownerId)
    : creeps;
  const hostiles = ownerId
    ? creeps.filter((creep) => creep.user && creep.user !== ownerId)
    : [];
  const sites = objects.filter((object) => object.type === "constructionSite");
  const sources = objects.filter((object) => object.type === "source");
  const extensions = objects.filter((object) => object.type === "extension");
  const towers = objects.filter((object) => object.type === "tower");
  const containers = objects.filter((object) => object.type === "container");
  const storages = objects.filter((object) => object.type === "storage");
  const terminals = objects.filter((object) => object.type === "terminal");
  const roads = objects.filter((object) => object.type === "road");
  const ramparts = objects.filter((object) => object.type === "rampart");
  const level = controller?.level ?? 0;
  const targetWorkforce = desiredWorkforce(
    level || 1,
    sources.length,
    sites.length,
  );
  const overviewTotals = roomSnapshot?.overview?.body?.totals ?? {};
  const terrain = terrainStringOf(roomSnapshot);
  const gameTime = Number.isFinite(Number(snapshot?.gameTime))
    ? Number(snapshot.gameTime)
    : null;
  const sourceDetails = sources.map((source) => {
    const access =
      Number.isInteger(source?.x) && Number.isInteger(source?.y) && terrain
        ? adjacent(source.x, source.y).filter(({ x, y }) =>
            terrainWalkable(terrain, x, y),
          )
        : null;
    return {
      x: Number.isInteger(source?.x) ? source.x : null,
      y: Number.isInteger(source?.y) ? source.y : null,
      energy: energyOf(source),
      capacity: capacityOf(source),
      accessibleTiles: access?.length ?? null,
      connectedToSpawn:
        access && spawns[0]
          ? terrainRouteExists(terrain, spawns[0], access)
          : null,
    };
  });
  const workforceDetails = myCreeps.map((creep) => ({
    spawning: Boolean(creep.spawning),
    ticksToLive: ticksToLiveOf(creep, gameTime),
    workParts: activeBodyPartCount(creep, "work"),
    carryParts: activeBodyPartCount(creep, "carry"),
    moveParts: activeBodyPartCount(creep, "move"),
  }));

  return {
    schemaVersion: BOOTSTRAP_STATE_VERSION,
    observedAt: snapshot?.collectedAt ?? null,
    target: snapshot?.target ?? snapshot?.request?.target ?? null,
    shard: roomSnapshot?.shard ?? snapshot?.request?.shard ?? null,
    room: roomName,
    worldStatus: snapshot?.worldStatus?.body?.status ?? null,
    controller: controller
      ? {
          level,
          progress: controller.progress ?? 0,
          progressTotal: controller.progressTotal ?? 0,
          ticksToDowngrade:
            controller.ticksToDowngrade ??
            (Number.isFinite(Number(controller.downgradeTime)) &&
            gameTime !== null
              ? Math.max(0, Number(controller.downgradeTime) - gameTime)
              : null),
          safeMode: controller.safeMode ?? null,
          owned: Boolean(controller.user),
        }
      : null,
    spawn: spawns[0]
      ? {
          name: spawns[0].name ?? null,
          energy: energyOf(spawns[0]),
          capacity: capacityOf(spawns[0]),
          spawning: spawns[0].spawning?.name ?? null,
        }
      : null,
    workforce: {
      target: targetWorkforce,
      total: myCreeps.length,
      alive: myCreeps.filter((creep) => !creep.spawning).length,
      spawning: myCreeps.filter((creep) => creep.spawning).length,
      carriedEnergy: myCreeps.reduce((sum, creep) => sum + energyOf(creep), 0),
      carryCapacity: myCreeps.reduce(
        (sum, creep) => sum + capacityOf(creep),
        0,
      ),
      activeWorkParts: workforceDetails.reduce(
        (sum, creep) => sum + creep.workParts,
        0,
      ),
      activeCarryParts: workforceDetails.reduce(
        (sum, creep) => sum + creep.carryParts,
        0,
      ),
      knownTtl: workforceDetails.filter(
        (creep) => creep.spawning || creep.ticksToLive !== null,
      ).length,
      members: workforceDetails,
    },
    energy: {
      sourceCount: sources.length,
      sourceEnergy: sources.reduce((sum, source) => sum + energyOf(source), 0),
      sourceCapacity: sources.reduce(
        (sum, source) => sum + capacityOf(source),
        0,
      ),
      harvestedTotal: overviewTotals.energyHarvested ?? 0,
      creepSpendTotal: overviewTotals.energyCreeps ?? 0,
      constructionSpendTotal: overviewTotals.energyConstruction ?? 0,
      controllerSpendTotal: overviewTotals.energyControl ?? 0,
      reserveEnergy: [...storages, ...terminals, ...containers].reduce(
        (sum, structure) => sum + energyOf(structure),
        0,
      ),
      sources: sourceDetails,
    },
    structures: {
      extensions: extensions.length,
      towers: towers.length,
      containers: containers.length,
      roads: roads.length,
      ramparts: ramparts.length,
      towerEnergy: towers.reduce((sum, tower) => sum + energyOf(tower), 0),
      towerCapacity: towers.reduce(
        (sum, tower) => sum + capacityOf(tower),
        0,
      ),
      constructionSites: sites.length,
      extensionSites: countBy(
        sites,
        (site) => site.structureType === "extension",
      ),
      towerSites: countBy(sites, (site) => site.structureType === "tower"),
      containerSites: countBy(
        sites,
        (site) => site.structureType === "container",
      ),
    },
    hostiles: hostiles.length,
  };
}

export function evaluateBootstrapState(state) {
  const level = state.controller?.level ?? 0;
  const extensionCapacity =
    state.structures.extensions + state.structures.extensionSites;
  const towerCapacity = state.structures.towers + state.structures.towerSites;
  const spawnPresent = Boolean(state.spawn);
  const energyLoopActive =
    state.energy.harvestedTotal > 0 ||
    (state.energy.sourceCapacity > 0 &&
      state.energy.sourceEnergy < state.energy.sourceCapacity);
  const workforceTargetMet = state.workforce.total >= state.workforce.target;
  const towerOnline =
    state.structures.towers >= 1 && state.structures.towerEnergy > 0;

  const milestones = {
    spawnPresent,
    energyLoopActive,
    workforceTargetMet,
    rcl2: level >= 2,
    rcl2Infrastructure: level >= 2 && extensionCapacity >= 5,
    rcl3: level >= 3,
    rcl3Infrastructure:
      level >= 3 && extensionCapacity >= 10 && towerCapacity >= 1,
    towerOnline,
    stableRcl3:
      level >= 3 &&
      spawnPresent &&
      energyLoopActive &&
      workforceTargetMet &&
      state.structures.extensions >= 10 &&
      towerOnline,
  };

  const reached = Object.entries(milestones)
    .filter(([, value]) => value)
    .map(([name]) => name);

  let status = "progressing";
  if (!milestones.spawnPresent || !state.controller?.owned) status = "failed";
  if (milestones.stableRcl3) status = "passed";

  return {
    status,
    milestones,
    reached,
    summary: {
      room: state.room,
      rcl: level,
      workforce: `${state.workforce.total}/${state.workforce.target}`,
      spawnEnergy: state.spawn?.energy ?? 0,
      extensions: state.structures.extensions,
      constructionSites: state.structures.constructionSites,
      towers: state.structures.towers,
      towerEnergy: state.structures.towerEnergy,
      hostiles: state.hostiles,
    },
  };
}
