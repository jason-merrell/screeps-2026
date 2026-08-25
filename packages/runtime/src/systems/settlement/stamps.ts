import type { PlannedPoint } from "../../planning/room-plan";

export const RAPID_FILL_EXTENSION_OFFSETS = [
  { x: -2, y: -1 },
  { x: -2, y: 1 },
  { x: -1, y: -2 },
  { x: -1, y: 2 },
  { x: 1, y: -2 },
  { x: 1, y: 2 },
  { x: 2, y: -1 },
  { x: 2, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: 1 },
] as const satisfies readonly PlannedPoint[];

export const RAPID_FILL_ROAD_OFFSETS = [
  { x: -2, y: 0 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: -2 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 0, y: 2 },
] as const satisfies readonly PlannedPoint[];

export const translateStampPoint = (origin: PlannedPoint, offset: PlannedPoint): PlannedPoint => ({
  x: origin.x + offset.x,
  y: origin.y + offset.y,
});
