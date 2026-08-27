import { recordTraffic } from "./traffic-heatmap";

export interface MovementMetrics {
  requests: number;
  cachedPathAttempts: number;
  pathFinds: number;
  congestionRepaths: number;
  fatigueWaits: number;
  stuckRequests: number;
  contentionYields: number;
  headOnSwapAttempts: number;
  headOnSwaps: number;
}

export interface MovementRequest {
  creep: Creep;
  target: RoomObject;
  range: number;
  priority: number;
  reason: string;
}

export interface MovementMemoryState {
  roomName: string;
  x: number;
  y: number;
  requestedTick: number;
  stuckTicks: number;
}

declare global {
  interface CreepMemory {
    movement?: MovementMemoryState;
  }
}

const PATH_REUSE_TICKS = 50;
const STUCK_SWAP_THRESHOLD = 2;
const STUCK_REPATH_THRESHOLD = 3;

const emptyMetrics = (): MovementMetrics => ({
  requests: 0,
  cachedPathAttempts: 0,
  pathFinds: 0,
  congestionRepaths: 0,
  fatigueWaits: 0,
  stuckRequests: 0,
  contentionYields: 0,
  headOnSwapAttempts: 0,
  headOnSwaps: 0,
});

export function advanceMovementState(
  previous: MovementMemoryState | undefined,
  roomName: string,
  x: number,
  y: number,
  tick: number,
  fatigue: number,
): MovementMemoryState {
  const consecutiveRequest = previous?.requestedTick === tick - 1;
  const samePosition =
    previous?.roomName === roomName && previous.x === x && previous.y === y;
  const stuckTicks =
    consecutiveRequest && samePosition && fatigue === 0 ? (previous?.stuckTicks ?? 0) + 1 : 0;

  return { roomName, x, y, requestedTick: tick, stuckTicks };
}

function directStepToward(origin: RoomPosition, target: RoomPosition): { x: number; y: number } | null {
  if (origin.roomName !== target.roomName) return null;

  const dx = Math.sign(target.x - origin.x);
  const dy = Math.sign(target.y - origin.y);
  if (dx === 0 && dy === 0) return null;

  return { x: origin.x + dx, y: origin.y + dy };
}

export function selectSameStepYielders(requests: MovementRequest[]): Set<string> {
  const reserved = new Set<string>();
  const yielders = new Set<string>();

  for (const request of requests) {
    if (request.creep.fatigue > 0) continue;

    const step = directStepToward(request.creep.pos, request.target.pos);
    if (!step) continue;

    const key = `${request.creep.pos.roomName}:${step.x}:${step.y}`;
    if (reserved.has(key)) {
      yielders.add(request.creep.name);
      continue;
    }
    reserved.add(key);
  }

  return yielders;
}

function directBlocker(request: MovementRequest): Creep | null {
  const step = directStepToward(request.creep.pos, request.target.pos);
  if (!step) return null;

  const blocker = request.creep.room
    .lookForAt(LOOK_CREEPS, step.x, step.y)
    .find((candidate) => candidate.my && candidate.name !== request.creep.name);
  return blocker ?? null;
}

function requestsAreHeadOn(a: MovementRequest, b: MovementRequest): boolean {
  if (a.creep.pos.roomName !== b.creep.pos.roomName) return false;

  const aStep = directStepToward(a.creep.pos, a.target.pos);
  const bStep = directStepToward(b.creep.pos, b.target.pos);
  return (
    aStep?.x === b.creep.pos.x &&
    aStep.y === b.creep.pos.y &&
    bStep?.x === a.creep.pos.x &&
    bStep.y === a.creep.pos.y
  );
}

function tryHeadOnSwap(
  request: MovementRequest,
  byCreep: Map<string, MovementRequest>,
  handled: Set<string>,
  metrics: MovementMetrics,
): boolean {
  const blocker = directBlocker(request);
  if (!blocker || blocker.fatigue > 0 || handled.has(blocker.name)) return false;

  const blockerRequest = byCreep.get(blocker.name);
  if (!blockerRequest || blockerRequest.priority >= request.priority) return false;
  if (!requestsAreHeadOn(request, blockerRequest)) return false;

  metrics.headOnSwapAttempts += 1;
  const forward = request.creep.pos.getDirectionTo(blocker.pos);
  const backward = blocker.pos.getDirectionTo(request.creep.pos);
  const first = request.creep.move(forward);
  const second = blocker.move(backward);

  handled.add(request.creep.name);
  handled.add(blocker.name);
  if (first === OK && second === OK) metrics.headOnSwaps += 1;
  return true;
}

function moveWithNativeCache(
  request: MovementRequest,
  stuckTicks: number,
  metrics: MovementMetrics,
): void {
  const { creep, target, range } = request;
  if (creep.fatigue > 0) {
    metrics.fatigueWaits += 1;
    return;
  }

  if (stuckTicks >= STUCK_REPATH_THRESHOLD) {
    metrics.congestionRepaths += 1;
    metrics.pathFinds += 1;
    creep.moveTo(target, {
      range,
      reusePath: 0,
      ignoreCreeps: false,
    });
    return;
  }

  metrics.cachedPathAttempts += 1;
  const cached = creep.moveTo(target, {
    range,
    reusePath: PATH_REUSE_TICKS,
    ignoreCreeps: true,
    noPathFinding: true,
  });
  if (cached === OK) return;
  if (cached !== ERR_NOT_FOUND && cached !== ERR_NO_PATH) return;

  metrics.pathFinds += 1;
  creep.moveTo(target, {
    range,
    reusePath: PATH_REUSE_TICKS,
    ignoreCreeps: true,
  });
}

export function resolveMovementRequests(requests: MovementRequest[]): MovementMetrics {
  const metrics = emptyMetrics();
  metrics.requests = requests.length;
  if (requests.length === 0) return metrics;

  const ordered = [...requests].sort(
    (a, b) => b.priority - a.priority || a.creep.name.localeCompare(b.creep.name),
  );
  const byCreep = new Map(ordered.map((request) => [request.creep.name, request]));
  const handled = new Set<string>();
  const yielders = selectSameStepYielders(ordered);

  for (const request of ordered) {
    if (handled.has(request.creep.name)) continue;

    recordTraffic(
      request.creep.pos.roomName,
      request.creep.pos.x,
      request.creep.pos.y,
      Game.time,
    );

    if (yielders.has(request.creep.name)) {
      metrics.contentionYields += 1;
      delete request.creep.memory.movement;
      handled.add(request.creep.name);
      continue;
    }

    const nextState = advanceMovementState(
      request.creep.memory.movement,
      request.creep.pos.roomName,
      request.creep.pos.x,
      request.creep.pos.y,
      Game.time,
      request.creep.fatigue,
    );
    request.creep.memory.movement = nextState;

    if (nextState.stuckTicks > 0) metrics.stuckRequests += 1;
    if (
      nextState.stuckTicks >= STUCK_SWAP_THRESHOLD &&
      tryHeadOnSwap(request, byCreep, handled, metrics)
    ) {
      continue;
    }

    moveWithNativeCache(request, nextState.stuckTicks, metrics);
    handled.add(request.creep.name);
  }

  return metrics;
}
