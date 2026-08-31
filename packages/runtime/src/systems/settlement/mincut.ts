import type { PlannedPoint } from "../../planning/room-plan";

const ROOM_SIZE = 50;
const TILE_COUNT = ROOM_SIZE * ROOM_SIZE;
const SOURCE = TILE_COUNT * 2;
const SINK = SOURCE + 1;
const NODE_COUNT = SINK + 1;

const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

interface FlowEdge {
  to: number;
  reverse: number;
  capacity: number;
}

export type DefensivePerimeterFailure =
  | "empty-protected-set"
  | "invalid-protected-tile"
  | "invalid-uncuttable-tile"
  | "no-room-exits"
  | "unserviceable-core"
  | "unseparable"
  | "oversized-perimeter"
  | "empty-perimeter"
  | "failed-separation";

export interface DefensivePerimeterOptions {
  /** Tiles that cannot receive a planned rampart, such as natural objects. */
  uncuttableTiles?: readonly PlannedPoint[];
  /** Hard cap on the number of ramparts the room may be asked to maintain. */
  maxPerimeterTiles?: number;
}

export interface DefensivePerimeterDiagnostics {
  walkableTiles: number;
  graphEdges: number;
  bfsPhases: number;
  augmentingPaths: number;
  maxFlow: number;
}

export interface DefensivePerimeterResult {
  perimeter: PlannedPoint[];
  failure: DefensivePerimeterFailure | null;
  diagnostics: DefensivePerimeterDiagnostics;
}

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined)
    throw new Error(`Missing flow item at index ${index}`);
  return item;
}

function integerAt(items: Int32Array, index: number): number {
  const item = items[index];
  if (item === undefined)
    throw new Error(`Missing flow integer at index ${index}`);
  return item;
}

const inBounds = (x: number, y: number): boolean =>
  x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE;

const isExit = (x: number, y: number): boolean =>
  x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1;

const tileIndex = (x: number, y: number): number => y * ROOM_SIZE + x;
const inNode = (tile: number): number => tile * 2;
const outNode = (tile: number): number => tile * 2 + 1;

class Dinic {
  readonly #graph: FlowEdge[][] = Array.from({ length: NODE_COUNT }, () => []);
  readonly #level = new Int32Array(NODE_COUNT);
  readonly #nextEdge = new Int32Array(NODE_COUNT);
  #forwardEdges = 0;
  #bfsPhases = 0;
  #augmentingPaths = 0;

  get diagnostics(): Pick<
    DefensivePerimeterDiagnostics,
    "graphEdges" | "bfsPhases" | "augmentingPaths"
  > {
    return {
      graphEdges: this.#forwardEdges,
      bfsPhases: this.#bfsPhases,
      augmentingPaths: this.#augmentingPaths,
    };
  }

