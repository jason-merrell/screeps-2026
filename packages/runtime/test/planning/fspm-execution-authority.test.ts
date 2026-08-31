import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIntentTrace } from "../../src/intents/trace";
import type {
  CreateConstructionSiteIntent,
  HarvestIntent,
  Intent,
  SpawnIntent,
  TowerAttackIntent,
} from "../../src/intents/types";
import { bindFspmActivities } from "../../src/planning/activity-lifecycle";
import {
  activateApprovedColonyGovernance,
  authorizedFspmIntents,
  type ColonyFspmPortfolio,
  createFspmAuthoritySnapshot,
  ensureColonyPortfolio,
  type FspmAuthorityDenialCode,
  getFspmPlanningAuthorityDiagnostics,
  reconcileFspmLifecycle,
  resolveActiveFspmAuthority,
  validateFspmIntentAuthority,
} from "../../src/planning/fspm";
import {
  FSPM_GOVERNANCE_SHA,
  fspmProcedureDefinition,
} from "../../src/planning/fspm-catalog";

vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");

const GOVERNANCE_SHA = "02d581886a759d19044ff91a80d743fa042f23f7";
const ROOM = "W1N1";
const TASK_KEY = "maintain-colony-energy-service";
const PROCEDURE_KEY = "extract-source-energy";

function installGlobals(): void {
  const room = { name: ROOM } as Room;
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
  } as unknown as Creep;
  const objects: Record<string, RoomObject> = {
    "source-1": {
      id: "source-1",
      room,
      pos: { roomName: ROOM },
    } as unknown as Source,
  };

  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: { "worker-1": creep },
      spawns: {},
      rooms: {
        [ROOM]: { name: ROOM, controller: { my: true } },
      },
      objects,
      getObjectById: (id: string) => objects[id] ?? null,
    },
    Memory: {
      version: 6,
      colonies: {
        [ROOM]: { roomName: ROOM, discoveredAt: 1 },
      },
    },
  });
}

function canonicalIntent(): HarvestIntent {
  return {
    type: "harvest",
    creepName: "worker-1",
    sourceId: "source-1" as Id<Source>,
    priority: 100,
    reason: "exercise canonical FSPM execution authority",
    trace: createIntentTrace({
      roomName: ROOM,
      domain: "economy",
      task: TASK_KEY,
      procedure: PROCEDURE_KEY,
    }),
  };
}

function portfolio(): ColonyFspmPortfolio {
  return ensureColonyPortfolio(ROOM);
}

function denialCode(intent: HarvestIntent): FspmAuthorityDenialCode {
  const result = validateFspmIntentAuthority(intent);
  if (result.authorized) throw new Error("expected FSPM authority denial");
  return result.code;
}

