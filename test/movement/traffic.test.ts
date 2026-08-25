import { describe, expect, it } from "vitest";
import { advanceMovementState } from "../../src/movement/traffic";

describe("traffic-aware movement", () => {
  it("counts consecutive movement requests that remain on the same tile without fatigue", () => {
    const first = advanceMovementState(undefined, "W1N1", 10, 20, 100, 0);
    const second = advanceMovementState(first, "W1N1", 10, 20, 101, 0);
    const third = advanceMovementState(second, "W1N1", 10, 20, 102, 0);

    expect(first.stuckTicks).toBe(0);
    expect(second.stuckTicks).toBe(1);
    expect(third.stuckTicks).toBe(2);
  });

  it("resets stuck state after movement, fatigue, or a gap in movement requests", () => {
    const previous = {
      roomName: "W1N1",
      x: 10,
      y: 20,
      requestedTick: 100,
      stuckTicks: 2,
    };

    expect(advanceMovementState(previous, "W1N1", 11, 20, 101, 0).stuckTicks).toBe(0);
    expect(advanceMovementState(previous, "W1N1", 10, 20, 101, 2).stuckTicks).toBe(0);
    expect(advanceMovementState(previous, "W1N1", 10, 20, 103, 0).stuckTicks).toBe(0);
  });
});
