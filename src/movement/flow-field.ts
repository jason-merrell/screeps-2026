export const ROOM_SIZE = 50;
export const BLOCKED_COST = 0xff;
const UNREACHABLE = 0xffff_ffff;

export interface GridPoint {
  x: number;
  y: number;
}

interface HeapEntry {
  node: number;
  priority: number;
}

const indexOf = (x: number, y: number): number => y * ROOM_SIZE + x;

const numericAt = (values: ArrayLike<number>, index: number): number => {
  const value = values[index];
  if (value === undefined) throw new Error(`missing numeric value at index ${index}`);
  return value;
};

const entryAt = (entries: readonly HeapEntry[], index: number): HeapEntry => {
  const entry = entries[index];
  if (!entry) throw new Error(`missing heap entry at index ${index}`);
  return entry;
};

class MinHeap {
  private readonly entries: HeapEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(node: number, priority: number): void {
    const entry = { node, priority };
    let index = this.entries.length;
    this.entries.push(entry);

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentEntry = entryAt(this.entries, parent);
      if (parentEntry.priority <= priority) break;
      this.entries[index] = parentEntry;
      index = parent;
    }

    this.entries[index] = entry;
  }

  pop(): HeapEntry | null {
    const root = this.entries[0];
    if (!root) return null;

    const last = this.entries.pop();
    if (!last) return null;
    if (this.entries.length === 0) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;

      let child = left;
      const leftEntry = entryAt(this.entries, left);
      if (right < this.entries.length) {
        const rightEntry = entryAt(this.entries, right);
        if (rightEntry.priority < leftEntry.priority) child = right;
      }

      const childEntry = entryAt(this.entries, child);
      if (childEntry.priority >= last.priority) break;
      this.entries[index] = childEntry;
      index = child;
    }

    this.entries[index] = last;
    return root;
  }
}

export function buildFlowField(costs: Uint8Array, goals: readonly GridPoint[]): Uint32Array {
  if (costs.length !== ROOM_SIZE * ROOM_SIZE) {
    throw new Error(`flow-field costs must contain ${ROOM_SIZE * ROOM_SIZE} cells`);
  }

  const distances = new Uint32Array(ROOM_SIZE * ROOM_SIZE);
  distances.fill(UNREACHABLE);
  const queue = new MinHeap();

  for (const goal of goals) {
    if (goal.x < 0 || goal.x >= ROOM_SIZE || goal.y < 0 || goal.y >= ROOM_SIZE) continue;
    const index = indexOf(goal.x, goal.y);
    if (numericAt(costs, index) === BLOCKED_COST || numericAt(distances, index) === 0) continue;
    distances[index] = 0;
    queue.push(index, 0);
  }

  while (queue.size > 0) {
    const current = queue.pop();
    if (!current || current.priority !== numericAt(distances, current.node)) continue;

    const x = current.node % ROOM_SIZE;
    const y = Math.floor(current.node / ROOM_SIZE);
    const enterCurrentCost = numericAt(costs, current.node);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const predecessorX = x + dx;
        const predecessorY = y + dy;
        if (
          predecessorX < 0 ||
          predecessorX >= ROOM_SIZE ||
          predecessorY < 0 ||
          predecessorY >= ROOM_SIZE
        ) {
          continue;
        }

        const predecessor = indexOf(predecessorX, predecessorY);
        if (numericAt(costs, predecessor) === BLOCKED_COST) continue;

        const candidate = current.priority + enterCurrentCost;
        if (candidate >= numericAt(distances, predecessor)) continue;
        distances[predecessor] = candidate;
        queue.push(predecessor, candidate);
      }
    }
  }

  return distances;
}

export function flowDistanceAt(distances: Uint32Array, x: number, y: number): number {
  if (x < 0 || x >= ROOM_SIZE || y < 0 || y >= ROOM_SIZE) return UNREACHABLE;
  return numericAt(distances, indexOf(x, y));
}

export function chooseFlowStep(
  distances: Uint32Array,
  costs: Uint8Array,
  origin: GridPoint,
  reserved: ReadonlySet<string> = new Set<string>(),
): GridPoint | null {
  const currentDistance = flowDistanceAt(distances, origin.x, origin.y);
  if (currentDistance === 0 || currentDistance === UNREACHABLE) return null;

  let best: GridPoint | null = null;
  let bestScore = UNREACHABLE;

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (x < 0 || x >= ROOM_SIZE || y < 0 || y >= ROOM_SIZE) continue;
      if (reserved.has(`${x}:${y}`)) continue;

      const index = indexOf(x, y);
      const cost = numericAt(costs, index);
      if (cost === BLOCKED_COST) continue;
      const distance = numericAt(distances, index);
      if (distance === UNREACHABLE) continue;

      const score = distance + cost;
      if (score > currentDistance || score >= bestScore) continue;
      best = { x, y };
      bestScore = score;
    }
  }

  return best;
}
