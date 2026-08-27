import { resolveMovementRequests, type MovementMetrics, type MovementRequest } from "../movement/traffic";

type SimTrafficScenario = "headOn" | "funnel" | "crossing";
type SimTrafficPhase = "spawning" | "staging" | "running" | "complete" | "failed";

interface Point {
  x: number;
  y: number;
}

interface SimTrafficArena {
  roomName: string;
  center: Point;
  left: Point;
  right: Point;
  top: Point;
  bottom: Point;
}

interface ScenarioParticipant {
  name: string;
  start: Point;
  goal: Point;
  priority: number;
}

interface SimTrafficState {
  version: 1;
  active: boolean;
  scenario: SimTrafficScenario;
  phase: SimTrafficPhase;
  startedAt: number;
  phaseStartedAt: number;
  arena?: SimTrafficArena;
  participants: string[];
  metrics: MovementMetrics;
  lastMetrics: MovementMetrics;
  runningTicks: number;
  completedAt?: number;
  failure?: string;
}

declare global {
  interface Memory {
    simTraffic?: SimTrafficState;
  }
}

const PREFIX = "simTraffic-";
const STAGING_TIMEOUT = 150;
const SCENARIO_TIMEOUT: Record<SimTrafficScenario, number> = {
  headOn: 30,
  funnel: 45,
  crossing: 45,
};

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

function addMetrics(total: MovementMetrics, sample: MovementMetrics): void {
  for (const key of Object.keys(total) as Array<keyof MovementMetrics>) {
    total[key] += sample[key];
  }
}

function isSimulation(): boolean {
  return Game.rooms.sim !== undefined;
}

function isWalkable(room: Room, x: number, y: number): boolean {
  if (x < 2 || x > 47 || y < 2 || y > 47) return false;
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
  if (room.controller?.pos.x === x && room.controller.pos.y === y) return false;
  if (room.lookForAt(LOOK_SOURCES, x, y).length > 0) return false;
  if (room.lookForAt(LOOK_MINERALS, x, y).length > 0) return false;

  return !room.lookForAt(LOOK_STRUCTURES, x, y).some((structure) =>
    (OBSTACLE_OBJECT_TYPES as readonly StructureConstant[]).includes(structure.structureType),
  );
}

function findArena(room: Room): SimTrafficArena | null {
  const radius = 5;
  let best: { arena: SimTrafficArena; score: number } | null = null;

  for (let x = 8; x <= 41; x += 1) {
    for (let y = 8; y <= 41; y += 1) {
      let valid = true;
      for (let offset = -radius; offset <= radius && valid; offset += 1) {
        valid = isWalkable(room, x + offset, y) && isWalkable(room, x, y + offset);
      }
      if (!valid) continue;

      const arena: SimTrafficArena = {
        roomName: room.name,
        center: { x, y },
        left: { x: x - radius, y },
        right: { x: x + radius, y },
        top: { x, y: y - radius },
        bottom: { x, y: y + radius },
      };
      const score = Math.abs(x - 25) + Math.abs(y - 25);
      if (!best || score < best.score) best = { arena, score };
    }
  }

  return best?.arena ?? null;
}

function participantSpecs(scenario: SimTrafficScenario, arena: SimTrafficArena): ScenarioParticipant[] {
  switch (scenario) {
    case "headOn":
      return [
        { name: `${PREFIX}A`, start: arena.left, goal: arena.right, priority: 100 },
        { name: `${PREFIX}B`, start: arena.right, goal: arena.left, priority: 50 },
      ];
    case "funnel":
      return [
        {
          name: `${PREFIX}A`,
          start: arena.left,
          goal: { x: arena.right.x, y: arena.right.y },
          priority: 100,
        },
        {
          name: `${PREFIX}B`,
          start: arena.top,
          goal: { x: arena.right.x, y: arena.right.y - 1 },
          priority: 80,
        },
        {
          name: `${PREFIX}C`,
          start: arena.bottom,
          goal: { x: arena.right.x, y: arena.right.y + 1 },
          priority: 60,
        },
      ];
    case "crossing":
      return [
        { name: `${PREFIX}A`, start: arena.left, goal: arena.right, priority: 100 },
        { name: `${PREFIX}B`, start: arena.right, goal: arena.left, priority: 80 },
        { name: `${PREFIX}C`, start: arena.top, goal: arena.bottom, priority: 60 },
        { name: `${PREFIX}D`, start: arena.bottom, goal: arena.top, priority: 40 },
      ];
  }
}