describe("FSPM execution authority invariant", () => {
  beforeEach(() => {
    installGlobals();
    activateApprovedColonyGovernance(ROOM);
  });

  it("authorizes and binds the exact active canonical lineage", () => {
    expect(FSPM_GOVERNANCE_SHA).toBe(GOVERNANCE_SHA);
    const intent = canonicalIntent();

    const authority = validateFspmIntentAuthority(intent);
    expect(authority).toMatchObject({
      authorized: true,
      requirement: { id: intent.trace?.requirementId, status: "active" },
      deliverable: { id: intent.trace?.deliverableId, status: "active" },
      task: { id: intent.trace?.taskId, status: "active" },
      procedure: {
        id: intent.trace?.procedureId,
        taskId: intent.trace?.taskId,
      },
    });
    expect(authorizedFspmIntents([intent]).accepted).toEqual([intent]);

    bindFspmActivities([intent]);

    expect(Object.values(portfolio().activities ?? {})).toEqual([
      expect.objectContaining({
        id: intent.trace?.activityId,
        taskId: intent.trace?.taskId,
        currentProcedureId: intent.trace?.procedureId,
        status: "in_progress",
      }),
    ]);
  });

  it("does not create or resume an Activity from a retired Task", () => {
    const first = canonicalIntent();
    bindFspmActivities([first]);
    const activityId = first.trace?.activityId;
    if (!activityId || !first.trace)
      throw new Error("expected governed Activity");

    const currentPortfolio = portfolio();
    const activity = currentPortfolio.activities?.[activityId];
    const task = currentPortfolio.tasks[first.trace.taskId];
    if (!activity || !task)
      throw new Error("expected governed Task and Activity");
    activity.status = "on_hold";
    task.status = "retired";
    task.statusReason = "operator withdrew execution authority";
    task.retiredAt = Game.time;

    Game.time = 101;
    const { activityId: _activityId, ...staleTrace } = first.trace;
    const attemptedResume: HarvestIntent = {
      ...first,
      trace: staleTrace,
    };

    expect(task).toMatchObject({
      status: "retired",
      statusReason: "operator withdrew execution authority",
      retiredAt: 100,
    });
    expect(denialCode(attemptedResume)).toBe("task_inactive");
    expect(authorizedFspmIntents([attemptedResume]).accepted).toEqual([]);

    bindFspmActivities([attemptedResume]);

    expect(attemptedResume.trace?.activityId).toBeUndefined();
    expect(currentPortfolio.activities?.[activityId]).toMatchObject({
      id: activityId,
      status: "on_hold",
      metrics: { resumeCount: 0 },
    });
    expect(Object.keys(currentPortfolio.activities ?? {})).toEqual([
      activityId,
    ]);
  });

  it.each([
    {
      label: "inactive Empire Portfolio",
      expected: "empire_p3_inactive" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        if (!Memory.empireFspm) throw new Error("expected Empire Portfolio");
        Memory.empireFspm.p3.status = "retired";
        return current;
      },
    },
    {
      label: "inactive colony Portfolio",
      expected: "p3_inactive" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        current.p3.status = "cancelled";
        return current;
      },
    },
    {
      label: "inactive Requirement",
      expected: "requirement_inactive" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        if (!current.requirements.economy)
          throw new Error("expected Requirement");
        current.requirements.economy.status = "completed";
        return current;
      },
    },
    {
      label: "inactive Deliverable",
      expected: "deliverable_inactive" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        if (!current.deliverables.economy)
          throw new Error("expected Deliverable");
        current.deliverables.economy.status = "retired";
        return current;
      },
    },
  ])("fails closed for an $label", ({ expected, mutate }) => {
    const intent = canonicalIntent();
    mutate(portfolio());

    expect(denialCode(intent)).toBe(expected);
    bindFspmActivities([intent]);
    expect(intent.trace?.activityId).toBeUndefined();
    expect(portfolio().activities).toEqual({});
  });

  it.each(["completed", "cancelled", "retired"] as const)(
    "does not implicitly reactivate a %s ancestor from planner demand",
    (status) => {
      const intent = canonicalIntent();
      const requirement = portfolio().requirements.economy;
      if (!requirement) throw new Error("expected Requirement");
      requirement.status = status;
      requirement.statusReason = `operator set Requirement ${status}`;

      expect(() => reconcileFspmLifecycle([intent])).toThrow(
        /Cannot reconcile invalid FSPM governance/i,
      );

      expect(requirement).toMatchObject({
        status,
        statusReason: `operator set Requirement ${status}`,
      });
      expect(denialCode(intent)).toBe("requirement_inactive");
      expect(authorizedFspmIntents([intent]).accepted).toEqual([]);
    },
  );

  it.each([
    {
      label: "missing Empire Portfolio",
      expected: "empire_p3_missing" as const,
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        (
          Memory as unknown as {
            empireFspm: Memory["empireFspm"] | undefined;
          }
        ).empireFspm = undefined;
        return { current, intent };
      },
    },
    {
      label: "missing colony Portfolio",
      expected: "p3_missing" as const,
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        if (!intent.trace) throw new Error("expected trace");
        intent.trace.p3Id = "portfolio:colony:missing";
        return { current, intent };
      },
    },
    {
      label: "missing Requirement",
      expected: "requirement_missing" as const,
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        (
          current.requirements as {
            economy: ColonyFspmPortfolio["requirements"]["economy"] | undefined;
          }
        ).economy = undefined;
        return { current, intent };
      },
    },
    {
      label: "missing Deliverable",
      expected: "deliverable_missing" as const,
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        (
          current.deliverables as {
            economy: ColonyFspmPortfolio["deliverables"]["economy"] | undefined;
          }
        ).economy = undefined;
        return { current, intent };
      },
    },
    {
      label: "missing Task",
      expected: "task_missing" as const,
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        if (!intent.trace) throw new Error("expected trace");
        (current.tasks as Partial<ColonyFspmPortfolio["tasks"]>)[
          intent.trace.taskId
        ] = undefined;
        return { current, intent };
      },
    },
  ])("fails closed for a $label ancestor", ({ expected, mutate }) => {
    const intent = canonicalIntent();
    mutate(portfolio(), intent);

    expect(denialCode(intent)).toBe(expected);
    expect(authorizedFspmIntents([intent]).accepted).toEqual([]);
  });

  it.each([
    {
      label: "colony Portfolio parent",
      expected: "p3_mismatch" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        (current.p3 as { parentP3Id: string | null }).parentP3Id = null;
      },
    },
    {
      label: "Requirement parent",
      expected: "requirement_mismatch" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        if (!current.requirements.economy)
          throw new Error("expected Requirement");
        current.requirements.economy.p3Id = "portfolio:colony:other";
      },
    },
    {
      label: "Deliverable parent",
      expected: "deliverable_mismatch" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        if (!current.deliverables.economy)
          throw new Error("expected Deliverable");
        current.deliverables.economy.requirementId =
          "requirement:other:economy";
      },
    },
    {
      label: "Task parent",
      expected: "task_mismatch" as const,
      mutate: (current: ColonyFspmPortfolio) => {
        const task = Object.values(current.tasks)[0];
        if (!task) throw new Error("expected Task");
        task.deliverableId = "deliverable:other:economy";
      },
    },
  ])(
    "does not repair or authorize a mismatched $label",
    ({ expected, mutate }) => {
      const intent = canonicalIntent();
      const current = portfolio();
      mutate(current);

      const before = structuredClone(current);
      expect(denialCode(intent)).toBe(expected);
      expect(portfolio()).toEqual(before);
      expect(authorizedFspmIntents([intent]).accepted).toEqual([]);
    },
  );

  it("rejects a Procedure whose parent Task does not match the trace Task", () => {
    const intent = canonicalIntent();
    if (!intent.trace) throw new Error("expected trace");
    const current = portfolio();
    const task = current.tasks[intent.trace.taskId];
    const procedure = task?.procedures.find(
      (candidate) => candidate.id === intent.trace?.procedureId,
    );
    if (!procedure) throw new Error("expected Procedure");
    procedure.taskId = "task:W1N1:economy:other";

    expect(denialCode(intent)).toBe("procedure_mismatch");
    bindFspmActivities([intent]);
    expect(intent.trace.activityId).toBeUndefined();
    expect(current.activities).toEqual({});
  });

  it("requires the exact canonical Task identity and refuses an unknown mutation", () => {
    const intent = canonicalIntent();
    if (!intent.trace) throw new Error("expected trace");
    const task = portfolio().tasks[intent.trace.taskId];
    if (!task) throw new Error("expected Task");
    task.taskKey = "forged-task-definition";

    expect(denialCode(intent)).toBe("task_catalog_mismatch");
    bindFspmActivities([intent]);
    expect(intent.trace.activityId).toBeUndefined();
    expect(portfolio().activities).toEqual({});
  });

  it("rejects a forged extra Procedure even when its key names a catalog Procedure", () => {
    const intent = canonicalIntent();
    if (!intent.trace) throw new Error("expected trace");
    const task = portfolio().tasks[intent.trace.taskId];
    if (!task) throw new Error("expected Task");
    const forgedId = `${intent.trace.procedureId}:forged`;
    task.procedures = [
      ...task.procedures,
      {
        id: forgedId,
        taskId: task.id,
        procedureKey: PROCEDURE_KEY,
        title: "Forged Procedure",
      },
    ];
    intent.trace.procedureId = forgedId;

    expect(denialCode(intent)).toBe("procedure_catalog_mismatch");
    expect(authorizedFspmIntents([intent]).accepted).toEqual([]);
  });

  it("rejects an exact legitimate sibling Procedure for the wrong intent operation", () => {
    const intent = canonicalIntent();
    intent.trace = createIntentTrace({
      roomName: ROOM,
      domain: "economy",
      task: TASK_KEY,
      procedure: "fund-workforce-energy",
    });

    expect(denialCode(intent)).toBe("intent_type_mismatch");
    const batch = authorizedFspmIntents([intent]);
    expect(batch.accepted).toEqual([]);
    expect(batch.denied).toMatchObject({
      total: 1,
      byCode: { intent_type_mismatch: 1 },
    });
    const bindingDenied = bindFspmActivities([intent], batch.snapshot);
    expect(bindingDenied).toMatchObject({
      total: 1,
      byCode: { intent_type_mismatch: 1 },
    });
    expect(portfolio().activities).toEqual({});
  });

  it("keeps Procedure capability immutable while a same-tick snapshot is live", () => {
    const intent = canonicalIntent();
    intent.trace = createIntentTrace({
      roomName: ROOM,
      domain: "economy",
      task: TASK_KEY,
      procedure: "fund-workforce-energy",
    });
    const snapshot = createFspmAuthoritySnapshot();
    const definition = fspmProcedureDefinition(
      "economy",
      TASK_KEY,
      "fund-workforce-energy",
    );
    if (!definition) throw new Error("expected Procedure definition");

    expect(snapshot.resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "intent_type_mismatch",
    });
    expect(() =>
      (definition.allowedIntentTypes as Intent["type"][]).push("harvest"),
    ).toThrow(TypeError);
    expect(definition.allowedIntentTypes).toEqual(["transfer"]);
    expect(snapshot.resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "intent_type_mismatch",
    });
  });

  it("revalidates the full intent during binding after proposal authorization", () => {
    const intent = canonicalIntent();
    const batch = authorizedFspmIntents([intent]);
    expect(batch.accepted).toEqual([intent]);

    (intent as unknown as { type: "transfer" }).type = "transfer";
    const bindingDenied = bindFspmActivities(batch.accepted, batch.snapshot);

    expect(bindingDenied).toMatchObject({
      total: 1,
      byCode: { intent_type_mismatch: 1 },
    });
    expect(intent.trace?.activityId).toBeUndefined();
    expect(portfolio().activities).toEqual({});
  });

  it("rejects duplicate exact Procedure identities as ambiguous", () => {
    const intent = canonicalIntent();
    if (!intent.trace) throw new Error("expected trace");
    const task = portfolio().tasks[intent.trace.taskId];
    const procedure = task?.procedures.find(
      (candidate) => candidate.id === intent.trace?.procedureId,
    );
    if (!task || !procedure) throw new Error("expected canonical Procedure");
    task.procedures = [...task.procedures, { ...procedure }];

    expect(denialCode(intent)).toBe("procedure_ambiguous");
  });

  it("fails closed and reports a trace-missing intent without binding evidence", () => {
    const intent = canonicalIntent();
    delete intent.trace;
    const batch = authorizedFspmIntents([intent]);

    expect(batch.accepted).toEqual([]);
    expect(batch.denied).toEqual({
      total: 1,
      byCode: { trace_missing: 1 },
      samples: [
        expect.objectContaining({
          code: "trace_missing",
          intentType: "harvest",
          trace: null,
        }),
      ],
    });
    bindFspmActivities([intent], batch.snapshot);
    expect(portfolio().activities).toEqual({});
  });

  it("does not mutate any Memory while refusing planner trace creation under a Retired Task", () => {
    const first = canonicalIntent();
    if (!first.trace) throw new Error("expected trace");
    const task = portfolio().tasks[first.trace.taskId];
    if (!task) throw new Error("expected Task");
    task.status = "retired";
    task.statusReason = "governed retirement";
    task.retiredAt = 99;
    const before = structuredClone(Memory);

    expect(() => canonicalIntent()).toThrow(/Task .* is retired/);
    expect(Memory).toEqual(before);
  });

  it("does not mutate any Memory while refusing planner trace creation under an inactive ancestor", () => {
    canonicalIntent();
    const requirement = portfolio().requirements.economy;
    if (!requirement) throw new Error("expected Requirement");
    requirement.status = "completed";
    requirement.statusReason = "governed acceptance reached";
    const before = structuredClone(Memory);

    expect(() => canonicalIntent()).toThrow(/Requirement is completed/);
    expect(Memory).toEqual(before);
  });

  it.each([
    {
      label: "Empire Portfolio",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        if (!Memory.empireFspm) throw new Error("expected Empire Portfolio");
        (Memory.empireFspm.p3 as { id: string }).id = "portfolio:empire:forged";
        return { current, intent };
      },
    },
    {
      label: "colony Portfolio",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        (current.p3 as { parentP3Id: string | null }).parentP3Id = null;
        return { current, intent };
      },
    },
    {
      label: "Empire Portfolio temporal basis",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        if (!Memory.empireFspm) throw new Error("expected Empire Portfolio");
        Memory.empireFspm.p3.temporalBasis = "wall_clock" as never;
        return { current, intent };
      },
    },
    {
      label: "colony Portfolio blank name",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        current.p3.name = "";
        return { current, intent };
      },
    },
    {
      label: "colony Portfolio invalid start tick",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        current.p3.startTick = Number.NaN;
        return { current, intent };
      },
    },
    {
      label: "Requirement",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        const requirement = current.requirements.economy;
        if (!requirement) throw new Error("expected Requirement");
        requirement.p3Id = "portfolio:colony:forged";
        return { current, intent };
      },
    },
    {
      label: "Deliverable",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        const deliverable = current.deliverables.economy;
        if (!deliverable) throw new Error("expected Deliverable");
        deliverable.requirementId = "requirement:forged:economy";
        return { current, intent };
      },
    },
    {
      label: "Task",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        if (!intent.trace) throw new Error("expected trace");
        const task = current.tasks[intent.trace.taskId];
        if (!task) throw new Error("expected Task");
        task.deliverableId = "deliverable:forged:economy";
        return { current, intent };
      },
    },
    {
      label: "Procedure",
      mutate: (current: ColonyFspmPortfolio, intent: HarvestIntent) => {
        if (!intent.trace) throw new Error("expected trace");
        const task = current.tasks[intent.trace.taskId];
        const procedure = task?.procedures.find(
          (candidate) => candidate.id === intent.trace?.procedureId,
        );
        if (!procedure) throw new Error("expected Procedure");
        procedure.taskId = "task:forged:economy";
        return { current, intent };
      },
    },
  ])(
    "does not mutate Memory while refusing planner trace creation through a contradictory $label",
    ({ mutate }) => {
      const intent = canonicalIntent();
      mutate(portfolio(), intent);
      const before = structuredClone(Memory);

      expect(() => canonicalIntent()).toThrow(
        /identity is not canonical|Task definition is not canonical/,
      );
      expect(Memory).toEqual(before);
    },
  );

  it.each([
    {
      label: "Task",
      input: {
        roomName: ROOM,
        domain: "economy" as const,
        task: "unknown-task",
        procedure: PROCEDURE_KEY,
      },
    },
    {
      label: "Procedure",
      input: {
        roomName: ROOM,
        domain: "economy" as const,
        task: TASK_KEY,
        procedure: "unknown-procedure",
      },
    },
  ])(
    "rejects an unknown catalog $label before creating any governance records",
    ({ input }) => {
      const before = structuredClone(Memory);

      expect(() => createIntentTrace(input)).toThrow(/Unknown FSPM/);
      expect(Memory).toEqual(before);
    },
  );

  it("never canonicalizes or appends Procedures to Retired Task history", () => {
    const first = canonicalIntent();
    if (!first.trace) throw new Error("expected trace");
    const task = portfolio().tasks[first.trace.taskId];
    if (!task) throw new Error("expected Task");
    task.status = "retired";
    task.title = "historical title retained verbatim";
    task.procedures = [];
    const before = structuredClone(task);

    ensureColonyPortfolio(ROOM);

    expect(portfolio().tasks[first.trace.taskId]).toEqual(before);
  });

  it("reuses one indexed tick snapshot across linear authorization and binding", () => {
    const intents = Array.from({ length: 64 }, () => canonicalIntent());
    const snapshot = createFspmAuthoritySnapshot();
    const batch = authorizedFspmIntents(intents, snapshot);

    expect(batch.snapshot).toBe(snapshot);
    expect(snapshot.stats).toEqual({
      colonies: 1,
      requirements: 4,
      deliverables: 4,
      tasks: 6,
      procedures: 19,
    });
    expect(batch.accepted).toHaveLength(64);
    bindFspmActivities(batch.accepted, snapshot);
    expect(Object.keys(portfolio().activities ?? {})).toHaveLength(1);
  });

  it("builds one global planning authority index for a large fresh intent batch", () => {
    const before = getFspmPlanningAuthorityDiagnostics();
    const traces = Array.from({ length: 256 }, () =>
      createIntentTrace({
        roomName: ROOM,
        domain: "economy",
        task: TASK_KEY,
        procedure: PROCEDURE_KEY,
      }),
    );
    const after = getFspmPlanningAuthorityDiagnostics();

    expect(traces).toHaveLength(256);
    expect(after.traceAuthorityChecks - before.traceAuthorityChecks).toBe(256);
    expect(
      after.globalRegistryTraversals - before.globalRegistryTraversals,
    ).toBe(1);
  });

  it("rebuilds the planning authority index exactly once after tick rollover", () => {
    const before = getFspmPlanningAuthorityDiagnostics();

    canonicalIntent();
    canonicalIntent();
    Game.time += 1;
    canonicalIntent();
    canonicalIntent();

    const after = getFspmPlanningAuthorityDiagnostics();
    expect(after.traceAuthorityChecks - before.traceAuthorityChecks).toBe(4);
    expect(
      after.globalRegistryTraversals - before.globalRegistryTraversals,
    ).toBe(2);
  });

  it.each([
    {
      label: "Empire P3 replacement",
      mutate: () => {
        if (!Memory.empireFspm) throw new Error("expected Empire Portfolio");
        Memory.empireFspm.p3 = { ...Memory.empireFspm.p3 };
      },
    },
    {
      label: "colony hierarchy replacement",
      mutate: () => {
        const colony = Memory.colonies[ROOM];
        if (!colony?.fspm) throw new Error("expected colony Portfolio");
        colony.fspm = structuredClone(colony.fspm);
      },
    },
    {
      label: "Requirement replacement",
      mutate: () => {
        const current = Memory.colonies[ROOM]?.fspm;
        const requirement = current?.requirements.economy;
        if (!current || !requirement) throw new Error("expected Requirement");
        current.requirements.economy = { ...requirement };
      },
    },
    {
      label: "Task identity mutation",
      mutate: () => {
        const current = Memory.colonies[ROOM]?.fspm;
        const task = current?.tasks[`task:${ROOM}:economy:${TASK_KEY}`];
        if (!task) throw new Error("expected Task");
        task.deliverableId = "deliverable:forged:economy";
      },
    },
    {
      label: "Procedure insertion",
      mutate: () => {
        const current = Memory.colonies[ROOM]?.fspm;
        const task = current?.tasks[`task:${ROOM}:economy:${TASK_KEY}`];
        const procedure = task?.procedures[0];
        if (!task || !procedure) throw new Error("expected Procedure");
        task.procedures.push({ ...procedure });
      },
    },
  ])(
    "rejects same-tick $label after indexing without mutating Memory",
    ({ mutate }) => {
      canonicalIntent();
      const beforeMutation = structuredClone(Memory);
      try {
        mutate();
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        expect(Memory).toEqual(beforeMutation);
        return;
      }
      const before = structuredClone(Memory);

      expect(() => canonicalIntent()).toThrow(/changed|canonical|ambiguous/i);
      expect(Memory).toEqual(before);
    },
  );

  it("invalidates the tick index for an in-place identity mutation in a non-requested colony", () => {
    Memory.colonies.W9N9 = { roomName: "W9N9", discoveredAt: 1 };
    activateApprovedColonyGovernance("W9N9");
    createIntentTrace({
      roomName: "W9N9",
      domain: "economy",
      task: TASK_KEY,
      procedure: PROCEDURE_KEY,
    });
    canonicalIntent();

    const foreignTask =
      Memory.colonies.W9N9?.fspm?.tasks[`task:W9N9:economy:${TASK_KEY}`];
    if (!foreignTask) throw new Error("expected foreign Task");
    foreignTask.id = `task:${ROOM}:economy:${TASK_KEY}`;
    const before = structuredClone(Memory);

    expect(() => canonicalIntent()).toThrow(
      /Task (?:identity|definition) is not canonical|globally indexed authority changed outside/i,
    );
    expect(Memory).toEqual(before);
  });

  it.each([
    {
      label: "missing",
      mutate: (task: NonNullable<ColonyFspmPortfolio["tasks"][string]>) =>
        task.procedures.slice(0, -1),
    },
    {
      label: "extra",
      mutate: (task: NonNullable<ColonyFspmPortfolio["tasks"][string]>) => {
        const first = task.procedures[0];
        if (!first) throw new Error("expected canonical Procedure");
        return [
          ...task.procedures,
          {
            ...first,
            id: `${first.id}:extra`,
          },
        ];
      },
    },
    {
      label: "reordered",
      mutate: (task: NonNullable<ColonyFspmPortfolio["tasks"][string]>) =>
        [...task.procedures].reverse(),
    },
    {
      label: "non-catalog",
      mutate: (task: NonNullable<ColonyFspmPortfolio["tasks"][string]>) => [
        ...task.procedures.slice(0, -1),
        {
          id: `procedure:${ROOM}:economy:${TASK_KEY}:forged-procedure`,
          taskId: task.id,
          procedureKey: "forged-procedure",
          title: "Forged Procedure",
        },
      ],
    },
  ])(
    "rejects a pre-existing Active Task with a $label Procedure set during global preflight",
    ({ mutate }) => {
      const intent = canonicalIntent();
      if (!intent.trace) throw new Error("expected trace");
      const task = Memory.colonies[ROOM]?.fspm?.tasks[intent.trace.taskId];
      if (!task) throw new Error("expected Task");
      Game.time += 1;
      task.procedures = mutate(task);
      const before = structuredClone(Memory);

      expect(() => canonicalIntent()).toThrow(
        /Task definition is not canonical|exact canonical Procedure set|Procedure identity is not canonical/i,
      );
      expect(Memory).toEqual(before);
    },
  );

  it("bounds denial samples while preserving exact aggregate counts", () => {
    const intents = Array.from({ length: 40 }, () => {
      const intent = canonicalIntent();
      delete intent.trace;
      return intent;
    });
    const batch = authorizedFspmIntents(intents);

    expect(batch.denied.total).toBe(40);
    expect(batch.denied.byCode).toEqual({ trace_missing: 40 });
    expect(batch.denied.samples).toHaveLength(24);
  });

  it.each([
    {
      label: "missing creep actor",
      expected: "scope_actor_missing" as const,
      mutate: () => delete Game.creeps["worker-1"],
    },
    {
      label: "foreign creep actor",
      expected: "scope_actor_mismatch" as const,
      mutate: () => {
        const creep = Game.creeps["worker-1"];
        if (!creep) throw new Error("expected creep");
        (creep as unknown as { room: Room }).room = { name: "W9N9" } as Room;
      },
    },
    {
      label: "missing creep target",
      expected: "scope_target_missing" as const,
      mutate: () => {
        delete (Game as unknown as { objects: Record<string, RoomObject> })
          .objects["source-1"];
      },
    },
    {
      label: "foreign creep target",
      expected: "scope_target_mismatch" as const,
      mutate: () => {
        const source = (
          Game as unknown as { objects: Record<string, RoomObject> }
        ).objects["source-1"];
        if (!source) throw new Error("expected source");
        (source as unknown as { room: Room }).room = { name: "W9N9" } as Room;
      },
    },
  ])("fails closed for a $label", ({ expected, mutate }) => {
    const intent = canonicalIntent();
    mutate();

    expect(denialCode(intent)).toBe(expected);
    expect(bindFspmActivities([intent])).toMatchObject({
      total: 1,
      byCode: { [expected]: 1 },
    });
    expect(portfolio().activities).toEqual({});
  });

  it.each([
    {
      type: "move",
      domain: "economy",
      task: TASK_KEY,
      procedure: "stage-source-transport",
      targetField: "targetId",
    },
    {
      type: "harvest",
      domain: "economy",
      task: TASK_KEY,
      procedure: PROCEDURE_KEY,
      targetField: "sourceId",
    },
    {
      type: "withdraw",
      domain: "economy",
      task: TASK_KEY,
      procedure: "withdraw-buffered-energy",
      targetField: "targetId",
    },
    {
      type: "transfer",
      domain: "economy",
      task: TASK_KEY,
      procedure: "fund-workforce-energy",
      targetField: "targetId",
    },
    {
      type: "build",
      domain: "construction",
      task: "realize-planned-infrastructure",
      procedure: "build-planned-infrastructure",
      targetField: "targetId",
    },
    {
      type: "repair",
      domain: "construction",
      task: "maintain-infrastructure-condition",
      procedure: "repair-infrastructure",
      targetField: "targetId",
    },
    {
      type: "upgrade",
      domain: "economy",
      task: "advance-controller-capability",
      procedure: "upgrade-controller",
      targetField: "controllerId",
    },
  ] as const)("enforces target scope for $type intents", (fixture) => {
    const targetId = `target-${fixture.type}`;
    const objects = (Game as unknown as { objects: Record<string, RoomObject> })
      .objects;
    objects[targetId] = {
      id: targetId,
      pos: { roomName: ROOM },
    } as unknown as RoomObject;
    const intent = {
      type: fixture.type,
      creepName: "worker-1",
      [fixture.targetField]: targetId,
      ...(fixture.type === "move" ? { range: 1 } : {}),
      ...(fixture.type === "withdraw" || fixture.type === "transfer"
        ? { resource: RESOURCE_ENERGY }
        : {}),
      priority: 100,
      reason: `scope fixture ${fixture.type}`,
      trace: createIntentTrace({
        roomName: ROOM,
        domain: fixture.domain,
        task: fixture.task,
        procedure: fixture.procedure,
      }),
    } as unknown as Intent;

    expect(validateFspmIntentAuthority(intent)).toMatchObject({
      authorized: true,
    });
    objects[targetId] = {
      id: targetId,
      pos: { roomName: "W9N9" },
    } as unknown as RoomObject;
    expect(validateFspmIntentAuthority(intent)).toMatchObject({
      authorized: false,
      code: "scope_target_mismatch",
    });
  });

  it("enforces construction room scope", () => {
    const intent: CreateConstructionSiteIntent = {
      type: "createConstructionSite",
      roomName: "W9N9",
      x: 10,
      y: 10,
      structureType: "road" as BuildableStructureConstant,
      priority: 100,
      reason: "adversarial foreign construction",
      trace: createIntentTrace({
        roomName: ROOM,
        domain: "construction",
        task: "realize-planned-infrastructure",
        procedure: "site-planned-road",
      }),
    };

    expect(validateFspmIntentAuthority(intent)).toMatchObject({
      authorized: false,
      code: "scope_room_mismatch",
    });
  });

  it("requires the governed construction room to be visible and owned", () => {
    const trace = createIntentTrace({
      roomName: ROOM,
      domain: "construction",
      task: "realize-planned-infrastructure",
      procedure: "site-planned-road",
    });
    const intent: CreateConstructionSiteIntent = {
      type: "createConstructionSite",
      roomName: ROOM,
      x: 10,
      y: 10,
      structureType: "road" as BuildableStructureConstant,
      priority: 100,
      reason: "same-room construction",
      trace,
    };
    delete Game.rooms[ROOM];
    expect(validateFspmIntentAuthority(intent)).toMatchObject({
      authorized: false,
      code: "scope_executor_missing",
    });
  });

  it.each([
    {
      label: "missing",
      spawnRoom: null,
      expected: "scope_executor_missing" as const,
    },
    {
      label: "foreign",
      spawnRoom: "W9N9",
      expected: "scope_executor_mismatch" as const,
    },
  ])("enforces $label spawn executor scope", ({ spawnRoom, expected }) => {
    if (spawnRoom) {
      Game.spawns.Spawn1 = {
        name: "Spawn1",
        room: { name: spawnRoom },
        pos: { roomName: spawnRoom },
      } as unknown as StructureSpawn;
    }
    const intent: SpawnIntent = {
      type: "spawn",
      spawnName: "Spawn1",
      body: ["move" as BodyPartConstant],
      name: "worker-new",
      priority: 100,
      reason: "adversarial spawn scope",
      trace: createIntentTrace({
        roomName: ROOM,
        domain: "spawning",
        task: "maintain-workforce-capacity",
        procedure: "maintain-general-workforce",
      }),
    };

    expect(validateFspmIntentAuthority(intent)).toMatchObject({
      authorized: false,
      code: expected,
    });
  });

  it.each([
    {
      towerRoom: null,
      targetRoom: ROOM,
      expected: "scope_executor_missing" as const,
    },
    {
      towerRoom: "W9N9",
      targetRoom: ROOM,
      expected: "scope_executor_mismatch" as const,
    },
    {
      towerRoom: ROOM,
      targetRoom: null,
      expected: "scope_target_missing" as const,
    },
    {
      towerRoom: ROOM,
      targetRoom: "W9N9",
      expected: "scope_target_mismatch" as const,
    },
  ])(
    "enforces tower executor and hostile target scope",
    ({ towerRoom, targetRoom, expected }) => {
      const objects = (
        Game as unknown as { objects: Record<string, RoomObject> }
      ).objects;
      if (towerRoom) {
        objects["tower-1"] = {
          id: "tower-1",
          my: true,
          room: { name: towerRoom },
          pos: { roomName: towerRoom },
        } as unknown as StructureTower;
      }
      if (targetRoom) {
        objects["hostile-1"] = {
          id: "hostile-1",
          room: { name: targetRoom },
          pos: { roomName: targetRoom },
        } as unknown as Creep;
      }
      const intent: TowerAttackIntent = {
        type: "towerAttack",
        towerId: "tower-1" as Id<StructureTower>,
        targetId: "hostile-1" as Id<Creep>,
        priority: 100,
        reason: "adversarial tower scope",
        trace: createIntentTrace({
          roomName: ROOM,
          domain: "defense",
          task: "maintain-defensive-readiness",
          procedure: "repel-hostile",
        }),
      };

      expect(validateFspmIntentAuthority(intent)).toMatchObject({
        authorized: false,
        code: expected,
      });
    },
  );

  it("authorizes a tower and hostile whose room is inferred from positions", () => {
    const objects = (Game as unknown as { objects: Record<string, RoomObject> })
      .objects;
    objects["tower-1"] = {
      id: "tower-1",
      my: true,
      pos: { roomName: ROOM },
    } as unknown as StructureTower;
    objects["hostile-1"] = {
      id: "hostile-1",
      pos: { roomName: ROOM },
    } as unknown as Creep;
    const intent: TowerAttackIntent = {
      type: "towerAttack",
      towerId: "tower-1" as Id<StructureTower>,
      targetId: "hostile-1" as Id<Creep>,
      priority: 100,
      reason: "same-room defense",
      trace: createIntentTrace({
        roomName: ROOM,
        domain: "defense",
        task: "maintain-defensive-readiness",
        procedure: "repel-hostile",
      }),
    };

    expect(validateFspmIntentAuthority(intent)).toMatchObject({
      authorized: true,
    });
  });

  it("rejects a same-room tower that is not owned", () => {
    const objects = (Game as unknown as { objects: Record<string, RoomObject> })
      .objects;
    objects["tower-1"] = {
      id: "tower-1",
      my: false,
      pos: { roomName: ROOM },
    } as unknown as StructureTower;
    objects["hostile-1"] = {
      id: "hostile-1",
      pos: { roomName: ROOM },
    } as unknown as Creep;
    const intent: TowerAttackIntent = {
      type: "towerAttack",
      towerId: "tower-1" as Id<StructureTower>,
      targetId: "hostile-1" as Id<Creep>,
      priority: 100,
      reason: "unowned tower",
      trace: createIntentTrace({
        roomName: ROOM,
        domain: "defense",
        task: "maintain-defensive-readiness",
        procedure: "repel-hostile",
      }),
    };

    expect(validateFspmIntentAuthority(intent)).toMatchObject({
      authorized: false,
      code: "scope_executor_mismatch",
    });
  });

  it("fails stale snapshots across ticks and after same-tick hierarchy replacement", () => {
    const intent = canonicalIntent();
    const snapshot = createFspmAuthoritySnapshot();
    expect(snapshot.resolveIntent(intent)).toMatchObject({ authorized: true });

    Game.time += 1;
    expect(snapshot.resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "snapshot_stale",
    });

    Game.time -= 1;
    const replacement = structuredClone(portfolio());
    const colony = Memory.colonies[ROOM];
    if (!colony) throw new Error("expected colony");
    colony.fspm = replacement;
    expect(snapshot.resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "snapshot_stale",
    });
    expect(bindFspmActivities([intent], snapshot)).toMatchObject({
      total: 1,
      byCode: { snapshot_stale: 1 },
    });
  });

  it("fails a same-tick snapshot after hierarchy removal or in-place identity mutation", () => {
    const intent = canonicalIntent();
    const snapshot = createFspmAuthoritySnapshot();
    const current = portfolio();
    const requirement = current.requirements.economy;
    if (!requirement) throw new Error("expected Requirement");
    requirement.id = "requirement:mutated:economy";

    expect(snapshot.resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "requirement_mismatch",
    });

    const secondSnapshot = createFspmAuthoritySnapshot();
    const colony = Memory.colonies[ROOM];
    if (!colony) throw new Error("expected colony");
    (colony as unknown as { fspm: ColonyFspmPortfolio | undefined }).fspm =
      undefined;
    expect(secondSnapshot.resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "snapshot_stale",
    });
  });

  it("invalidates an execution snapshot after a foreign-colony authority mutation", () => {
    Memory.colonies.W9N9 = { roomName: "W9N9", discoveredAt: 1 };
    activateApprovedColonyGovernance("W9N9");
    const foreignTrace = createIntentTrace({
      roomName: "W9N9",
      domain: "economy",
      task: TASK_KEY,
      procedure: PROCEDURE_KEY,
    });
    const intent = canonicalIntent();
    const snapshot = createFspmAuthoritySnapshot();
    const foreignTask = Memory.colonies.W9N9?.fspm?.tasks[foreignTrace.taskId];
    if (!foreignTask) throw new Error("expected foreign Task");

    foreignTask.status = "retired";

    expect(snapshot.resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "authority_registry_invalid",
    });
  });

  it("rejects a fresh execution snapshot over a dormant non-catalog Procedure", () => {
    const intent = canonicalIntent();
    if (!intent.trace) throw new Error("expected trace");
    const task = Memory.colonies[ROOM]?.fspm?.tasks[intent.trace.taskId];
    if (!task) throw new Error("expected Task");
    Game.time += 1;
    task.procedures = [
      ...task.procedures,
      {
        id: `procedure:${ROOM}:economy:${TASK_KEY}:dormant-extra`,
        taskId: task.id,
        procedureKey: "dormant-extra",
        title: "Dormant extra Procedure",
      },
    ];

    expect(createFspmAuthoritySnapshot().resolveIntent(intent)).toMatchObject({
      authorized: false,
      code: "authority_registry_invalid",
    });
  });

  it("makes live authority identity and registry slots non-configurable", () => {
    Memory.colonies.W9N9 = { roomName: "W9N9", discoveredAt: 1 };
    activateApprovedColonyGovernance("W9N9");
    const foreignTrace = createIntentTrace({
      roomName: "W9N9",
      domain: "economy",
      task: TASK_KEY,
      procedure: PROCEDURE_KEY,
    });
    canonicalIntent();
    const foreignPortfolio = Memory.colonies.W9N9?.fspm;
    const foreignTask = foreignPortfolio?.tasks[foreignTrace.taskId];
    if (!foreignPortfolio || !foreignTask) {
      throw new Error("expected foreign authority");
    }
    const before = structuredClone(Memory);

    expect(() => {
      delete (foreignTask as Partial<typeof foreignTask>).id;
    }).toThrow(TypeError);
    expect(() => {
      Object.defineProperty(foreignPortfolio.tasks, foreignTrace.taskId, {
        configurable: true,
        value: undefined,
      });
    }).toThrow(TypeError);
    const missingCanonicalTaskId = "task:W9N9:economy:not-in-catalog";
    expect(foreignPortfolio.tasks[missingCanonicalTaskId]).toBeUndefined();
    expect(Object.isExtensible(foreignPortfolio.tasks)).toBe(false);
    expect(() => {
      Object.defineProperty(foreignPortfolio.tasks, missingCanonicalTaskId, {
        configurable: true,
        enumerable: true,
        value: structuredClone(foreignTask),
      });
    }).toThrow(TypeError);
    expect(JSON.stringify(Memory)).not.toContain(missingCanonicalTaskId);
    expect(Memory).toEqual(before);
  });

  it("caches a corrupted-tick planner denial after one global revalidation", () => {
    Memory.colonies.W9N9 = { roomName: "W9N9", discoveredAt: 1 };
    activateApprovedColonyGovernance("W9N9");
    const foreignTrace = createIntentTrace({
      roomName: "W9N9",
      domain: "economy",
      task: TASK_KEY,
      procedure: PROCEDURE_KEY,
    });
    canonicalIntent();
    const foreignTask = Memory.colonies.W9N9?.fspm?.tasks[foreignTrace.taskId];
    if (!foreignTask) throw new Error("expected foreign Task");
    foreignTask.id = `task:${ROOM}:economy:${TASK_KEY}`;
    const before = getFspmPlanningAuthorityDiagnostics();

    for (let attempt = 0; attempt < 32; attempt += 1) {
      expect(() => canonicalIntent()).toThrow(
        /Task (?:identity|definition) is not canonical/i,
      );
    }

    const after = getFspmPlanningAuthorityDiagnostics();
    expect(
      after.globalRegistryTraversals - before.globalRegistryTraversals,
    ).toBe(1);
  });

  it.each([
    {
      label: "duplicate foreign P3 identity",
      mutate: () => {
        Memory.colonies.W9N9 = {
          roomName: "W9N9",
          discoveredAt: 1,
          fspm: structuredClone(portfolio()),
        };
      },
    },
    {
      label: "wrong-key Requirement identity",
      mutate: () => {
        const current = portfolio();
        const requirement = current.requirements.economy;
        if (!requirement) throw new Error("expected Requirement");
        delete current.requirements.economy;
        current.requirements.defense = requirement;
      },
    },
    {
      label: "wrong-key Deliverable identity",
      mutate: () => {
        const current = portfolio();
        const deliverable = current.deliverables.economy;
        if (!deliverable) throw new Error("expected Deliverable");
        delete current.deliverables.economy;
        current.deliverables.defense = deliverable;
      },
    },
    {
      label: "cross-colony Task identity",
      mutate: () => {
        const current = portfolio();
        const task = Object.values(current.tasks)[0];
        if (!task) throw new Error("expected Task");
        Memory.colonies.W9N9 = {
          roomName: "W9N9",
          discoveredAt: 1,
          fspm: {
            ...structuredClone(current),
            p3: {
              ...structuredClone(current.p3),
              id: "portfolio:colony:W9N9",
              roomName: "W9N9",
            },
            requirements: {},
            deliverables: {},
            tasks: { [task.id]: structuredClone(task) },
          },
        };
      },
    },
  ])("rejects $label globally before planner mutation", ({ mutate }) => {
    canonicalIntent();
    const beforeMutation = structuredClone(Memory);
    try {
      mutate();
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(Memory).toEqual(beforeMutation);
      return;
    }
    const before = structuredClone(Memory);

    expect(() => canonicalIntent()).toThrow(
      /FSPM.*identity|ambiguous|registry/i,
    );
    expect(Memory).toEqual(before);
  });

  it("never repairs an existing colony authority container that lost its root P3", () => {
    canonicalIntent();
    const current = Memory.colonies[ROOM]?.fspm;
    if (!current) throw new Error("expected colony Portfolio");
    (
      current as unknown as {
        p3: ColonyFspmPortfolio["p3"] | undefined;
      }
    ).p3 = undefined;
    const before = structuredClone(Memory);

    expect(() => ensureColonyPortfolio(ROOM)).toThrow(/missing.*required.*P3/i);
    expect(Memory).toEqual(before);
    expect(() => reconcileFspmLifecycle([])).toThrow(/missing.*required.*P3/i);
    expect(Memory).toEqual(before);
  });

  it.each(["completed", "cancelled"])(
    "never promotes a persisted Task in malformed %s state back to Active",
    (status) => {
      const intent = canonicalIntent();
      if (!intent.trace) throw new Error("expected trace");
      const task = Memory.colonies[ROOM]?.fspm?.tasks[intent.trace.taskId];
      if (!task) throw new Error("expected Task");
      (task as { status: string }).status = status;
      const before = structuredClone(Memory);

      expect(() => ensureColonyPortfolio(ROOM)).toThrow(
        /invalid lifecycle state.*refusing implicit activation/i,
      );
      expect(Memory).toEqual(before);
      expect(() => reconcileFspmLifecycle([])).toThrow(
        /invalid lifecycle state.*refusing lifecycle reconciliation/i,
      );
      expect(Memory).toEqual(before);
    },
  );

  it("fails malformed empty Empire authority without mutation or TypeError", () => {
    (Memory as unknown as { empireFspm: object }).empireFspm = {};
    const before = structuredClone(Memory);

    expect(() => canonicalIntent()).toThrow(/Empire.*missing.*P3/i);
    expect(Memory).toEqual(before);
  });

  it("keeps legacy traces decodable but never treats retired contract authority as current", () => {
    const intent = canonicalIntent();
    if (!intent.trace) throw new Error("expected trace");
    delete intent.trace.p3Id;
    intent.trace.contractId = "contract:colony:W1N1";

    expect(resolveActiveFspmAuthority(intent.trace)).toMatchObject({
      authorized: false,
      code: "trace_p3_missing",
    });
    expect(authorizedFspmIntents([intent]).accepted).toEqual([]);
  });
});
