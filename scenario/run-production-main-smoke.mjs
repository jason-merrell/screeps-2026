import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { evaluateProductionPublicationWindow } from "./production-publication-window.mjs";
import { scenarioExitCode } from "./verdict-policy.mjs";

const require = createRequire(import.meta.url);
const { ScreepsServer } = require("screeps-server-mockup");
const mockupPackage = require("screeps-server-mockup/package.json");

const resultPath = process.env.SCENARIO_RESULT_PATH;
const bundlePath = path.resolve(
  process.env.SCENARIO_BUNDLE_PATH || "scenario/dist/production-main-smoke.js",
);
const expectedRuntimeSha = process.env.EXPECTED_RUNTIME_SHA;
const ticks = Number(process.env.PRODUCTION_SMOKE_TICKS || 12);
const mode = process.env.PRODUCTION_SMOKE_MODE || "normal";
const expectMaintenanceFault =
  process.env.SCENARIO_EXPECT_MAINTENANCE_FAULT === "true";
const expectMalformedAuthority =
  process.env.SCENARIO_EXPECT_MALFORMED_AUTHORITY === "true";
const expectMalformedColonyAuthority =
  process.env.SCENARIO_EXPECT_MALFORMED_COLONY_AUTHORITY === "true";
const expectAnyMalformedAuthority =
  expectMalformedAuthority || expectMalformedColonyAuthority;
const roomName = "W0N0";
const segmentId = 99;
const initialSpawnEnergy = 300;
const expectedMemoryVersion = 8;
const runRoot = path.resolve(
  "scenario",
  ".production-main-smoke",
  String(process.pid),
);
const serverPath = path.join(runRoot, "server");
const logdir = path.join(runRoot, "logs");
const port = 26000 + (process.pid % 1_000);
let server;
let exitCode = 1;

if (!resultPath) throw new Error("SCENARIO_RESULT_PATH is required");
if (!/^[0-9a-f]{40}$/i.test(expectedRuntimeSha ?? "")) {
  throw new Error("EXPECTED_RUNTIME_SHA must be a full 40-character Git SHA");
}
if (!Number.isInteger(ticks) || ticks < 5 || ticks > 20) {
  throw new Error(
    "PRODUCTION_SMOKE_TICKS must be an integer from 5 through 20",
  );
}
if (
  [
    expectMaintenanceFault,
    expectMalformedAuthority,
    expectMalformedColonyAuthority,
  ].filter(Boolean).length > 1
) {
  throw new Error(
    "maintenance-fault and malformed-authority modes must run independently",
  );
}

