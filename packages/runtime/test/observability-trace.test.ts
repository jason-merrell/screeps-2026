import { beforeEach, describe, expect, it } from "vitest";
import {
  activityTraceDisposition,
  type PublishTickTraceInput,
  publishTickTrace,
} from "../src/observability/trace";
import type { FspmAssignmentState } from "../src/planning/activity-lifecycle";
import {
  activateApprovedColonyGovernance,
  createEmpirePortfolioP3,
  decideDeliverableReceipt,
  type FspmActivityRecord,
  recordDeliverableReceipt,
  reconcileFspmLifecycle,
} from "../src/planning/fspm";

function activity(
  status: FspmActivityRecord["status"],
  disposition?: FspmAssignmentState,
): FspmActivityRecord {
  return {
    id: "activity:test",
    taskId: "task:test",
    assignee: "worker-1",
    status,
    currentProcedureId: "procedure:test",
    qualityDescription: "test quality",
    qualityMetric: "test metric",
    kpiMetric: {
      metric: "test KPI",
      exceptional: "exceptional",
      satisfactory: "satisfactory",
      unsatisfactory: "unsatisfactory",
    },
    createdAt: 1,
    updatedAt: 2,
    metrics: {
      inProgressTicks: 1,
      onHoldTicks: 0,
      productiveTicks: 1,
      travelTicks: 0,
      idleTicks: 0,
      holdCount: 0,
      resumeCount: 0,
      taskPreemptions: 0,
      procedureTransitions: 0,
    },
    ...(disposition ? { currentDisposition: disposition } : {}),
  } as FspmActivityRecord;
}

function installTraceGlobals(memoryVersion = 7): void {
  Object.assign(globalThis, {
    Game: {
      time: 1234,
      cpu: {
        limit: 50,
        bucket: 10_000,
        getUsed: () => 1,
      },
    },
    Memory: {
      version: memoryVersion,
      colonies: {},
    },
    RawMemory: {
      segments: {},
      setActiveSegments: () => undefined,
    },
  });
}

function emptyTraceInput(): PublishTickTraceInput {
  return {
    tickStartCpu: 0,
    memoryCpu: 0,
    perceptionCpu: 0,
    settlementCpu: 0,
    plannerRuns: [],
    arbitrationCpu: 0,
    executionCpu: 0,
    spatial: {
      roomsIndexed: 0,
      distanceLookups: 0,
      distanceCacheHits: 0,
      distanceCacheMisses: 0,
    },
    movement: {
      requests: 0,
      cachedPathAttempts: 0,
      pathFinds: 0,
      congestionRepaths: 0,
      fatigueWaits: 0,
      stuckRequests: 0,
      contentionYields: 0,
      headOnSwapAttempts: 0,
      headOnSwaps: 0,
    },
    accepted: [],
    rejected: [],
    authorityDenials: { total: 0, byCode: {}, samples: [] },
    assignments: [],
    supervisor: {
      mode: "normal",
      deadline: 45,
      headroom: 5,
      scopeUnits: 1,
      phases: [],
      metrics: {
        fspm_governance: { samples: 0, p50: null, p95: null, p99: null },
        settlement: { samples: 0, p50: null, p95: null, p99: null },
        defense: { samples: 0, p50: null, p95: null, p99: null },
        spawning: { samples: 0, p50: null, p95: null, p99: null },
        construction: { samples: 0, p50: null, p95: null, p99: null },
        economy: { samples: 0, p50: null, p95: null, p99: null },
        fspm_maintenance: { samples: 0, p50: null, p95: null, p99: null },
        fspm_authority: { samples: 0, p50: null, p95: null, p99: null },
        activity_evidence: { samples: 0, p50: null, p95: null, p99: null },
        arbitration: { samples: 0, p50: null, p95: null, p99: null },
        execution: { samples: 0, p50: null, p95: null, p99: null },
      },
    },
    plannerByIntent: new Map(),
    conflictKey: () => "none",
  };
}

