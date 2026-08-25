import { describe, expect, it } from "vitest";
import { TickSpatialIndex } from "../../src/world/spatial-index";

describe("TickSpatialIndex", () => {
  it("selects the nearest candidate and caches repeated range lookups", () => {
    let rangeCalls = 0;
    const origin = {
      roomName: "W1N1",
      x: 10,
      y: 10,
      getRangeTo(target: RoomPosition) {
        rangeCalls += 1;
        return Math.max(Math.abs(10 - target.x), Math.abs(10 - target.y));
      },
    } as unknown as RoomPosition;

    const near = {
      id: "near" as Id<Source>,
      pos: { roomName: "W1N1", x: 12, y: 11 } as RoomPosition,
    } as Source;
    const far = {
      id: "far" as Id<Source>,
      pos: { roomName: "W1N1", x: 20, y: 20 } as RoomPosition,
    } as Source;

    const index = new TickSpatialIndex([]);

    expect(index.nearest(origin, [far, near])).toBe(near);
    expect(index.nearest(origin, [far, near])).toBe(near);
    expect(rangeCalls).toBe(2);
    expect(index.metrics).toEqual({
      roomsIndexed: 0,
      distanceLookups: 4,
      distanceCacheHits: 2,
      distanceCacheMisses: 2,
    });
  });
});
