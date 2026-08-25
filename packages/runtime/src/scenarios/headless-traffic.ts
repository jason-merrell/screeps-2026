import {
  resolveMovementRequests,
  type MovementMetrics,
  type MovementRequest,
} from "../movement/traffic";

export type HeadlessTrafficScenario = "head-on" | "funnel" | "crossing";
type HeadlessTrafficPhase = "staging" | "running" | "complete" | "failed";

interface Point {
  x: number;
  y: number;
}

interface ScenarioParticipant {
  name: string;
  start: Point;
  goal: Point;
  priority: number;
}

interface HeadlessTrafficState {
  version: 1;
  name: HeadlessTrafficScenario;
  phase: HeadlessTrafficPhase;
  startedAt: number;
  phaseStartedAt: number;
  stageIndex: number;
  runningTicks: number;
  metrics: MovementMetrics;
  lastMetrics: MovementMetrics;
  completedAt?: number;
  failure?: string;
}

declare global {
  interface Memory {
    headlessScenarioName?: HeadlessTrafficScenario;
    headlessTraffic?: HeadlessTrafficState;
  }
}

const ROOM_NAME = "W0N0";
const PREFIX = "scenario-";
const RUNNING_TIMEOUT = 60;

const POINTS = {
  left: { x: 16, y: 25 },
  right: { x: 34, y: 25 },
  top: { x: 25, y: 16 },
  bottom: { x: 25, y: 34 },
  rightUpper: { x: 34, y: 24 },
  rightLower: { x: 34, y: 26 },
} satisfies Record<string, Point>;

const emptyMetrics = (): MovementMetrics => ({
  requests: 0,
  cachedPathAttempts: 0,
  pathFinds: 0,
  congestionRepaths: 0,
  fatigueWaits: 0,
  stuckRequests: 0,
  headOnSwapAttempts: 0,
  headOnSwaps: 0,
});

function addMetrics(total: MovementMetrics, sample: MovementMetrics): void {
  for (const key of Object.keys(total) as Array<keyof MovementMetrics>) {
    total[key] += sample[key];
  }
}

function participants(name: HeadlessTrafficScenario): ScenarioParticipant[] {
  switch (name) {
    case "head-on":
      // Stage the far-side creep first so the second creep never needs to pass it during setup.
      return [
        { name: `${PREFIX}B`, start: POINTS.right, goal: POINTS.left, priority: 50 },
        { name: `${PREFIX}A`, start: POINTS.left, goal: POINTS.right, priority: 100 },
      ];
    case "funnel":
      return [
        { name: `${PREFIX}B`, start: POINTS.top, goal: POINTS.rightUpper, priority: 80 },
        { name: `${PREFIX}C`, start: POINTS.bottom, goal: POINTS.rightLower, priority: 60 },
        { name: `${PREFIX}A`, start: POINTS.left, goal: POINTS.right, priority: 100 },
      ];
    case "crossing":
      return [
        { name: `${PREFIX}B`, start: POINTS.right, goal: POINTS.left, priority: 80 },
        { name: `${PREFIX}C`, start: POINTS.top, goal: POINTS.bottom, priority: 60 },
        { name: `${PREFIX}D`, start: POINTS.bottom, goal: POINTS.top, priority: 40 },
        { name: `${PREFIX}A`, start: POINTS.left, goal: POINTS.right, priority: 100 },
      ];
  }
}

function initializeState(): HeadlessTrafficState {
  const name = Memory.headlessScenarioName ?? "head-on";
  return {
    version: 1,
    name,
    phase: "staging",
    startedAt: Game.time,
    phaseStartedAt: Game.time,
    stageIndex: 0,
    runningTicks: 0,
    metrics: emptyMetrics(),
    lastMetrics: emptyMetrics(),
  };
}

function atPoint(creep: Creep, point: Point): boolean {
  return creep.pos.roomName === ROOM_NAME && creep.pos.x === point.x && creep.pos.y === point.y;
}

