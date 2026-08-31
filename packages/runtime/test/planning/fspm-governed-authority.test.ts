import { beforeEach, describe, expect, it } from "vitest";
import { createIntentTrace } from "../../src/intents/trace";
import { migrateMemory } from "../../src/memory/migrate";
import {
  FSPM_ACTIVITY_MEMORY_LIMIT,
  pruneFspmActivityHistory,
} from "../../src/memory/segments";
import {
  activateApprovedColonyGovernance,
  createColonyPortfolioP3,
  createEmpirePortfolioP3,
  createFspmAuthoritySnapshot,
  decideDeliverableReceipt,
  deliverableApprovedContent,
  recordDeliverableReceipt,
  requirementApprovedContent,
  retireGovernedAuthorityRecords,
  validateAuthorityLifecycleLedger,
  validateColonyGovernanceAuthority,
  validateDeliverableReceipt,
  validateDeliverableReceiptDecision,
  validateDeliverableReceiptDecisionRegistry,
  validateDeliverableReceiptRegistry,
} from "../../src/planning/fspm";
import {
  APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE,
  authorityPackageUnsignedContent,
  type FspmAuthorityPackage,
  governanceContentHash,
  governanceSha256,
  isCanonicalRequirementSource,
  validateAuthorityPackage,
} from "../../src/planning/fspm-governance";

const ROOM = "W1N1";

function installFreshMemory(time = 100): void {
  Object.assign(globalThis, {
    Game: { time },
    Memory: {
      version: 8,
      colonies: {
        [ROOM]: { roomName: ROOM, discoveredAt: 1 },
      },
    },
  });
}

function portfolio() {
  const result = Memory.colonies[ROOM]?.fspm;
  if (!result) throw new Error("expected governed test portfolio");
  return result;
}

function mutablePackage(): FspmAuthorityPackage {
  return structuredClone(APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE);
}

function resign(authorityPackage: FspmAuthorityPackage): void {
  const contentHash = governanceContentHash(
    authorityPackageUnsignedContent(authorityPackage),
  );
  authorityPackage.contentHash = contentHash;
  authorityPackage.approval.signedContentHash = contentHash;
}

