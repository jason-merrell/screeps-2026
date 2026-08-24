export interface SpawnSiteScore {
  x: number;
  y: number;
  score: number;
  sourceAccess: number;
  controllerAccess: number;
  buildableArea: number;
  exitSafety: number;
  terrainEfficiency: number;
}

export interface SpawnSiteEvaluation {
  roomName: string;
  candidates: SpawnSiteScore[];
}

export interface SpawnAdvisorPoint {
  x: number;
  y: number;
}

const ROOM_SIZE = 50;
const MIN_COORD = 4;
const MAX_COORD = 45;
const INF = Number.POSITIVE_INFINITY;

interface QueueNode extends SpawnAdvisorPoint {
  cost: number;
}

class MinHeap {
  private readonly items: QueueNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: QueueNode): void {
    this.items.push(node);
    let index = this.items.length - 1;

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].cost <= this.items[index].cost) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  pop(): QueueNode | undefined {
    if (this.items.length === 0) return undefined;
    if (this.items.length === 1) return this.items.pop();

    const root = this.items[0];
    const tail = this.items.pop();
    if (!tail) return root;
    this.items[0] = tail;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.items.length && this.items[left].cost < this.items[smallest].cost) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right].cost < this.items[smallest].cost) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.items[index], this.items[smallest]] = [
        this.items[smallest],
        this.items[index],
      ];
      index = smallest;
    }

    return root;
  }
}

const indexOf = (x: number, y: number): number => y * ROOM_SIZE + x;

const isInside = (x: number, y: number): boolean =>
  x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE;

const isWall = (terrain: RoomTerrain, x: number, y: number): boolean =>
  terrain.get(x, y) === TERRAIN_MASK_WALL;

const movementCost = (terrain: RoomTerrain, x: number, y: number): number =>
  terrain.get(x, y) === TERRAIN_MASK_SWAMP ? 5 : 1;

const neighbors = (x: number, y: number): SpawnAdvisorPoint[] => {
  const result: SpawnAdvisorPoint[] = [];

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;

      const nx = x + dx;
      const ny = y + dy;
      if (isInside(nx, ny)) result.push({ x: nx, y: ny });
    }
  }

  return result;
};

const buildDistanceField = (
  terrain: RoomTerrain,
  goals: SpawnAdvisorPoint[],
): Float64Array => {
  const distance = new Float64Array(ROOM_SIZE * ROOM_SIZE);
  distance.fill(INF);

  const open = new MinHeap();

  for (const goal of goals) {
    if (isWall(terrain, goal.x, goal.y)) continue;
    const index = indexOf(goal.x, goal.y);
    distance[index] = 0;
    open.push({ ...goal, cost: 0 });
  }

  while (open.size > 0) {
    const current = open.pop();
    if (!current) break;
    if (current.cost !== distance[indexOf(current.x, current.y)]) continue;

    for (const next of neighbors(current.x, current.y)) {
      if (isWall(terrain, next.x, next.y)) continue;

      const nextIndex = indexOf(next.x, next.y);
      const nextCost = current.cost + movementCost(terrain, next.x, next.y);
      if (nextCost >= distance[nextIndex]) continue;

      distance[nextIndex] = nextCost;
      open.push({ ...next, cost: nextCost });
    }
  }

  return distance;
};

const adjacentWalkable = (
  terrain: RoomTerrain,
  pos: SpawnAdvisorPoint,
): SpawnAdvisorPoint[] =>
  neighbors(pos.x, pos.y).filter(({ x, y }) => !isWall(terrain, x, y));

const normalizedAccess = (cost: number, ceiling: number): number => {
  if (!Number.isFinite(cost)) return 0;
  return Math.max(0, 1 - cost / ceiling);
};

const localTerrain = (
  terrain: RoomTerrain,
  x: number,
  y: number,
  radius: number,
): { walkable: number; swamp: number; total: number } => {
  let walkable = 0;
  let swamp = 0;
  let total = 0;

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const px = x + dx;
      const py = y + dy;
      if (!isInside(px, py)) continue;

      total += 1;
      const value = terrain.get(px, py);
      if (value === TERRAIN_MASK_WALL) continue;

      walkable += 1;
      if (value === TERRAIN_MASK_SWAMP) swamp += 1;
    }
  }

  return { walkable, swamp, total };
};

