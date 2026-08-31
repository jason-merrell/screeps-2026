import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlannedPoint,
  RoomPlan,
  RoomPlanStructure,
} from "../../src/planning/room-plan";
import {
  DEFENDED_CORE_PADDING,
  deriveRoomDefenseEnvelope,
  MAX_DEFENSIVE_PERIMETER_TILES,
} from "../../src/systems/settlement/defense-envelope";

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

const keyOf = (point: PlannedPoint): string => `${point.x}:${point.y}`;

function structure(
  id: string,
  x: number,
  y: number,
  structureType: BuildableStructureConstant,
  phase: RoomPlanStructure["phase"] = "advanced-operations",
): RoomPlanStructure {
  return {
    id,
    x,
    y,
    structureType,
    minRcl: 8,
    priority: 1_000,
    activation: "automatic",
    reservation: "hard",
    phase,
    reason: "geometry fixture",
    stage: "mature-rcl8",
    strategicWeight: 10,
    requiredForStage: true,
  };
}

function plan(structures?: RoomPlanStructure[]): RoomPlan {
  return {
    version: 4,
    horizonRcl: 8,
    roomName: "W1N1",
    generatedAt: 1,
    generatedReason: "geometry fixture",
    anchors: {
      spawn: { name: "Spawn1", x: 25, y: 25 },
      hub: { x: 25, y: 25 },
      controller: { x: 40, y: 40, service: { x: 39, y: 40 } },
      sources: [
        {
          sourceId: "source-1",
          x: 10,
          y: 10,
          container: { x: 11, y: 10 },
        },
      ],
    },
    reservations: [],
    structures: structures ?? [
      structure("spawn-1", 25, 25, "spawn", "bootstrap-capacity"),
      structure("storage-1", 27, 25, "storage", "core-economy"),
      structure("lab-1", 23, 26, "lab"),
      structure("extractor-1", 42, 42, "extractor"),
      structure("source-container", 11, 10, "container", "source-logistics"),
      structure("source-link", 40, 10, "link", "energy-distribution"),
    ],
    roads: [
      {
        id: "core-exit-road",
        x: 19,
        y: 25,
        minRcl: 4,
        activation: "demand",
        phase: "strategic-roads",
        reason: "service route",
      },
    ],
    roadGraph: { nodes: [], edges: [] },
    defense: { strategy: "pending-mincut", protectedTiles: [], perimeter: [] },
  };
}

interface MockRoomOptions {
  walls?: ReadonlySet<string>;
  structures?: Array<{
    structureType: StructureConstant;
    my?: boolean;
    pos: PlannedPoint;
  }>;
  sites?: Array<{
    structureType: BuildableStructureConstant;
    my: boolean;
    pos: PlannedPoint;
  }>;
}

function room(options: MockRoomOptions = {}): Room {
  const sources = [{ pos: { x: 10, y: 10 } }];
  const minerals = [{ pos: { x: 42, y: 42 } }];
  return {
    name: "W1N1",
    controller: { pos: { x: 40, y: 40 } },
    getTerrain: () => ({
      get: (x: number, y: number) =>
        options.walls?.has(`${x}:${y}`) ? WALL : 0,
    }),
    find: (constant: FindConstant) => {
      if (constant === FIND_SOURCES) return sources;
      if (constant === FIND_MINERALS) return minerals;
      if (constant === FIND_STRUCTURES) return options.structures ?? [];
      if (constant === FIND_CONSTRUCTION_SITES) return options.sites ?? [];
      return [];
    },
  } as unknown as Room;
}

function exitsReachProtected(
  protectedTiles: readonly PlannedPoint[],
  perimeter: readonly PlannedPoint[],
): boolean {
  const protectedKeys = new Set(protectedTiles.map(keyOf));
  const blocked = new Set(perimeter.map(keyOf));
  const visited = new Set<string>();
  const queue: PlannedPoint[] = [];
  for (let index = 0; index < ROOM_SIZE; index += 1) {
    for (const point of [
      { x: 0, y: index },
      { x: 49, y: index },
      { x: index, y: 0 },
      { x: index, y: 49 },
    ]) {
      if (visited.has(keyOf(point))) continue;
      visited.add(keyOf(point));
      queue.push(point);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const point = queue[head];
    if (!point) continue;
    if (protectedKeys.has(keyOf(point))) return true;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const next = { x: point.x + dx, y: point.y + dy };
      if (
        next.x < 0 ||
        next.x >= ROOM_SIZE ||
        next.y < 0 ||
        next.y >= ROOM_SIZE ||
        visited.has(keyOf(next)) ||
        blocked.has(keyOf(next))
      ) {
        continue;
      }
      visited.add(keyOf(next));
      queue.push(next);
    }
  }
  return false;
}

