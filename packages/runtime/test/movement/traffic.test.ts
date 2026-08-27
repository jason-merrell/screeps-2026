import { describe, expect, it } from "vitest";
import {
  advanceMovementState,
  selectSameStepYielders,
  type MovementRequest,
} from "../../src/movement/traffic";

function movementRequest(
  name: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  priority: number,
  fatigue = 0,
): MovementRequest {
  return {
    creep: {
      name,
      fatigue,
      pos: { roomName: "W1N1", ...from },
    } as unknown as Creep,
    target: {
      pos: { roomName: "W1N1", ...to },
    } as RoomObject,
    range: 0,
    priority,
    reason: "test",
  };
}

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

  it("yields lower-priority requests that converge on the same next tile", () => {
    const requests = [
      movementRequest("high", { x: 24, y: 25 }, { x: 30, y: 25 }, 100),
      movementRequest("middle", { x: 25, y: 24 }, { x: 25, y: 30 }, 80),
      movementRequest("low", { x: 26, y: 25 }, { x: 20, y: 25 }, 60),
    ];

    expect([...selectSameStepYielders(requests)]).toEqual(["middle", "low"]);
  });

  it("does not treat a head-on exchange as same-tile contention", () => {
    const requests = [
      movementRequest("left", { x: 25, y: 25 }, { x: 30, y: 25 }, 100),
      movementRequest("right", { x: 26, y: 25 }, { x: 20, y: 25 }, 80),
    ];

    expect(selectSameStepYielders(requests).size).toBe(0);
  });

  it("does not let a fatigued creep reserve a contested next tile", () => {
    const requests = [
      movementRequest("fatigued", { x: 24, y: 25 }, { x: 30, y: 25 }, 100, 2),
      movementRequest("ready", { x: 25, y: 24 }, { x: 25, y: 30 }, 80),
    ];

    expect(selectSameStepYielders(requests).size).toBe(0);
  });
});
