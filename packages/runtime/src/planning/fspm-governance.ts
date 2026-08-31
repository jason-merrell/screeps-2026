import type { FspmDomain } from "./fspm";
import { FSPM_GOVERNANCE_SHA } from "./fspm-catalog";

export const FSPM_AUTHORITY_PACKAGE_SCHEMA =
  "screeps-fspm-authority-package/v1" as const;
export const FSPM_AUTHORITY_PACKAGE_ID =
  "authority-package:empire:colony-operations:v1" as const;
export const FSPM_AUTHORITY_PACKAGE_REVISION = 1 as const;
export const FSPM_AUTHORITY_PACKAGE_EFFECTIVE_DATE = "2026-08-30" as const;
export const FSPM_WEIGHT_BASIS_POINTS = 10_000 as const;
const authorityDomains = [
  "economy",
  "spawning",
  "construction",
  "defense",
] as const satisfies readonly FspmDomain[];
const requirementSourcePattern =
  /^(\d{4})\.(\d{2})(?:\.(\d{2}))?-([^\r\n]*\S)$/;

export function isCanonicalRequirementSource(value: string): boolean {
  if (value !== value.trim()) return false;
  const match = requirementSourcePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] === undefined ? undefined : Number(match[3]);
  if (year < 1000 || month < 1 || month > 12) return false;
  if (day === undefined) return true;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isCanonicalIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1000 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export type FspmStrategicPriority = "SELL" | "STAFF" | "SERVE";
export type FspmRequirementTrigger =
  | "executiveDirective"
  | "strategicBusinessObjective"
  | "operationalEfficiencyInitiative"
  | "regulatoryCompliance";
export type FspmDeliverableCategory = "corporate" | "service_program";
export type FspmDeliverableType = "product" | "service" | "result";

export interface FspmEvaluationFactors {
  primaryStrategicPriority: FspmStrategicPriority;
  strategicAlignment: string;
  operationalEffectiveness: string;
  dataIntegrityAndUsability: string;
  adoptionAndEngagement: string;
  scalabilityAndMaintainability: string;
}

export interface FspmReceiptValidationContract {
  evidenceForm: "system_generated_confirmation" | "logged_system_record";
  storageLocation: string;
  captureResponsibility: string;
}

export interface FspmServicePrincipalAcceptancePolicy {
  model: "terminal_activity_kpi_threshold";
  acceptedKpiRatings: readonly ["exceptional", "satisfactory"];
  canonicalHumanAcceptance: false;
}

export interface FspmRequirementAuthorityTemplate {
  domain: FspmDomain;
  title: string;
  requestorId: string;
  requirementTrigger: FspmRequirementTrigger;
  requirementSource?: string;
  originatingAuthority?: string;
  requirementVerbiage: string;
  purposeStatement: string;
  strategicPriority: FspmStrategicPriority;
  strategicAlignment: string;
  desiredOutcomes: string;
  businessCase: string;
}

export interface FspmDeliverableAuthorityTemplate {
  domain: FspmDomain;
  category: FspmDeliverableCategory;
  deliverableType: FspmDeliverableType;
  title: string;
  details: string;
  output: string;
  evaluationFactors: FspmEvaluationFactors;
  qualityDescription: string;
  qualityMetric: string;
  receiptValidation: FspmReceiptValidationContract;
  servicePrincipalAcceptance: FspmServicePrincipalAcceptancePolicy;
  siblingWeightBasisPoints: number;
  childDeliverableIds: readonly string[];
}

export interface FspmAuthorityPackage {
  schema: typeof FSPM_AUTHORITY_PACKAGE_SCHEMA;
  id: typeof FSPM_AUTHORITY_PACKAGE_ID;
  revision: typeof FSPM_AUTHORITY_PACKAGE_REVISION;
  governanceSha: string;
  effectiveDate: string;
  issuer: {
    principalId: string;
    organizationalUnitId: string;
    accountablePositionId: string;
  };
  organizationalAuthority: {
    departmentOuId: string;
    departmentCode: string;
    accountablePositionId: string;
    accountablePrincipalId: string;
    executiveException: false;
  };
  approval: {
    type: "source_control_policy_attestation";
    signedBy: string;
    typedSignature: string;
    signedAt: string;
    signedContentHash: string;
  };
  requirements: readonly FspmRequirementAuthorityTemplate[];
  deliverables: readonly FspmDeliverableAuthorityTemplate[];
  contentHash: string;
}

