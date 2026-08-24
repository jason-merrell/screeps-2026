const ROOM_SIZE = 50;
const MIN_COORD = 4;
const MAX_COORD = 45;
const INF = Number.POSITIVE_INFINITY;

const indexOf = (x, y) => y * ROOM_SIZE + x;
const isInside = (x, y) => x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE;

const terrainValue = (terrain, x, y) => {
  const value = Number(terrain[indexOf(x, y)]);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid encoded terrain at (${x},${y})`);
  }
  return value;
};

const isWall = (terrain, x, y) => (terrainValue(terrain, x, y) & 1) !== 0;
const movementCost = (terrain, x, y) =>
  (terrainValue(terrain, x, y) & 2) !== 0 ? 5 : 1;

const neighbors = (x, y) => {
  const result = [];
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

class MinHeap {
  #items = [];

  get size() {
    return this.#items.length;
  }

  push(node) {
    this.#items.push(node);
    let index = this.#items.length - 1;

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#items[parent].cost <= this.#items[index].cost) break;
      [this.#items[parent], this.#items[index]] = [this.#items[index], this.#items[parent]];
      index = parent;
    }
  }

  pop() {
    if (this.#items.length === 0) return undefined;
    if (this.#items.length === 1) return this.#items.pop();

    const root = this.#items[0];
    this.#items[0] = this.#items.pop();

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.#items.length && this.#items[left].cost < this.#items[smallest].cost) {
        smallest = left;
      }
      if (right < this.#items.length && this.#items[right].cost < this.#items[smallest].cost) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.#items[index], this.#items[smallest]] = [
        this.#items[smallest],
        this.#items[index],
      ];
      index = smallest;
    }

    return root;
  }
}

const adjacentWalkable = (terrain, point) =>
  neighbors(point.x, point.y).filter(({ x, y }) => !isWall(terrain, x, y));

const buildDistanceField = (terrain, goals) => {
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

const localTerrain = (terrain, x, y, radius) => {
  let walkable = 0;
  let swamp = 0;
  let total = 0;

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const px = x + dx;
      const py = y + dy;
      if (!isInside(px, py)) continue;
      total += 1;
      const value = terrainValue(terrain, px, py);
      if ((value & 1) !== 0) continue;
      walkable += 1;
      if ((value & 2) !== 0) swamp += 1;
    }
  }

  return { walkable, swamp, total };
};

const normalizedAccess = (cost, ceiling) => {
  if (!Number.isFinite(cost)) return 0;
  return Math.max(0, 1 - cost / ceiling);
};

const validateRoom = ({ room, terrain, sources, controller }) => {
  if (!/^[WE]\d+[NS]\d+$/.test(room)) throw new Error(`Invalid room '${room}'`);
  if (typeof terrain !== "string" || terrain.length !== ROOM_SIZE * ROOM_SIZE) {
    throw new Error(`${room} must provide exactly 2500 encoded terrain cells`);
  }
  if (!controller || !Number.isInteger(controller.x) || !Number.isInteger(controller.y)) {
    throw new Error(`${room} is missing a valid controller position`);
  }
  if (!Array.isArray(sources) || sources.length < 2) {
    throw new Error(`${room} requires at least two sources`);
  }
};

export const evaluateStartRoom = (candidate, limit = 5) => {
  validateRoom(candidate);
  const { room, shard, terrain, sources, controller } = candidate;
  const sourceFields = sources.map((source) =>
    buildDistanceField(terrain, adjacentWalkable(terrain, source)),
  );
  const controllerField = buildDistanceField(
    terrain,
    adjacentWalkable(terrain, controller),
  );
  const anchors = new Set([
    `${controller.x},${controller.y}`,
    ...sources.map((source) => `${source.x},${source.y}`),
  ]);
  const spawnSites = [];

  for (let x = MIN_COORD; x <= MAX_COORD; x += 1) {
    for (let y = MIN_COORD; y <= MAX_COORD; y += 1) {
      if (isWall(terrain, x, y) || anchors.has(`${x},${y}`)) continue;
      const index = indexOf(x, y);
      const sourceCost =
        sourceFields.reduce((sum, field) => sum + field[index], 0) / sourceFields.length;
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

      spawnSites.push({
        x,
        y,
        score: Number((score * 100).toFixed(1)),
        sourceAccess: Number((sourceAccess * 100).toFixed(1)),
        controllerAccess: Number((controllerAccess * 100).toFixed(1)),
        buildableArea: Number((buildableArea * 100).toFixed(1)),
        exitSafety: Number((exitSafety * 100).toFixed(1)),
        terrainEfficiency: Number((terrainEfficiency * 100).toFixed(1)),
        sourcePathCost: Number(sourceCost.toFixed(1)),
        controllerPathCost: Number(controllerCost.toFixed(1)),
      });
    }
  }

  spawnSites.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
  const bestSpawn = spawnSites[0] || null;

  return {
    room,
    shard,
    score: bestSpawn?.score ?? 0,
    bestSpawn,
    spawnSites: spawnSites.slice(0, Math.max(1, limit)),
    controller: {
      x: controller.x,
      y: controller.y,
      sign: controller.sign || null,
    },
    sources: sources.map(({ x, y, energyCapacity }) => ({ x, y, energyCapacity })),
  };
};

export const rankStartRooms = (candidates, limit = 5) =>
  candidates
    .map((candidate) => evaluateStartRoom(candidate, limit))
    .sort((a, b) => b.score - a.score || a.room.localeCompare(b.room));