async function writeResult(result) {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function readLogTail(fileName, limit = 80) {
  try {
    const raw = await readFile(path.join(logdir, fileName), "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}

async function serverLogs() {
  const [storage, engineRunner, engineProcessor] = await Promise.all([
    readLogTail("storage.log"),
    readLogTail("engine_runner.log"),
    readLogTail("engine_processor.log"),
  ]);
  return { storage, engineRunner, engineProcessor };
}

function worldSnapshot(objects) {
  const spawn = objects.find((object) => object.type === "spawn");
  const creeps = objects.filter((object) => object.type === "creep");
  return {
    spawnEnergy: spawn?.store?.energy ?? null,
    spawnBusy: Boolean(spawn?.spawning),
    creeps: creeps.length,
    liveCreeps: creeps.filter((creep) => !creep.spawning).length,
  };
}

try {
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });
  const bundle = await readFile(bundlePath, "utf8");
  server = new ScreepsServer({ path: serverPath, logdir, port });
  server.on("error", (message) =>
    console.error(`[production-main-smoke] ${message}`),
  );

  await server.world.stubWorld();
  const bot = await server.world.addBot({
    username: "production-main-smoke",
    room: roomName,
    x: 25,
    y: 25,
    spawnName: "ProductionSmokeSpawn",
    cpu: 100,
    cpuAvailable: 10_000,
    modules: { main: bundle },
  });

  if (expectMalformedAuthority) {
    const { env } = await server.world.load();
    await env.set(
      env.keys.MEMORY + bot.id,
      JSON.stringify({
        version: 7,
        colonies: {},
        empireFspm: {},
        runtimeSupervisor: { version: 1, phases: {} },
      }),
    );
  } else if (expectMalformedColonyAuthority) {
    const { env } = await server.world.load();
    await env.set(
      env.keys.MEMORY + bot.id,
      JSON.stringify({
        version: 7,
        colonies: {
          [roomName]: {
            roomName,
            discoveredAt: 1,
            fspm: {
              requirements: {},
              deliverables: {},
              tasks: {},
              activities: {},
              qualityHistory: {},
              activityKpiHistory: {},
            },
          },
        },
        empireFspm: {
          p3: {
            id: "portfolio:empire:operations",
            type: "portfolio",
            subType: "ou_portfolio",
            name: "EMPIRE-PORTFOLIO-Empire Operations",
            description: "Production smoke canonical Empire authority",
            parentP3Id: null,
            temporalBasis: "game_tick",
            startTick: 1,
            status: "active",
            statusReason: "production smoke canonical Empire authority",
            createdAt: 1,
            updatedAt: 1,
          },
        },
        runtimeSupervisor: { version: 1, phases: {} },
      }),
    );
  }

  const consoleEvents = [];
  bot.on("console", (log = [], results = []) => {
    if (log.length === 0 && results.length === 0) return;
    consoleEvents.push({ log, results });
    if (consoleEvents.length > 80) consoleEvents.shift();
  });

  await server.start();
  const timeline = [];
  const publicationObservations = [];
  let finalMemory = null;
  let finalTrace = null;
  let engineSideEffectObserved = false;
  let malformedRootTicks = 0;
  let malformedColonyTicks = 0;

  for (let index = 0; index < ticks; index += 1) {
    await server.tick();
    const [rawMemory, segments, localCpu, gameTime, roomObjects] =
      await Promise.all([
        bot.memory,
        bot.getSegments([segmentId]),
        bot.lastUsedCpu,
        server.world.gameTime,
        server.world.roomObjects(roomName),
      ]);
    finalMemory = JSON.parse(rawMemory || "{}");
    finalTrace = segments[0] ? JSON.parse(segments[0]) : null;
    const tracePhaseStatus = Object.fromEntries(
      (Array.isArray(finalTrace?.runtime?.phases)
        ? finalTrace.runtime.phases
        : []
      ).map((phase) => [phase?.name, phase?.status]),
    );
    if (
      finalMemory?.empireFspm &&
      typeof finalMemory.empireFspm === "object" &&
      !Object.hasOwn(finalMemory.empireFspm, "p3")
    ) {
      malformedRootTicks += 1;
    }
    if (
      finalMemory?.colonies?.[roomName]?.fspm &&
      !Object.hasOwn(finalMemory.colonies[roomName].fspm, "p3")
    ) {
      malformedColonyTicks += 1;
    }
    const world = worldSnapshot(roomObjects);
    engineSideEffectObserved ||=
      world.creeps > 0 ||
      world.spawnBusy ||
      (typeof world.spawnEnergy === "number" &&
        world.spawnEnergy < initialSpawnEnergy);
    publicationObservations.push({
      index: index + 1,
      gameTime,
      publication: finalMemory.runtimeSupervisor?.lastPublication
        ? { ...finalMemory.runtimeSupervisor.lastPublication }
        : null,
      trace: finalTrace,
    });
    timeline.push({
      index: index + 1,
      gameTime,
      memoryVersion: finalMemory.version ?? null,
      colonies: Object.keys(finalMemory.colonies ?? {}).sort(),
      publicationTick:
        finalMemory.runtimeSupervisor?.lastPublication?.tick ?? null,
      segmentTick: finalTrace?.tick ?? null,
      segmentRuntimeSha: finalTrace?.runtimeSha ?? null,
      localServerCpu: localCpu ?? null,
      governedAccepted: finalTrace?.intents?.accepted ?? null,
      authorityDenied: finalTrace?.intents?.authorityDenied?.total ?? null,
      fspmIntegrity: finalTrace?.fspm?.integrity ?? null,
      phaseStatus: tracePhaseStatus,
      world,
    });
  }

  const publicationWindow = evaluateProductionPublicationWindow({
    ticks,
    mode,
    expectedRuntimeSha,
    observations: publicationObservations,
  });
  const acceptedObservationIndexes = new Set(
    publicationWindow.acceptedObservationIndexes,
  );
  const freshTraces = publicationObservations.flatMap((observation) =>
    acceptedObservationIndexes.has(observation.index) && observation.trace
      ? [observation.trace]
      : [],
  );
  const governedAcceptedTotal = freshTraces.reduce((sum, trace) => {
    const accepted = Number(trace?.intents?.accepted ?? 0);
    return sum + (Number.isFinite(accepted) ? accepted : 0);
  }, 0);
  const governedActivityObserved = freshTraces.some(
    (trace) => (trace?.fspm?.assignments?.length ?? 0) > 0,
  );
  const governedSpawnActivityObserved = freshTraces.some((trace) =>
    (Array.isArray(trace?.fspm?.colonies)
      ? trace.fspm.colonies.flatMap((colony) => colony?.activities ?? [])
      : []
    ).some(
      (activity) =>
        typeof activity?.taskId === "string" &&
        activity.taskId.includes(":spawning:maintain-workforce-capacity") &&
        activity.assignee === "spawn:ProductionSmokeSpawn",
    ),
  );
  const publishedTraceTicks = publicationWindow.freshPublications;
  const quarantinedTraceTicks = freshTraces.filter(
    (trace) =>
      trace?.fspm?.integrity?.authoritative === false &&
      trace?.fspm?.integrity?.byCode?.[
        expectMalformedColonyAuthority
          ? "colony_p3_missing"
          : "empire_p3_missing"
      ] === 1,
  ).length;
  const downstreamCompletedTicks = freshTraces.filter((trace) => {
    const statuses = Object.fromEntries(
      (Array.isArray(trace?.runtime?.phases) ? trace.runtime.phases : []).map(
        (phase) => [phase?.name, phase?.status],
      ),
    );
    return ["fspm_authority", "arbitration", "execution"].every(
      (phase) => statuses[phase] === "completed",
    );
  }).length;

  const tracePhases = new Set(
    Array.isArray(finalTrace?.runtime?.phases)
      ? finalTrace.runtime.phases.map((phase) => phase?.name)
      : [],
  );
  const failedTracePhases = (
    Array.isArray(finalTrace?.runtime?.phases) ? finalTrace.runtime.phases : []
  ).filter((phase) => phase?.status === "failed");
  const phaseStatus = Object.fromEntries(
    (Array.isArray(finalTrace?.runtime?.phases)
      ? finalTrace.runtime.phases
      : []
    ).map((phase) => [phase?.name, phase?.status]),
  );
  const unsupervisedRegistryClaims = [
    "memory",
    "perception",
    "observability",
  ].filter(
    (phase) =>
      Object.hasOwn(finalTrace?.runtime?.metrics ?? {}, phase) &&
      !tracePhases.has(phase),
  );
  const downstreamPhaseNames = ["fspm_authority", "arbitration", "execution"];
  const malformedFailureContained =
    JSON.stringify(failedTracePhases.map((phase) => phase?.name).sort()) ===
      JSON.stringify(["fspm_governance", "fspm_maintenance"]) &&
    failedTracePhases.every(
      (phase) => !downstreamPhaseNames.includes(phase?.name),
    );
  const assertions = [
    {
      name: "production main.loop completed the requested engine window",
      passed: timeline.length === ticks,
      actual: timeline.length,
      expected: ticks,
    },
    {
      name: "production memory migration completed",
      passed:
        finalMemory?.version === expectedMemoryVersion &&
        finalTrace?.memoryVersion === expectedMemoryVersion,
      actual: {
        memory: finalMemory?.version ?? null,
        trace: finalTrace?.memoryVersion ?? null,
      },
      expected: {
        memory: expectedMemoryVersion,
        trace: expectedMemoryVersion,
      },
    },
    {
      name: "owned colony was perceived and persisted",
      passed: Boolean(finalMemory?.colonies?.[roomName]),
      actual: Object.keys(finalMemory?.colonies ?? {}).sort(),
      expected: [roomName],
    },
    {
      name: "Segment 99 published a complete fresh tick-correlated window",
      passed: publicationWindow.passed,
      actual: publicationWindow,
      expected: {
        passed: true,
        expectedFreshPublications: ticks - 1,
        freshPublications: ticks - 1,
        invalidObservations: [],
      },
    },
    {
      name: "observability proves the exact candidate runtime SHA",
      passed: finalTrace?.runtimeSha === expectedRuntimeSha,
      actual: finalTrace?.runtimeSha ?? null,
      expected: expectedRuntimeSha,
    },
    {
      name: "survival and execution phases completed under production orchestration",
      passed: [
        "defense",
        "spawning",
        "economy",
        "fspm_maintenance",
        "fspm_authority",
        "arbitration",
        "execution",
      ].every((phase) => tracePhases.has(phase)),
      actual: [...tracePhases].sort(),
      expected: [
        "defense",
        "spawning",
        "economy",
        "fspm_maintenance",
        "fspm_authority",
        "arbitration",
        "execution",
      ],
    },
    {
      name: expectAnyMalformedAuthority
        ? "malformed governance failures are contained before downstream execution"
        : expectMaintenanceFault
          ? "fault is contained to FSPM maintenance"
          : "no supervised runtime phase reported failed status",
      passed: expectAnyMalformedAuthority
        ? malformedFailureContained
        : expectMaintenanceFault
          ? failedTracePhases.length === 1 &&
            failedTracePhases[0]?.name === "fspm_maintenance"
          : failedTracePhases.length === 0,
      actual: failedTracePhases,
      expected: expectAnyMalformedAuthority
        ? {
            includes: [
              { name: "fspm_governance", status: "failed" },
              { name: "fspm_maintenance", status: "failed" },
            ],
            excludes: downstreamPhaseNames,
          }
        : expectMaintenanceFault
          ? [{ name: "fspm_maintenance", status: "failed" }]
          : [],
    },
    {
      name: "authority, arbitration, and execution complete after maintenance boundary",
      passed: ["fspm_authority", "arbitration", "execution"].every(
        (phase) => phaseStatus[phase] === "completed",
      ),
      actual: phaseStatus,
      expected: {
        fspm_authority: "completed",
        arbitration: "completed",
        execution: "completed",
      },
    },
    {
      name: expectAnyMalformedAuthority
        ? "malformed authority remained fail-closed"
        : "governed survival work remained authorized",
      passed: expectAnyMalformedAuthority
        ? governedAcceptedTotal === 0
        : governedAcceptedTotal > 0,
      actual: governedAcceptedTotal,
      expected: expectAnyMalformedAuthority ? 0 : "> 0",
    },
    {
      name: expectAnyMalformedAuthority
        ? "no Activity evidence was fabricated under malformed authority"
        : "the governed spawn retained FSPM Activity evidence",
      passed: expectAnyMalformedAuthority
        ? !governedActivityObserved && !governedSpawnActivityObserved
        : governedActivityObserved && governedSpawnActivityObserved,
      actual: { governedActivityObserved, governedSpawnActivityObserved },
      expected: expectAnyMalformedAuthority
        ? {
            governedActivityObserved: false,
            governedSpawnActivityObserved: false,
          }
        : {
            governedActivityObserved: true,
            governedSpawnActivityObserved: true,
          },
    },
    {
      name: expectAnyMalformedAuthority
        ? "no unauthoritative spawn reached the Screeps engine"
        : "the authorized spawn reached the Screeps engine",
      passed: expectAnyMalformedAuthority
        ? !engineSideEffectObserved
        : engineSideEffectObserved,
      actual: {
        engineSideEffectObserved,
        finalWorld: timeline.at(-1)?.world ?? null,
      },
      expected: !expectAnyMalformedAuthority,
    },
    ...(expectAnyMalformedAuthority
      ? [
          {
            name: expectMalformedColonyAuthority
              ? "malformed colony root was never repaired or treated as authority"
              : "malformed Empire root was never repaired or treated as authority",
            passed: expectMalformedColonyAuthority
              ? malformedColonyTicks === ticks &&
                finalTrace?.fspm?.rootP3?.id ===
                  "portfolio:empire:operations" &&
                finalTrace?.fspm?.colonies?.find(
                  (colony) => colony?.roomName === roomName,
                )?.p3 === null
              : malformedRootTicks === ticks &&
                finalTrace?.fspm?.rootP3 === null,
            actual: expectMalformedColonyAuthority
              ? {
                  malformedColonyTicks,
                  finalRootP3: finalTrace?.fspm?.rootP3 ?? null,
                  finalColonyP3:
                    finalTrace?.fspm?.colonies?.find(
                      (colony) => colony?.roomName === roomName,
                    )?.p3 ?? null,
                }
              : {
                  malformedRootTicks,
                  finalRootP3: finalTrace?.fspm?.rootP3 ?? null,
                },
            expected: expectMalformedColonyAuthority
              ? {
                  malformedColonyTicks: ticks,
                  finalRootP3: "portfolio:empire:operations",
                  finalColonyP3: null,
                }
              : { malformedRootTicks: ticks, finalRootP3: null },
          },
          {
            name: "every available Segment 99 trace published bounded integrity quarantine evidence",
            passed:
              publicationWindow.passed &&
              publishedTraceTicks === ticks - 1 &&
              quarantinedTraceTicks === publishedTraceTicks &&
              finalTrace?.fspm?.integrity?.total === 1 &&
              (finalTrace?.fspm?.integrity?.samples?.length ?? 0) <=
                (finalTrace?.fspm?.integrity?.sampleLimit ?? 0),
            actual: {
              publishedTraceTicks,
              quarantinedTraceTicks,
              integrity: finalTrace?.fspm?.integrity ?? null,
            },
            expected: {
              publishedTraceTicks: ticks - 1,
              quarantinedTraceTicks: "equal to publishedTraceTicks",
              integrityTotal: 1,
              boundedSamples: true,
            },
          },
          {
            name: "authority, arbitration, and execution kept completing after quarantine",
            passed: downstreamCompletedTicks === publishedTraceTicks,
            actual: { downstreamCompletedTicks, publishedTraceTicks },
            expected: { downstreamCompletedTicks: publishedTraceTicks },
          },
        ]
      : []),
    {
      name: "registry makes no zero-sample claims for unsupervised boundaries",
      passed: unsupervisedRegistryClaims.length === 0,
      actual: unsupervisedRegistryClaims,
      expected: [],
    },
  ];
  const passed = assertions.every((assertion) => assertion.passed);
  const result = {
    name: `production-main-smoke:${mode}`,
    status: passed ? "passed" : "failed",
    error: passed ? null : "One or more production main.loop assertions failed",
    engine: {
      serverMockup: mockupPackage.version,
      node: process.version,
      ticks,
      mode,
      expectMaintenanceFault,
      expectMalformedAuthority,
      expectMalformedColonyAuthority,
    },
    runtime: {
      expectedSha: expectedRuntimeSha,
      observedSha: finalTrace?.runtimeSha ?? null,
      memoryVersion: finalMemory?.version ?? null,
      room: roomName,
      governedAcceptedTotal,
      governedActivityObserved,
      governedSpawnActivityObserved,
      engineSideEffectObserved,
      publishedTraceTicks,
      quarantinedTraceTicks,
      malformedRootTicks,
      malformedColonyTicks,
      downstreamCompletedTicks,
      publicationWindow,
    },
    assertions,
    timeline,
    consoleEvents,
    finalTrace,
  };
  await writeResult(result);
  exitCode = scenarioExitCode(result.status);
  console.log(
    `[production-main-smoke] ${result.status}; ticks=${timeline.length}; runtimeSha=${finalTrace?.runtimeSha ?? "missing"}`,
  );
} catch (error) {
  await writeResult({
    name: `production-main-smoke:${mode}`,
    status: "infrastructure-failed",
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    engine: {
      serverMockup: mockupPackage.version,
      node: process.version,
      mode,
      expectMaintenanceFault,
      expectMalformedAuthority,
      expectMalformedColonyAuthority,
    },
    serverLogs: await serverLogs(),
  });
  exitCode = scenarioExitCode("infrastructure-failed");
  console.error("[production-main-smoke] infrastructure failure", error);
} finally {
  if (server) server.stop();
  await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  process.exit(exitCode);
}
