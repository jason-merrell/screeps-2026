import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";

interface BuildTile {
  x: number;
  y: number;
  score: number;
}

const MAX_NEW_SITES_PER_ROOM = 12;
const MAX_TOTAL_SITES_PER_ROOM = 24;

const tileKey = (x: number, y: number): string => `${x}:${y}`;

function hasSite(room: Room, x: number, y: number, type: BuildableStructureConstant): boolean {
  return room
    .lookForAt(LOOK_CONSTRUCTION_SITES, x, y)
    .some((site) => site.structureType === type);
}

function hasStructure(room: Room, x: number, y: number, type: StructureConstant): boolean {
  return room.lookForAt(LOOK_STRUCTURES, x, y).some((structure) => structure.structureType === type);
}

function isOpenBuildTile(room: Room, x: number, y: number): boolean {
  if (x < 2 || x > 47 || y < 2 || y > 47) return false;
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
  if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) return false;

  return !room.lookForAt(LOOK_STRUCTURES, x, y).some(
    (structure) =>
      structure.structureType !== STRUCTURE_ROAD &&
      structure.structureType !== STRUCTURE_RAMPART,
  );
}

function rankedCoreTiles(room: Room, origin: RoomPosition): BuildTile[] {
  const sources = room.find(FIND_SOURCES);
  const controller = room.controller;
  const tiles: BuildTile[] = [];

  for (let x = Math.max(2, origin.x - 7); x <= Math.min(47, origin.x + 7); x += 1) {
    for (let y = Math.max(2, origin.y - 7); y <= Math.min(47, origin.y + 7); y += 1) {
      if (!isOpenBuildTile(room, x, y)) continue;

      const position = new RoomPosition(x, y, room.name);
      const range = origin.getRangeTo(position);
      if (range < 2 || range > 7) continue;
      if (controller && position.getRangeTo(controller) <= 2) continue;
      if (sources.some((source) => position.getRangeTo(source) <= 1)) continue;

      const swampPenalty = room.getTerrain().get(x, y) === TERRAIN_MASK_SWAMP ? 5 : 0;
      tiles.push({ x, y, score: range * 10 + swampPenalty + x / 100 + y / 10000 });
    }
  }

  return tiles.sort((a, b) => a.score - b.score);
}

function adjacentSourceTile(room: Room, source: Source, reserved: Set<string>): BuildTile | null {
  const candidates: BuildTile[] = [];

  for (let x = source.pos.x - 1; x <= source.pos.x + 1; x += 1) {
    for (let y = source.pos.y - 1; y <= source.pos.y + 1; y += 1) {
      if (x === source.pos.x && y === source.pos.y) continue;
      if (!isOpenBuildTile(room, x, y) || reserved.has(tileKey(x, y))) continue;

      const swampPenalty = room.getTerrain().get(x, y) === TERRAIN_MASK_SWAMP ? 5 : 0;
      candidates.push({ x, y, score: swampPenalty + x / 100 + y / 10000 });
    }
  }

  return candidates.sort((a, b) => a.score - b.score)[0] ?? null;
}

function siteIntent(
  room: Room,
  x: number,
  y: number,
  structureType: BuildableStructureConstant,
  priority: number,
  reason: string,
): Intent {
  return {
    type: "createConstructionSite",
    roomName: room.name,
    x,
    y,
    structureType,
    priority,
    reason,
  };
}

