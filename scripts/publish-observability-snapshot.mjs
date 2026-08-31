import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import {
  sanitizeTaskQi,
  sanitizeWeightedEqvmIndex,
} from "./lib/eqvm-snapshot.mjs";
import { roomPlanIntegrityEvidence } from "./lib/room-plan-integrity.mjs";
import { captureConsistencyEvidence } from "./lib/snapshot-capture-consistency.mjs";
import {
  isOwnedSnapshotObject,
  snapshotOwnership,
} from "./lib/snapshot-ownership.mjs";
import { traceFencedCapture } from "./lib/trace-fenced-capture.mjs";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const room = process.env.SCREEPS_ROOM || "";
const shard =
  process.env.SCREEPS_REQUESTED_SHARD || process.env.SCREEPS_SHARD || "shard3";
const target = process.env.SCREEPS_TARGET || "ptr";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const commandKey = process.env.SCREEPS_COMMAND_KEY || "";
const requestCommand = process.env.SCREEPS_COMMAND || "/snapshot";
const apiPrefix = target === "ptr" ? "/ptr" : "";
const supabaseIngestUrl = process.env.SUPABASE_INGEST_URL || "";
const githubOidcToken = process.env.GITHUB_OIDC_TOKEN || "";
const observabilitySegment = 99;

if (!token)
  throw new Error(
    "SCREEPS_TOKEN is required to publish an observability snapshot",
  );
if (!/^[WE]\d+[NS]\d+$/.test(room))
  throw new Error("SCREEPS_ROOM is required for /snapshot");
if (!/^shard\d+$/.test(shard)) throw new Error(`Invalid shard '${shard}'`);
if (target !== "ptr")
  throw new Error("Observability snapshots are currently restricted to PTR");

