export const OBSERVABILITY_SEGMENT = 99;

const requestedSegments = new Set<number>([OBSERVABILITY_SEGMENT]);

export function requestMemorySegment(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 99) {
    throw new Error(`Invalid RawMemory segment ${id}; expected an integer from 0 through 99`);
  }

  requestedSegments.add(id);
}

export function activateMemorySegments(): void {
  const ids = [...requestedSegments].sort((a, b) => a - b);
  if (ids.length > 10) {
    throw new Error(`RawMemory supports at most 10 active segments; requested ${ids.length}`);
  }

  RawMemory.setActiveSegments(ids);
}

export function writeObservabilitySegment(payload: string): boolean {
  if (RawMemory.segments[OBSERVABILITY_SEGMENT] === undefined) return false;

  RawMemory.segments[OBSERVABILITY_SEGMENT] = payload;
  return true;
}