const isOccupiedByAnchor = (
  x: number,
  y: number,
  sources: SpawnAdvisorPoint[],
  controller: SpawnAdvisorPoint,
): boolean =>
  (controller.x === x && controller.y === y) ||
  sources.some((source) => source.x === x && source.y === y);

const validatePoint = (label: string, point: SpawnAdvisorPoint): void => {
  if (!isInside(point.x, point.y)) {
    throw new Error(`${label} (${point.x},${point.y}) is outside the room.`);
  }
};

export const evaluateSpawnSitesFromAnchors = (
  roomName: string,
  sources: SpawnAdvisorPoint[],
  controller: SpawnAdvisorPoint,
  limit = 10,
): SpawnSiteEvaluation => {
  if (sources.length === 0) {
    throw new Error("Spawn advisor requires at least one source position.");
  }

  sources.forEach((source, index) => validatePoint(`Source ${index + 1}`, source));
  validatePoint("Controller", controller);

  const terrain = Game.map.getRoomTerrain(roomName);
  const sourceFields = sources.map((source) =>
    buildDistanceField(terrain, adjacentWalkable(terrain, source)),
  );
  const controllerField = buildDistanceField(
    terrain,
    adjacentWalkable(terrain, controller),
  );

  const candidates: SpawnSiteScore[] = [];

  for (let x = MIN_COORD; x <= MAX_COORD; x += 1) {
    for (let y = MIN_COORD; y <= MAX_COORD; y += 1) {
      if (isWall(terrain, x, y)) continue;
      if (isOccupiedByAnchor(x, y, sources, controller)) continue;

      const index = indexOf(x, y);
      const sourceCost =
        sourceFields.reduce((sum, field) => sum + field[index], 0) /
        sourceFields.length;
      const controllerCost = controllerField[index];

      const radius4 = localTerrain(terrain, x, y, 4);
      const radius3 = localTerrain(terrain, x, y, 3);
      const buildableArea = radius4.total === 0 ? 0 : radius4.walkable / radius4.total;
      const terrainEfficiency =
        radius3.walkable === 0 ? 0 : 1 - radius3.swamp / radius3.walkable;
      const edgeDistance = Math.min(x, y, ROOM_SIZE - 1 - x, ROOM_SIZE - 1 - y);
      const exitSafety = Math.min(edgeDistance / 15, 1);

      const sourceAccess = normalizedAccess(sourceCost, 80);
      const controllerAccess = normalizedAccess(controllerCost, 100);
      const score =
        sourceAccess * 0.35 +
        controllerAccess * 0.15 +
        buildableArea * 0.25 +
        exitSafety * 0.15 +
        terrainEfficiency * 0.1;

      candidates.push({
        x,
        y,
        score: Number((score * 100).toFixed(1)),
        sourceAccess: Number((sourceAccess * 100).toFixed(1)),
        controllerAccess: Number((controllerAccess * 100).toFixed(1)),
        buildableArea: Number((buildableArea * 100).toFixed(1)),
        exitSafety: Number((exitSafety * 100).toFixed(1)),
        terrainEfficiency: Number((terrainEfficiency * 100).toFixed(1)),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);

  return {
    roomName,
    candidates: candidates.slice(0, Math.max(1, limit)),
  };
};

export const evaluateSpawnSites = (
  roomName: string,
  limit = 10,
): SpawnSiteEvaluation => {
  const room = Game.rooms[roomName];
  if (!room) {
    throw new Error(
      `Spawn advisor needs vision in ${roomName}. For an initial spawn, use spawnAdvisorOffline with map coordinates.`,
    );
  }

  const controller = room.controller;
  if (!controller) {
    throw new Error(`${roomName} has no controller and is not a valid owned-room candidate.`);
  }

  const sources = room.find(FIND_SOURCES);
  if (sources.length === 0) {
    throw new Error(`${roomName} has no visible energy sources.`);
  }

  return evaluateSpawnSitesFromAnchors(
    roomName,
    sources.map((source) => ({ x: source.pos.x, y: source.pos.y })),
    { x: controller.pos.x, y: controller.pos.y },
    limit,
  );
};