function target(point: Point, roomName: string): RoomObject {
  return { pos: new RoomPosition(point.x, point.y, roomName) } as RoomObject;
}

function atPoint(creep: Creep, point: Point): boolean {
  return creep.pos.x === point.x && creep.pos.y === point.y;
}

function clearNativeMovementCache(creep: Creep): void {
  const memory = creep.memory as CreepMemory & { _move?: unknown };
  delete memory._move;
  delete memory.movement;
}

function cleanupParticipants(): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.name.startsWith(PREFIX)) creep.suicide();
  }
}

function fail(state: SimTrafficState, reason: string): true {
  state.phase = "failed";
  state.failure = reason;
  state.completedAt = Game.time;
  console.log(`[simTraffic] FAILED ${state.scenario}: ${reason}`);
  return true;
}

function renderStatus(state = Memory.simTraffic): string {
  if (!state) return "simTraffic: no scenario configured";
  const arena = state.arena
    ? ` arena=(${state.arena.center.x},${state.arena.center.y})`
    : "";
  const positions = state.participants
    .map((name) => {
      const creep = Game.creeps[name];
      return creep ? `${name}=(${creep.pos.x},${creep.pos.y})` : `${name}=missing`;
    })
    .join(" ");
  const m = state.metrics;
  return [
    `simTraffic ${state.scenario} phase=${state.phase} tick=${Game.time}${arena}`,
    positions,
    `requests=${m.requests} cached=${m.cachedPathAttempts} pathFinds=${m.pathFinds} congestionRepaths=${m.congestionRepaths}`,
    `stuck=${m.stuckRequests} fatigueWaits=${m.fatigueWaits} contentionYields=${m.contentionYields} swapAttempts=${m.headOnSwapAttempts} swaps=${m.headOnSwaps}`,
    state.failure ? `failure=${state.failure}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function spawnMissingParticipants(
  state: SimTrafficState,
  room: Room,
  specs: ScenarioParticipant[],
): boolean {
  const missing = specs.find((spec) => !Game.creeps[spec.name]);
  if (!missing) return false;

  const spawn = Object.values(Game.spawns).find((candidate) => candidate.room.name === room.name);
  if (!spawn) {
    fail(state, "Simulation room has no owned spawn; add one in Survival before starting the bench");
    return true;
  }
  if (spawn.spawning) return true;
  if (spawn.store.getUsedCapacity(RESOURCE_ENERGY) < BODYPART_COST[MOVE]) return true;

  const result = spawn.spawnCreep([MOVE], missing.name);
  if (result !== OK && result !== ERR_BUSY) {
    fail(state, `Unable to spawn ${missing.name}; spawnCreep returned ${result}`);
  }
  return true;
}

function movementRequests(
  specs: ScenarioParticipant[],
  roomName: string,
  mode: "start" | "goal",
): MovementRequest[] {
  return specs.flatMap((spec) => {
    const creep = Game.creeps[spec.name];
    if (!creep || creep.spawning) return [];
    const point = mode === "start" ? spec.start : spec.goal;
    if (atPoint(creep, point)) return [];
    return [
      {
        creep,
        target: target(point, roomName),
        range: 0,
        priority: spec.priority,
        reason: `sim ${mode} ${spec.name}`,
      },
    ];
  });
}

function scenarioComplete(specs: ScenarioParticipant[]): boolean {
  return specs.every((spec) => {
    const creep = Game.creeps[spec.name];
    return creep !== undefined && !creep.spawning && atPoint(creep, spec.goal);
  });
}

function clearParticipantCaches(state: SimTrafficState, specs: ScenarioParticipant[]): boolean {
  for (const spec of specs) {
    const creep = Game.creeps[spec.name];
    if (!creep) return fail(state, `Participant ${spec.name} disappeared before scenario start`);
    clearNativeMovementCache(creep);
  }
  return false;
}

export function runSimTrafficHarness(): boolean {
  const state = Memory.simTraffic;
  if (!state?.active) return false;
  if (!isSimulation()) return fail(state, "simTraffic can only run in the browser Simulation room");

  const room = Game.rooms.sim;
  if (!room) return fail(state, "Simulation room 'sim' is not visible");

  if (!state.arena) {
    const arena = findArena(room);
    if (!arena) return fail(state, "Could not find an open 11-tile cross for deterministic traffic scenarios");
    state.arena = arena;
  }

  const specs = participantSpecs(state.scenario, state.arena);
  state.participants = specs.map((spec) => spec.name);

  if (state.phase === "complete" || state.phase === "failed") return true;

  if (spawnMissingParticipants(state, room, specs)) return true;
  if (specs.some((spec) => Game.creeps[spec.name]?.spawning)) return true;

  if (state.phase === "spawning") {
    state.phase = "staging";
    state.phaseStartedAt = Game.time;
    if (clearParticipantCaches(state, specs)) return true;
  }

  if (state.phase === "staging") {
    const requests = movementRequests(specs, room.name, "start");
    if (requests.length === 0) {
      state.phase = "running";
      state.phaseStartedAt = Game.time;
      state.runningTicks = 0;
      state.metrics = emptyMetrics();
      state.lastMetrics = emptyMetrics();
      if (clearParticipantCaches(state, specs)) return true;
      console.log(`[simTraffic] ${state.scenario} staged; stress phase begins at tick ${Game.time}`);
      return true;
    }

    state.lastMetrics = resolveMovementRequests(requests);
    if (Game.time - state.phaseStartedAt > STAGING_TIMEOUT) {
      return fail(state, "Participants could not reach deterministic staging positions");
    }
    return true;
  }

  if (scenarioComplete(specs)) {
    state.phase = "complete";
    state.completedAt = Game.time;
    console.log(`[simTraffic] PASS ${state.scenario}\n${renderStatus(state)}`);
    return true;
  }

  state.runningTicks = Game.time - state.phaseStartedAt;
  const requests = movementRequests(specs, room.name, "goal");
  state.lastMetrics = resolveMovementRequests(requests);
  addMetrics(state.metrics, state.lastMetrics);

  if (state.runningTicks >= SCENARIO_TIMEOUT[state.scenario]) {
    return fail(
      state,
      `Scenario exceeded ${SCENARIO_TIMEOUT[state.scenario]} running ticks without all participants reaching goals`,
    );
  }

  return true;
}

export const installSimTrafficDebug = (): void => {
  const globals = globalThis as typeof globalThis & {
    simTraffic?: {
      start: (scenario?: SimTrafficScenario) => string;
      status: () => string;
      stop: () => string;
      scenarios: () => string;
    };
  };

  globals.simTraffic = {
    start: (scenario: SimTrafficScenario = "headOn") => {
      if (!isSimulation()) return "simTraffic is only available in browser Simulation mode";
      if (!(["headOn", "funnel", "crossing"] as string[]).includes(scenario)) {
        return `Unknown scenario '${scenario}'. Use simTraffic.scenarios()`;
      }

      cleanupParticipants();
      Memory.simTraffic = {
        version: 1,
        active: true,
        scenario,
        phase: "spawning",
        startedAt: Game.time,
        phaseStartedAt: Game.time,
        participants: [],
        metrics: emptyMetrics(),
        lastMetrics: emptyMetrics(),
        runningTicks: 0,
      };
      const report = `simTraffic started '${scenario}' at tick ${Game.time}`;
      console.log(report);
      return report;
    },
    status: () => {
      const report = renderStatus();
      console.log(report);
      return report;
    },
    stop: () => {
      cleanupParticipants();
      if (Memory.simTraffic) Memory.simTraffic.active = false;
      const report = "simTraffic stopped; test creeps scheduled for cleanup";
      console.log(report);
      return report;
    },
    scenarios: () => "headOn | funnel | crossing",
  };
};