/**
 * Stable JSON used by the authority package and append-only ledgers. Undefined
 * object values are omitted, array order is retained, and object keys are
 * ordered lexicographically. The output is independent of engine insertion
 * order and therefore replayable across Screeps isolates and Node fixtures.
 */
export function canonicalGovernanceJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("unsupported governance value");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalGovernanceJson(entry)).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new Error(`unsupported governance value type ${typeof value}`);
  }
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalGovernanceJson(entry)}`,
    )
    .join(",")}}`;
}

const rotateRight = (value: number, amount: number): number =>
  (value >>> amount) | (value << (32 - amount));

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else {
        point = 0xfffd;
      }
    } else if (point >= 0xdc00 && point <= 0xdfff) {
      point = 0xfffd;
    }

    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) {
      bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
    } else if (point <= 0xffff) {
      bytes.push(
        0xe0 | (point >>> 12),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 0x3f),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

/** Small dependency-free SHA-256 implementation suitable for the Screeps VM. */
export function governanceSha256(value: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8)
    bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8)
    bytes.push((low >>> shift) & 0xff);

  const schedule = new Array<number>(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      schedule[index] =
        (((bytes[position] ?? 0) << 24) |
          ((bytes[position + 1] ?? 0) << 16) |
          ((bytes[position + 2] ?? 0) << 8) |
          (bytes[position + 3] ?? 0)) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const prior15 = schedule[index - 15] ?? 0;
      const prior2 = schedule[index - 2] ?? 0;
      const sigma0 =
        rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
      const sigma1 =
        rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
      schedule[index] =
        ((schedule[index - 16] ?? 0) +
          sigma0 +
          (schedule[index - 7] ?? 0) +
          sigma1) >>>
        0;
    }

    let [a, b, c, d, e, f, g, h] = state as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          sum1 +
          choose +
          (constants[index] ?? 0) +
          (schedule[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function governanceContentHash(value: unknown): string {
  return `sha256:${governanceSha256(canonicalGovernanceJson(value))}`;
}

const source = "2026.08.30-Screeps Colony Operations Policy v1";
const requestorId = "principal:repository-governance-owner";
const receiptValidation = {
  evidenceForm: "system_generated_confirmation",
  storageLocation: "Memory.colonies[roomName].fspm.deliverableReceipts",
  captureResponsibility: "principal:runtime-evidence-recorder",
} as const satisfies FspmReceiptValidationContract;
const servicePrincipalAcceptance = {
  model: "terminal_activity_kpi_threshold",
  acceptedKpiRatings: ["exceptional", "satisfactory"],
  canonicalHumanAcceptance: false,
} as const satisfies FspmServicePrincipalAcceptancePolicy;

const requirement = (
  input: Omit<
    FspmRequirementAuthorityTemplate,
    "requestorId" | "requirementTrigger" | "originatingAuthority"
  >,
): FspmRequirementAuthorityTemplate => ({
  ...input,
  requestorId,
  requirementTrigger: "operationalEfficiencyInitiative",
});

const evaluationFactors = (
  domain: string,
  primaryStrategicPriority: FspmStrategicPriority,
): FspmEvaluationFactors => ({
  primaryStrategicPriority,
  strategicAlignment: `${domain} performance advances the named strategic priority through measurable colony capability.`,
  operationalEffectiveness: `${domain} work is evaluated for uninterrupted, low-rework execution against governed Activities.`,
  dataIntegrityAndUsability: `${domain} decisions and outcomes retain traceable runtime evidence suitable for replay and operator review.`,
  adoptionAndEngagement: `${domain} capability is exercised by the owned colony whenever governed demand exists.`,
  scalabilityAndMaintainability: `${domain} definitions remain catalog-driven, colony-scoped, and bounded as colony count grows.`,
});

const requirements = [
  requirement({
    domain: "economy",
    requirementSource: source,
    title: "Maintain continuous colony energy capability",
    requirementVerbiage:
      "Each owned colony shall maintain a continuous, recoverable energy service that extracts, buffers, transports, and applies energy to governed operational demand.",
    purposeStatement:
      "Keep the colony economically viable and able to fund all other governed capabilities.",
    strategicPriority: "SERVE",
    strategicAlignment:
      "Reliable energy flow sustains delivery of every colony service and reduces avoidable interruption.",
    desiredOutcomes:
      "Owned sources remain productive, usable energy reaches authorized consumers, and controller capability advances without preventable logistics starvation.",
    businessCase:
      "Energy is the binding resource for workforce, infrastructure, control, and defense; interruption compounds into loss of all other capability.",
  }),
  requirement({
    domain: "spawning",
    requirementSource: source,
    title: "Maintain viable workforce capacity",
    requirementVerbiage:
      "Each owned colony shall maintain viable workforce capacity for bootstrap recovery, source production, logistics throughput, and general governed demand.",
    purposeStatement:
      "Ensure the colony can continuously perform authorized work and recover from workforce loss.",
    strategicPriority: "STAFF",
    strategicAlignment:
      "Measured staffing demand is converted into viable capacity before service continuity is lost.",
    desiredOutcomes:
      "Required creep capabilities are available before incumbents expire and emergency recovery remains possible at zero workforce.",
    businessCase:
      "Every executable colony outcome depends on sufficient viable creep capability; late replacement causes cascading service failure.",
  }),
  requirement({
    domain: "construction",
    requirementSource: source,
    title: "Maintain fit-for-purpose colony infrastructure",
    requirementVerbiage:
      "Each owned colony shall realize its governed room plan and maintain operational infrastructure at the defined service thresholds.",
    purposeStatement:
      "Turn strategic room design and observed demand into durable, serviceable colony infrastructure.",
    strategicPriority: "SERVE",
    strategicAlignment:
      "Correctly sited and maintained infrastructure increases delivery capacity while reducing travel and rework.",
    desiredOutcomes:
      "Eligible planned structures are built in priority order and governed infrastructure remains above its operational health threshold.",
    businessCase:
      "Infrastructure compounds energy and workforce efficiency; unmanaged siting or decay consumes scarce capacity and constrains growth.",
  }),
  requirement({
    domain: "defense",
    requirementSource: source,
    title: "Maintain defensive readiness",
    requirementVerbiage:
      "Each owned colony shall maintain bounded defensive readiness and engage detected hostile threats with available governed capability.",
    purposeStatement:
      "Preserve owned colony assets, workforce, and control against hostile interruption.",
    strategicPriority: "SERVE",
    strategicAlignment:
      "Readiness protects the continuity and integrity of every other colony service.",
    desiredOutcomes:
      "Tower reserves meet policy and visible hostile creeps are engaged without avoidable delay.",
    businessCase:
      "A preventable defensive lapse can erase accumulated economic and infrastructure value faster than it can be rebuilt.",
  }),
] as const satisfies readonly FspmRequirementAuthorityTemplate[];

const deliverables = [
  {
    domain: "economy",
    category: "corporate",
    deliverableType: "service",
    title: "Colony Energy Service",
    details:
      "Recurring extraction, recovery, buffering, transport, consumer funding, and controller investment within one owned colony.",
    output:
      "A continuously available energy service that funds authorized colony operations and room-control progress.",
    evaluationFactors: evaluationFactors("Energy-service", "SERVE"),
    qualityDescription:
      "Usable energy moves from owned or recoverable sources to governed buffers and consumers through traceable Activities without avoidable blockage or target churn.",
    qualityMetric:
      "Completed energy-service Activities contain productive work, no unexplained blocked execution, and no abandonment of an unsatisfied target within a Procedure.",
    receiptValidation,
    servicePrincipalAcceptance,
    siblingWeightBasisPoints: 3500,
    childDeliverableIds: [],
  },
  {
    domain: "spawning",
    category: "corporate",
    deliverableType: "service",
    title: "Colony Workforce Capacity Service",
    details:
      "Recurring bootstrap, source-production, transport, and general workforce provisioning based on measured deficits and replacement lead time.",
    output:
      "Viable creep capability sufficient to execute the colony's governed work and recover from workforce loss.",
    evaluationFactors: evaluationFactors("Workforce-capacity", "STAFF"),
    qualityDescription:
      "Each staffing occurrence produces the requested viable workforce increment and preserves aggregate service continuity.",
    qualityMetric:
      "The specifically requested creep reaches a viable non-spawning state with productive spawn execution and no blocked execution.",
    receiptValidation,
    servicePrincipalAcceptance,
    siblingWeightBasisPoints: 2500,
    childDeliverableIds: [],
  },
  {
    domain: "construction",
    category: "corporate",
    deliverableType: "service",
    title: "Colony Infrastructure Service",
    details:
      "Governed siting, realization, and condition maintenance for planned structures, strategic roads, and traffic-driven adaptive roads.",
    output:
      "Persistent, correctly sited infrastructure that remains fit for governed colony operations.",
    evaluationFactors: evaluationFactors("Infrastructure-service", "SERVE"),
    qualityDescription:
      "Eligible structures are realized in governed priority order and maintained to explicit operational health thresholds without invalid siting or material rework.",
    qualityMetric:
      "Infrastructure Activities produce valid siting, productive build or repair work, and finish only at the governed target state.",
    receiptValidation,
    servicePrincipalAcceptance,
    siblingWeightBasisPoints: 2500,
    childDeliverableIds: [],
  },
  {
    domain: "defense",
    category: "corporate",
    deliverableType: "service",
    title: "Colony Defensive Readiness Service",
    details:
      "Recurring tower-reserve provisioning and immediate tower engagement of visible hostile creeps within the owned colony.",
    output:
      "A defensible colony with bounded tower energy reserve and prompt response to observed hostile threats.",
    evaluationFactors: evaluationFactors("Defensive-readiness", "SERVE"),
    qualityDescription:
      "Tower reserve reaches policy when funding is required and available towers engage active threats without avoidable delay.",
    qualityMetric:
      "Readiness or hostile-response Activities satisfy their governed target with productive work and no blocked execution.",
    receiptValidation,
    servicePrincipalAcceptance,
    siblingWeightBasisPoints: 1500,
    childDeliverableIds: [],
  },
] as const satisfies readonly FspmDeliverableAuthorityTemplate[];

const unsignedPackage = {
  schema: FSPM_AUTHORITY_PACKAGE_SCHEMA,
  id: FSPM_AUTHORITY_PACKAGE_ID,
  revision: FSPM_AUTHORITY_PACKAGE_REVISION,
  governanceSha: FSPM_GOVERNANCE_SHA,
  effectiveDate: FSPM_AUTHORITY_PACKAGE_EFFECTIVE_DATE,
  issuer: {
    principalId: requestorId,
    organizationalUnitId: "ou:empire-operations",
    accountablePositionId: "position:empire-operations:accountable",
  },
  organizationalAuthority: {
    departmentOuId: "ou:empire-operations",
    departmentCode: "01 Empire Operations",
    accountablePositionId: "position:empire-operations:accountable",
    accountablePrincipalId: requestorId,
    executiveException: false,
  },
  requirements,
  deliverables,
} as const;

const packageAttestation = {
  type: "source_control_policy_attestation",
  signedBy: requestorId,
  typedSignature: "APPROVE COLONY OPERATIONS AUTHORITY PACKAGE V1",
  signedAt: FSPM_AUTHORITY_PACKAGE_EFFECTIVE_DATE,
} as const;
const packageContentHash = governanceContentHash({
  ...unsignedPackage,
  approval: packageAttestation,
});

/**
 * Source-controlled autonomous-governance adaptation. This is deliberately not
 * described as a human signature: #164 remains the authority for adding a
 * human Employee/Position system. The package nevertheless binds one named
 * accountable service principal, exact content, governance revision, and date.
 */
export const APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE: FspmAuthorityPackage =
  Object.freeze({
    ...unsignedPackage,
    approval: Object.freeze({
      ...packageAttestation,
      signedContentHash: packageContentHash,
    }),
    contentHash: packageContentHash,
  });

export function authorityPackageUnsignedContent(
  authorityPackage: FspmAuthorityPackage,
): unknown {
  return {
    schema: authorityPackage.schema,
    id: authorityPackage.id,
    revision: authorityPackage.revision,
    governanceSha: authorityPackage.governanceSha,
    effectiveDate: authorityPackage.effectiveDate,
    issuer: authorityPackage.issuer,
    organizationalAuthority: authorityPackage.organizationalAuthority,
    approval: {
      type: authorityPackage.approval.type,
      signedBy: authorityPackage.approval.signedBy,
      typedSignature: authorityPackage.approval.typedSignature,
      signedAt: authorityPackage.approval.signedAt,
    },
    requirements: authorityPackage.requirements,
    deliverables: authorityPackage.deliverables,
  };
}

export function validateAuthorityPackage(
  authorityPackage: FspmAuthorityPackage,
): string[] {
  const errors: string[] = [];
  if (authorityPackage.schema !== FSPM_AUTHORITY_PACKAGE_SCHEMA) {
    errors.push(
      `unsupported authority package schema ${authorityPackage.schema}`,
    );
  }
  if (authorityPackage.id !== FSPM_AUTHORITY_PACKAGE_ID) {
    errors.push(`unexpected authority package id ${authorityPackage.id}`);
  }
  if (authorityPackage.revision !== FSPM_AUTHORITY_PACKAGE_REVISION) {
    errors.push(
      `unexpected authority package revision ${authorityPackage.revision}`,
    );
  }
  if (authorityPackage.governanceSha !== FSPM_GOVERNANCE_SHA) {
    errors.push("authority package governance SHA is stale");
  }
  const calculatedHash = governanceContentHash(
    authorityPackageUnsignedContent(authorityPackage),
  );
  if (
    authorityPackage.contentHash !== calculatedHash ||
    authorityPackage.approval.signedContentHash !== calculatedHash
  ) {
    errors.push("authority package content hash or attestation is invalid");
  }
  if (
    authorityPackage.contentHash !==
    APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE.contentHash
  ) {
    errors.push(
      "authority package content is not the source-controlled approved revision",
    );
  }
  if (
    authorityPackage.approval.signedBy !==
      authorityPackage.organizationalAuthority.accountablePrincipalId ||
    authorityPackage.issuer.accountablePositionId !==
      authorityPackage.organizationalAuthority.accountablePositionId ||
    authorityPackage.issuer.organizationalUnitId !==
      authorityPackage.organizationalAuthority.departmentOuId
  ) {
    errors.push("authority package signer is not the accountable OU principal");
  }
  if (!authorityPackage.approval.typedSignature.trim()) {
    errors.push("authority package typed attestation is blank");
  }
  if (
    !isCanonicalIsoDate(authorityPackage.effectiveDate) ||
    !isCanonicalIsoDate(authorityPackage.approval.signedAt) ||
    authorityPackage.approval.signedAt !== authorityPackage.effectiveDate
  ) {
    errors.push(
      "authority package effective and attestation dates are not the same valid ISO date",
    );
  }

  const domains = new Set<FspmDomain>();
  for (const requirementRecord of authorityPackage.requirements) {
    if (domains.has(requirementRecord.domain)) {
      errors.push(`duplicate Requirement template ${requirementRecord.domain}`);
    }
    domains.add(requirementRecord.domain);
    const hasSource = Boolean(requirementRecord.requirementSource?.trim());
    const hasOrigin = Boolean(requirementRecord.originatingAuthority?.trim());
    if (hasSource === hasOrigin) {
      errors.push(
        `${requirementRecord.domain} Requirement must have exactly one source or originating authority`,
      );
    }
    if (
      hasSource &&
      !isCanonicalRequirementSource(requirementRecord.requirementSource ?? "")
    ) {
      errors.push(
        `${requirementRecord.domain} Requirement Source is not a canonical document identity`,
      );
    }
    if (
      requirementRecord.requirementTrigger === "regulatoryCompliance" &&
      !hasSource
    ) {
      errors.push(
        `${requirementRecord.domain} regulatory Requirement must be derived from a source`,
      );
    }
    for (const [field, value] of Object.entries(requirementRecord)) {
      if (typeof value === "string" && !value.trim()) {
        errors.push(
          `${requirementRecord.domain} Requirement ${field} is blank`,
        );
      }
    }
  }
  if (
    domains.size !== authorityDomains.length ||
    authorityDomains.some((domain) => !domains.has(domain))
  ) {
    errors.push("authority package does not define every governed domain");
  }

  const deliverableDomains = new Set<FspmDomain>();
  let deliverableWeight = 0;
  for (const deliverable of authorityPackage.deliverables) {
    if (deliverableDomains.has(deliverable.domain)) {
      errors.push(`duplicate Deliverable template ${deliverable.domain}`);
    }
    deliverableDomains.add(deliverable.domain);
    deliverableWeight += deliverable.siblingWeightBasisPoints;
    if (deliverable.category !== "corporate") {
      errors.push(`${deliverable.domain} is not a Corporate Deliverable`);
    }
    if (
      !["product", "service", "result"].includes(deliverable.deliverableType)
    ) {
      errors.push(`${deliverable.domain} Deliverable type is invalid`);
    }
    if (
      !Number.isInteger(deliverable.siblingWeightBasisPoints) ||
      deliverable.siblingWeightBasisPoints <= 0 ||
      deliverable.siblingWeightBasisPoints > FSPM_WEIGHT_BASIS_POINTS
    ) {
      errors.push(`${deliverable.domain} Deliverable weight is not integral`);
    }
    if (
      !deliverable.title.trim() ||
      !deliverable.details.trim() ||
      !deliverable.output.trim() ||
      !deliverable.qualityDescription.trim() ||
      !deliverable.qualityMetric.trim()
    ) {
      errors.push(`${deliverable.domain} Deliverable content is incomplete`);
    }
    if (deliverable.childDeliverableIds.length !== 0) {
      errors.push(
        `${deliverable.domain} package requests unsupported child Deliverables`,
      );
    }
    const { primaryStrategicPriority, ...narrativeFactors } =
      deliverable.evaluationFactors;
    const factors = Object.values(narrativeFactors);
    if (
      !["SELL", "STAFF", "SERVE"].includes(primaryStrategicPriority) ||
      factors.length !== 5 ||
      factors.some((factor) => !factor.trim())
    ) {
      errors.push(
        `${deliverable.domain} Deliverable does not address all five evaluation factors`,
      );
    }
    if (
      !deliverable.receiptValidation.evidenceForm ||
      !deliverable.receiptValidation.storageLocation.trim() ||
      !deliverable.receiptValidation.captureResponsibility.trim()
    ) {
      errors.push(
        `${deliverable.domain} Deliverable has an incomplete Receipt Validation contract`,
      );
    }
    if (
      deliverable.servicePrincipalAcceptance.model !==
        "terminal_activity_kpi_threshold" ||
      deliverable.servicePrincipalAcceptance.canonicalHumanAcceptance !==
        false ||
      canonicalGovernanceJson(
        deliverable.servicePrincipalAcceptance.acceptedKpiRatings,
      ) !== canonicalGovernanceJson(["exceptional", "satisfactory"])
    ) {
      errors.push(
        `${deliverable.domain} Deliverable has an invalid service-principal acceptance policy`,
      );
    }
    if (!domains.has(deliverable.domain)) {
      errors.push(
        `${deliverable.domain} Deliverable has no Requirement template`,
      );
    }
  }
  if (deliverableWeight !== FSPM_WEIGHT_BASIS_POINTS) {
    errors.push(
      `Deliverable weights sum to ${deliverableWeight}, expected ${FSPM_WEIGHT_BASIS_POINTS}`,
    );
  }
  if (domains.size !== deliverableDomains.size) {
    errors.push("Requirement and Deliverable template domains do not match");
  }
  if (
    deliverableDomains.size !== authorityDomains.length ||
    authorityDomains.some((domain) => !deliverableDomains.has(domain))
  ) {
    errors.push("authority package does not define every governed Deliverable");
  }
  return errors;
}

export function requirementTemplateForDomain(
  domain: FspmDomain,
  authorityPackage: FspmAuthorityPackage = APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE,
): FspmRequirementAuthorityTemplate | undefined {
  return authorityPackage.requirements.find(
    (record) => record.domain === domain,
  );
}

export function deliverableTemplateForDomain(
  domain: FspmDomain,
  authorityPackage: FspmAuthorityPackage = APPROVED_COLONY_OPERATIONS_AUTHORITY_PACKAGE,
): FspmDeliverableAuthorityTemplate | undefined {
  return authorityPackage.deliverables.find(
    (record) => record.domain === domain,
  );
}

// Prevent accidental in-process mutation of nested package records. Serialized
// Memory projections are separately protected by content and ledger hashes.
for (const entry of requirements) Object.freeze(entry);
for (const entry of deliverables) {
  Object.freeze(entry.evaluationFactors);
  Object.freeze(entry.receiptValidation);
  Object.freeze(entry.childDeliverableIds);
  Object.freeze(entry);
}
Object.freeze(requirements);
Object.freeze(deliverables);
