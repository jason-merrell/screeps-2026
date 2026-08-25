import { describe, expect, it } from "vitest";
import { decayTraffic, type TrafficMemory } from "../../src/movement/traffic-heatmap";

describe("traffic heatmap", () => {
  it("decays old movement evidence in bounded intervals", () => {
    const memory: TrafficMemory = {
      lastDecay: 100,
      tiles: {
        "10:10": 20,
        "11:10": 1,
      },
    };

    decayTraffic(memory, 125);

    expect(memory.tiles["10:10"]).toBeCloseTo(16);
    expect(memory.tiles["11:10"]).toBeUndefined();
    expect(memory.lastDecay).toBe(125);
  });

  it("does not churn scores before the decay interval", () => {
    const memory: TrafficMemory = {
      lastDecay: 100,
      tiles: { "10:10": 20 },
    };

    decayTraffic(memory, 124);

    expect(memory.tiles["10:10"]).toBe(20);
    expect(memory.lastDecay).toBe(100);
  });
});
