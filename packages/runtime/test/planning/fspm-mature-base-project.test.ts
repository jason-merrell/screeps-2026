import { describe, expect, it } from "vitest";
import {
  canonicalGovernanceJson,
  governanceContentHash,
} from "../../src/planning/fspm-governance";
import {
  APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE,
  createMatureBaseProjectCandidate,
  evaluateMatureBaseQualityMetric,
  MATURE_BASE_PROJECT_POLICY_ID,
  MATURE_BASE_PROJECT_POLICY_OBLIGATION,
  MATURE_BASE_PROJECT_POLICY_VERBIAGE,
  MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR,
  type MatureBaseProjectCandidate,
  type MatureBaseProjectCandidateInput,
  type MatureBaseProjectDefinitionPackage,
  MatureBaseProjectValidationError,
  type MatureBaseValidationFinding,
  matureBaseProjectPackageUnsignedContent,
  validateMatureBaseProjectAuthorityPackage,
  validateMatureBaseProjectCandidate,
  validateMatureBaseProjectCandidateInput,
} from "../../src/planning/fspm-mature-base-project";
import goldenFixtureData from "../fixtures/fspm/mature-base-project-v1.json";

type DeepMutable<T> = T extends readonly (infer Entry)[]
  ? DeepMutable<Entry>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

interface MatureBaseGoldenFixture {
  readonly input: MatureBaseProjectCandidateInput;
  readonly expected: {
    readonly packageSchema: string;
    readonly definitionPackageHash: string;
    readonly candidateSchema: string;
    readonly candidateContentHash: string;
    readonly scheduleAttestationHash: string;
    readonly projectId: string;
    readonly projectName: string;
    readonly projectDefinitionHash: string;
    readonly requirementId: string;
    readonly requirementDefinitionHash: string;
    readonly deliverableKeys: readonly string[];
    readonly deliverableIds: readonly string[];
    readonly deliverableDefinitionHashes: Readonly<Record<string, string>>;
    readonly weights: Readonly<Record<string, number>>;
    readonly totalWeightBasisPoints: number;
    readonly rootDeliverableIds: readonly string[];
    readonly matureBaseChildDeliverableIds: readonly string[];
    readonly initialMilestoneTicks: Readonly<Record<string, number>>;
    readonly taskKeys: readonly string[];
    readonly taskDeliverableIds: readonly string[];
    readonly taskDefinitionHashes: Readonly<Record<string, string>>;
    readonly aggregatePrerequisites: readonly string[];
    readonly receiptStorage: MatureBaseProjectCandidate["deliverables"][number]["receiptValidation"];
    readonly runtimeBoundary: MatureBaseProjectCandidate["runtimeBoundary"];
  };
}

declare global {
  interface ImportMeta {
    glob: (
      pattern: string,
      options: {
        readonly eager: true;
        readonly import: "default";
        readonly query: "?raw";
      },
    ) => Readonly<Record<string, string>>;
  }
}

const golden = goldenFixtureData as unknown as MatureBaseGoldenFixture;
const runtimeSourceFiles = import.meta.glob("../../src/**/*.ts", {
  eager: true,
  import: "default",
  query: "?raw",
});
const policySourceFiles = import.meta.glob(
  "../../../../docs/screeps-mature-base-development-policy.md",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

function mutableCandidate(): DeepMutable<MatureBaseProjectCandidate> {
  return structuredClone(
    createMatureBaseProjectCandidate(golden.input),
  ) as unknown as DeepMutable<MatureBaseProjectCandidate>;
}

function mutablePackage(): DeepMutable<MatureBaseProjectDefinitionPackage> {
  return structuredClone(
    APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE,
  ) as unknown as DeepMutable<MatureBaseProjectDefinitionPackage>;
}

function setField(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function resignPackage(
  authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
): void {
  const hash = governanceContentHash(
    matureBaseProjectPackageUnsignedContent(
      authorityPackage as unknown as MatureBaseProjectDefinitionPackage,
    ),
  );
  authorityPackage.contentHash = hash;
  authorityPackage.approval.signedContentHash = hash;
}

function ruleCodes(
  findings: readonly MatureBaseValidationFinding[],
): readonly string[] {
  return findings.map((entry) => entry.rule);
}

function expectDeepFrozen(root: unknown): void {
  const pending: unknown[] = [root];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || seen.has(value)) {
      continue;
    }
    seen.add(value);
    expect(Object.isFrozen(value)).toBe(true);
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if ("value" in descriptor) pending.push(descriptor.value);
    }
  }
}

function policySource(): string {
  const source = Object.values(policySourceFiles)[0];
  if (!source) throw new Error("mature-base policy was not loaded as raw text");
  return source;
}

