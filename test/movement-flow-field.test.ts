import { describe, expect, it } from "vitest";
import {
  BLOCKED_COST,
  buildFlowField,
  chooseFlowStep,
  flowDistanceAt,
  ROOM_SIZE,
} from "../src/movement/flow-field";

const openGrid = (): Uint8Array => new Uint8Array(ROOM_SIZE * ROOM_SIZE).fill(2);
const indexOf = (x: number, y: number): number => y * ROOM_SIZE + x;

describe("flow-field routing", () => {
  it("moves downhill toward a reachable goal", () => {
    const costs = openGrid();
    const field = buildFlowField(costs, [{ x: 10, y: 10 }]);
    const before = flowDistanceAt(field, 5, 10);
    const step = chooseFlowStep(field, costs, { x: 5, y: 10 });

    expect(step).not.toBeNull();
    if (!step) throw new Error("expected a downhill step");
    expect(flowDistanceAt(field, step.x, step.y)).toBeLessThan(before);
  });

  it("never chooses a blocked tile", () => {
    const costs = openGrid();
    costs[indexOf(6, 10)] = BLOCKED_COST;
    const field = buildFlowField(costs, [{ x: 10, y: 10 }]);
    const step = chooseFlowStep(field, costs, { x: 5, y: 10 });

    expect(step).not.toEqual({ x: 6, y: 10 });
    expect(step).not.toBeNull();
  });

  it("chooses an alternate downhill step when the preferred destination is reserved", () => {
    const costs = openGrid();
    const field = buildFlowField(costs, [{ x: 10, y: 10 }]);
    const preferred = chooseFlowStep(field, costs, { x: 5, y: 10 });
    expect(preferred).not.toBeNull();
    if (!preferred) throw new Error("expected a preferred step");

    const reserved = new Set([`${preferred.x}:${preferred.y}`]);
    const alternate = chooseFlowStep(field, costs, { x: 5, y: 10 }, reserved);

    expect(alternate).not.toBeNull();
    expect(alternate).not.toEqual(preferred);
  });

  it("returns no step for an unreachable origin", () => {
    const costs = openGrid();
    for (let x = 0; x < ROOM_SIZE; x += 1) {
      costs[indexOf(x, 9)] = BLOCKED_COST;
      costs[indexOf(x, 11)] = BLOCKED_COST;
    }
    costs[indexOf(4, 10)] = BLOCKED_COST;
    costs[indexOf(6, 10)] = BLOCKED_COST;

    const field = buildFlowField(costs, [{ x: 10, y: 10 }]);
    expect(chooseFlowStep(field, costs, { x: 5, y: 10 })).toBeNull();
  });
});