  addEdge(from: number, to: number, capacity: number): void {
    const fromEdges = itemAt(this.#graph, from);
    const toEdges = itemAt(this.#graph, to);
    const forward: FlowEdge = {
      to,
      reverse: toEdges.length,
      capacity,
    };
    const reverse: FlowEdge = {
      to: from,
      reverse: fromEdges.length,
      capacity: 0,
    };
    fromEdges.push(forward);
    toEdges.push(reverse);
    this.#forwardEdges += 1;
  }

  maxFlow(source: number, sink: number, limit: number): number {
    let total = 0;
    while (total < limit && this.#buildLevels(source, sink)) {
      this.#nextEdge.fill(0);
      while (total < limit) {
        const pushed = this.#sendFlow(source, sink, limit - total);
        if (pushed === 0) break;
        this.#augmentingPaths += 1;
        total += pushed;
      }
    }
    return total;
  }

  reachableFrom(source: number): Uint8Array {
    const reachable = new Uint8Array(NODE_COUNT);
    const queue = new Int32Array(NODE_COUNT);
    let head = 0;
    let tail = 0;
    reachable[source] = 1;
    queue[tail] = source;
    tail += 1;

    while (head < tail) {
      const node = integerAt(queue, head);
      head += 1;
      for (const edge of itemAt(this.#graph, node)) {
        if (edge.capacity <= 0 || reachable[edge.to] === 1) continue;
        reachable[edge.to] = 1;
        queue[tail] = edge.to;
        tail += 1;
      }
    }
    return reachable;
  }

  #buildLevels(source: number, sink: number): boolean {
    this.#bfsPhases += 1;
    this.#level.fill(-1);
    const queue = new Int32Array(NODE_COUNT);
    let head = 0;
    let tail = 0;
    this.#level[source] = 0;
    queue[tail] = source;
    tail += 1;

    while (head < tail) {
      const node = integerAt(queue, head);
      head += 1;
      for (const edge of itemAt(this.#graph, node)) {
        if (edge.capacity <= 0 || this.#level[edge.to] !== -1) continue;
        this.#level[edge.to] = integerAt(this.#level, node) + 1;
        queue[tail] = edge.to;
        tail += 1;
      }
    }
    return this.#level[sink] !== -1;
  }

  #sendFlow(node: number, sink: number, available: number): number {
    if (node === sink) return available;
    const edges = itemAt(this.#graph, node);

    while (integerAt(this.#nextEdge, node) < edges.length) {
      const edgeIndex = integerAt(this.#nextEdge, node);
      const edge = itemAt(edges, edgeIndex);
      if (
        edge.capacity > 0 &&
        this.#level[edge.to] === integerAt(this.#level, node) + 1
      ) {
        const pushed = this.#sendFlow(
          edge.to,
          sink,
          Math.min(available, edge.capacity),
        );
        if (pushed > 0) {
          edge.capacity -= pushed;
          const reverse = itemAt(itemAt(this.#graph, edge.to), edge.reverse);
          reverse.capacity += pushed;
          return pushed;
        }
      }
      this.#nextEdge[node] = edgeIndex + 1;
    }
    return 0;
  }
}

const emptyDiagnostics = (
  walkableTiles = 0,
): DefensivePerimeterDiagnostics => ({
  walkableTiles,
  graphEdges: 0,
  bfsPhases: 0,
  augmentingPaths: 0,
  maxFlow: 0,
});

function failedResult(
  failure: DefensivePerimeterFailure,
  diagnostics = emptyDiagnostics(),
): DefensivePerimeterResult {
  return { perimeter: [], failure, diagnostics };
}

function validatesSeparation(
  walkable: Uint8Array,
  exitTiles: readonly number[],
  protectedTiles: ReadonlySet<number>,
  perimeterTiles: ReadonlySet<number>,
): boolean {
  const visited = new Uint8Array(TILE_COUNT);
  const queue = new Int32Array(TILE_COUNT);
  let head = 0;
  let tail = 0;

  for (const exit of exitTiles) {
    if (perimeterTiles.has(exit) || visited[exit] === 1) continue;
    visited[exit] = 1;
    queue[tail] = exit;
    tail += 1;
  }

  while (head < tail) {
    const current = integerAt(queue, head);
    head += 1;
    if (protectedTiles.has(current)) return false;
    const x = current % ROOM_SIZE;
    const y = Math.floor(current / ROOM_SIZE);

    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (!inBounds(nextX, nextY)) continue;
      const next = tileIndex(nextX, nextY);
      if (
        walkable[next] !== 1 ||
        visited[next] === 1 ||
        perimeterTiles.has(next)
      ) {
        continue;
      }
      visited[next] = 1;
      queue[tail] = next;
      tail += 1;
    }
  }

  return true;
}

function exitsReachEveryProtected(
  walkable: Uint8Array,
  exitTiles: readonly number[],
  protectedTiles: ReadonlySet<number>,
): boolean {
  const visited = new Uint8Array(TILE_COUNT);
  const queue = new Int32Array(TILE_COUNT);
  let head = 0;
  let tail = 0;

  for (const exit of exitTiles) {
    if (visited[exit] === 1) continue;
    visited[exit] = 1;
    queue[tail] = exit;
    tail += 1;
  }

  while (head < tail) {
    const current = integerAt(queue, head);
    head += 1;
    const x = current % ROOM_SIZE;
    const y = Math.floor(current / ROOM_SIZE);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (!inBounds(nextX, nextY)) continue;
      const next = tileIndex(nextX, nextY);
      if (walkable[next] !== 1 || visited[next] === 1) continue;
      visited[next] = 1;
      queue[tail] = next;
      tail += 1;
    }
  }

  return [...protectedTiles].every((tile) => visited[tile] === 1);
}

/**
 * Derive the minimum set of walkable interior tiles that separates every room
 * exit from the protected footprint under Screeps' eight-direction movement.
 *
 * Tiles use unit vertex capacity while exits and protected tiles use a capacity
 * larger than every finite room cut. The residual graph after max-flow therefore
 * exposes an actual minimum vertex cut, not a geometric ring heuristic.
 */
export function deriveDefensivePerimeterResult(
  room: Room,
  protectedTiles: readonly PlannedPoint[],
  options: DefensivePerimeterOptions = {},
): DefensivePerimeterResult {
  if (protectedTiles.length === 0) return failedResult("empty-protected-set");
  const maxPerimeterTiles = options.maxPerimeterTiles ?? TILE_COUNT;
  if (!Number.isInteger(maxPerimeterTiles) || maxPerimeterTiles < 1) {
    return failedResult("oversized-perimeter");
  }

  const terrain = room.getTerrain();
  const walkable = new Uint8Array(TILE_COUNT);
  const protectedIndexes = new Set<number>();
  const explicitlyUncuttable = new Set<number>();
  let walkableCount = 0;

  for (let y = 0; y < ROOM_SIZE; y += 1) {
    for (let x = 0; x < ROOM_SIZE; x += 1) {
      const index = tileIndex(x, y);
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      walkable[index] = 1;
      walkableCount += 1;
    }
  }

  for (const point of protectedTiles) {
    if (
      !Number.isInteger(point.x) ||
      !Number.isInteger(point.y) ||
      !inBounds(point.x, point.y)
    ) {
      return failedResult(
        "invalid-protected-tile",
        emptyDiagnostics(walkableCount),
      );
    }
    const index = tileIndex(point.x, point.y);
    if (walkable[index] !== 1 || isExit(point.x, point.y)) {
      return failedResult(
        "invalid-protected-tile",
        emptyDiagnostics(walkableCount),
      );
    }
    protectedIndexes.add(index);
  }
  if (protectedIndexes.size === 0) {
    return failedResult("empty-protected-set", emptyDiagnostics(walkableCount));
  }

  for (const point of options.uncuttableTiles ?? []) {
    if (
      !Number.isInteger(point.x) ||
      !Number.isInteger(point.y) ||
      !inBounds(point.x, point.y)
    ) {
      return failedResult(
        "invalid-uncuttable-tile",
        emptyDiagnostics(walkableCount),
      );
    }
    const index = tileIndex(point.x, point.y);
    if (walkable[index] === 1) explicitlyUncuttable.add(index);
  }

  const exitTiles: number[] = [];
  for (let y = 0; y < ROOM_SIZE; y += 1) {
    for (let x = 0; x < ROOM_SIZE; x += 1) {
      if (!isExit(x, y)) continue;
      const index = tileIndex(x, y);
      if (walkable[index] === 1) exitTiles.push(index);
    }
  }
  if (exitTiles.length === 0) {
    return failedResult("no-room-exits", emptyDiagnostics(walkableCount));
  }
  if (!exitsReachEveryProtected(walkable, exitTiles, protectedIndexes)) {
    return failedResult("unserviceable-core", emptyDiagnostics(walkableCount));
  }

  const allCuttableTiles = new Set<number>();
  for (let y = 1; y < ROOM_SIZE - 1; y += 1) {
    for (let x = 1; x < ROOM_SIZE - 1; x += 1) {
      const index = tileIndex(x, y);
      if (
        walkable[index] === 1 &&
        !protectedIndexes.has(index) &&
        !explicitlyUncuttable.has(index)
      ) {
        allCuttableTiles.add(index);
      }
    }
  }
  if (
    !validatesSeparation(
      walkable,
      exitTiles,
      protectedIndexes,
      allCuttableTiles,
    )
  ) {
    return failedResult("unseparable", emptyDiagnostics(walkableCount));
  }

  const infiniteCapacity = walkableCount + 1;
  const flow = new Dinic();

  for (let y = 0; y < ROOM_SIZE; y += 1) {
    for (let x = 0; x < ROOM_SIZE; x += 1) {
      const index = tileIndex(x, y);
      if (walkable[index] !== 1) continue;
      const uncuttable =
        isExit(x, y) ||
        protectedIndexes.has(index) ||
        explicitlyUncuttable.has(index);
      flow.addEdge(
        inNode(index),
        outNode(index),
        uncuttable ? infiniteCapacity : 1,
      );

      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (!inBounds(nextX, nextY)) continue;
        const next = tileIndex(nextX, nextY);
        if (walkable[next] !== 1) continue;
        flow.addEdge(outNode(index), inNode(next), infiniteCapacity);
      }
    }
  }

  for (const exit of exitTiles) {
    flow.addEdge(SOURCE, inNode(exit), infiniteCapacity);
  }
  for (const protectedTile of protectedIndexes) {
    flow.addEdge(outNode(protectedTile), SINK, infiniteCapacity);
  }

  // Any finite vertex cut costs at most one per walkable tile. Reaching this
  // sentinel means the footprint cannot be separated without cutting an exit
  // or protected tile, so fail closed rather than returning a partial barrier.
  const flowLimit = Math.min(infiniteCapacity, maxPerimeterTiles + 1);
  const maxFlow = flow.maxFlow(SOURCE, SINK, flowLimit);
  const diagnostics: DefensivePerimeterDiagnostics = {
    walkableTiles: walkableCount,
    ...flow.diagnostics,
    maxFlow,
  };
  if (maxFlow >= flowLimit) {
    return failedResult(
      flowLimit < infiniteCapacity ? "oversized-perimeter" : "unseparable",
      diagnostics,
    );
  }

  const reachable = flow.reachableFrom(SOURCE);
  const perimeter: PlannedPoint[] = [];
  const perimeterIndexes = new Set<number>();
  for (let x = 1; x < ROOM_SIZE - 1; x += 1) {
    for (let y = 1; y < ROOM_SIZE - 1; y += 1) {
      const index = tileIndex(x, y);
      if (
        walkable[index] !== 1 ||
        protectedIndexes.has(index) ||
        reachable[inNode(index)] !== 1 ||
        reachable[outNode(index)] === 1
      ) {
        continue;
      }
      perimeter.push({ x, y });
      perimeterIndexes.add(index);
    }
  }

  if (perimeter.length === 0) {
    return failedResult("empty-perimeter", diagnostics);
  }
  if (
    !validatesSeparation(
      walkable,
      exitTiles,
      protectedIndexes,
      perimeterIndexes,
    )
  ) {
    return failedResult("failed-separation", diagnostics);
  }
  return { perimeter, failure: null, diagnostics };
}

export function deriveDefensivePerimeter(
  room: Room,
  protectedTiles: readonly PlannedPoint[],
  options: DefensivePerimeterOptions = {},
): PlannedPoint[] {
  return deriveDefensivePerimeterResult(room, protectedTiles, options)
    .perimeter;
}
