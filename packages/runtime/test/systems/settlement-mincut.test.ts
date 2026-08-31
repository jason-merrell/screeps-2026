import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedPoint } from "../../src/planning/room-plan";
import {
  deriveDefensivePerimeter,
  deriveDefensivePerimeterResult,
} from "../../src/systems/settlement/mincut";

const WALL = 1;
const ROOM_SIZE = 50;
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

const key = (point: PlannedPoint): string => `${point.x}:${point.y}`;

function mockRoom(walkable: ReadonlySet<string> | "all"): Room {
  return {
    getTerrain: () => ({
      get: (x: number, y: number) =>
        walkable === "all" || walkable.has(`${x}:${y}`) ? 0 : WALL,
    }),
  } as unknown as Room;
}

function exitsReachProtected(
  walkable: ReadonlySet<string>,
  protectedTiles: readonly PlannedPoint[],
  perimeter: readonly PlannedPoint[],
): boolean {
  const blocked = new Set(perimeter.map(key));
  const protectedKeys = new Set(protectedTiles.map(key));
  const queue: PlannedPoint[] = [];
  const visited = new Set<string>();

  for (let index = 0; index < ROOM_SIZE; index += 1) {
    for (const point of [
      { x: 0, y: index },
      { x: ROOM_SIZE - 1, y: index },
      { x: index, y: 0 },
      { x: index, y: ROOM_SIZE - 1 },
    ]) {
      const pointKey = key(point);
      if (
        !walkable.has(pointKey) ||
        blocked.has(pointKey) ||
        visited.has(pointKey)
      ) {
        continue;
      }
      visited.add(pointKey);
      queue.push(point);
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const point = queue[head];
    if (!point) throw new Error(`Missing queued point at index ${head}`);
    if (protectedKeys.has(key(point))) return true;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const next = { x: point.x + dx, y: point.y + dy };
      const nextKey = key(next);
      if (
        next.x < 0 ||
        next.x >= ROOM_SIZE ||
        next.y < 0 ||
        next.y >= ROOM_SIZE ||
        !walkable.has(nextKey) ||
        blocked.has(nextKey) ||
        visited.has(nextKey)
      ) {
        continue;
      }
      visited.add(nextKey);
      queue.push(next);
    }
  }
  return false;
}

describe("terrain-aware defensive min-cut", () => {
  beforeEach(() => {
    vi.stubGlobal("TERRAIN_MASK_WALL", WALL);
  });

  it("cuts topology choke points instead of drawing a cosmetic asset ring", () => {
    const walkable = new Set<string>();
    for (const y of [20, 30]) {
      for (let x = 0; x <= 24; x += 1) walkable.add(`${x}:${y}`);
    }
    const protectedTiles = [
      { x: 24, y: 20 },
      { x: 24, y: 30 },
    ];
    const room = mockRoom(walkable);

    const perimeter = deriveDefensivePerimeter(room, protectedTiles);

    expect(perimeter).toEqual([
      { x: 1, y: 20 },
      { x: 1, y: 30 },
    ]);
    expect(
      deriveDefensivePerimeter(room, [...protectedTiles].reverse()),
    ).toEqual(perimeter);
    expect(exitsReachProtected(walkable, protectedTiles, perimeter)).toBe(
      false,
    );
    for (const removed of perimeter) {
      expect(
        exitsReachProtected(
          walkable,
          protectedTiles,
          perimeter.filter((point) => key(point) !== key(removed)),
        ),
      ).toBe(true);
    }
  });

  it("returns the eight-direction minimum separator on open terrain", () => {
    const protectedTiles = [{ x: 25, y: 25 }];

    const perimeter = deriveDefensivePerimeter(mockRoom("all"), protectedTiles);

    expect(perimeter).toEqual([
      { x: 24, y: 24 },
      { x: 24, y: 25 },
      { x: 24, y: 26 },
      { x: 25, y: 24 },
      { x: 25, y: 26 },
      { x: 26, y: 24 },
      { x: 26, y: 25 },
      { x: 26, y: 26 },
    ]);
    expect(perimeter).not.toContainEqual(protectedTiles[0]);
    expect(
      perimeter.every(
        (point) =>
          point.x > 0 &&
          point.x < ROOM_SIZE - 1 &&
          point.y > 0 &&
          point.y < ROOM_SIZE - 1,
      ),
    ).toBe(true);
  });

  it("deduplicates protected tiles and excludes walls, exits, and assets", () => {
    const walkable = new Set<string>();
    for (let x = 0; x <= 10; x += 1) walkable.add(`${x}:25`);
    const protectedTile = { x: 10, y: 25 };

    const perimeter = deriveDefensivePerimeter(mockRoom(walkable), [
      protectedTile,
      protectedTile,
    ]);

    expect(perimeter).toEqual([{ x: 1, y: 25 }]);
    expect(perimeter.some((point) => point.x === 0 || point.x === 49)).toBe(
      false,
    );
    expect(perimeter).not.toContainEqual(protectedTile);
    expect(perimeter.every((point) => walkable.has(key(point)))).toBe(true);
  });

  it("fails closed for invalid, walled, or exit-bound protected tiles", () => {
    const corridor = new Set<string>();
    for (let x = 0; x <= 10; x += 1) corridor.add(`${x}:25`);
    const room = mockRoom(corridor);

    expect(deriveDefensivePerimeter(room, [{ x: 0, y: 25 }])).toEqual([]);
    expect(deriveDefensivePerimeter(room, [{ x: 10, y: 24 }])).toEqual([]);
    expect(deriveDefensivePerimeter(room, [{ x: -1, y: 25 }])).toEqual([]);
    expect(deriveDefensivePerimeter(room, [])).toEqual([]);
  });

  it("returns no artificial barrier when terrain already seals the footprint", () => {
    const isolated = new Set<string>(["25:25"]);

    expect(
      deriveDefensivePerimeter(mockRoom(isolated), [{ x: 25, y: 25 }]),
    ).toEqual([]);
  });

  it("reports bounded-work and unrealizable-cut failures explicitly", () => {
    const oversized = deriveDefensivePerimeterResult(
      mockRoom("all"),
      [{ x: 25, y: 25 }],
      { maxPerimeterTiles: 7 },
    );
    expect(oversized).toMatchObject({
      perimeter: [],
      failure: "oversized-perimeter",
      diagnostics: { maxFlow: 8, walkableTiles: 2_500 },
    });
    expect(oversized.diagnostics.graphEdges).toBeLessThan(23_000);
    expect(oversized.diagnostics.augmentingPaths).toBeLessThanOrEqual(8);

    const corridor = new Set<string>();
    const uncuttable: PlannedPoint[] = [];
    for (let x = 0; x <= 10; x += 1) {
      corridor.add(`${x}:25`);
      if (x > 0 && x < 10) uncuttable.push({ x, y: 25 });
    }
    expect(
      deriveDefensivePerimeterResult(mockRoom(corridor), [{ x: 10, y: 25 }], {
        uncuttableTiles: uncuttable,
      }),
    ).toMatchObject({ perimeter: [], failure: "unseparable" });
  });
});