function target(point: Point): RoomObject {
  return { pos: new RoomPosition(point.x, point.y, ROOM_NAME) } as RoomObject;
}

function movementRequest(creep: Creep, point: Point, priority: number, reason: string): MovementRequest {
  return {
    creep,
    target: target(point),
    range: 0,
    priority,
    reason,
  };
}

function clearMovementCache(creep: Creep): void {
  const memory = creep.memory as CreepMemory & { _move?: unknown };
  delete memory._move;
  delete memory.movement;
}

function fail(state: HeadlessTrafficState, reason: string): void {
  state.phase = "failed";
  state.failure = reason;
  state.completedAt = Game.time;
  console.log(`[headlessTraffic] FAIL ${state.name}: ${reason}`);
}

function stageNextParticipant(state: HeadlessTrafficState, specs: ScenarioParticipant[]): void {
  const spec = specs[state.stageIndex];
  if (!spec) {
    state.phase = "running";
    state.phaseStartedAt = Game.time;
    state.runningTicks = 0;
    state.metrics = emptyMetrics();
    state.lastMetrics = emptyMetrics();
    for (const participant of specs) {
      const creep = Game.creeps[participant.name];
      if (creep) clearMovementCache(creep);
    }
    console.log(`[headlessTraffic] ${state.name} staged at tick ${Game.time}`);
    return;
  }

  const creep = Game.creeps[spec.name];
  if (!creep) {
    const spawn = Game.spawns.ScenarioSpawn;
    if (!spawn) {
      fail(state, "ScenarioSpawn is missing");
      return;
    }
    if (!spawn.spawning) {
      const result = spawn.spawnCreep([MOVE], spec.name);
      if (result !== OK && result !== ERR_BUSY) {
        fail(state, `spawnCreep(${spec.name}) returned ${result}`);
      }
    }
    return;
  }

  if (creep.spawning) return;
  if (atPoint(creep, spec.start)) {
    clearMovementCache(creep);
    state.stageIndex += 1;
    return;
  }

  state.lastMetrics = resolveMovementRequests([
    movementRequest(creep, spec.start, spec.priority, `stage ${spec.name}`),
  ]);
}

function runScenario(state: HeadlessTrafficState, specs: ScenarioParticipant[]): void {
  const complete = specs.every((spec) => {
    const creep = Game.creeps[spec.name];
    return creep !== undefined && !creep.spawning && atPoint(creep, spec.goal);
  });

  if (complete) {
    state.phase = "complete";
    state.completedAt = Game.time;
    console.log(
      `[headlessTraffic] PASS ${state.name} ticks=${state.runningTicks} swaps=${state.metrics.headOnSwaps} repaths=${state.metrics.congestionRepaths}`,
    );
    return;
  }

  const requests: MovementRequest[] = [];
  for (const spec of specs) {
    const creep = Game.creeps[spec.name];
    if (!creep || creep.spawning) {
      fail(state, `participant ${spec.name} disappeared during running phase`);
      return;
    }
    if (!atPoint(creep, spec.goal)) {
      requests.push(movementRequest(creep, spec.goal, spec.priority, `run ${state.name} ${spec.name}`));
    }
  }

  state.lastMetrics = resolveMovementRequests(requests);
  addMetrics(state.metrics, state.lastMetrics);
  state.runningTicks = Game.time - state.phaseStartedAt + 1;

  if (state.runningTicks >= RUNNING_TIMEOUT) {
    fail(state, `scenario exceeded ${RUNNING_TIMEOUT} running ticks`);
  }
}

export const loop = (): void => {
  Memory.headlessTraffic ??= initializeState();
  const state = Memory.headlessTraffic;
  if (state.phase === "complete" || state.phase === "failed") return;

  const specs = participants(state.name);
  if (state.phase === "staging") {
    stageNextParticipant(state, specs);
    return;
  }

  runScenario(state, specs);
};
