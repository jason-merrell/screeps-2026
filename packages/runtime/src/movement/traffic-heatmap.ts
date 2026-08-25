export interface TrafficMemory {
  lastDecay: number;
  tiles: Record<string, number>;
}

export interface TrafficTile {
  x: number;
  y: number;
  score: number;
}

const DECAY_INTERVAL = 25;
const DECAY_FACTOR = 0.8;
const MIN_RETAINED_SCORE = 1;
const MAX_TRACKED_TILES = 120;

const keyOf = (x: number, y: number): string => `${x}:${y}`;

function parseKey(key: string): { x: number; y: number } | null {
  const [xRaw, yRaw] = key.split(":");
  const x = Number(xRaw);
  const y = Number(yRaw);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

export function decayTraffic(memory: TrafficMemory, tick: number): void {
  if (tick - memory.lastDecay < DECAY_INTERVAL) return;

  const elapsedIntervals = Math.max(1, Math.floor((tick - memory.lastDecay) / DECAY_INTERVAL));
  const factor = DECAY_FACTOR ** elapsedIntervals;
  for (const [key, value] of Object.entries(memory.tiles)) {
    const next = value * factor;
    if (next < MIN_RETAINED_SCORE) delete memory.tiles[key];
    else memory.tiles[key] = next;
  }
  memory.lastDecay = tick;
}

export function recordTraffic(roomName: string, x: number, y: number, tick: number): void {
  const colony = Memory.colonies[roomName];
  if (!colony) return;

  const traffic = colony.traffic ?? { lastDecay: tick, tiles: {} };
  colony.traffic = traffic;
  decayTraffic(traffic, tick);

  const key = keyOf(x, y);
  traffic.tiles[key] = (traffic.tiles[key] ?? 0) + 1;

  const keys = Object.keys(traffic.tiles);
  if (keys.length <= MAX_TRACKED_TILES) return;

  for (const staleKey of keys
    .sort((a, b) => (traffic.tiles[b] ?? 0) - (traffic.tiles[a] ?? 0) || a.localeCompare(b))
    .slice(MAX_TRACKED_TILES)) {
    delete traffic.tiles[staleKey];
  }
}

export function hotTrafficTiles(roomName: string, minimumScore = 20): TrafficTile[] {
  const traffic = Memory.colonies[roomName]?.traffic;
  if (!traffic) return [];
  decayTraffic(traffic, Game.time);

  return Object.entries(traffic.tiles)
    .flatMap(([key, score]) => {
      const point = parseKey(key);
      return point && score >= minimumScore ? [{ ...point, score }] : [];
    })
    .sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
}