function planRoomConstruction(room: Room): Intent[] {
  const level = room.controller?.level ?? 0;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn || level < 2) return [];

  const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  if (existingSites.length >= MAX_TOTAL_SITES_PER_ROOM) return [];

  const intents: Intent[] = [];
  const reserved = new Set<string>();
  const coreTiles = rankedCoreTiles(room, spawn.pos);

  const existingExtensions = room.find(FIND_MY_STRUCTURES, {
    filter: (structure) => structure.structureType === STRUCTURE_EXTENSION,
  }).length;
  const extensionSites = existingSites.filter(
    (site) => site.structureType === STRUCTURE_EXTENSION,
  ).length;
  const extensionLimit = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][level];
  let missingExtensions = Math.max(0, extensionLimit - existingExtensions - extensionSites);

  for (const tile of coreTiles) {
    if (missingExtensions <= 0) break;
    const key = tileKey(tile.x, tile.y);
    if (reserved.has(key)) continue;
    reserved.add(key);
    intents.push(
      siteIntent(room, tile.x, tile.y, STRUCTURE_EXTENSION, 900, "bootstrap extension capacity"),
    );
    missingExtensions -= 1;
  }

  for (const source of room.find(FIND_SOURCES)) {
    const hasContainer = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (structure) => structure.structureType === STRUCTURE_CONTAINER,
    }).length > 0;
    const hasContainerSite = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 1, {
      filter: (site) => site.structureType === STRUCTURE_CONTAINER,
    }).length > 0;
    if (hasContainer || hasContainerSite) continue;

    const tile = adjacentSourceTile(room, source, reserved);
    if (!tile) continue;
    reserved.add(tileKey(tile.x, tile.y));
    intents.push(
      siteIntent(room, tile.x, tile.y, STRUCTURE_CONTAINER, 850, "source logistics container"),
    );
  }

  if (level >= 3) {
    const existingTowers = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_TOWER,
    }).length;
    const towerSites = existingSites.filter((site) => site.structureType === STRUCTURE_TOWER).length;
    const towerLimit = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][level];

    if (existingTowers + towerSites < towerLimit) {
      const tile = coreTiles.find((candidate) => !reserved.has(tileKey(candidate.x, candidate.y)));
      if (tile) {
        reserved.add(tileKey(tile.x, tile.y));
        intents.push(siteIntent(room, tile.x, tile.y, STRUCTURE_TOWER, 1000, "first defensive tower"));
      }
    }
  }

  if (!hasStructure(room, spawn.pos.x, spawn.pos.y, STRUCTURE_RAMPART) &&
      !hasSite(room, spawn.pos.x, spawn.pos.y, STRUCTURE_RAMPART)) {
    intents.push(
      siteIntent(room, spawn.pos.x, spawn.pos.y, STRUCTURE_RAMPART, 700, "protect primary spawn"),
    );
  }

  if (level >= 3) {
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];
    for (const tower of towers) {
      if (hasStructure(room, tower.pos.x, tower.pos.y, STRUCTURE_RAMPART) ||
          hasSite(room, tower.pos.x, tower.pos.y, STRUCTURE_RAMPART)) {
        continue;
      }
      intents.push(
        siteIntent(room, tower.pos.x, tower.pos.y, STRUCTURE_RAMPART, 700, "protect defensive tower"),
      );
    }
  }

  const existingRoadSites = existingSites.filter((site) => site.structureType === STRUCTURE_ROAD).length;
  let roadBudget = Math.max(0, 10 - existingRoadSites);
  const roadTargets: RoomPosition[] = [
    ...room.find(FIND_SOURCES).map((source) => source.pos),
    ...(room.controller ? [room.controller.pos] : []),
  ];

  for (const target of roadTargets) {
    if (roadBudget <= 0) break;
    const path = room.findPath(spawn.pos, target, {
      ignoreCreeps: true,
      plainCost: 1,
      swampCost: 5,
      maxOps: 2000,
    });

    for (const step of path) {
      if (roadBudget <= 0) break;
      const key = tileKey(step.x, step.y);
      if (reserved.has(key)) continue;
      if (room.getTerrain().get(step.x, step.y) === TERRAIN_MASK_WALL) continue;
      if (hasStructure(room, step.x, step.y, STRUCTURE_ROAD) ||
          hasSite(room, step.x, step.y, STRUCTURE_ROAD)) {
        continue;
      }
      if (room.lookForAt(LOOK_CONSTRUCTION_SITES, step.x, step.y).length > 0) continue;

      reserved.add(key);
      intents.push(siteIntent(room, step.x, step.y, STRUCTURE_ROAD, 300, "bootstrap logistics road"));
      roadBudget -= 1;
    }
  }

  const roomBudget = Math.min(
    MAX_NEW_SITES_PER_ROOM,
    MAX_TOTAL_SITES_PER_ROOM - existingSites.length,
  );

  return intents
    .sort((a, b) => b.priority - a.priority)
    .slice(0, roomBudget);
}

export function planConstruction(world: WorldSnapshot): Intent[] {
  return world.rooms.flatMap(planRoomConstruction);
}