const requestJson = async (path, params = {}) => {
  const url = new URL(`${apiPrefix}${path}`, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "")
      url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Token": token },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok || body?.ok === 0) {
    throw new Error(
      `${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
};

const decodeMemory = (data) => {
  if (data === undefined || data === null) return null;
  if (typeof data !== "string") return data;
  const json = data.startsWith("gz:")
    ? gunzipSync(Buffer.from(data.slice(3), "base64")).toString("utf8")
    : data;
  return JSON.parse(json);
};

const point = (value) =>
  value && Number.isInteger(value.x) && Number.isInteger(value.y)
    ? { x: value.x, y: value.y }
    : null;

const finiteNumber = (value) => (Number.isFinite(value) ? value : null);
const boundedString = (value, max = 240) =>
  typeof value === "string" && value.length <= max ? value : null;

const sanitizePlan = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  const controller = plan.anchors?.controller;
  return {
    planId: boundedString(plan.planId),
    deliverableId: boundedString(plan.deliverableId),
    plannerRevision: Number.isInteger(plan.plannerRevision)
      ? plan.plannerRevision
      : null,
    projectionRevision: Number.isInteger(plan.projectionRevision)
      ? plan.projectionRevision
      : null,
    projectionFingerprint: boundedString(plan.projectionFingerprint, 40),
    version: plan.version ?? null,
    horizonRcl: plan.horizonRcl ?? null,
    roomName: plan.roomName ?? room,
    generatedAt: plan.generatedAt ?? null,
    generatedReason: boundedString(plan.generatedReason),
    stages: Array.isArray(plan.stages)
      ? plan.stages.map((stage) => ({
          id: boundedString(stage.id, 64),
          title: boundedString(stage.title, 120),
          minRcl: stage.minRcl ?? null,
          weight: finiteNumber(stage.weight),
          prerequisiteStageIds: Array.isArray(stage.prerequisiteStageIds)
            ? stage.prerequisiteStageIds
                .map((id) => boundedString(id, 64))
                .filter(Boolean)
            : [],
          objective: boundedString(stage.objective, 320),
        }))
      : [],
    anchors: {
      spawn: plan.anchors?.spawn
        ? {
            ...point(plan.anchors.spawn),
            name: plan.anchors.spawn.name ?? null,
          }
        : null,
      hub: point(plan.anchors?.hub),
      controller: controller
        ? { ...point(controller), service: point(controller.service) }
        : null,
      sources: Array.isArray(plan.anchors?.sources)
        ? plan.anchors.sources.map((source) => ({
            ...point(source),
            container: point(source.container),
          }))
        : [],
    },
    reservations: Array.isArray(plan.reservations)
      ? plan.reservations.map((reservation) => ({
          ...point(reservation),
          kind: reservation.kind ?? null,
        }))
      : [],
    structures: Array.isArray(plan.structures)
      ? plan.structures.map((structure) => ({
          ...point(structure),
          id: boundedString(structure.id),
          structureType: structure.structureType ?? null,
          minRcl: structure.minRcl ?? null,
          priority: finiteNumber(structure.priority),
          activation: structure.activation ?? null,
          reservation: structure.reservation ?? null,
          phase: structure.phase ?? null,
          stage: boundedString(structure.stage, 64),
          strategicWeight: finiteNumber(structure.strategicWeight),
          requiredForStage:
            typeof structure.requiredForStage === "boolean"
              ? structure.requiredForStage
              : null,
        }))
      : [],
    roads: Array.isArray(plan.roads)
      ? plan.roads.map((road) => ({
          ...point(road),
          id: boundedString(road.id),
          minRcl: road.minRcl ?? null,
          activation: road.activation ?? null,
          phase: road.phase ?? null,
          stage: boundedString(road.stage, 64),
          strategicWeight: finiteNumber(road.strategicWeight),
          requiredForStage:
            typeof road.requiredForStage === "boolean"
              ? road.requiredForStage
              : null,
        }))
      : [],
    defense: {
      strategy: boundedString(plan.defense?.strategy, 64),
      protectedTiles: Array.isArray(plan.defense?.protectedTiles)
        ? plan.defense.protectedTiles.map(point).filter(Boolean)
        : [],
      perimeter: Array.isArray(plan.defense?.perimeter)
        ? plan.defense.perimeter.map(point).filter(Boolean)
        : [],
    },
  };
};

const sanitizeLineage = (value) => {
  if (!value || typeof value !== "object") return null;
  const lineage = {
    contractId: boundedString(value.contractId),
    requirementId: boundedString(value.requirementId),
    deliverableId: boundedString(value.deliverableId),
    taskId: boundedString(value.taskId),
    activityId: boundedString(value.activityId),
  };
  return Object.values(lineage).every(Boolean) ? lineage : null;
};

const sanitizeIntentTrace = (value) => {
  if (!value || typeof value !== "object") return null;
  const lineage = sanitizeLineage(value.trace);
  return {
    type: boundedString(value.type, 64),
    planner: boundedString(value.planner, 64),
    priority: finiteNumber(value.priority),
    reason: boundedString(value.reason, 500),
    actor: boundedString(value.actor, 240),
    conflictKey: boundedString(value.conflictKey, 240),
    ...(lineage ? { trace: lineage } : {}),
  };
};

const sanitizeStringArray = (value, maxItems = 64, maxLength = 240) =>
  Array.isArray(value)
    ? value
        .slice(0, maxItems)
        .map((item) => boundedString(item, maxLength))
        .filter(Boolean)
    : [];

const sanitizeOperationalHealth = (value) => {
  if (!value || typeof value !== "object") return null;
  const score = finiteNumber(value.score);
  const state = ["healthy", "watch", "degraded"].includes(value.state)
    ? value.state
    : null;
  const trend = ["new", "improving", "stable", "declining"].includes(
    value.trend,
  )
    ? value.trend
    : null;
  const measuredAt =
    Number.isInteger(value.measuredAt) && value.measuredAt >= 0
      ? value.measuredAt
      : null;
  const evidence = sanitizeStringArray(value.evidence, 8, 240);
  return score !== null &&
    score >= 0 &&
    score <= 100 &&
    state &&
    trend &&
    measuredAt !== null
    ? { score, state, trend, measuredAt, evidence }
    : null;
};

const sanitizeOperationalHealthSample = (value) => {
  if (!value || typeof value !== "object") return null;
  const tick =
    Number.isInteger(value.tick) && value.tick >= 0 ? value.tick : null;
  const score = finiteNumber(value.score);
  const state = ["healthy", "watch", "degraded"].includes(value.state)
    ? value.state
    : null;
  return tick !== null && score !== null && score >= 0 && score <= 100 && state
    ? { tick, score, state }
    : null;
};

const sanitizeFspmRecord = (value) => {
  if (!value || typeof value !== "object") return null;
  const id = boundedString(value.id);
  const title = boundedString(value.title, 160) ?? id;
  const status = ["active", "completed", "cancelled", "retired"].includes(
    value.status,
  )
    ? value.status
    : null;
  if (!id || !status) return null;
  const operationalHealth = sanitizeOperationalHealth(value.operationalHealth);
  return {
    id,
    title,
    status,
    ...(operationalHealth ? { operationalHealth } : {}),
  };
};

const sanitizeProgram = (value) => {
  if (!value || typeof value !== "object") return null;
  const id = boundedString(value.id);
  const title = boundedString(value.title, 160);
  const status = ["active", "completed", "cancelled"].includes(value.status)
    ? value.status
    : null;
  if (
    !id ||
    !title ||
    value.type !== "program" ||
    value.subType !== "service_program" ||
    !status
  )
    return null;
  return { id, title, type: "program", subType: "service_program", status };
};

const sanitizeKpiMetric = (value) => {
  if (!value || typeof value !== "object") return null;
  const metric = boundedString(value.metric, 240);
  const exceptional = boundedString(value.exceptional, 320);
  const satisfactory = boundedString(value.satisfactory, 320);
  const unsatisfactory = boundedString(value.unsatisfactory, 320);
  return metric && exceptional && satisfactory && unsatisfactory
    ? { metric, exceptional, satisfactory, unsatisfactory }
    : null;
};

const sanitizeActivityKpi = (value) => {
  if (!value || typeof value !== "object") return null;
  const tick = Number.isInteger(value.tick) ? value.tick : null;
  const activityId = boundedString(value.activityId);
  const activityType = boundedString(value.activityType, 64);
  const actor = boundedString(value.actor, 160);
  const rating = [
    "exceptional",
    "satisfactory",
    "marginal",
    "unsatisfactory",
    "rejected",
  ].includes(value.rating)
    ? value.rating
    : null;
  const evidence = boundedString(value.evidence, 240);
  const numeric = value.value === null ? null : finiteNumber(value.value);
  const outcome =
    value.outcome && typeof value.outcome === "object"
      ? {
          metric: boundedString(value.outcome.metric, 96),
          actual: finiteNumber(value.outcome.actual),
          target: finiteNumber(value.outcome.target),
          unit: boundedString(value.outcome.unit, 32),
          utilization: finiteNumber(value.outcome.utilization),
        }
      : null;
  if (
    tick === null ||
    !activityId ||
    !activityType ||
    !actor ||
    !rating ||
    !evidence ||
    value.source !== "terminal_activity_kpi" ||
    !Number.isInteger(value.activityCompletedAtTick) ||
    value.activityCompletedAtTick !== tick ||
    value.activityWeightPolicyId !==
      "eqvm:activity-weight:equal-terminal-samples:v1"
  )
    return null;
  if (numeric !== null && (numeric < 0 || numeric > 1.5)) return null;
  const sanitizedOutcome =
    outcome?.metric &&
    outcome.actual !== null &&
    outcome.actual >= 0 &&
    outcome.target !== null &&
    outcome.target > 0 &&
    outcome.unit &&
    outcome.utilization !== null &&
    outcome.utilization >= 0 &&
    outcome.utilization <= 1
      ? outcome
      : null;
  return {
    tick,
    activityId,
    activityType,
    actor,
    rating,
    value: numeric,
    evidence,
    source: "terminal_activity_kpi",
    activityCompletedAtTick: value.activityCompletedAtTick,
    activityWeightPolicyId: value.activityWeightPolicyId,
    ...(sanitizedOutcome ? { outcome: sanitizedOutcome } : {}),
  };
};

const sanitizePortfolioP3 = (value) => {
  if (!value || typeof value !== "object") return null;
  const id = boundedString(value.id);
  const name = boundedString(value.name, 160);
  const description = boundedString(value.description, 500) ?? "";
  const parentP3Id =
    value.parentP3Id === null ? null : boundedString(value.parentP3Id);
  const status = ["active", "completed", "cancelled", "retired"].includes(
    value.status,
  )
    ? value.status
    : null;
  const startTick =
    Number.isInteger(value.startTick) && value.startTick >= 0
      ? value.startTick
      : null;
  if (
    !id ||
    !name ||
    value.type !== "portfolio" ||
    value.subType !== "ou_portfolio" ||
    value.temporalBasis !== "game_tick" ||
    !status ||
    startTick === null
  )
    return null;
  const operationalHealth = sanitizeOperationalHealth(value.operationalHealth);
  const pqi = sanitizeWeightedEqvmIndex(
    value.pqi,
    "deliverableWeightBasisPoints",
  );
  return {
    id,
    type: "portfolio",
    subType: "ou_portfolio",
    name,
    description,
    parentP3Id,
    temporalBasis: "game_tick",
    startTick,
    status,
    ...(operationalHealth ? { operationalHealth } : {}),
    ...(pqi ? { pqi } : {}),
  };
};

const sanitizeGovernance = (value) => {
  if (!value || typeof value !== "object") return null;
  const checks = value.checks;
  const checkKeys = [
    "empireRoot",
    "packageProjection",
    "approvalLedger",
    "ancestry",
    "relationships",
    "exactWeights",
    "receiptContracts",
    "acceptancePolicies",
    "receiptLedgers",
  ];
  if (
    !checks ||
    typeof checks !== "object" ||
    checkKeys.some((key) => typeof checks[key] !== "boolean")
  )
    return null;
  const stringFields = [
    "packageId",
    "packageHash",
    "governanceSha",
    "effectiveDate",
    "signerPrincipalId",
    "accountablePositionId",
  ];
  const integerFields = [
    "packageRevision",
    "importedAtTick",
    "approvalEvents",
    "receiptEvidenceEvents",
    "receiptDecisionEvents",
    "deliverableWeightBasisPoints",
  ];
  if (
    stringFields.some((field) => !boundedString(value[field], 240)) ||
    integerFields.some(
      (field) => !Number.isInteger(value[field]) || value[field] < 0,
    ) ||
    value.approvalModel !== "source_control_service_principal" ||
    value.canonicalHumanApproval !== false ||
    typeof value.valid !== "boolean" ||
    typeof value.executionEligible !== "boolean"
  )
    return null;
  return {
    packageId: value.packageId,
    packageRevision: value.packageRevision,
    packageHash: value.packageHash,
    governanceSha: value.governanceSha,
    effectiveDate: value.effectiveDate,
    importedAtTick: value.importedAtTick,
    signerPrincipalId: value.signerPrincipalId,
    accountablePositionId: value.accountablePositionId,
    approvalEvents: value.approvalEvents,
    receiptEvidenceEvents: value.receiptEvidenceEvents,
    receiptDecisionEvents: value.receiptDecisionEvents,
    deliverableWeightBasisPoints: value.deliverableWeightBasisPoints,
    approvalModel: value.approvalModel,
    canonicalHumanApproval: false,
    checks: Object.fromEntries(checkKeys.map((key) => [key, checks[key]])),
    valid: value.valid,
    executionEligible: value.executionEligible,
  };
};

const sanitizeRequirement = (record) => {
  const base = sanitizeFspmRecord(record);
  const p3Id = boundedString(record?.p3Id);
  const contractId = boundedString(record?.contractId);
  const domain = boundedString(record?.domain, 32);
  if (!base || !domain || (!p3Id && !contractId)) return null;
  return {
    ...base,
    ...(p3Id ? { p3Id } : {}),
    ...(contractId ? { contractId } : {}),
    domain,
    ...(Number.isInteger(record.revision) ? { revision: record.revision } : {}),
    ...(["SELL", "STAFF", "SERVE"].includes(record.strategicPriority)
      ? { strategicPriority: record.strategicPriority }
      : {}),
    requirementSource: boundedString(record.requirementSource, 500),
    originatingAuthority: boundedString(record.originatingAuthority, 500),
    applicableOuId: boundedString(record.applicableOuId),
    approvalAuthorityOuId: boundedString(record.approvalAuthorityOuId),
    approval: record.approval === true,
    approvedBy: boundedString(record.approvedBy),
    dateApproved: boundedString(record.dateApproved, 80),
    approvalEventId: boundedString(record.approvalEventId),
    activationStatus: ["valid", "missing", "invalid"].includes(
      record.activationStatus,
    )
      ? record.activationStatus
      : null,
  };
};

const sanitizeDeliverable = (record) => {
  const base = sanitizeFspmRecord(record);
  const requirementId = boundedString(record?.requirementId);
  const domain = boundedString(record?.domain, 32);
  if (!base || !requirementId || !domain) return null;
  const dqi = sanitizeWeightedEqvmIndex(record.dqi, "taskWeightBasisPoints");
  const receiptValidation =
    record.receiptValidation && typeof record.receiptValidation === "object"
      ? {
          evidenceForm: boundedString(
            record.receiptValidation.evidenceForm,
            320,
          ),
          storageLocation: boundedString(
            record.receiptValidation.storageLocation,
            320,
          ),
          captureResponsibility: boundedString(
            record.receiptValidation.captureResponsibility,
            320,
          ),
        }
      : null;
  const servicePrincipalAcceptance =
    record.servicePrincipalAcceptance?.model ===
      "terminal_activity_kpi_threshold" &&
    record.servicePrincipalAcceptance?.canonicalHumanAcceptance === false
      ? {
          model: "terminal_activity_kpi_threshold",
          acceptedKpiRatings: ["exceptional", "satisfactory"],
          canonicalHumanAcceptance: false,
        }
      : null;
  return {
    ...base,
    p3Id: boundedString(record.p3Id),
    requirementId,
    domain,
    ...(Number.isInteger(record.revision) ? { revision: record.revision } : {}),
    ...(record.category === "corporate" ? { category: "corporate" } : {}),
    ...(["product", "service", "result"].includes(record.deliverableType)
      ? { deliverableType: record.deliverableType }
      : {}),
    output: boundedString(record.output, 500),
    qualityDescription: boundedString(record.qualityDescription, 500),
    qualityMetric: boundedString(record.qualityMetric, 320),
    siblingWeightBasisPoints: finiteNumber(record.siblingWeightBasisPoints),
    expectedSiblingWeightBasisPoints: finiteNumber(
      record.expectedSiblingWeightBasisPoints,
    ),
    weightStatus: ["valid", "invalid"].includes(record.weightStatus)
      ? record.weightStatus
      : null,
    taskWeightBasisPoints: finiteNumber(record.taskWeightBasisPoints),
    ...(dqi ? { dqi } : {}),
    ...(receiptValidation?.evidenceForm &&
    receiptValidation.storageLocation &&
    receiptValidation.captureResponsibility
      ? { receiptValidation }
      : {}),
    ...(servicePrincipalAcceptance ? { servicePrincipalAcceptance } : {}),
    receiptContractStatus: ["valid", "invalid"].includes(
      record.receiptContractStatus,
    )
      ? record.receiptContractStatus
      : null,
    servicePrincipalAcceptanceStatus: ["valid", "invalid"].includes(
      record.servicePrincipalAcceptanceStatus,
    )
      ? record.servicePrincipalAcceptanceStatus
      : null,
    receiptEvidenceStatus: [
      "pending",
      "missing",
      "validated",
      "invalid",
    ].includes(record.receiptEvidenceStatus)
      ? record.receiptEvidenceStatus
      : null,
    receiptAcceptanceStatus: [
      "pending",
      "missing",
      "accepted",
      "rejected",
      "disputed",
      "invalid",
    ].includes(record.receiptAcceptanceStatus)
      ? record.receiptAcceptanceStatus
      : null,
    childDeliverableIds: sanitizeStringArray(record.childDeliverableIds),
  };
};

const sanitizeTask = (record) => {
  const base = sanitizeFspmRecord(record);
  const deliverableId = boundedString(record?.deliverableId);
  const domain = boundedString(record?.domain, 32);
  const taskKey = boundedString(record?.taskKey, 120);
  const kpiMetric = sanitizeKpiMetric(record?.kpiMetric);
  if (!base || !deliverableId || !domain || !taskKey || !kpiMetric) return null;
  const qi = sanitizeTaskQi(record.qi);
  const procedures = Array.isArray(record.procedures)
    ? record.procedures
        .slice(0, 32)
        .map((procedure) => ({
          id: boundedString(procedure?.id),
          procedureKey: boundedString(procedure?.procedureKey, 120),
          title: boundedString(procedure?.title, 160),
        }))
        .filter(
          (procedure) =>
            procedure.id && procedure.procedureKey && procedure.title,
        )
    : [];
  const recentActivities = Array.isArray(record.recentActivities)
    ? record.recentActivities.slice(-8).map(sanitizeActivityKpi).filter(Boolean)
    : [];
  return {
    ...base,
    deliverableId,
    domain,
    taskKey,
    taskWeightBasisPoints: finiteNumber(record.taskWeightBasisPoints),
    qualityDescription: boundedString(record.qualityDescription, 500),
    qualityMetric: boundedString(record.qualityMetric, 320),
    kpiMetric,
    procedures,
    ...(qi ? { qi } : {}),
    recentActivities,
  };
};

const sanitizeFspm = (value) => {
  const colonies = Array.isArray(value?.colonies)
    ? value.colonies.slice(0, 16)
    : [];
  const rootP3 = sanitizePortfolioP3(value?.rootP3);
  return {
    ...(rootP3 ? { rootP3 } : {}),
    colonies: colonies
      .map((colony) => {
        const roomName = boundedString(colony?.roomName, 32);
        const p3 = sanitizePortfolioP3(colony?.p3);
        const contract = sanitizeFspmRecord(colony?.contract);
        if (!roomName || (!p3 && !contract)) return null;
        const history = (field) =>
          Array.isArray(colony[field])
            ? colony[field]
                .slice(-12)
                .map(sanitizeOperationalHealthSample)
                .filter(Boolean)
            : [];
        return {
          roomName,
          p3,
          program: sanitizeProgram(colony.program),
          contract,
          governance: sanitizeGovernance(colony.governance),
          p3OperationalHealthHistory: history("p3OperationalHealthHistory"),
          contractOperationalHealthHistory: history(
            "contractOperationalHealthHistory",
          ),
          requirements: Array.isArray(colony.requirements)
            ? colony.requirements
                .slice(0, 128)
                .map(sanitizeRequirement)
                .filter(Boolean)
            : [],
          deliverables: Array.isArray(colony.deliverables)
            ? colony.deliverables
                .slice(0, 128)
                .map(sanitizeDeliverable)
                .filter(Boolean)
            : [],
          tasks: Array.isArray(colony.tasks)
            ? colony.tasks.slice(0, 256).map(sanitizeTask).filter(Boolean)
            : [],
        };
      })
      .filter(Boolean),
  };
};

const sanitizeRuntimeTrace = (value) => {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const intents =
    value.intents && typeof value.intents === "object" ? value.intents : {};
  const settlementPlans = Array.isArray(value.settlement?.plans)
    ? value.settlement.plans.slice(0, 16).map((plan) => {
        const development =
          plan?.development && typeof plan.development === "object"
            ? {
                source:
                  plan.development.source ===
                  "runtime_room_development_evaluator"
                    ? "runtime_room_development_evaluator"
                    : null,
                evaluatedAt: Number.isInteger(plan.development.evaluatedAt)
                  ? plan.development.evaluatedAt
                  : null,
                horizonStatus: boundedString(
                  plan.development.horizonStatus,
                  40,
                ),
                validationIssues: Array.isArray(
                  plan.development.validationIssues,
                )
                  ? plan.development.validationIssues
                      .slice(0, 12)
                      .map((issue) => boundedString(issue, 240))
                      .filter(Boolean)
                  : [],
                activeStageId: boundedString(
                  plan.development.activeStageId,
                  64,
                ),
                nextStageId: boundedString(plan.development.nextStageId, 64),
                realizationPercentage: finiteNumber(
                  plan.development.realizationPercentage,
                ),
                missingStructures: finiteNumber(
                  plan.development.missingStructures,
                ),
                blockedStructures: finiteNumber(
                  plan.development.blockedStructures,
                ),
                stages: Array.isArray(plan.development.stages)
                  ? plan.development.stages.slice(0, 5).map((stage) => ({
                      id: boundedString(stage?.id, 64),
                      title: boundedString(stage?.title, 120),
                      minRcl: finiteNumber(stage?.minRcl),
                      stageWeight: finiteNumber(stage?.stageWeight),
                      status: boundedString(stage?.status, 40),
                      controllerEligible:
                        typeof stage?.controllerEligible === "boolean"
                          ? stage.controllerEligible
                          : null,
                      prerequisitesSatisfied:
                        typeof stage?.prerequisitesSatisfied === "boolean"
                          ? stage.prerequisitesSatisfied
                          : null,
                      realizationPercentage: finiteNumber(
                        stage?.realizationPercentage,
                      ),
                      realizedStructures: finiteNumber(
                        stage?.realizedStructures,
                      ),
                      eligibleStructures: finiteNumber(
                        stage?.eligibleStructures,
                      ),
                      missingStructures: finiteNumber(stage?.missingStructures),
                      blockedStructures: finiteNumber(stage?.blockedStructures),
                    }))
                  : [],
                missingCriticalStructures: Array.isArray(
                  plan.development.missingCriticalStructures,
                )
                  ? plan.development.missingCriticalStructures
                      .slice(0, 16)
                      .map((requirement) => ({
                        plannedStructureId: boundedString(
                          requirement?.plannedStructureId,
                          120,
                        ),
                        stageId: boundedString(requirement?.stageId, 64),
                        structureType: boundedString(
                          requirement?.structureType,
                          48,
                        ),
                        x: finiteNumber(requirement?.x),
                        y: finiteNumber(requirement?.y),
                        minRcl: finiteNumber(requirement?.minRcl),
                        priority: finiteNumber(requirement?.priority),
                        strategicWeight: finiteNumber(
                          requirement?.strategicWeight,
                        ),
                        underConstruction:
                          requirement?.underConstruction === true,
                        blocked: requirement?.blocked === true,
                        blockerReasons: Array.isArray(
                          requirement?.blockerReasons,
                        )
                          ? requirement.blockerReasons
                              .slice(0, 4)
                              .map((reason) => boundedString(reason, 240))
                              .filter(Boolean)
                          : [],
                      }))
                  : [],
                nextMilestone:
                  plan.development.nextMilestone &&
                  typeof plan.development.nextMilestone === "object"
                    ? {
                        kind: boundedString(
                          plan.development.nextMilestone.kind,
                          64,
                        ),
                        stageId: boundedString(
                          plan.development.nextMilestone.stageId,
                          64,
                        ),
                        plannedStructureId: boundedString(
                          plan.development.nextMilestone.plannedStructureId,
                          120,
                        ),
                        reason: boundedString(
                          plan.development.nextMilestone.reason,
                          320,
                        ),
                      }
                    : null,
              }
            : null;
        return {
          roomName: boundedString(plan?.roomName, 32),
          projectionUsability:
            plan?.projectionUsability &&
            typeof plan.projectionUsability === "object"
              ? {
                  usable: plan.projectionUsability.usable === true,
                  status: boundedString(plan.projectionUsability.status, 48),
                  reason: boundedString(plan.projectionUsability.reason, 320),
                }
              : null,
          plannerRevision: Number.isInteger(plan?.plannerRevision)
            ? plan.plannerRevision
            : null,
          projectionRevision: Number.isInteger(plan?.projectionRevision)
            ? plan.projectionRevision
            : null,
          projectionFingerprint: boundedString(plan?.projectionFingerprint, 40),
          deliverableId: boundedString(plan?.deliverableId),
          controllerLevel: finiteNumber(plan?.controllerLevel),
          horizonStatus: boundedString(plan?.horizonStatus, 40),
          activeStageId: boundedString(plan?.activeStageId, 64),
          nextStageId: boundedString(plan?.nextStageId, 64),
          realizationPercentage: finiteNumber(plan?.realizationPercentage),
          missingStructures: finiteNumber(plan?.missingStructures),
          blockedStructures: finiteNumber(plan?.blockedStructures),
          development,
          defense: {
            strategy: boundedString(plan?.defense?.strategy, 64),
            protectedTiles: finiteNumber(plan?.defense?.protectedTiles),
            perimeterPlanned: finiteNumber(plan?.defense?.perimeterPlanned),
            perimeterBuilt: finiteNumber(plan?.defense?.perimeterBuilt),
            perimeterAtTarget: finiteNumber(plan?.defense?.perimeterAtTarget),
            targetHits: finiteNumber(plan?.defense?.targetHits),
            underAttack: plan?.defense?.underAttack === true,
            nextMissingTile:
              Number.isInteger(plan?.defense?.nextMissingTile?.x) &&
              Number.isInteger(plan?.defense?.nextMissingTile?.y)
                ? {
                    x: plan.defense.nextMissingTile.x,
                    y: plan.defense.nextMissingTile.y,
                  }
                : null,
          },
          energyTopology: {
            status: [
              "authorization-debt",
              "incomplete",
              "fault",
              "unavailable",
            ].includes(plan?.energyTopology?.status)
              ? plan.energyTopology.status
              : "unavailable",
            reason: boundedString(plan?.energyTopology?.reason, 500),
            sourceLinks: finiteNumber(plan?.energyTopology?.sourceLinks),
            controllerLinkPlanId: boundedString(
              plan?.energyTopology?.controllerLinkPlanId,
            ),
            coreLinkPlanId: boundedString(plan?.energyTopology?.coreLinkPlanId),
          },
        };
      })
    : [];
  const settlementFaults = Array.isArray(value.settlement?.faults)
    ? value.settlement.faults.slice(0, 16).map((fault) => ({
        roomName: boundedString(fault?.roomName, 32),
        kind:
          fault?.kind === "room-plan-generation"
            ? "room-plan-generation"
            : null,
        status: ["active", "superseded"].includes(fault?.status)
          ? fault.status
          : null,
        firstTick: Number.isInteger(fault?.firstTick) ? fault.firstTick : null,
        lastTick: Number.isInteger(fault?.lastTick) ? fault.lastTick : null,
        attemptCount: Number.isInteger(fault?.attemptCount)
          ? fault.attemptCount
          : null,
        retryDelayTicks: Number.isInteger(fault?.retryDelayTicks)
          ? fault.retryDelayTicks
          : null,
        nextRetryTick: Number.isInteger(fault?.nextRetryTick)
          ? fault.nextRetryTick
          : null,
        reason: boundedString(fault?.reason, 180),
        remediation: boundedString(fault?.remediation, 240),
        retainedPlannerRevision: Number.isInteger(
          fault?.retainedPlannerRevision,
        )
          ? fault.retainedPlannerRevision
          : null,
        targetPlannerRevision: Number.isInteger(fault?.targetPlannerRevision)
          ? fault.targetPlannerRevision
          : null,
        retainedProjectionRevision: Number.isInteger(
          fault?.retainedProjectionRevision,
        )
          ? fault.retainedProjectionRevision
          : null,
        retainedProjectionFingerprint: boundedString(
          fault?.retainedProjectionFingerprint,
          40,
        ),
        resolvedAtTick: Number.isInteger(fault?.resolvedAtTick)
          ? fault.resolvedAtTick
          : null,
        supersededByRevision: Number.isInteger(fault?.supersededByRevision)
          ? fault.supersededByRevision
          : null,
        supersededByFingerprint: boundedString(
          fault?.supersededByFingerprint,
          40,
        ),
      }))
    : [];
  return {
    version: 1,
    runtimeSha: boundedString(value.runtimeSha, 80),
    tick: Number.isInteger(value.tick) ? value.tick : null,
    cpu:
      value.cpu && typeof value.cpu === "object"
        ? {
            limit: finiteNumber(value.cpu.limit),
            bucket: finiteNumber(value.cpu.bucket),
            perception: finiteNumber(value.cpu.perception),
            settlement: finiteNumber(value.cpu.settlement),
            arbitration: finiteNumber(value.cpu.arbitration),
            execution: finiteNumber(value.cpu.execution),
            observability: finiteNumber(value.cpu.observability),
            total: finiteNumber(value.cpu.total),
          }
        : null,
    fspm: sanitizeFspm(value.fspm),
    settlement: { plans: settlementPlans, faults: settlementFaults },
    intents: {
      proposed: finiteNumber(intents.proposed),
      accepted: finiteNumber(intents.accepted),
      rejected: finiteNumber(intents.rejected),
      acceptedSample: Array.isArray(intents.acceptedSample)
        ? intents.acceptedSample
            .slice(0, 24)
            .map(sanitizeIntentTrace)
            .filter(Boolean)
        : [],
      rejectedSample: Array.isArray(intents.rejectedSample)
        ? intents.rejectedSample.slice(0, 24).map((rejection) => ({
            conflictKey: boundedString(rejection?.conflictKey, 240),
            winner: sanitizeIntentTrace(rejection?.winner),
            loser: sanitizeIntentTrace(rejection?.loser),
          }))
        : [],
    },
  };
};

const {
  initialTrace: traceMemory,
  payload: { memory, roomObjects, roomTerrain },
  finalTrace: traceFenceMemory,
} = await traceFencedCapture(
  () =>
    requestJson("/api/user/memory-segment", {
      segment: observabilitySegment,
      shard,
    }),
  async () => {
    const [memory, roomObjects, roomTerrain] = await Promise.all([
      requestJson("/api/user/memory", {
        path: `colonies.${room}.roomPlan`,
        shard,
      }),
      requestJson("/api/game/room-objects", { room, shard }),
      requestJson("/api/game/room-terrain", { room, shard, encoded: 1 }),
    ]);
    return { memory, roomObjects, roomTerrain };
  },
);
const rawPlan = decodeMemory(memory.data);
const plan = sanitizePlan(rawPlan);
const rawInitialTrace = decodeMemory(traceMemory.data);
const rawFinalTrace = decodeMemory(traceFenceMemory.data);
const captureConsistency = captureConsistencyEvidence(
  rawInitialTrace,
  rawFinalTrace,
  room,
);
const runtimeTrace = sanitizeRuntimeTrace(rawFinalTrace);
if (!plan)
  throw new Error(
    `No durable room plan exists at Memory.colonies.${room}.roomPlan`,
  );

const objects = Array.isArray(roomObjects.objects) ? roomObjects.objects : [];
const encodedTerrain = roomTerrain?.terrain?.[0]?.terrain;
const terrain =
  typeof encodedTerrain === "string" &&
  encodedTerrain.length === 2_500 &&
  /^[0-3]+$/.test(encodedTerrain)
    ? {
        encoding: "screeps-terrain-mask/v1",
        width: 50,
        height: 50,
        cells: encodedTerrain,
      }
    : null;
const controller =
  objects.find((object) => object.type === "controller") ?? null;
const sources = objects.filter((object) => object.type === "source");
const minerals = objects.filter((object) => object.type === "mineral");
const structureTypes = new Set([
  "spawn",
  "extension",
  "road",
  "constructedWall",
  "rampart",
  "link",
  "storage",
  "tower",
  "observer",
  "powerSpawn",
  "extractor",
  "lab",
  "terminal",
  "container",
  "nuker",
  "factory",
]);
const structures = objects.filter((object) => structureTypes.has(object.type));
const constructionSites = objects.filter(
  (object) =>
    object.type === "constructionSite" || object.type === "construction-site",
);
const controllerUser =
  typeof controller?.user === "string" ? controller.user : null;
const isColonyOwned = (object) => isOwnedSnapshotObject(object, controllerUser);
const energyStructures = structures.filter(
  (object) =>
    ["spawn", "extension"].includes(object.type) && isColonyOwned(object),
);

const snapshot = {
  schema: "screeps-observability-snapshot/v1",
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  target,
  shard,
  room,
  terrain,
  captureConsistency,
  colony: {
    controller: controller
      ? {
          x: controller.x,
          y: controller.y,
          level: controller.level ?? null,
          progress: controller.progress ?? null,
          progressTotal: controller.progressTotal ?? null,
        }
      : null,
    energy: {
      available: energyStructures.reduce(
        (sum, object) => sum + (Number(object.energy) || 0),
        0,
      ),
      capacity: energyStructures.reduce(
        (sum, object) => sum + (Number(object.energyCapacity) || 0),
        0,
      ),
    },
    creeps: objects.filter(
      (object) => object.type === "creep" && isColonyOwned(object),
    ).length,
    sources: sources.map((source) => ({ x: source.x, y: source.y })),
    minerals: minerals.map((mineral) => ({ x: mineral.x, y: mineral.y })),
    structures: structures.map((structure) => ({
      type: structure.type,
      x: structure.x,
      y: structure.y,
      hits: finiteNumber(structure.hits),
      hitsMax: finiteNumber(structure.hitsMax),
      owned: snapshotOwnership(structure, controllerUser),
    })),
    constructionSites: constructionSites.map((site) => ({
      structureType: site.structureType ?? null,
      x: site.x,
      y: site.y,
      progress: site.progress ?? null,
      progressTotal: site.progressTotal ?? null,
      owned: snapshotOwnership(site, controllerUser),
    })),
  },
  roomPlan: plan,
  roomPlanIntegrity: roomPlanIntegrityEvidence(rawPlan, plan),
  runtimeTrace,
};

let publication = {
  destination: "artifact-only",
  configured: false,
};

if (supabaseIngestUrl && githubOidcToken) {
  const response = await fetch(supabaseIngestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubOidcToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestId,
      commandKey: commandKey || undefined,
      snapshot,
    }),
  });
  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = { raw: text };
  }
  if (!response.ok || result?.ok !== true) {
    throw new Error(
      `Supabase ingest failed with HTTP ${response.status}: ${JSON.stringify(result)}`,
    );
  }
  publication = {
    destination: "supabase-edge-oidc",
    configured: true,
    colonyId: result.colonyId ?? null,
    snapshotId: result.snapshotId ?? null,
  };
}

const artifact = {
  request: {
    id: requestId,
    commandKey: commandKey || null,
    mode: "snapshot",
    command: requestCommand,
    room,
    shard,
    target,
  },
  publication,
  snapshot,
};

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/screeps-insights.json",
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
await writeFile(
  "artifacts/screeps-public-snapshot.json",
  `${JSON.stringify(snapshot)}\n`,
  "utf8",
);
console.log(
  `Published sanitized observability snapshot v1 for ${room}/${shard} (${publication.destination}).`,
);
