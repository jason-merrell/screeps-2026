import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createIntentTrace } from "../src/intents/trace";
import { migrateMemory } from "../src/memory/migrate";
import { MEMORY_VERSION } from "../src/memory/schema";
import {
  activateApprovedColonyGovernance,
  authorizedFspmIntents,
  prepareFspmPlanningTick,
} from "../src/planning/fspm";

const ROOM = "W0N0";

function productionV8AuthorityFixture() {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/production-v8-task-authority.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (
    fixture.schemaVersion !== 1 ||
    fixture.memoryVersion !== 8 ||
    fixture.roomName !== ROOM ||
    fixture.sourceScenario !== "production-main-smoke:normal" ||
    fixture.projectionEncoding !== "json-stringify-v1" ||
    !Array.isArray(fixture.taskIds) ||
    !/^[0-9a-f]{64}$/.test(fixture.projectionSha256 ?? "")
  ) {
    throw new Error("production v8 authority fixture is malformed");
  }
  return fixture;
}

function taskAuthorityProjection(portfolio) {
  return Object.values(portfolio.tasks)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      deliverableId: task.deliverableId,
      domain: task.domain,
      taskKey: task.taskKey,
      taskWeightBasisPoints: task.taskWeight * 100,
      qualityDescription: task.qualityDescription,
      qualityMetric: task.qualityMetric,
      kpiMetric: task.kpiMetric,
      procedures: task.procedures.map((procedure) => ({
        id: procedure.id,
        procedureKey: procedure.procedureKey,
        title: procedure.title,
      })),
      recentActivities: [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function installProductionV8World() {
  const room = { name: ROOM, controller: { my: true } };
  const creep = {
    name: "worker-1",
    spawning: false,
    room,
    pos: { roomName: ROOM },
    memory: {},
    store: {
      getUsedCapacity: () => 0,
      getCapacity: () => 50,
    },
  };
  const source = {
    id: "source-1",
    room,
    pos: { roomName: ROOM },
  };
  Object.assign(globalThis, {
    Game: {
      time: 1,
      creeps: { "worker-1": creep },
      spawns: {},
      rooms: { [ROOM]: room },
      getObjectById: (id) => (id === source.id ? source : null),
    },
    Memory: {
      version: 8,
      colonies: {
        [ROOM]: { roomName: ROOM, discoveredAt: 1 },
      },
      runtimeSupervisor: { version: 1, phases: {} },
    },
  });
}

describe("literal production-v8 governed authority upgrade", () => {
  it("preserves Task authority and emits governed work on the first v10 tick", () => {
    installProductionV8World();
    const portfolio = activateApprovedColonyGovernance(ROOM);

    // This checked-in digest is the literal production-v8 authority projection.
    // The private-server smoke remains an independent end-to-end gate; tests do
    // not consume its mutable diagnostics artifact or race with its producer.
    const fixture = productionV8AuthorityFixture();
    const authorityProjection = taskAuthorityProjection(portfolio);
    expect(authorityProjection.map((task) => task.id)).toEqual(
      fixture.taskIds,
    );
    expect(
      createHash("sha256")
        .update(JSON.stringify(authorityProjection))
        .digest("hex"),
    ).toBe(fixture.projectionSha256);
    expect(
      Object.values(portfolio.tasks).every(
        (task) => !("activityKpiAggregation" in task),
      ),
    ).toBe(true);
    const authorityBeforeUpgrade = structuredClone(portfolio.tasks);

    migrateMemory();

    expect(Memory.version).toBe(MEMORY_VERSION);
    expect(Memory.colonies[ROOM].fspm.tasks).toEqual(authorityBeforeUpgrade);
    expect(() => activateApprovedColonyGovernance(ROOM)).not.toThrow();

    Game.time += 1;
    prepareFspmPlanningTick();
    const intent = {
      type: "harvest",
      creepName: "worker-1",
      sourceId: "source-1",
      priority: 100,
      reason: "prove governed planning remains live after v8 upgrade",
      trace: createIntentTrace({
        roomName: ROOM,
        domain: "economy",
        task: "maintain-colony-energy-service",
        procedure: "extract-source-energy",
      }),
    };
    expect(authorizedFspmIntents([intent])).toMatchObject({
      accepted: [intent],
      denied: { total: 0, byCode: {}, samples: [] },
    });
  });
});