function addCompletedActivity(
  taskId: string,
  activityId: string,
  completedAt = Game.time,
  kpiScore: "exceptional" | "satisfactory" | "unsatisfactory" = "satisfactory",
): string {
  const currentPortfolio = portfolio();
  const task = currentPortfolio.tasks[taskId];
  if (!task) throw new Error(`expected Task ${taskId}`);
  const currentProcedure = task.procedures.at(-1);
  if (!currentProcedure) throw new Error(`expected Procedure for ${taskId}`);
  currentPortfolio.activities ??= {};
  currentPortfolio.activities[activityId] = {
    id: activityId,
    taskId,
    assignee: "creep:governance-test",
    status: "completed",
    currentProcedureId: currentProcedure.id,
    qualityDescription: task.qualityDescription,
    qualityMetric: task.qualityMetric,
    kpiMetric: { ...task.kpiMetric },
    kpiScore,
    createdAt: completedAt,
    startedAt: completedAt,
    updatedAt: completedAt,
    completedAt,
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
  return activityId;
}

describe("governed Corporate Requirement and Deliverable authority", () => {
  beforeEach(() => installFreshMemory());

  it("uses a deterministic, standards-compatible SHA-256 content digest", () => {
    expect(governanceSha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(governanceSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("activates the complete reviewed package top-down before any intent exists", () => {
    const activated = activateApprovedColonyGovernance(ROOM);

    expect(validateColonyGovernanceAuthority(activated)).toEqual([]);
    expect(Object.keys(activated.requirements)).toHaveLength(4);
    expect(Object.keys(activated.deliverables)).toHaveLength(4);
    expect(Object.keys(activated.tasks)).toHaveLength(6);
    expect(
      Object.values(activated.deliverables).reduce(
        (sum, deliverable) =>
          sum + (deliverable?.siblingWeightBasisPoints ?? 0),
        0,
      ),
    ).toBe(10_000);
    expect(
      Object.values(activated.requirements).every(
        (requirement) =>
          requirement?.approval === true &&
          Boolean(
            activated.requirementApprovalLedger?.[requirement.approvalEventId],
          ),
      ),
    ).toBe(true);
  });

  it("keeps intent tracing read-only when approved ancestors are absent", () => {
    const before = structuredClone(Memory);

    expect(() =>
      createIntentTrace({
        roomName: ROOM,
        domain: "economy",
        task: "maintain-colony-energy-service",
        procedure: "extract-source-energy",
      }),
    ).toThrow(/no approved governance package/i);
    expect(Memory).toEqual(before);
  });

  it("rejects a forged package signer before making any Memory mutation", () => {
    const forged = mutablePackage();
    forged.approval.signedBy = "principal:forged";
    resign(forged);
    const before = structuredClone(Memory);

    expect(() => activateApprovedColonyGovernance(ROOM, forged)).toThrow(
      /signer is not the accountable OU principal/i,
    );
    expect(Memory).toEqual(before);
  });

  it("rejects a valid-looking re-signed package that is not the reviewed source-controlled revision", () => {
    const substituted = mutablePackage();
    const deliverable = substituted.deliverables[0];
    if (!deliverable) throw new Error("expected Deliverable template");
    deliverable.output =
      "A plausible but unreviewed energy-service output substituted at runtime.";
    resign(substituted);
    const before = structuredClone(Memory);

    expect(validateAuthorityPackage(substituted)).toContainEqual(
      expect.stringMatching(/not the source-controlled approved revision/i),
    );
    expect(() => activateApprovedColonyGovernance(ROOM, substituted)).toThrow(
      /not the source-controlled approved revision/i,
    );
    expect(Memory).toEqual(before);
  });

  it("rejects malformed source/origin semantics even under a fresh package hash", () => {
    const malformed = mutablePackage();
    const requirement = malformed.requirements[0];
    if (!requirement) throw new Error("expected Requirement template");
    (requirement as { originatingAuthority?: string }).originatingAuthority =
      "Forged Second Authority";
    resign(malformed);

    expect(validateAuthorityPackage(malformed)).toContainEqual(
      expect.stringMatching(/exactly one source or originating authority/i),
    );
    expect(() => activateApprovedColonyGovernance(ROOM, malformed)).toThrow(
      /exactly one source or originating authority/i,
    );
  });

  it("rejects an impossible Requirement Source date", () => {
    const malformed = mutablePackage();
    const requirement = malformed.requirements[0];
    if (!requirement) throw new Error("expected Requirement template");
    requirement.requirementSource =
      "2026.02.30-Screeps Colony Operations Policy v1";
    resign(malformed);

    expect(validateAuthorityPackage(malformed)).toContainEqual(
      expect.stringMatching(/Source is not a canonical document identity/i),
    );
  });

  it.each([
    "2026.00-Policy",
    "2026.13-Policy",
    "2026.02.30-Policy",
    "2026.08.30-Policy ",
    " 2026.08-Policy",
    "2026.08.30-Policy\nforged",
  ])("rejects noncanonical Requirement Source %j", (source) => {
    expect(isCanonicalRequirementSource(source)).toBe(false);
  });

  it.each(["2026.08-Policy", "2026.08.30-Policy"])(
    "accepts canonical Requirement Source %j",
    (source) => {
      expect(isCanonicalRequirementSource(source)).toBe(true);
    },
  );

  it("rejects a missing Empire root P3 atomically", () => {
    Object.assign(Memory, { empireFspm: {} });
    const before = structuredClone(Memory);

    expect(() => activateApprovedColonyGovernance(ROOM)).toThrow(
      /Empire authority container with no root P3/i,
    );
    expect(Memory).toEqual(before);
  });

  it("refuses to reuse governed colony authority after the Empire root is removed", () => {
    activateApprovedColonyGovernance(ROOM);
    delete Memory.empireFspm;
    const before = structuredClone(Memory);

    expect(() => activateApprovedColonyGovernance(ROOM)).toThrow(
      /cannot reuse .* without its required Empire root Portfolio/i,
    );
    expect(Memory).toEqual(before);
  });

  it("rolls back the Empire root when the colony authority write throws", () => {
    const colony = Memory.colonies[ROOM];
    if (!colony) throw new Error("expected colony Memory");
    Object.defineProperty(colony, "fspm", {
      configurable: true,
      enumerable: true,
      get: () => undefined,
      set: () => {
        throw new Error("simulated colony authority write failure");
      },
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(colony, "fspm");

    expect(() => activateApprovedColonyGovernance(ROOM)).toThrow(
      /simulated colony authority write failure/i,
    );
    expect(Memory.empireFspm).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(colony, "fspm")).toEqual(
      originalDescriptor,
    );
    expect(colony.fspm).toBeUndefined();
  });

  it.each([
    {
      label: "retired",
      mutate: (p3: ReturnType<typeof createColonyPortfolioP3>) => {
        p3.status = "retired";
      },
    },
    {
      label: "wrong parent",
      mutate: (p3: ReturnType<typeof createColonyPortfolioP3>) => {
        p3.parentP3Id = "portfolio:foreign" as typeof p3.parentP3Id;
      },
    },
    {
      label: "wrong subtype",
      mutate: (p3: ReturnType<typeof createColonyPortfolioP3>) => {
        Object.assign(p3, { subType: "service_program" });
      },
    },
  ])("rejects a $label colony root P3 atomically", ({ mutate }) => {
    const p3 = createColonyPortfolioP3(ROOM, 1, Game.time);
    mutate(p3);
    const colony = Memory.colonies[ROOM];
    if (!colony) throw new Error("expected colony Memory");
    colony.fspm = {
      p3,
      requirements: {},
      deliverables: {},
      tasks: {},
      activities: {},
      qualityHistory: {},
      activityKpiHistory: {},
      requirementApprovalLedger: {},
      deliverableReceipts: {},
      deliverableReceiptDecisions: {},
      authorityLifecycleLedger: {},
    };
    const before = structuredClone(Memory);

    expect(() => activateApprovedColonyGovernance(ROOM)).toThrow(
      /noncanonical or inactive colony Portfolio/i,
    );
    expect(Memory).toEqual(before);
  });

  it.each([
    {
      label: "edited approved verbiage",
      mutate: () => {
        const requirement = portfolio().requirements.economy;
        if (!requirement) throw new Error("expected Requirement");
        requirement.requirementVerbiage = "forged obligation";
      },
      expected: /approved content differs|content hash is stale/i,
    },
    {
      label: "wrong applicable OU",
      mutate: () => {
        const requirement = portfolio().requirements.economy;
        if (!requirement) throw new Error("expected Requirement");
        requirement.applicableOuId = "ou:foreign";
      },
      expected: /OU approval authority is invalid/i,
    },
    {
      label: "forged approval signer",
      mutate: () => {
        const requirement = portfolio().requirements.economy;
        const event = requirement
          ? portfolio().requirementApprovalLedger?.[requirement.approvalEventId]
          : undefined;
        if (!event) throw new Error("expected approval event");
        event.signerPrincipalId = "principal:forged";
      },
      expected: /ledger hash is invalid|ledger authority is invalid/i,
    },
    {
      label: "missing approval event",
      mutate: () => {
        const requirement = portfolio().requirements.economy;
        if (!requirement) throw new Error("expected Requirement");
        delete portfolio().requirementApprovalLedger?.[
          requirement.approvalEventId
        ];
      },
      expected: /approval ledger event is missing/i,
    },
    {
      label: "invalid Deliverable sibling weights",
      mutate: () => {
        const deliverable = portfolio().deliverables.economy;
        if (!deliverable) throw new Error("expected Deliverable");
        deliverable.siblingWeightBasisPoints = 3499;
      },
      expected: /content differs|weights sum/i,
    },
    {
      label: "invalid Task weights",
      mutate: () => {
        const task =
          portfolio().tasks[
            `task:${ROOM}:economy:maintain-colony-energy-service`
          ];
        if (!task) throw new Error("expected Task");
        task.taskWeight = 64;
      },
      expected: /Task definition is not canonical|Task weights sum/i,
    },
    {
      label: "edited Task Quality Metric",
      mutate: () => {
        const task =
          portfolio().tasks[
            `task:${ROOM}:economy:maintain-colony-energy-service`
          ];
        if (!task) throw new Error("expected Task");
        task.qualityMetric = "forged quality metric";
      },
      expected: /Task definition is not canonical/i,
    },
    {
      label: "edited Task KPI rubric and determination",
      mutate: () => {
        const task =
          portfolio().tasks[
            `task:${ROOM}:economy:maintain-colony-energy-service`
          ];
        if (!task?.determination) throw new Error("expected Task definition");
        task.kpiMetric.satisfactory = "forged acceptance threshold";
        task.determination.governanceSha = "forged-governance-sha";
      },
      expected: /Task definition is not canonical/i,
    },
    {
      label: "edited Procedure title",
      mutate: () => {
        const task =
          portfolio().tasks[
            `task:${ROOM}:economy:maintain-colony-energy-service`
          ];
        const procedure = task?.procedures.at(0);
        if (!procedure) throw new Error("expected Procedure");
        procedure.title = "Forged Procedure";
      },
      expected: /Task definition is not canonical/i,
    },
    {
      label: "unexpected Requirement registry member",
      mutate: () => {
        const requirement = portfolio().requirements.economy;
        if (!requirement) throw new Error("expected Requirement");
        (portfolio().requirements as Record<string, typeof requirement>).rogue =
          {
            ...structuredClone(requirement),
            id: `requirement:${ROOM}:rogue`,
            domain: "rogue" as typeof requirement.domain,
          };
      },
      expected: /unexpected Requirement registry keys: rogue/i,
    },
    {
      label: "unexpected Deliverable registry member",
      mutate: () => {
        const deliverable = portfolio().deliverables.economy;
        if (!deliverable) throw new Error("expected Deliverable");
        (portfolio().deliverables as Record<string, typeof deliverable>).rogue =
          {
            ...structuredClone(deliverable),
            id: `deliverable:${ROOM}:rogue`,
            domain: "rogue" as typeof deliverable.domain,
          };
      },
      expected: /unexpected Deliverable registry keys: rogue/i,
    },
  ])("fails closed for $label", ({ mutate, expected }) => {
    activateApprovedColonyGovernance(ROOM);
    mutate();

    expect(validateColonyGovernanceAuthority(portfolio())).toContainEqual(
      expect.stringMatching(expected),
    );
  });

  it("rejects hash-valid one-shot completion semantics on recurring authority", () => {
    activateApprovedColonyGovernance(ROOM);
    const requirement = portfolio().requirements.economy;
    const deliverable = portfolio().deliverables.economy;
    if (!requirement || !deliverable) {
      throw new Error("expected recurring economy authority");
    }
    const event =
      portfolio().requirementApprovalLedger?.[requirement.approvalEventId];
    if (!event) throw new Error("expected Requirement activation event");

    requirement.completionCriterion = "complete after one accepted receipt";
    requirement.approvedContentHash = governanceContentHash(
      requirementApprovedContent(requirement),
    );
    event.approvedContentHash = requirement.approvedContentHash;
    const { eventHash: _eventHash, ...eventContent } = event;
    event.eventHash = governanceContentHash(eventContent);

    deliverable.completionCriterion = "complete after one accepted receipt";
    deliverable.approvedContentHash = governanceContentHash(
      deliverableApprovedContent(deliverable),
    );

    expect(validateColonyGovernanceAuthority(portfolio())).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Requirement.*approved content differs/i),
        expect.stringMatching(/Deliverable.*approved content differs/i),
      ]),
    );
  });

  it("rejects unsupported completion and reopening metadata in v1 lifecycle projections", () => {
    activateApprovedColonyGovernance(ROOM);
    const requirement = portfolio().requirements.economy;
    const deliverable = portfolio().deliverables.economy;
    if (!requirement || !deliverable) {
      throw new Error("expected economy authority records");
    }

    requirement.reopenedAt = Game.time;
    expect(validateAuthorityLifecycleLedger(portfolio())).toContainEqual(
      expect.stringMatching(/unsupported reopening data/i),
    );
    delete requirement.reopenedAt;

    retireGovernedAuthorityRecords(
      ROOM,
      [deliverable.id],
      "Retired pending a separately governed superseding package",
    );
    const retiredDeliverable = portfolio().deliverables.economy;
    if (!retiredDeliverable) throw new Error("expected retired Deliverable");
    retiredDeliverable.completedAt = Game.time;
    expect(validateAuthorityLifecycleLedger(portfolio())).toContainEqual(
      expect.stringMatching(/unsupported completion data/i),
    );
  });

  it.each(["satisfactory", "exceptional"] as const)(
    "accepts a %s recurring-service occurrence without completing its Deliverable",
    (kpiScore) => {
      activateApprovedColonyGovernance(ROOM);
      const deliverable = portfolio().deliverables.economy;
      if (!deliverable) throw new Error("expected Deliverable");
      const receipt = recordDeliverableReceipt(
        ROOM,
        deliverable.id,
        addCompletedActivity(
          `task:${ROOM}:economy:maintain-colony-energy-service`,
          `activity:${ROOM}:economy:${kpiScore}-receipt`,
          Game.time,
          kpiScore,
        ),
      );

      expect(validateDeliverableReceipt(portfolio(), receipt)).toBe(true);
      expect(receipt.sourceActivityKpiScore).toBe(kpiScore);
      const decision = decideDeliverableReceipt(
        ROOM,
        receipt.id,
        "accepted",
        `${kpiScore} evidence satisfies the package-bound acceptance policy`,
      );

      expect(validateDeliverableReceiptDecision(portfolio(), decision)).toBe(
        true,
      );
      expect(validateDeliverableReceiptDecisionRegistry(portfolio())).toEqual(
        [],
      );
      expect(portfolio().deliverables.economy).toMatchObject({
        status: "active",
      });
      expect(portfolio().deliverables.economy?.completedAt).toBeUndefined();
      expect(validateColonyGovernanceAuthority(portfolio())).toEqual([]);
    },
  );

  it("fails closed when compact receipt content is edited", () => {
    activateApprovedColonyGovernance(ROOM);
    const deliverable = portfolio().deliverables.economy;
    if (!deliverable) throw new Error("expected Deliverable");
    const receipt = recordDeliverableReceipt(
      ROOM,
      deliverable.id,
      addCompletedActivity(
        `task:${ROOM}:economy:maintain-colony-energy-service`,
        `activity:${ROOM}:economy:tampered-receipt`,
      ),
    );

    receipt.evidenceReference = "";
    expect(validateDeliverableReceipt(portfolio(), receipt)).toBe(false);
    expect(validateColonyGovernanceAuthority(portfolio())).toContainEqual(
      expect.stringMatching(/receipt .* evidence is invalid/i),
    );
  });

  it("rejects receipt evidence whose Activity predates package import", () => {
    activateApprovedColonyGovernance(ROOM);
    const deliverable = portfolio().deliverables.economy;
    if (!deliverable) throw new Error("expected Deliverable");
    const activityId = addCompletedActivity(
      `task:${ROOM}:economy:maintain-colony-energy-service`,
      `activity:${ROOM}:economy:predates-authority`,
      99,
    );
    const before = structuredClone(portfolio().deliverableReceipts);

    expect(() =>
      recordDeliverableReceipt(ROOM, deliverable.id, activityId),
    ).toThrow(/chronology must begin at or after package import/i);
    expect(portfolio().deliverableReceipts).toEqual(before);
  });

  it("keeps a compact receipt valid after its source Activity is pruned", () => {
    activateApprovedColonyGovernance(ROOM);
    const deliverable = portfolio().deliverables.economy;
    if (!deliverable) throw new Error("expected Deliverable");
    const taskId = `task:${ROOM}:economy:maintain-colony-energy-service`;
    const evidenceActivityId = addCompletedActivity(
      taskId,
      `activity:${ROOM}:economy:retained-receipt-evidence`,
    );
    const receipt = recordDeliverableReceipt(
      ROOM,
      deliverable.id,
      evidenceActivityId,
    );
    Object.assign(Game, { time: 200 });
    for (let index = 0; index < FSPM_ACTIVITY_MEMORY_LIMIT; index += 1) {
      addCompletedActivity(
        taskId,
        `activity:${ROOM}:economy:newer-${index}`,
        101 + index,
      );
    }

    expect(pruneFspmActivityHistory()).toBe(1);
    expect(portfolio().activities?.[evidenceActivityId]).toBeUndefined();
    expect(Object.keys(portfolio().activities ?? {})).toHaveLength(
      FSPM_ACTIVITY_MEMORY_LIMIT,
    );
    expect(validateDeliverableReceipt(portfolio(), receipt)).toBe(true);
    const decision = decideDeliverableReceipt(
      ROOM,
      receipt.id,
      "accepted",
      "Compact receipt evidence satisfies the approved service threshold",
    );
    expect(validateDeliverableReceiptDecision(portfolio(), decision)).toBe(
      true,
    );
    expect(portfolio().deliverables.economy?.status).toBe("active");
    expect(validateColonyGovernanceAuthority(portfolio())).toEqual([]);
  });

  it("rejects unsatisfactory evidence from acceptance but permits accountable rejection", () => {
    activateApprovedColonyGovernance(ROOM);
    const deliverable = portfolio().deliverables.economy;
    if (!deliverable) throw new Error("expected Deliverable");
    const receipt = recordDeliverableReceipt(
      ROOM,
      deliverable.id,
      addCompletedActivity(
        `task:${ROOM}:economy:maintain-colony-energy-service`,
        `activity:${ROOM}:economy:unsatisfactory-receipt`,
        Game.time,
        "unsatisfactory",
      ),
    );
    const decisionsBefore = structuredClone(
      portfolio().deliverableReceiptDecisions,
    );
    const anchorBefore = structuredClone(
      portfolio().authorityLedgerAnchors?.deliverableReceiptDecisions,
    );

    expect(() =>
      decideDeliverableReceipt(
        ROOM,
        receipt.id,
        "accepted",
        "Attempted acceptance below the package-bound threshold",
      ),
    ).toThrow(/does not satisfy the package-bound .* acceptance policy/i);
    expect(portfolio().deliverableReceiptDecisions).toEqual(decisionsBefore);
    expect(
      portfolio().authorityLedgerAnchors?.deliverableReceiptDecisions,
    ).toEqual(anchorBefore);

    const decision = decideDeliverableReceipt(
      ROOM,
      receipt.id,
      "rejected",
      "Unsatisfactory evidence does not satisfy the approved quality threshold",
    );
    expect(validateDeliverableReceiptDecision(portfolio(), decision)).toBe(
      true,
    );
    expect(portfolio().deliverables.economy?.status).toBe("active");
    expect(validateColonyGovernanceAuthority(portfolio())).toEqual([]);
  });

  it("rejects arbitrary or cross-Deliverable Activity references without mutation", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const beforeUnknown = structuredClone(
      portfolio().deliverableReceipts ?? {},
    );

    expect(() =>
      recordDeliverableReceipt(ROOM, economy.id, "activity:invented"),
    ).toThrow(/requires a completed Activity/i);
    expect(portfolio().deliverableReceipts).toEqual(beforeUnknown);

    const defenseActivity = addCompletedActivity(
      `task:${ROOM}:defense:maintain-defensive-readiness`,
      `activity:${ROOM}:defense:receipt-1`,
    );
    expect(() =>
      recordDeliverableReceipt(ROOM, economy.id, defenseActivity),
    ).toThrow(/does not belong to Deliverable/i);
    expect(portfolio().deliverableReceipts).toEqual(beforeUnknown);
  });

  it("rejects a mis-keyed Activity receipt source without mutation", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const recordedId = addCompletedActivity(
      `task:${ROOM}:economy:maintain-colony-energy-service`,
      `activity:${ROOM}:economy:claimed-identity`,
    );
    const activities = portfolio().activities;
    const activity = activities?.[recordedId];
    if (!activity || !activities) {
      throw new Error("expected completed Activity");
    }
    delete activities[recordedId];
    const storageId = `activity:${ROOM}:economy:storage-identity`;
    activities[storageId] = activity;
    const before = structuredClone(portfolio().deliverableReceipts);

    expect(() => recordDeliverableReceipt(ROOM, economy.id, storageId)).toThrow(
      /storage identity .* does not match record identity/i,
    );
    expect(portfolio().deliverableReceipts).toEqual(before);
  });

  it("refuses to receipt the same Activity twice for one Deliverable revision", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const activityId = addCompletedActivity(
      `task:${ROOM}:economy:maintain-colony-energy-service`,
      `activity:${ROOM}:economy:receipt-once`,
    );
    recordDeliverableReceipt(ROOM, economy.id, activityId);
    const before = structuredClone(portfolio().deliverableReceipts);

    expect(() =>
      recordDeliverableReceipt(ROOM, economy.id, activityId),
    ).toThrow(/already has a receipt/i);
    expect(portfolio().deliverableReceipts).toEqual(before);
  });

  it("enforces contiguous receipt sequence and previous-hash linkage", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const taskId = `task:${ROOM}:economy:maintain-colony-energy-service`;
    const first = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(taskId, `activity:${ROOM}:economy:receipt-chain-1`),
    );
    const second = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(taskId, `activity:${ROOM}:economy:receipt-chain-2`),
    );

    expect(second.sequence).toBe(2);
    expect(second.previousReceiptHash).toBe(first.receiptHash);
    expect(validateDeliverableReceiptRegistry(portfolio())).toEqual([]);

    second.previousReceiptHash = null;
    const { receiptHash: _receiptHash, ...content } = second;
    second.receiptHash = governanceContentHash(content);
    expect(validateDeliverableReceipt(portfolio(), second)).toBe(true);
    expect(validateDeliverableReceiptRegistry(portfolio())).toContainEqual(
      expect.stringMatching(/receipt chain is not contiguous/i),
    );
  });

  it("detects deletion of the newest receipt through its count and digest anchor", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const taskId = `task:${ROOM}:economy:maintain-colony-energy-service`;
    const first = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(taskId, `activity:${ROOM}:economy:anchor-receipt-1`),
    );
    const second = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(taskId, `activity:${ROOM}:economy:anchor-receipt-2`),
    );
    const anchor = structuredClone(
      portfolio().authorityLedgerAnchors?.deliverableReceipts,
    );
    const receipts = portfolio().deliverableReceipts;
    if (!anchor || !receipts) throw new Error("expected receipt ledger anchor");

    expect(anchor).toMatchObject({ count: 2 });
    expect(anchor.headHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    delete receipts[second.id];

    expect(validateDeliverableReceipt(portfolio(), first)).toBe(true);
    expect(validateDeliverableReceiptRegistry(portfolio())).toContainEqual(
      expect.stringMatching(
        /Deliverable receipt ledger anchor does not match its retained chain/i,
      ),
    );
    expect(portfolio().authorityLedgerAnchors?.deliverableReceipts).toEqual(
      anchor,
    );
  });

  it("rejects a hash-valid receipt chain with regressing capture ticks", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const taskId = `task:${ROOM}:economy:maintain-colony-energy-service`;
    Object.assign(Game, { time: 101 });
    recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(
        taskId,
        `activity:${ROOM}:economy:chronology-1`,
        100,
      ),
    );
    Object.assign(Game, { time: 102 });
    const second = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(
        taskId,
        `activity:${ROOM}:economy:chronology-2`,
        100,
      ),
    );

    second.capturedAtTick = 100;
    const { receiptHash: _receiptHash, ...content } = second;
    second.receiptHash = governanceContentHash(content);
    expect(validateDeliverableReceipt(portfolio(), second)).toBe(true);
    expect(validateDeliverableReceiptRegistry(portfolio())).toContainEqual(
      expect.stringMatching(/receipt chronology regresses/i),
    );
  });

  it("chains terminal receipt decisions and rejects replay or regressing time", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const taskId = `task:${ROOM}:economy:maintain-colony-energy-service`;
    const firstReceipt = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(taskId, `activity:${ROOM}:economy:decision-1`),
    );
    const secondReceipt = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(taskId, `activity:${ROOM}:economy:decision-2`),
    );
    Object.assign(Game, { time: 101 });
    const first = decideDeliverableReceipt(
      ROOM,
      firstReceipt.id,
      "rejected",
      "Evidence does not satisfy the approved quality threshold",
    );
    Object.assign(Game, { time: 102 });
    const second = decideDeliverableReceipt(
      ROOM,
      secondReceipt.id,
      "disputed",
      "Evidence requires accountable adjudication",
    );

    expect(second.sequence).toBe(2);
    expect(second.previousDecisionHash).toBe(first.decisionHash);
    expect(validateDeliverableReceiptDecisionRegistry(portfolio())).toEqual([]);
    expect(() =>
      decideDeliverableReceipt(
        ROOM,
        firstReceipt.id,
        "accepted",
        "Attempted replay",
      ),
    ).toThrow(/already has a terminal decision/i);

    second.decidedAtTick = 100;
    const { decisionHash: _decisionHash, ...content } = second;
    second.decisionHash = governanceContentHash(content);
    expect(validateDeliverableReceiptDecision(portfolio(), second)).toBe(true);
    expect(
      validateDeliverableReceiptDecisionRegistry(portfolio()),
    ).toContainEqual(expect.stringMatching(/decision chronology regresses/i));
  });

  it("detects deletion of the newest decision through its count and digest anchor", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    if (!economy) throw new Error("expected economy Deliverable");
    const taskId = `task:${ROOM}:economy:maintain-colony-energy-service`;
    const firstReceipt = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(
        taskId,
        `activity:${ROOM}:economy:anchor-decision-1`,
      ),
    );
    const secondReceipt = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(
        taskId,
        `activity:${ROOM}:economy:anchor-decision-2`,
      ),
    );
    const first = decideDeliverableReceipt(
      ROOM,
      firstReceipt.id,
      "rejected",
      "First occurrence does not satisfy the quality threshold",
    );
    Object.assign(Game, { time: 101 });
    const second = decideDeliverableReceipt(
      ROOM,
      secondReceipt.id,
      "disputed",
      "Second occurrence requires accountable adjudication",
    );
    const anchor = structuredClone(
      portfolio().authorityLedgerAnchors?.deliverableReceiptDecisions,
    );
    const decisions = portfolio().deliverableReceiptDecisions;
    if (!anchor || !decisions) {
      throw new Error("expected receipt decision ledger anchor");
    }

    expect(anchor).toMatchObject({ count: 2 });
    expect(anchor.headHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    delete decisions[second.id];

    expect(validateDeliverableReceiptDecision(portfolio(), first)).toBe(true);
    expect(
      validateDeliverableReceiptDecisionRegistry(portfolio()),
    ).toContainEqual(
      expect.stringMatching(
        /Deliverable receipt decision ledger anchor does not match its retained chain/i,
      ),
    );
    expect(
      portfolio().authorityLedgerAnchors?.deliverableReceiptDecisions,
    ).toEqual(anchor);
  });

  it("prevents extension of every live hash-bound authority entry after indexing", () => {
    activateApprovedColonyGovernance(ROOM);
    const economy = portfolio().deliverables.economy;
    const requirement = portfolio().requirements.economy;
    if (!economy || !requirement) {
      throw new Error("expected economy authority records");
    }
    const receipt = recordDeliverableReceipt(
      ROOM,
      economy.id,
      addCompletedActivity(
        `task:${ROOM}:economy:maintain-colony-energy-service`,
        `activity:${ROOM}:economy:extension-guard`,
      ),
    );
    const decision = decideDeliverableReceipt(
      ROOM,
      receipt.id,
      "accepted",
      "Satisfactory evidence satisfies the package-bound occurrence policy",
    );
    const event =
      portfolio().requirementApprovalLedger?.[requirement.approvalEventId];
    const binding = portfolio().governanceBinding;
    if (!event || !binding) throw new Error("expected hash-bound authority");

    createFspmAuthoritySnapshot();
    const before = structuredClone(Memory);
    for (const entry of [binding, event, receipt, decision]) {
      expect(Object.isExtensible(entry)).toBe(false);
      expect(() => Object.assign(entry, { forged: true })).toThrow(TypeError);
      expect("forged" in entry).toBe(false);
    }
    expect(Memory).toEqual(before);
  });

  it("binds approval and record creation ticks to the package import receipt", () => {
    activateApprovedColonyGovernance(ROOM);
    const requirement = portfolio().requirements.economy;
    const binding = portfolio().governanceBinding;
    const event = requirement
      ? portfolio().requirementApprovalLedger?.[requirement.approvalEventId]
      : undefined;
    if (!requirement || !binding || !event) {
      throw new Error("expected governed Requirement projection");
    }

    event.recordedAtTick = binding.importedAtTick + 1;
    const { eventHash: _eventHash, ...eventContent } = event;
    event.eventHash = governanceContentHash(eventContent);
    expect(validateColonyGovernanceAuthority(portfolio())).toContainEqual(
      expect.stringMatching(/approval ledger authority is invalid/i),
    );

    event.recordedAtTick = binding.importedAtTick;
    const { eventHash: _repairedHash, ...repairedContent } = event;
    event.eventHash = governanceContentHash(repairedContent);
    requirement.createdAt = binding.importedAtTick + 1;
    expect(validateColonyGovernanceAuthority(portfolio())).toContainEqual(
      expect.stringMatching(/creation tick is not bound to package import/i),
    );
  });

  it("records a chained retirement batch and rejects reactivation after reload", () => {
    activateApprovedColonyGovernance(ROOM);
    Object.assign(Game, { time: 125 });
    const requirement = portfolio().requirements.economy;
    const deliverable = portfolio().deliverables.economy;
    if (!requirement || !deliverable) {
      throw new Error("expected economy authority records");
    }

    const events = retireGovernedAuthorityRecords(
      ROOM,
      [deliverable.id, requirement.id],
      "Retired for a reviewed replacement package",
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.sequence).toBe(1);
    expect(events[1]?.previousEventHash).toBe(events[0]?.eventHash);
    expect(validateAuthorityLifecycleLedger(portfolio())).toEqual([]);
    expect(validateColonyGovernanceAuthority(portfolio())).toContainEqual(
      expect.stringMatching(/Requirement is retired|Deliverable is retired/i),
    );

    const secondEvent = events[1];
    if (!secondEvent) throw new Error("expected second lifecycle event");
    const lifecycleAnchor = structuredClone(
      portfolio().authorityLedgerAnchors?.authorityLifecycle,
    );
    const lifecycleLedger = portfolio().authorityLifecycleLedger;
    if (!lifecycleAnchor || !lifecycleLedger) {
      throw new Error("expected authority lifecycle ledger anchor");
    }
    expect(lifecycleAnchor).toMatchObject({ count: 2 });
    expect(lifecycleAnchor.headHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    delete lifecycleLedger[secondEvent.id];
    expect(validateAuthorityLifecycleLedger(portfolio())).toContainEqual(
      expect.stringMatching(
        /Authority lifecycle ledger anchor does not match its retained chain/i,
      ),
    );
    expect(portfolio().authorityLedgerAnchors?.authorityLifecycle).toEqual(
      lifecycleAnchor,
    );
    lifecycleLedger[secondEvent.id] = secondEvent;
    expect(validateAuthorityLifecycleLedger(portfolio())).toEqual([]);

    secondEvent.previousEventHash = null;
    const { eventHash: _brokenHash, ...brokenContent } = secondEvent;
    secondEvent.eventHash = governanceContentHash(brokenContent);
    expect(validateAuthorityLifecycleLedger(portfolio())).toContainEqual(
      expect.stringMatching(/lifecycle ledger is not contiguous/i),
    );
    secondEvent.previousEventHash = events[0]?.eventHash ?? null;
    const { eventHash: _restoredHash, ...restoredContent } = secondEvent;
    secondEvent.eventHash = governanceContentHash(restoredContent);
    expect(validateAuthorityLifecycleLedger(portfolio())).toEqual([]);

    secondEvent.recordedAtTick = 124;
    const retiredRequirement = portfolio().requirements.economy;
    if (!retiredRequirement) throw new Error("expected retired Requirement");
    retiredRequirement.updatedAt = 124;
    retiredRequirement.retiredAt = 124;
    const { eventHash: _regressedHash, ...regressedContent } = secondEvent;
    secondEvent.eventHash = governanceContentHash(regressedContent);
    expect(validateAuthorityLifecycleLedger(portfolio())).toContainEqual(
      expect.stringMatching(/lifecycle event chronology regresses/i),
    );

    secondEvent.recordedAtTick = 126;
    retiredRequirement.updatedAt = 126;
    retiredRequirement.retiredAt = 126;
    const { eventHash: _futureHash, ...futureContent } = secondEvent;
    secondEvent.eventHash = governanceContentHash(futureContent);
    expect(validateAuthorityLifecycleLedger(portfolio())).toContainEqual(
      expect.stringMatching(/lifecycle event .* recorded tick is invalid/i),
    );

    secondEvent.recordedAtTick = 125;
    retiredRequirement.updatedAt = 125;
    retiredRequirement.retiredAt = 125;
    const { eventHash: _finalHash, ...finalContent } = secondEvent;
    secondEvent.eventHash = governanceContentHash(finalContent);
    expect(validateAuthorityLifecycleLedger(portfolio())).toEqual([]);

    const reloaded = structuredClone(Memory);
    Object.assign(globalThis, { Game: { time: 126 }, Memory: reloaded });
    const reactivatedRequirement = portfolio().requirements.economy;
    const importTick = portfolio().governanceBinding?.importedAtTick;
    if (!reactivatedRequirement || importTick === undefined) {
      throw new Error("expected reloaded Requirement");
    }
    reactivatedRequirement.status = "active";
    reactivatedRequirement.statusReason =
      "binding obligation activated from the approved colony-operations authority package";
    reactivatedRequirement.updatedAt = importTick;
    delete reactivatedRequirement.retiredAt;

    expect(validateAuthorityLifecycleLedger(portfolio())).toContainEqual(
      expect.stringMatching(/cannot be reactivated/i),
    );
    expect(() => activateApprovedColonyGovernance(ROOM)).toThrow(
      /cannot reuse invalid FSPM governance/i,
    );
  });

  it("localizes an active Deliverable beneath a retired Requirement", () => {
    activateApprovedColonyGovernance(ROOM);
    const requirement = portfolio().requirements.economy;
    const deliverable = portfolio().deliverables.economy;
    if (!requirement || !deliverable) {
      throw new Error("expected economy authority records");
    }

    retireGovernedAuthorityRecords(
      ROOM,
      [requirement.id],
      "Requirement retired pending governed supersession",
    );

    expect(deliverable.status).toBe("active");
    expect(validateColonyGovernanceAuthority(portfolio())).toContainEqual(
      expect.stringMatching(
        /cannot remain active under .* Requirement status retired/i,
      ),
    );
  });

  it("quarantines v7 placeholders deterministically without granting approval", () => {
    const legacyPortfolio = {
      p3: createColonyPortfolioP3(ROOM, 1, 50),
      requirements: {
        economy: {
          kind: "requirement",
          id: `requirement:${ROOM}:economy`,
          p3Id: `portfolio:colony:${ROOM}`,
          domain: "economy",
          title: "legacy placeholder",
          status: "active",
          completionCriterion: "legacy",
          createdAt: 1,
          updatedAt: 1,
        },
      },
      deliverables: {},
      tasks: {},
      activities: {},
      qualityHistory: {},
      activityKpiHistory: {},
    };
    const legacyMemory = {
      version: 7,
      empireFspm: { p3: createEmpirePortfolioP3(1, 50) },
      runtimeSupervisor: { version: 1 as const, phases: {} },
      colonies: {
        [ROOM]: {
          roomName: ROOM,
          discoveredAt: 1,
          fspm: legacyPortfolio,
        },
      },
    };

    Object.assign(globalThis, {
      Game: { time: 100 },
      Memory: structuredClone(legacyMemory),
    });
    migrateMemory();
    const first = structuredClone(Memory);

    Object.assign(globalThis, {
      Game: { time: 100 },
      Memory: structuredClone(legacyMemory),
    });
    migrateMemory();
    const second = structuredClone(Memory);

    expect(second).toEqual(first);
    expect(Memory.version).toBe(8);
    expect(portfolio().requirements).toEqual({});
    expect(portfolio().governanceBinding).toBeUndefined();
    expect(portfolio().requirementApprovalLedger).toEqual({});
    expect(
      portfolio().authorityQuarantine?.[0]?.requirements.economy,
    ).toMatchObject({ title: "legacy placeholder", status: "active" });
  });
});
