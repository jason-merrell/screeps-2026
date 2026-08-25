export const ROOM_SIZE = 50;
export const BLOCKED_COST = 0xff;
const UNREACHABLE = 0xffff_ffff;

export interface GridPoint {
  x: number;
  y: number;
}

const indexOf = (x: number, y: number): number => y * ROOM_SIZE + x;

class MinHeap {
  private readonly nodes: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, priority: number): void {
    let index = this.nodes.length;
    this.nodes.push(node);
    this.priorities.push(priority);

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.priorities[parent] <= priority) break;

      this.nodes[index] = this.nodes[parent];
      this.priorities[index] = this.priorities[parent];
      index = parent;
    }

    this.nodes[index] = node;
    this.priorities[index] = priority;
  }

  pop(): { node: number; priority: number } | null {
    if (this.nodes.length === 0) return null;

    const node = this.nodes[0];
    const priority = this.priorities[0];
    const lastNode = this.nodes.pop() as number;
    const lastPriority = this.priorities.pop() as number;

    if (this.nodes.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.nodes.length) break;

        let child = left;
        if (
          right < this.nodes.length &&
          this.priorities[right] < this.priorities[left]
        ) {
          child = right;
        }

        if (this.priorities[child] >= lastPriority) break;
        this.nodes[index] = this.nodes[child];
        this.priorities[index] = this.priorities[child];
        index = child;
      }

      this.nodes[index] = lastNode;
      this.priorities[index] = lastPriority;
    }

    return { node, priority };
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
    if (costs[index] === BLOCKED_COST || distances[index] === 0) continue;
    distances[index] = 0;
    queue.push(index, 0);
  }

  while (queue.size > 0) {
    const current = queue.pop();
    if (!current || current.priority !== distances[current.node]) continue;

    const x = current.node % ROOM_SIZE;
    const y = Math.floor(current.node / ROOM_SIZE);
    const enterCurrentCost = costs[current.node];

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
        if (costs[predecessor] === BLOCKED_COST) continue;

        const candidate = current.priority + enterCurrentCost;
        if (candidate >= distances[predecessor]) continue;
        distances[predecessor] = candidate;
        queue.push(predecessor, candidate);
      }
    }
  }

  return distances;
}

export function flowDistanceAt(distances: Uint32Array, x: number, y: number): number {
  if (x < 0 || x >= ROOM_SIZE || y < 0 || y >= ROOM_SIZE) return UNREACHABLE;
  return distances[indexOf(x, y)];
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
      const cost = costs[index];
      if (cost === BLOCKED_COST) continue;
      const distance = distances[index];
      if (distance === UNREACHABLE) continue;

      const score = distance + cost;
      if (score > currentDistance || score >= bestScore) continue;
      best = { x, y };
      bestScore = score;
    }
  }

  return best;
}