describe("serviceable defensive core envelope", () => {
  beforeEach(() => {
    vi.stubGlobal("TERRAIN_MASK_WALL", WALL);
    vi.stubGlobal("FIND_SOURCES", 1);
    vi.stubGlobal("FIND_MINERALS", 2);
    vi.stubGlobal("FIND_STRUCTURES", 3);
    vi.stubGlobal("FIND_CONSTRUCTION_SITES", 4);
  });

  it("pads one coherent core, excludes remote extraction, and retains road gates", () => {
    const envelope = deriveRoomDefenseEnvelope(room(), plan());
    const protectedKeys = new Set(envelope.protectedTiles.map(keyOf));

    for (const asset of envelope.coreAssets) {
      for (
        let dx = -DEFENDED_CORE_PADDING;
        dx <= DEFENDED_CORE_PADDING;
        dx += 1
      ) {
        for (
          let dy = -DEFENDED_CORE_PADDING;
          dy <= DEFENDED_CORE_PADDING;
          dy += 1
        ) {
          expect(protectedKeys.has(`${asset.x + dx}:${asset.y + dy}`)).toBe(
            true,
          );
        }
      }
    }
    expect(envelope.coreAssets).not.toContainEqual({ x: 42, y: 42 });
    expect(envelope.coreAssets).not.toContainEqual({ x: 11, y: 10 });
    expect(envelope.coreAssets).not.toContainEqual({ x: 40, y: 10 });
    expect(protectedKeys.has("42:42")).toBe(false);
    expect(envelope.perimeter.length).toBeGreaterThan(0);
    expect(envelope.perimeter.length).toBeLessThanOrEqual(
      MAX_DEFENSIVE_PERIMETER_TILES,
    );
    expect(
      envelope.perimeter.every((rampart) =>
        envelope.coreAssets.every(
          (asset) =>
            Math.max(
              Math.abs(rampart.x - asset.x),
              Math.abs(rampart.y - asset.y),
            ) > DEFENDED_CORE_PADDING,
        ),
      ),
    ).toBe(true);
    expect(envelope.gateTiles).toContainEqual({ x: 19, y: 25 });
    expect(
      exitsReachProtected(envelope.protectedTiles, envelope.perimeter),
    ).toBe(false);

    // Own ramparts remain traversable in Screeps; removing their hostile-block
    // semantics represents the service route available to colony creeps.
    expect(exitsReachProtected(envelope.protectedTiles, [])).toBe(true);
    expect(envelope.diagnostics).toMatchObject({
      walkableTiles: 2_500,
      maxFlow: envelope.perimeter.length,
    });
    expect(envelope.diagnostics.graphEdges).toBeLessThan(23_000);
    expect(envelope.diagnostics.bfsPhases).toBeLessThan(100);
    expect(envelope.diagnostics.augmentingPaths).toBeLessThanOrEqual(
      MAX_DEFENSIVE_PERIMETER_TILES,
    );
  });

  it("is deterministic and routes the cut around hostile or unowned occupancy", () => {
    const baseline = deriveRoomDefenseEnvelope(room(), plan());
    const ownedOverlay = deriveRoomDefenseEnvelope(
      room({
        structures: [
          { structureType: "spawn", my: true, pos: { x: 19, y: 26 } },
        ],
      }),
      plan(),
    );
    const occupied = room({
      structures: [
        { structureType: "spawn", my: false, pos: { x: 19, y: 25 } },
      ],
      sites: [{ structureType: "extension", my: false, pos: { x: 19, y: 27 } }],
    });
    const forward = deriveRoomDefenseEnvelope(occupied, plan());
    const reversedPlan = plan([...plan().structures].reverse());
    const reversed = deriveRoomDefenseEnvelope(occupied, reversedPlan);

    expect(ownedOverlay.perimeter).toEqual(baseline.perimeter);
    expect(ownedOverlay.perimeter).toContainEqual({ x: 19, y: 26 });
    expect(forward.perimeter).toEqual(reversed.perimeter);
    expect(forward.perimeter).not.toContainEqual({ x: 19, y: 25 });
    expect(forward.perimeter).not.toContainEqual({ x: 19, y: 27 });
  });

  it("fails closed when a dispersed core exceeds the repair-burden cap", () => {
    const dispersed = plan([
      structure("spawn-west", 10, 10, "spawn"),
      structure("spawn-east", 40, 40, "spawn"),
    ]);

    expect(() => deriveRoomDefenseEnvelope(room(), dispersed)).toThrow(
      /oversized-perimeter/,
    );
  });
});
