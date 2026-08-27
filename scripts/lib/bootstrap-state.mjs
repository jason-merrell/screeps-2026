export const BOOTSTRAP_STATE_VERSION = 1;

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
  object?.storeCapacityResource?.energy ?? object?.storeCapacity ?? object?.energyCapacity ?? 0;

const countBy = (objects, predicate) => objects.filter(predicate).length;

export function projectBootstrapState(snapshot, requestedRoom = "") {
  const roomEntries = Object.entries(snapshot?.roomSnapshots ?? {});
  const [roomName, roomSnapshot] = requestedRoom
    ? roomEntries.find(([name]) => name === requestedRoom) ?? []
    : roomEntries[0] ?? [];

  if (!roomName || !roomSnapshot) {
    throw new Error("Bootstrap replay requires at least one room snapshot");
  }

  const objects = Array.isArray(roomSnapshot?.objects?.body?.objects)
    ? roomSnapshot.objects.body.objects
    : [];
  const controller = objects.find((object) => object.type === "controller") ?? null;
  const spawns = objects.filter((object) => object.type === "spawn");
  const ownerId = controller?.user ?? spawns[0]?.user ?? null;
  const creeps = objects.filter((object) => object.type === "creep");
  const myCreeps = ownerId ? creeps.filter((creep) => creep.user === ownerId) : creeps;
  const hostiles = ownerId ? creeps.filter((creep) => creep.user && creep.user !== ownerId) : [];
  const sites = objects.filter((object) => object.type === "constructionSite");
  const sources = objects.filter((object) => object.type === "source");
  const extensions = objects.filter((object) => object.type === "extension");
  const towers = objects.filter((object) => object.type === "tower");
  const containers = objects.filter((object) => object.type === "container");
  const roads = objects.filter((object) => object.type === "road");
  const ramparts = objects.filter((object) => object.type === "rampart");
  const level = controller?.level ?? 0;
  const targetWorkforce = desiredWorkforce(level || 1, sources.length, sites.length);
  const overviewTotals = roomSnapshot?.overview?.body?.totals ?? {};

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
      carryCapacity: myCreeps.reduce((sum, creep) => sum + capacityOf(creep), 0),
    },
    energy: {
      sourceCount: sources.length,
      sourceEnergy: sources.reduce((sum, source) => sum + energyOf(source), 0),
      sourceCapacity: sources.reduce((sum, source) => sum + capacityOf(source), 0),
      harvestedTotal: overviewTotals.energyHarvested ?? 0,
      creepSpendTotal: overviewTotals.energyCreeps ?? 0,
      constructionSpendTotal: overviewTotals.energyConstruction ?? 0,
      controllerSpendTotal: overviewTotals.energyControl ?? 0,
    },
    structures: {
      extensions: extensions.length,
      towers: towers.length,
      containers: containers.length,
      roads: roads.length,
      ramparts: ramparts.length,
      towerEnergy: towers.reduce((sum, tower) => sum + energyOf(tower), 0),
      constructionSites: sites.length,
      extensionSites: countBy(sites, (site) => site.structureType === "extension"),
      towerSites: countBy(sites, (site) => site.structureType === "tower"),
      containerSites: countBy(sites, (site) => site.structureType === "container"),
    },
    hostiles: hostiles.length,
  };
}

export function evaluateBootstrapState(state) {
  const level = state.controller?.level ?? 0;
  const extensionCapacity = state.structures.extensions + state.structures.extensionSites;
  const towerCapacity = state.structures.towers + state.structures.towerSites;
  const spawnPresent = Boolean(state.spawn);
  const energyLoopActive =
    state.energy.harvestedTotal > 0 ||
    (state.energy.sourceCapacity > 0 && state.energy.sourceEnergy < state.energy.sourceCapacity);
  const workforceTargetMet = state.workforce.total >= state.workforce.target;
  const towerOnline = state.structures.towers >= 1 && state.structures.towerEnergy > 0;

  const milestones = {
    spawnPresent,
    energyLoopActive,
    workforceTargetMet,
    rcl2: level >= 2,
    rcl2Infrastructure: level >= 2 && extensionCapacity >= 5,
    rcl3: level >= 3,
    rcl3Infrastructure: level >= 3 && extensionCapacity >= 10 && towerCapacity >= 1,
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