describe("FSPM mature-base General Project candidate", () => {
  it("encodes the policy locator as line one and the verbatim obligation as the Requirement body", () => {
    const policy = policySource();
    const requirement =
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.requirement;
    const [locator, ...bodyLines] = requirement.requirementVerbiage.split("\n");

    expect(policy).toContain(
      `- Policy ID: \`${MATURE_BASE_PROJECT_POLICY_ID}\``,
    );
    expect(policy).toContain(
      `- Requirement locator: \`${MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR}\``,
    );
    expect(policy).toContain(
      `## Binding obligation\n\n> ${MATURE_BASE_PROJECT_POLICY_OBLIGATION}\n`,
    );
    expect(MATURE_BASE_PROJECT_POLICY_VERBIAGE).toBe(
      `${MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR}\n${MATURE_BASE_PROJECT_POLICY_OBLIGATION}`,
    );
    expect(locator).toBe(MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR);
    expect(bodyLines.join("\n")).toBe(MATURE_BASE_PROJECT_POLICY_OBLIGATION);
    expect(requirement).toMatchObject({
      requirementSource: MATURE_BASE_PROJECT_POLICY_ID,
      requirementVerbiage: MATURE_BASE_PROJECT_POLICY_VERBIAGE,
    });
    expect("requirementSourceLocator" in requirement).toBe(false);
  });

  it("validates, hashes, attests, and deeply freezes the exact definition package", () => {
    const authorityPackage =
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE;

    expect(validateMatureBaseProjectAuthorityPackage(authorityPackage)).toEqual(
      [],
    );
    expect(authorityPackage.schema).toBe(golden.expected.packageSchema);
    expect(authorityPackage.contentHash).toBe(
      golden.expected.definitionPackageHash,
    );
    expect(authorityPackage.approval).toMatchObject({
      signedContentHash: authorityPackage.contentHash,
      canonicalHumanApproval: false,
    });
    expect(
      governanceContentHash(
        matureBaseProjectPackageUnsignedContent(authorityPackage),
      ),
    ).toBe(authorityPackage.contentHash);
    expectDeepFrozen(authorityPackage);

    const mutableView = authorityPackage as unknown as { schema: string };
    expect(() => {
      mutableView.schema = "forged";
    }).toThrow(TypeError);
  });

  it.each([
    {
      label: "Requirement source",
      rule: "MBP-REQ-001",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.requirement,
          "requirementSource",
          "2026.08.31-Forged",
        ),
    },
    {
      label: "missing first-line Requirement locator",
      rule: "MBP-REQ-001",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.requirement,
          "requirementVerbiage",
          MATURE_BASE_PROJECT_POLICY_OBLIGATION,
        ),
    },
    {
      label: "forged first-line Requirement locator",
      rule: "MBP-REQ-001",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.requirement,
          "requirementVerbiage",
          `§ Forged\n${MATURE_BASE_PROJECT_POLICY_OBLIGATION}`,
        ),
    },
    {
      label: "altered Requirement obligation body",
      rule: "MBP-REQ-001",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.requirement,
          "requirementVerbiage",
          `${MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR}\nBuild a base.`,
        ),
    },
    {
      label: "duplicate Deliverable identity",
      rule: "MBP-DLV-001",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.deliverables[1] ?? {},
          "key",
          "room-development-plan",
        ),
    },
    {
      label: "child hierarchy",
      rule: "MBP-DLV-002",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => authorityPackage.deliverables[1]?.childKeys.pop(),
    },
    {
      label: "flat weight pool",
      rule: "MBP-DLV-003",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.deliverables[0] ?? {},
          "p3WeightBasisPoints",
          999,
        ),
    },
    {
      label: "durable receipt storage claim",
      rule: "MBP-DLV-004",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.deliverables[0]?.receiptValidation ?? {},
          "storageState",
          "ready",
        ),
    },
    {
      label: "Deliverable missing its first-line Requirement locator",
      rule: "MBP-DLV-004",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.deliverables[0] ?? {},
          "requirementVerbiage",
          MATURE_BASE_PROJECT_POLICY_OBLIGATION,
        ),
    },
    {
      label: "circular aggregate prerequisite",
      rule: "MBP-DLV-004",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => {
        const aggregate = authorityPackage.deliverables[1]?.metricPolicy;
        if (aggregate?.evaluator === "mature_base_integration_v1") {
          aggregate.requiredAcceptedDeliverableKeys.push("mature-base-state");
        }
      },
    },
    {
      label: "missing Task candidate",
      rule: "MBP-TSK-001",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => authorityPackage.taskCandidates.pop(),
    },
    {
      label: "executable Task candidate",
      rule: "MBP-TSK-002",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) =>
        setField(
          authorityPackage.taskCandidates[0] ?? {},
          "executionEligibility",
          "authorized",
        ),
    },
  ])(
    "independently diagnoses package semantic drift in $label with $rule",
    ({ rule, mutate }) => {
      const authorityPackage = mutablePackage();
      mutate(authorityPackage);
      resignPackage(authorityPackage);

      const findings =
        validateMatureBaseProjectAuthorityPackage(authorityPackage);
      expect(ruleCodes(findings)).toContain(rule);
      expect(ruleCodes(findings)).not.toContain("MBP-PKG-008");
      expect(ruleCodes(findings)).toContain("MBP-PKG-009");
    },
  );

  it("projects a deterministic generation-scoped W1N1 proposal without pretending to authorize it", () => {
    const first = createMatureBaseProjectCandidate(golden.input);
    const second = createMatureBaseProjectCandidate(
      structuredClone(golden.input),
    );

    expect(validateMatureBaseProjectCandidateInput(golden.input)).toEqual([]);
    expect(validateMatureBaseProjectCandidate(first)).toEqual([]);
    expect(canonicalGovernanceJson(first)).toBe(
      canonicalGovernanceJson(second),
    );
    expect(first.schema).toBe(golden.expected.candidateSchema);
    expect(first.contentHash).toBe(golden.expected.candidateContentHash);
    expect(first.scheduleAttestation).toMatchObject({
      type: "proposed_colony_project_schedule_attestation",
      attestationId: golden.input.scheduleAttestationId,
      projectGeneration: 1,
      initialDueTick: golden.input.initialDueTick,
      initialMilestoneTicks: golden.input.initialMilestoneTicks,
      canonicalHumanAuthorization: false,
      grantsProjectAuthority: false,
      attestedContentHash: golden.expected.scheduleAttestationHash,
    });
    expect(first.project).toMatchObject({
      id: golden.expected.projectId,
      name: golden.expected.projectName,
      type: "project",
      subType: "general_project",
      projectGeneration: 1,
      parentP3Id: "portfolio:colony:W1N1",
      temporalBasis: "game_tick",
      startTick: golden.input.startTick,
      initialDueTick: golden.input.initialDueTick,
      initialScheduleRevision: 1,
      plannedInitialStatus:
        "active_after_canonical_authorization_and_atomic_publication",
      definitionHash: golden.expected.projectDefinitionHash,
      creationTest: {
        temporaryEndeavor: true,
        authorizationStatus: "pending",
        servicePrincipalScheduleAttestationPresent: true,
        definedStartAndEnd: true,
        excludesOngoingMaintenance: true,
      },
    });
    expect(first.requirement).toMatchObject({
      id: golden.expected.requirementId,
      p3Id: golden.expected.projectId,
      title: "Develop W1N1 to a Mature Operating Base",
      requirementSource: MATURE_BASE_PROJECT_POLICY_ID,
      requirementVerbiage: MATURE_BASE_PROJECT_POLICY_VERBIAGE,
      definitionHash: golden.expected.requirementDefinitionHash,
      approvalContract: {
        state: "requires_canonical_authorization_and_atomic_publication",
        canonicalHumanApproval: false,
      },
    });
    expectDeepFrozen(first);
  });

  it("snapshots Proxy input before validation so caller-side TOCTOU reads cannot alter the built candidate", () => {
    const target = structuredClone(golden.input);
    let propertyReads = 0;
    const adversarialInput = new Proxy(target, {
      get: (current, property, receiver) => {
        propertyReads += 1;
        if (property === "roomName") return "W9N9";
        return Reflect.get(current, property, receiver);
      },
    });

    const candidate = createMatureBaseProjectCandidate(adversarialInput);

    expect(propertyReads).toBe(0);
    expect(candidate.project.roomName).toBe(golden.input.roomName);
    expect(candidate.project.id).toBe(golden.expected.projectId);
    expect(validateMatureBaseProjectCandidate(candidate)).toEqual([]);
  });

  it("pins every identity, hash, milestone, flat weight, and one-level relationship", () => {
    const candidate = createMatureBaseProjectCandidate(golden.input);
    const roots = candidate.deliverables.filter(
      (deliverable) => deliverable.parentDeliverableId === null,
    );
    const matureBase = candidate.deliverables.find(
      (deliverable) => deliverable.key === "mature-base-state",
    );
    if (!matureBase)
      throw new Error("golden candidate has no mature-base root");

    expect(candidate.deliverables.map((entry) => entry.key)).toEqual(
      golden.expected.deliverableKeys,
    );
    expect(candidate.deliverables.map((entry) => entry.id)).toEqual(
      golden.expected.deliverableIds,
    );
    expect(new Set(candidate.deliverables.map((entry) => entry.id)).size).toBe(
      candidate.deliverables.length,
    );
    expect(
      Object.fromEntries(
        candidate.deliverables.map((entry) => [
          entry.key,
          entry.definitionHash,
        ]),
      ),
    ).toEqual(golden.expected.deliverableDefinitionHashes);
    expect(
      Object.fromEntries(
        candidate.deliverables.map((entry) => [
          entry.key,
          entry.p3WeightBasisPoints,
        ]),
      ),
    ).toEqual(golden.expected.weights);
    expect(
      candidate.deliverables.reduce(
        (sum, entry) => sum + entry.p3WeightBasisPoints,
        0,
      ),
    ).toBe(golden.expected.totalWeightBasisPoints);
    expect(roots.map((entry) => entry.id)).toEqual(
      golden.expected.rootDeliverableIds,
    );
    expect(matureBase.childDeliverableIds).toEqual(
      golden.expected.matureBaseChildDeliverableIds,
    );
    expect(
      candidate.deliverables
        .filter((entry) => entry.parentDeliverableId !== null)
        .every(
          (entry) =>
            entry.parentDeliverableId === matureBase.id &&
            entry.childDeliverableIds.length === 0,
        ),
    ).toBe(true);
    expect(
      Object.fromEntries(
        candidate.deliverables.map((entry) => [
          entry.key,
          entry.initialMilestoneTick,
        ]),
      ),
    ).toEqual(golden.expected.initialMilestoneTicks);
  });

  it("keeps receipts blocked, aggregate prerequisites acyclic, and activation stateful", () => {
    const candidate = createMatureBaseProjectCandidate(golden.input);
    const matureBase = candidate.deliverables.find(
      (deliverable) => deliverable.key === "mature-base-state",
    );
    if (matureBase?.metricPolicy.evaluator !== "mature_base_integration_v1") {
      throw new Error("golden candidate has no aggregate mature-base policy");
    }

    expect(
      candidate.deliverables.every(
        (deliverable) =>
          !("requirementSourceLocator" in deliverable) &&
          deliverable.requirementVerbiage ===
            MATURE_BASE_PROJECT_POLICY_VERBIAGE &&
          canonicalGovernanceJson(deliverable.receiptValidation) ===
            canonicalGovernanceJson(golden.expected.receiptStorage) &&
          deliverable.acceptanceDecision.state === "not_authorized" &&
          deliverable.acceptanceDecision.evidenceCaptureSeparationRequired &&
          deliverable.acceptanceDecision.decisionResponsibility !==
            deliverable.receiptValidation.captureResponsibility,
      ),
    ).toBe(true);
    expect(matureBase.metricPolicy.requiredAcceptedDeliverableKeys).toEqual(
      golden.expected.aggregatePrerequisites,
    );
    expect(
      matureBase.metricPolicy.requiredAcceptedDeliverableKeys,
    ).not.toContain("mature-base-state");
    expect(candidate.runtimeBoundary).toEqual(golden.expected.runtimeBoundary);
    expect(candidate.runtimeBoundary.requiredActivationPreconditions).toEqual(
      expect.arrayContaining([
        "canonical_authorization_exists",
        "canonical_ou_position_and_arci_assignments_exist",
        "activation_tick_equals_canonical_authorization_tick",
        "schedule_attestation_tick_is_no_later_than_activation_tick",
        "activation_tick_is_no_later_than_start_tick",
        "no_activity_or_evidence_before_start_tick",
        "room_is_currently_owned",
        "exact_active_colony_portfolio_exists",
        "project_generation_is_monotonic_and_unused",
        "durable_append_only_evidence_store_is_bound",
        "append_only_schedule_revision_ledger_exists",
        "atomic_compact_persistence_schema_exists",
        "deliverable_weights_confirmed_by_accountable_position",
        "mature_quality_evaluator_contracts_are_content_bound",
        "mature_capability_manifest_is_content_bound",
      ]),
    );
    expect(
      candidate.runtimeBoundary.requiredActivationPreconditions,
    ).toHaveLength(15);
    expect(candidate.runtimeBoundary).toMatchObject({
      grantsP3Authority: false,
      grantsTaskAuthority: false,
      grantsIntentAuthority: false,
      permitsEvidenceCapture: false,
      permitsReceiptOrDecision: false,
      permitsRetroactiveEvidence: false,
      qi: null,
      dqi: null,
      pqi: null,
    });
  });

  it("keeps task candidates complete, immutable, non-live, and unable to issue intents", () => {
    const candidate = createMatureBaseProjectCandidate(golden.input);

    expect(candidate.taskCandidates.map((entry) => entry.key)).toEqual(
      golden.expected.taskKeys,
    );
    expect(
      candidate.taskCandidates.map((entry) => entry.deliverableId),
    ).toEqual(golden.expected.taskDeliverableIds);
    expect(
      Object.fromEntries(
        candidate.taskCandidates.map((entry) => [
          entry.key,
          entry.definitionHash,
        ]),
      ),
    ).toEqual(golden.expected.taskDefinitionHashes);
    expect(
      candidate.taskCandidates.every(
        (task) =>
          task.candidateKind === "task_definition_candidate" &&
          task.executionEligibility === "not_authorized" &&
          task.taskWeightBasisPoints === 10_000 &&
          !("id" in task) &&
          !("status" in task) &&
          !("createdAt" in task) &&
          !("updatedAt" in task) &&
          task.procedures.length > 0 &&
          task.procedures.every(
            (procedure) => procedure.allowedIntentTypes.length === 0,
          ),
      ),
    ).toBe(true);
  });

  it("uses generation-scoped identities so a later proposal cannot collide with retained history", () => {
    const first = createMatureBaseProjectCandidate(golden.input);
    const secondInput: MatureBaseProjectCandidateInput = {
      ...golden.input,
      projectGeneration: 2,
      scheduleAttestationId:
        "attestation:colony:W1N1:mature-base-development:g2:1000:7000",
      typedAttestation:
        "ATTEST PROPOSED W1N1 MATURE BASE DEVELOPMENT G2 1000-7000",
    };
    const second = createMatureBaseProjectCandidate(secondInput);

    expect(validateMatureBaseProjectCandidate(second)).toEqual([]);
    expect(second.project).toMatchObject({
      id: "project:colony:W1N1:mature-base-development:g2",
      name: "COLONY-W1N1-PROJ-Mature Operating Base Development G2",
    });
    expect(second.requirement.id).toBe(
      "requirement:W1N1:mature-base-development:g2",
    );
    expect(second.deliverables[0]?.id).toBe(
      "deliverable:W1N1:mature-base:g2:room-development-plan",
    );
    expect(second.project.id).not.toBe(first.project.id);
    expect(second.requirement.id).not.toBe(first.requirement.id);
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it("keeps the heavy detached candidate off every production runtime path", () => {
    const forbiddenReferences = Object.entries(runtimeSourceFiles)
      .filter(
        ([path, source]) =>
          !path.endsWith("/fspm-mature-base-project.ts") &&
          (source.includes("fspm-mature-base-project") ||
            source.includes(
              "authority-package:empire:world-mature-base-development:v1",
            )),
      )
      .map(([path]) => path);

    expect(forbiddenReferences).toEqual([]);
  });

  it("binds the aggregate defense evaluator name to an actual exported runtime symbol", () => {
    const aggregate =
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.deliverables.find(
        (deliverable) => deliverable.key === "mature-base-state",
      );
    if (aggregate?.metricPolicy.evaluator !== "mature_base_integration_v1") {
      throw new Error("approved package has no mature-base integration metric");
    }
    const defenseSource = Object.entries(runtimeSourceFiles).find(([path]) =>
      path.endsWith("/systems/defense/active-defense-readiness.ts"),
    )?.[1];
    if (!defenseSource) throw new Error("active-defense source was not loaded");

    expect(aggregate.metricPolicy.activeDefenseEvaluator).toBe(
      "assessPreparedActiveDefense",
    );
    expect(defenseSource).toContain(
      `export function ${aggregate.metricPolicy.activeDefenseEvaluator}(`,
    );
  });

  it.each([
    {
      label: "schema",
      rule: "MBP-PKG-001",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "schema", "forged/v1"),
    },
    {
      label: "identity",
      rule: "MBP-PKG-002",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "id", "authority-package:forged"),
    },
    {
      label: "revision",
      rule: "MBP-PKG-003",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "revision", 2),
    },
    {
      label: "governance pin",
      rule: "MBP-PKG-004",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "governanceSha", "deadbeef"),
    },
    {
      label: "effective date",
      rule: "MBP-PKG-005",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "effectiveDate", "2099-01-01"),
    },
    {
      label: "runtime authority",
      rule: "MBP-PKG-006",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "grantsRuntimeAuthority", true),
    },
    {
      label: "signer ancestry",
      rule: "MBP-PKG-007",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage.approval, "signedBy", "principal:forged"),
    },
    {
      label: "attestation hash",
      rule: "MBP-PKG-008",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "contentHash", "sha256:forged"),
    },
    {
      label: "unknown field",
      rule: "MBP-PKG-009",
      mutate: (
        authorityPackage: DeepMutable<MatureBaseProjectDefinitionPackage>,
      ) => setField(authorityPackage, "forged", true),
    },
  ])(
    "rejects package drift in $label with stable $rule",
    ({ rule, mutate }) => {
      const authorityPackage = mutablePackage();
      mutate(authorityPackage);

      expect(
        ruleCodes(validateMatureBaseProjectAuthorityPackage(authorityPackage)),
      ).toContain(rule);
    },
  );

  it("rejects incomplete, inferred, unsafe, or non-monotonic proposal inputs", () => {
    const cases: readonly {
      readonly input: unknown;
      readonly rule: string;
    }[] = [
      { input: { ...golden.input, forged: true }, rule: "MBP-INP-001" },
      { input: { ...golden.input, roomName: "world" }, rule: "MBP-INP-002" },
      {
        input: { ...golden.input, parentP3Id: "portfolio:empire:operations" },
        rule: "MBP-INP-003",
      },
      { input: { ...golden.input, projectGeneration: 0 }, rule: "MBP-INP-004" },
      { input: { ...golden.input, startTick: -0 }, rule: "MBP-INP-004" },
      {
        input: {
          ...golden.input,
          initialMilestoneTicks: {
            ...golden.input.initialMilestoneTicks,
            bootstrap: -0,
          },
        },
        rule: "MBP-INP-005",
      },
      {
        input: {
          ...golden.input,
          initialMilestoneTicks: {
            ...golden.input.initialMilestoneTicks,
            logistics: 2000,
          },
        },
        rule: "MBP-INP-006",
      },
      {
        input: { ...golden.input, scheduleAttestationId: "attestation:auto" },
        rule: "MBP-INP-007",
      },
      {
        input: { ...golden.input, attestedAtTick: 1001 },
        rule: "MBP-INP-008",
      },
      {
        input: { ...golden.input, typedAttestation: "AUTHORIZE" },
        rule: "MBP-INP-008",
      },
    ];

    for (const entry of cases) {
      expect(
        ruleCodes(validateMatureBaseProjectCandidateInput(entry.input)),
      ).toContain(entry.rule);
      expect(() =>
        createMatureBaseProjectCandidate(
          entry.input as MatureBaseProjectCandidateInput,
        ),
      ).toThrow(MatureBaseProjectValidationError);
    }
  });

  it.each([
    {
      label: "a World pseudo-type",
      rule: "MBP-PRJ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate.project, "type", "world"),
    },
    {
      label: "a Service Program",
      rule: "MBP-PRJ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) => {
        setField(candidate.project, "type", "program");
        setField(candidate.project, "subType", "service_program");
      },
    },
    {
      label: "a different parent",
      rule: "MBP-PRJ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.project,
          "parentP3Id",
          "portfolio:empire:operations",
        ),
    },
    {
      label: "a verb-first Project name",
      rule: "MBP-PRJ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate.project, "name", "Develop W1N1"),
    },
    {
      label: "a rewritten baseline schedule",
      rule: "MBP-PRJ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate.project, "initialDueTick", 7001),
    },
    {
      label: "a false authorization claim",
      rule: "MBP-PRJ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.project.creationTest,
          "authorizationStatus",
          "authorized",
        ),
    },
    {
      label: "a substituted Requirement Source",
      rule: "MBP-REQ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.requirement,
          "requirementSource",
          "2026.08.31-Forged",
        ),
    },
    {
      label: "missing first-line Requirement locator",
      rule: "MBP-REQ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.requirement,
          "requirementVerbiage",
          MATURE_BASE_PROJECT_POLICY_OBLIGATION,
        ),
    },
    {
      label: "a forged first-line Requirement locator",
      rule: "MBP-REQ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.requirement,
          "requirementVerbiage",
          `§ Forged\n${MATURE_BASE_PROJECT_POLICY_OBLIGATION}`,
        ),
    },
    {
      label: "an altered Requirement obligation body",
      rule: "MBP-REQ-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.requirement,
          "requirementVerbiage",
          `${MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR}\nBuild a base.`,
        ),
    },
    {
      label: "a Deliverable missing its first-line Requirement locator",
      rule: "MBP-DLV-004",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.deliverables[0] ?? {},
          "requirementVerbiage",
          MATURE_BASE_PROJECT_POLICY_OBLIGATION,
        ),
    },
    {
      label: "a broken child relationship",
      rule: "MBP-DLV-002",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        candidate.deliverables[1]?.childDeliverableIds.pop(),
    },
    {
      label: "an underweight flat pool",
      rule: "MBP-DLV-003",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate.deliverables[0] ?? {}, "p3WeightBasisPoints", 999),
    },
    {
      label: "a reallocated but still 10,000-point pool",
      rule: "MBP-DLV-004",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) => {
        setField(candidate.deliverables[0] ?? {}, "p3WeightBasisPoints", 999);
        setField(candidate.deliverables[1] ?? {}, "p3WeightBasisPoints", 1001);
      },
    },
    {
      label: "an executable Task candidate",
      rule: "MBP-TSK-002",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.taskCandidates[0] ?? {},
          "executionEligibility",
          "authorized",
        ),
    },
    {
      label: "a live Task status",
      rule: "MBP-TSK-002",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate.taskCandidates[0] ?? {}, "status", "active"),
    },
    {
      label: "an intent allowlist",
      rule: "MBP-TSK-002",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(
          candidate.taskCandidates[0]?.procedures[0] ?? {},
          "allowedIntentTypes",
          ["build"],
        ),
    },
    {
      label: "runtime authority",
      rule: "MBP-BND-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate.runtimeBoundary, "grantsP3Authority", true),
    },
    {
      label: "a forged content hash",
      rule: "MBP-HSH-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate, "contentHash", "sha256:forged"),
    },
    {
      label: "an extra top-level receipt",
      rule: "MBP-EXA-001",
      mutate: (candidate: DeepMutable<MatureBaseProjectCandidate>) =>
        setField(candidate, "receipt", { accepted: true }),
    },
  ])("fails closed on $label with stable $rule", ({ rule, mutate }) => {
    const candidate = mutableCandidate();
    mutate(candidate);

    expect(ruleCodes(validateMatureBaseProjectCandidate(candidate))).toContain(
      rule,
    );
  });

  it("never throws on accessors, prototypes, cycles, __proto__, non-finite, unsafe, sparse, or oversized data", () => {
    class ForgedAuthority {}
    const hostileFactories: readonly (() => unknown)[] = [
      () => null,
      () => [],
      () => new ForgedAuthority(),
      () => {
        const value: Record<string, unknown> = {};
        Object.defineProperty(value, "schema", {
          enumerable: true,
          get: () => {
            throw new Error("validator invoked an accessor");
          },
        });
        return value;
      },
      () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
      () => {
        const value: Record<string, unknown> = {};
        Object.defineProperty(value, "__proto__", {
          enumerable: true,
          value: { polluted: true },
        });
        return value;
      },
      () => ({ ...golden.input, startTick: Number.NaN }),
      () => ({ ...golden.input, initialDueTick: Number.POSITIVE_INFINITY }),
      () => ({ ...golden.input, startTick: Number.MAX_SAFE_INTEGER + 1 }),
      () => ({ value: "x".repeat(32_769) }),
      () => ({ value: new Array(20_001).fill(null) }),
      () => {
        const value: unknown[] = [];
        value.length = 2;
        return value;
      },
      () => {
        const value: Record<string, unknown> = {};
        Object.defineProperty(value, Symbol("forged"), {
          enumerable: true,
          value: true,
        });
        return value;
      },
    ];
    const validators: readonly ((
      input: unknown,
    ) => MatureBaseValidationFinding[])[] = [
      validateMatureBaseProjectCandidateInput,
      validateMatureBaseProjectAuthorityPackage,
      validateMatureBaseProjectCandidate,
    ];

    for (const validator of validators) {
      for (const createHostileValue of hostileFactories) {
        let findings: MatureBaseValidationFinding[] = [];
        expect(() => {
          findings = validator(createHostileValue());
        }).not.toThrow();
        expect(findings.length).toBeGreaterThan(0);
      }
    }
  });

  it("maps material validation failures to canonical rules and stable severity", () => {
    const hierarchy = mutablePackage();
    hierarchy.deliverables[1]?.childKeys.pop();
    const hierarchyFinding = validateMatureBaseProjectAuthorityPackage(
      hierarchy,
    ).find((entry) => entry.rule === "MBP-DLV-002");

    expect(hierarchyFinding).toMatchObject({
      severity: "blocker",
      canonicalRules: ["DLV-REF-001", "DLV-STR-001", "DLV-STR-002"],
    });

    const weights = mutablePackage();
    setField(weights.deliverables[0] ?? {}, "p3WeightBasisPoints", 999);
    const weightFinding = validateMatureBaseProjectAuthorityPackage(
      weights,
    ).find((entry) => entry.rule === "MBP-DLV-003");
    expect(weightFinding).toMatchObject({
      severity: "error",
      canonicalRules: ["DLV-WGT-002", "DLV-WGT-004"],
    });

    const prototypeKey: Record<string, unknown> = {};
    Object.defineProperty(prototypeKey, "__proto__", {
      enumerable: true,
      value: true,
    });
    expect(validateMatureBaseProjectCandidate(prototypeKey)[0]).toMatchObject({
      rule: "MBP-DAT-001",
      severity: "blocker",
      canonicalRules: [],
    });
  });

  it("crosswalks forged P3 lineage and Child Deliverable Requirement-source drift", () => {
    const forgedP3 = mutableCandidate();
    setField(
      forgedP3.deliverables[2] ?? {},
      "p3Id",
      "project:colony:W1N1:forged:g1",
    );
    const p3Finding = validateMatureBaseProjectCandidate(forgedP3).find(
      (entry) => entry.rule === "MBP-DLV-004",
    );
    expect(p3Finding?.canonicalRules).toContain("DLV-REF-003");

    const forgedChildSource = mutableCandidate();
    setField(
      forgedChildSource.deliverables[2] ?? {},
      "requirementVerbiage",
      `${MATURE_BASE_PROJECT_REQUIREMENT_LOCATOR}\nForged obligation.`,
    );
    const sourceFinding = validateMatureBaseProjectCandidate(
      forgedChildSource,
    ).find((entry) => entry.rule === "MBP-DLV-004");
    expect(sourceFinding?.canonicalRules).toContain("DLV-STR-006");
  });

  it("refuses syntactically perfect plan evidence until a content-recomputing verifier exists", () => {
    const plan =
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.deliverables.find(
        (deliverable) => deliverable.key === "room-development-plan",
      );
    if (plan?.metricPolicy.evaluator !== "room_plan_projection_v1") {
      throw new Error("approved package has no room-plan Product metric");
    }
    const evaluation = evaluateMatureBaseQualityMetric(plan.metricPolicy, {
      projectRoomName: "W1N1",
      projectStartTick: 1000,
      capturedAtTick: 1500,
      roomName: "W1N1",
      artifactHash:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      version: plan.metricPolicy.roomPlanVersion,
      horizonRcl: plan.metricPolicy.horizonRcl,
      plannerRevision: plan.metricPolicy.plannerRevision,
      projectionRevision: 1,
      projectionFingerprint: "rpf1-0123456789abcdef",
      currentAndUsable: true,
      fingerprintValid: true,
      validationIssues: [],
    });

    expect(evaluation.satisfied).toBe(false);
    expect(
      evaluation.clauses
        .filter(
          (clause) => clause.clause !== "content_recomputing_artifact_verifier",
        )
        .every((clause) => clause.satisfied),
    ).toBe(true);
    expect(evaluation.clauses).toContainEqual(
      expect.objectContaining({
        clause: "content_recomputing_artifact_verifier",
        satisfied: false,
      }),
    );
  });

  it("allows an after-start pre-milestone stage shape while refusing to call it governed evidence", () => {
    const matureStage =
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.deliverables.find(
        (deliverable) => deliverable.key === "mature-rcl8",
      );
    if (matureStage?.metricPolicy.evaluator !== "room_development_stage_v1") {
      throw new Error("approved package has no Mature RCL8 Result metric");
    }

    const capturedAtTick = 1100;
    expect(capturedAtTick).toBeLessThan(
      golden.input.initialMilestoneTicks["mature-rcl8"],
    );
    const evaluation = evaluateMatureBaseQualityMetric(
      matureStage.metricPolicy,
      {
        controllerLevel: 8,
        projectStartTick: 1000,
        capturedAtTick,
        acceptedPlanProductIsCurrent: true,
        horizonStatus: "v4_rcl8",
        validationIssues: [],
        stageId: "mature-rcl8",
        controllerEligible: true,
        prerequisitesSatisfied: true,
        status: "realized",
        eligibleRequiredWeight: 100,
        realizedRequiredWeight: 100,
        realizationPercentage: 100,
        missingEligibleStructures: 0,
        blockedEligibleStructures: 0,
      },
    );

    expect(evaluation).toMatchObject({ satisfied: false });
    expect(evaluation.clauses).toEqual([
      expect.objectContaining({
        clause: "caller_supplied_blueprint_shape_consistency",
        satisfied: true,
      }),
      expect.objectContaining({
        clause: "content_recomputing_stage_evidence_verifier",
        satisfied: false,
      }),
      expect.objectContaining({
        clause: "controller_level_is_eligibility_only",
        satisfied: false,
      }),
    ]);
  });

  it.each([
    { label: "pre-start capture", override: { capturedAtTick: 999 } },
    {
      label: "unaccepted plan Product",
      override: { acceptedPlanProductIsCurrent: false },
    },
    { label: "RCL above eight", override: { controllerLevel: 9 } },
    {
      label: "negative eligible weight",
      override: { eligibleRequiredWeight: -1, realizedRequiredWeight: -1 },
    },
    {
      label: "fractional eligible weight",
      override: { eligibleRequiredWeight: 0.5, realizedRequiredWeight: 0.5 },
    },
    {
      label: "negative realized weight",
      override: { realizedRequiredWeight: -1 },
    },
    {
      label: "fractional realized weight",
      override: { realizedRequiredWeight: 99.5 },
    },
  ])("rejects $label in the stage shape diagnostic", ({ override }) => {
    const matureStage =
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.deliverables.find(
        (deliverable) => deliverable.key === "mature-rcl8",
      );
    if (matureStage?.metricPolicy.evaluator !== "room_development_stage_v1") {
      throw new Error("approved package has no Mature RCL8 Result metric");
    }

    const evaluation = evaluateMatureBaseQualityMetric(
      matureStage.metricPolicy,
      {
        controllerLevel: 8,
        projectStartTick: 1000,
        capturedAtTick: 1100,
        acceptedPlanProductIsCurrent: true,
        horizonStatus: "v4_rcl8",
        validationIssues: [],
        stageId: "mature-rcl8",
        controllerEligible: true,
        prerequisitesSatisfied: true,
        status: "realized",
        eligibleRequiredWeight: 100,
        realizedRequiredWeight: 100,
        realizationPercentage: 100,
        missingEligibleStructures: 0,
        blockedEligibleStructures: 0,
        ...override,
      },
    );

    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.clauses).toContainEqual(
      expect.objectContaining({
        clause: "caller_supplied_blueprint_shape_consistency",
        satisfied: false,
      }),
    );
  });

  it("fails aggregate quality and malformed evidence closed without throwing", () => {
    const aggregate =
      APPROVED_WORLD_MATURE_BASE_PROJECT_DEFINITION_PACKAGE.deliverables.find(
        (deliverable) => deliverable.key === "mature-base-state",
      );
    if (aggregate?.metricPolicy.evaluator !== "mature_base_integration_v1") {
      throw new Error("approved package has no mature-base integration metric");
    }

    expect(
      evaluateMatureBaseQualityMetric(aggregate.metricPolicy, {}),
    ).toMatchObject({ satisfied: false });
    const accessorEvidence: Record<string, unknown> = {};
    Object.defineProperty(accessorEvidence, "artifactHash", {
      enumerable: true,
      get: () => {
        throw new Error("metric evaluator invoked an accessor");
      },
    });
    expect(() =>
      evaluateMatureBaseQualityMetric(aggregate.metricPolicy, accessorEvidence),
    ).not.toThrow();
    expect(
      evaluateMatureBaseQualityMetric(aggregate.metricPolicy, accessorEvidence),
    ).toMatchObject({
      satisfied: false,
      clauses: [
        expect.objectContaining({ clause: "evidence_is_bounded_plain_data" }),
      ],
    });
  });
});