describe("observability Activity disposition", () => {
  it("reports On Hold authoritatively even when cached execution disposition is stale", () => {
    expect(activityTraceDisposition(activity("on_hold", "executing"))).toBe(
      "on_hold",
    );
  });

  it("preserves the reconciled disposition for current work", () => {
    expect(activityTraceDisposition(activity("in_progress", "traveling"))).toBe(
      "traveling",
    );
  });
});

describe("observability schema evidence", () => {
  beforeEach(() => installTraceGlobals());

  it("distinguishes the trace schema from the active persistent Memory schema", () => {
    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.version).toBe(1);
    expect(trace.memoryVersion).toBe(7);
    expect(trace.runtimeSha).toBeNull();
    expect(trace.runtime).toMatchObject({
      mode: "normal",
      deadline: 45,
      headroom: 5,
      phases: [],
    });
    expect(trace.cpu).toMatchObject({
      measurementBoundary: "before_segment_fit_and_write",
      previousTickFinal: null,
    });
    expect(Memory.runtimeSupervisor?.lastPublication).toEqual({
      tick: 1234,
      observability: 0,
      total: 1,
      segmentWritten: false,
    });
  });

  it("reconciles the previous tick's complete publication cost without claiming it for the current pre-write total", () => {
    Memory.runtimeSupervisor = {
      version: 1,
      phases: {},
      lastPublication: {
        tick: 1233,
        observability: 2.75,
        total: 8.5,
        segmentWritten: true,
      },
    };

    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.cpu.previousTickFinal).toEqual({
      tick: 1233,
      observability: 2.75,
      total: 8.5,
      segmentWritten: true,
    });
  });

  it("publishes bounded authority-denial counts and evidence samples", () => {
    const input = emptyTraceInput();
    input.authorityDenials = {
      total: 3,
      byCode: { trace_missing: 2, intent_type_mismatch: 1 },
      samples: [
        {
          code: "trace_missing",
          reason: "harvest intent has no FSPM authority trace",
          intentType: "harvest",
          trace: null,
        },
      ],
    };

    const trace = publishTickTrace(input);

    expect(trace.intents.authorityDenied).toEqual(input.authorityDenials);
    expect(trace.intents.proposed).toBe(0);
    expect(trace.intents.accepted).toBe(0);
  });

  it("quarantines a malformed Empire root while publishing bounded integrity evidence", () => {
    (Memory as unknown as { empireFspm: object }).empireFspm = {};
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.fspm.rootP3).toBeNull();
    expect(trace.fspm.integrity).toEqual({
      authoritative: false,
      total: 1,
      byCode: { empire_p3_missing: 1 },
      sampleLimit: 4,
      omittedSamples: 0,
      samples: [
        {
          code: "empire_p3_missing",
          scope: "empire",
          reason:
            "Empire authority container is present but its required root P3 is missing",
        },
      ],
    });
    expect(
      JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity,
    ).toEqual(trace.fspm.integrity);
  });

  it("fails colony governance closed when the Empire root authority is missing", () => {
    installTraceGlobals(8);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    activateApprovedColonyGovernance("W1N1");
    delete (Memory.empireFspm as Partial<typeof Memory.empireFspm>)?.p3;
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());
    const summary = trace.fspm.colonies.at(0);

    expect(trace.fspm.rootP3).toBeNull();
    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      byCode: { empire_p3_missing: 1 },
    });
    expect(summary?.governance).toMatchObject({
      valid: false,
      executionEligible: false,
      checks: { empireRoot: false },
    });
  });

  it("quarantines a malformed colony P3 without aborting publication", () => {
    Memory.empireFspm = { p3: createEmpirePortfolioP3(1, Game.time) };
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
      fspm: {
        requirements: {},
        deliverables: {},
        tasks: {},
        activities: {},
        activityKpiHistory: {},
        qualityHistory: {},
      } as never,
    };
    RawMemory.segments[99] = "{}";

    const beforeReconciliation = structuredClone(Memory);
    expect(() => reconcileFspmLifecycle([])).toThrow(/missing.*required.*P3/i);
    expect(Memory).toEqual(beforeReconciliation);

    const trace = publishTickTrace(emptyTraceInput());

    expect(trace.fspm.colonies).toEqual([
      expect.objectContaining({ roomName: "W1N1", p3: null }),
    ]);
    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      total: 1,
      byCode: { colony_p3_missing: 1 },
      omittedSamples: 0,
      samples: [
        {
          code: "colony_p3_missing",
          scope: "colony:W1N1",
          reason: "Colony W1N1 authority portfolio is missing its required P3",
        },
      ],
    });
    expect(
      JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity,
    ).toEqual(trace.fspm.integrity);
  });

  it("marks a structurally corrupted governed P3 invalid instead of publishing false-green governance", () => {
    installTraceGlobals(8);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    const portfolio = activateApprovedColonyGovernance("W1N1");
    (portfolio.p3 as unknown as { name: number }).name = 5;
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());
    const summary = trace.fspm.colonies.at(0);

    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      byCode: { colony_p3_malformed: 1 },
    });
    expect(summary?.p3).toBeNull();
    expect(summary?.governance).toMatchObject({
      valid: false,
      executionEligible: false,
      checks: { packageProjection: false },
    });
  });

  it("quarantines a null P3 on a populated governed portfolio without aborting publication", () => {
    installTraceGlobals(8);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    const portfolio = activateApprovedColonyGovernance("W1N1");
    Object.assign(portfolio, { p3: null });
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());
    const summary = trace.fspm.colonies.at(0);

    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      byCode: { colony_p3_malformed: 1 },
    });
    expect(summary?.p3).toBeNull();
    expect(summary?.governance).toMatchObject({
      valid: false,
      executionEligible: false,
      checks: { packageProjection: false, ancestry: false },
    });
  });

  it.each(["Requirement", "Deliverable"] as const)(
    "omits a malformed %s identity while preserving bounded governance evidence",
    (kind) => {
      installTraceGlobals(8);
      Memory.colonies.W1N1 = {
        roomName: "W1N1",
        discoveredAt: 1,
      };
      const portfolio = activateApprovedColonyGovernance("W1N1");
      const record =
        kind === "Requirement"
          ? portfolio.requirements.defense
          : portfolio.deliverables.defense;
      if (!record) throw new Error(`expected governed ${kind}`);
      (record as unknown as { id: number }).id = 5;
      RawMemory.segments[99] = "{}";

      const trace = publishTickTrace(emptyTraceInput());
      const summary = trace.fspm.colonies.at(0);
      const projected =
        kind === "Requirement" ? summary?.requirements : summary?.deliverables;

      expect(trace.fspm.integrity).toMatchObject({
        authoritative: false,
        byCode: { colony_governance_invalid: 1 },
      });
      expect(summary?.governance?.valid).toBe(false);
      expect(projected).toHaveLength(3);
      expect(projected?.every((entry) => typeof entry.id === "string")).toBe(
        true,
      );
      expect(
        JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity?.byCode,
      ).toEqual({ colony_governance_invalid: 1 });
    },
  );

  it.each(["requirements", "deliverables", "tasks"] as const)(
    "quarantines a null %s authority registry without aborting publication",
    (registry) => {
      installTraceGlobals(8);
      Memory.colonies.W1N1 = {
        roomName: "W1N1",
        discoveredAt: 1,
      };
      const portfolio = activateApprovedColonyGovernance("W1N1");
      Object.assign(portfolio, { [registry]: null });
      RawMemory.segments[99] = "{}";

      const trace = publishTickTrace(emptyTraceInput());
      const summary = trace.fspm.colonies.at(0);

      expect(trace.fspm.integrity).toMatchObject({
        authoritative: false,
        byCode: { colony_governance_invalid: 1 },
      });
      expect(summary?.governance?.valid).toBe(false);
      expect(summary?.[registry]).toEqual([]);
      expect(
        JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity?.byCode,
      ).toEqual({ colony_governance_invalid: 1 });
    },
  );

  it("omits a Deliverable with a malformed numeric projection instead of emitting a Lab-crashing value", () => {
    installTraceGlobals(8);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    const portfolio = activateApprovedColonyGovernance("W1N1");
    const deliverable = portfolio.deliverables.economy;
    if (!deliverable) throw new Error("expected governed Deliverable");
    Object.assign(deliverable, { siblingWeightBasisPoints: null });
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());
    const summary = trace.fspm.colonies.at(0);

    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      byCode: { colony_governance_invalid: 1 },
    });
    expect(summary?.governance?.valid).toBe(false);
    expect(summary?.deliverables).toHaveLength(3);
    expect(
      summary?.deliverables.every((record) =>
        Number.isFinite(record.siblingWeightBasisPoints),
      ),
    ).toBe(true);
  });

  it("projects a malformed governance binding as explicit blocked authority with safe scalar fields", () => {
    installTraceGlobals(8);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    const portfolio = activateApprovedColonyGovernance("W1N1");
    Object.assign(portfolio, { governanceBinding: 5 });
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());
    const governance = trace.fspm.colonies.at(0)?.governance;

    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      byCode: { colony_governance_invalid: 1 },
    });
    expect(governance).toMatchObject({
      packageId: "unavailable:malformed-governance-binding",
      packageRevision: 0,
      importedAtTick: -1,
      valid: false,
      executionEligible: false,
      checks: { packageProjection: false },
    });
  });

  it.each([
    ["deliverableReceipts", "receiptEvidenceStatus"],
    ["deliverableReceiptDecisions", "receiptAcceptanceStatus"],
  ] as const)(
    "quarantines a null entry in %s without aborting publication",
    (registry, statusField) => {
      installTraceGlobals(8);
      Memory.colonies.W1N1 = {
        roomName: "W1N1",
        discoveredAt: 1,
      };
      const portfolio = activateApprovedColonyGovernance("W1N1");
      Object.assign(portfolio, { [registry]: { bad: null } });
      RawMemory.segments[99] = "{}";

      const trace = publishTickTrace(emptyTraceInput());
      const summary = trace.fspm.colonies.at(0);

      expect(trace.fspm.integrity).toMatchObject({
        authoritative: false,
        byCode: { colony_governance_invalid: 1 },
      });
      expect(summary?.governance).toMatchObject({
        valid: false,
        checks: { receiptLedgers: false },
      });
      expect(
        summary?.deliverables.every(
          (record) => record[statusField] === "invalid",
        ),
      ).toBe(true);
    },
  );

  it.each([{ bad: null }, 5] as const)(
    "omits malformed Activity registry data without aborting publication",
    (activities) => {
      installTraceGlobals(8);
      Memory.colonies.W1N1 = {
        roomName: "W1N1",
        discoveredAt: 1,
      };
      const portfolio = activateApprovedColonyGovernance("W1N1");
      Object.assign(portfolio, { activities });
      RawMemory.segments[99] = "{}";

      const trace = publishTickTrace(emptyTraceInput());
      const summary = trace.fspm.colonies.at(0);

      expect(summary?.activities).toEqual([]);
      expect(
        JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.colonies?.[0]
          ?.activities,
      ).toEqual([]);
    },
  );

  it("reports a newer undecided receipt as the latest pending service occurrence", () => {
    installTraceGlobals(8);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    const portfolio = activateApprovedColonyGovernance("W1N1");
    const deliverable = portfolio.deliverables.economy;
    const task =
      portfolio.tasks["task:W1N1:economy:maintain-colony-energy-service"];
    const procedure = task?.procedures.at(-1);
    if (!deliverable || !task || !procedure) {
      throw new Error("expected governed economy authority");
    }
    portfolio.activities ??= {};
    for (const suffix of ["accepted", "pending"] as const) {
      const activityId = `activity:W1N1:economy:${suffix}`;
      portfolio.activities[activityId] = {
        id: activityId,
        taskId: task.id,
        assignee: `worker-${suffix}`,
        status: "completed",
        currentProcedureId: procedure.id,
        qualityDescription: task.qualityDescription,
        qualityMetric: task.qualityMetric,
        kpiMetric: { ...task.kpiMetric },
        kpiScore: "satisfactory",
        createdAt: Game.time,
        startedAt: Game.time,
        completedAt: Game.time,
        updatedAt: Game.time,
        metrics: {
          inProgressTicks: 1,
          onHoldTicks: 0,
          productiveTicks: 1,
          travelTicks: 0,
          idleTicks: 0,
          holdCount: 0,
          resumeCount: 0,
          taskPreemptions: 0,
          procedureTransitions: 1,
        },
      };
    }
    const acceptedReceipt = recordDeliverableReceipt(
      "W1N1",
      deliverable.id,
      "activity:W1N1:economy:accepted",
    );
    decideDeliverableReceipt(
      "W1N1",
      acceptedReceipt.id,
      "accepted",
      "Terminal KPI satisfies the package-bound occurrence policy",
    );
    recordDeliverableReceipt(
      "W1N1",
      deliverable.id,
      "activity:W1N1:economy:pending",
    );

    const trace = publishTickTrace(emptyTraceInput());
    const economy = trace.fspm.colonies
      .at(0)
      ?.deliverables.find((record) => record.domain === "economy");

    expect(economy?.receiptEvidenceStatus).toBe("validated");
    expect(economy?.receiptAcceptanceStatus).toBe("pending");
  });

  it.each(["receiptValidation", "servicePrincipalAcceptance"] as const)(
    "publishes bounded invalid-governance evidence when a Deliverable loses %s",
    (field) => {
      installTraceGlobals(8);
      Memory.colonies.W1N1 = {
        roomName: "W1N1",
        discoveredAt: 1,
      };
      const portfolio = activateApprovedColonyGovernance("W1N1");
      const deliverable = portfolio.deliverables.economy;
      if (!deliverable) throw new Error("expected governed Deliverable");
      delete (deliverable as Partial<typeof deliverable>)[field];
      RawMemory.segments[99] = "{}";

      const trace = publishTickTrace(emptyTraceInput());
      const summary = trace.fspm.colonies.at(0);
      const economy = summary?.deliverables.find(
        (record) => record.domain === "economy",
      );

      expect(trace.fspm.integrity).toMatchObject({
        authoritative: false,
        byCode: { colony_governance_invalid: 1 },
      });
      expect(summary?.governance?.valid).toBe(false);
      if (field === "receiptValidation") {
        expect(summary?.governance?.checks.receiptContracts).toBe(false);
        expect(economy?.receiptContractStatus).toBe("invalid");
        expect(economy?.receiptValidation).toBeUndefined();
      } else {
        expect(summary?.governance?.checks.acceptancePolicies).toBe(false);
        expect(economy?.servicePrincipalAcceptanceStatus).toBe("invalid");
        expect(economy?.servicePrincipalAcceptance).toBeUndefined();
      }
      expect(
        JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity?.byCode,
      ).toEqual({ colony_governance_invalid: 1 });
    },
  );

  it("omits a malformed Task projection while preserving bounded governance evidence", () => {
    installTraceGlobals(8);
    Memory.colonies.W1N1 = {
      roomName: "W1N1",
      discoveredAt: 1,
    };
    const portfolio = activateApprovedColonyGovernance("W1N1");
    const task =
      portfolio.tasks["task:W1N1:economy:maintain-colony-energy-service"];
    if (!task) throw new Error("expected governed Task");
    delete (task as Partial<typeof task>).procedures;
    RawMemory.segments[99] = "{}";

    const trace = publishTickTrace(emptyTraceInput());
    const summary = trace.fspm.colonies.at(0);

    expect(trace.fspm.integrity).toMatchObject({
      authoritative: false,
      byCode: { colony_governance_invalid: 1 },
    });
    expect(summary?.governance?.valid).toBe(false);
    expect(summary?.tasks.some((record) => record.id === task.id)).toBe(false);
    expect(
      JSON.parse(RawMemory.segments[99] ?? "null")?.fspm?.integrity?.byCode,
    ).toEqual({ colony_governance_invalid: 1 });
  });
});
