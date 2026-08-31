import type {
  EncodedRoomTerrain,
  Point,
  RoomDevelopmentStageId,
  Snapshot,
} from "./control-plane";
import type {
  DevelopmentRequirement,
  RoomDevelopmentSummary,
} from "./room-development";

export const ROOM_SIZE = 50;

export type TerrainCellKind = "plain" | "swamp" | "wall";
export type DecodedRoomTerrain = {
  cells: TerrainCellKind[];
  walls: Point[];
  swamps: Point[];
  exits: Point[];
};

export type BlueprintAuthority = {
  active: boolean;
  status: string;
  reason: string;
};

export type RampartCondition = {
  state: "unverified" | "critical" | "strengthening" | "at-target";
  ratio: number | null;
  targetHits: number | null;
};

export type StrategicStructureMarker = Point & {
  key: string;
  structureType: string;
  planned: boolean;
  built: boolean;
  constructionSite: boolean;
  offPlan: boolean;
  defense: boolean;
  plannedStructureIds: string[];
  stageId: RoomDevelopmentStageId | null;
  minRcl: number | null;
  underConstruction: boolean;
  blockerReasons: string[];
  owned: boolean | null;
  ownership: "colony" | "foreign" | "neutral" | "unverified" | null;
  hits: number | null;
  hitsMax: number | null;
  siteProgress: number | null;
  siteProgressTotal: number | null;
  rampartCondition: RampartCondition | null;
};

export type StrategicNaturalMarker = Point & {
  key: string;
  kind: "controller" | "source" | "mineral";
};

export type StrategicAnchorMarker = Point & {
  key: string;
  kind: "hub" | "controller-service";
};

export type StrategicDiagnosticMarker = Point & {
  key: string;
  structureType: string;
  defense: boolean;
};

export type StrategicDiagnosticAnchor = Point & {
  key: string;
  kind: "hub" | "controller-service";
};

export type StrategicRoomMapModel = {
  roomName: string | null;
  terrain: DecodedRoomTerrain | null;
  blueprint: BlueprintAuthority;
  retainedPlanPresent: boolean;
  structures: StrategicStructureMarker[];
  naturals: StrategicNaturalMarker[];
  anchors: StrategicAnchorMarker[];
  diagnosticStructures: StrategicDiagnosticMarker[];
  diagnosticAnchors: StrategicDiagnosticAnchor[];
  missingQueue: DevelopmentRequirement[];
  counts: {
    planned: number;
    built: number;
    constructionSites: number;
    offPlan: number;
    blocked: number;
  };
};

const isRoomCoordinate = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) < ROOM_SIZE;

type PointLike = { x?: number | null; y?: number | null };

const isPoint = (value: PointLike | null | undefined): value is Point =>
  Boolean(value && isRoomCoordinate(value.x) && isRoomCoordinate(value.y));

export const pointKey = (point: Point): string => `${point.x}:${point.y}`;

export const structureKey = (structureType: string, point: Point): string =>
  `${structureType}@${pointKey(point)}`;

type CanonicalJson =
  | boolean
  | number
  | string
  | null
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

const canonicalize = (value: unknown): CanonicalJson => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

const fingerprintContent = (plan: unknown): CanonicalJson | null => {
  if (!plan || typeof plan !== "object") return null;
  const {
    deliverableId: _deliverableId,
    generatedAt: _generatedAt,
    generatedReason: _generatedReason,
    invalidatedAt: _invalidatedAt,
    invalidationReason: _invalidationReason,
    planId: _planId,
    projectionFingerprint: _projectionFingerprint,
    projectionRevision: _projectionRevision,
    ...content
  } = plan as Record<string, unknown>;
  return canonicalize(content);
};

const mixFingerprint = (text: string, seed: number): number => {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    value = Math.imul(value ^ (code & 0xff), 0x01000193) >>> 0;
    value = Math.imul(value ^ (code >>> 8), 0x01000193) >>> 0;
  }
  return value;
};

const planFingerprint = (plan: unknown, prefix: "rpf1" | "lpf1") => {
  const content = fingerprintContent(plan);
  if (content === null) return null;
  const serialized = JSON.stringify(content);
  const left = mixFingerprint(serialized, 0x811c9dc5)
    .toString(16)
    .padStart(8, "0");
  const right = mixFingerprint(serialized, 0x9e3779b9)
    .toString(16)
    .padStart(8, "0");
  return `${prefix}-${left}${right}`;
};

/** Byte-compatible verification of the runtime rpf1 projection identity. */
export const runtimeRoomPlanFingerprint = (plan: unknown) =>
  planFingerprint(plan, "rpf1");

/** Detects projection mutation after publisher sanitization. */
export const snapshotRoomPlanDigest = (plan: unknown) =>
  planFingerprint(plan, "lpf1");

const terrainMask = (
  terrain: EncodedRoomTerrain | null | undefined,
  x: number,
  y: number,
): number | null => {
  if (
    terrain?.encoding !== "screeps-terrain-mask/v1" ||
    terrain.width !== ROOM_SIZE ||
    terrain.height !== ROOM_SIZE ||
    terrain.cells.length !== ROOM_SIZE * ROOM_SIZE ||
    !/^[0-3]+$/.test(terrain.cells) ||
    !isRoomCoordinate(x) ||
    !isRoomCoordinate(y)
  ) {
    return null;
  }
  return Number(terrain.cells[y * ROOM_SIZE + x]);
};

export function decodeRoomTerrain(
  terrain: EncodedRoomTerrain | null | undefined,
): DecodedRoomTerrain | null {
  if (terrainMask(terrain, 0, 0) === null) return null;

  const cells: TerrainCellKind[] = [];
  const walls: Point[] = [];
  const swamps: Point[] = [];
  const exits: Point[] = [];
  for (let y = 0; y < ROOM_SIZE; y += 1) {
    for (let x = 0; x < ROOM_SIZE; x += 1) {
      const mask = terrainMask(terrain, x, y) ?? 0;
      const point = { x, y };
      const kind: TerrainCellKind =
        (mask & 1) !== 0 ? "wall" : (mask & 2) !== 0 ? "swamp" : "plain";
      cells.push(kind);
      if (kind === "wall") walls.push(point);
      if (kind === "swamp") swamps.push(point);
      if (
        kind !== "wall" &&
        (x === 0 || x === ROOM_SIZE - 1 || y === 0 || y === ROOM_SIZE - 1)
      ) {
        exits.push(point);
      }
    }
  }
  return { cells, walls, swamps, exits };
}

export function terrainAt(
  terrain: DecodedRoomTerrain | null,
  point: Point,
): TerrainCellKind | "unknown" {
  if (!terrain || !isPoint(point)) return "unknown";
  return terrain.cells[point.y * ROOM_SIZE + point.x] ?? "unknown";
}

export function blueprintAuthority(
  snapshot: Snapshot | null,
  development: RoomDevelopmentSummary,
): BlueprintAuthority {
  const plan = snapshot?.roomPlan;
  if (!plan) {
    return {
      active: false,
      status: "plan-missing",
      reason: "No retained room-plan projection is present.",
    };
  }
  if (plan.version !== 4 || plan.horizonRcl !== 8) {
    return {
      active: false,
      status: "version-horizon-mismatch",
      reason: `Expected room plan v4/RCL8; retained v${plan.version ?? "?"}/RCL${plan.horizonRcl ?? "?"}.`,
    };
  }
  const usability = development.projection.runtimeUsability;
  if (!usability) {
    return {
      active: false,
      status: "evidence-missing",
      reason: "Runtime projection-usability evidence is missing.",
    };
  }
  if (development.projection.traceAlignment !== "matched") {
    return {
      active: false,
      status: `epoch-${development.projection.traceAlignment}`,
      reason:
        "The retained plan and runtime trace do not prove the same projection epoch.",
    };
  }
  if (usability.usable !== true || usability.status !== "current") {
    return {
      active: false,
      status: usability.status,
      reason: usability.reason,
    };
  }
  if (
    development.state !== "developing" &&
    development.state !== "footprint-realized"
  ) {
    return {
      active: false,
      status: `development-${development.state}`,
      reason:
        "Runtime development evidence is not current and operational for this projection.",
    };
  }
  if (
    development.projection.plannerRevision !== plan.plannerRevision ||
    development.projection.projectionRevision !== plan.projectionRevision ||
    development.projection.projectionFingerprint !== plan.projectionFingerprint
  ) {
    return {
      active: false,
      status: "development-epoch-mismatch",
      reason:
        "Runtime development evidence and the browser projection do not share an exact epoch.",
    };
  }
  if (snapshot.captureConsistency?.status !== "matched") {
    return {
      active: false,
      status: `capture-${snapshot.captureConsistency?.status ?? "missing"}`,
      reason:
        snapshot.captureConsistency?.reason ??
        "Snapshot trace-fence evidence is missing; same-tick overlay is unverified.",
    };
  }
  const integrity = snapshot.roomPlanIntegrity;
  const browserDigest = snapshotRoomPlanDigest(plan);
  if (!integrity) {
    return {
      active: false,
      status: "content-integrity-missing",
      reason: "Publisher room-plan content-integrity evidence is missing.",
    };
  }
  if (
    integrity.projectionScheme !== "room-plan-fingerprint/v1" ||
    integrity.snapshotDigestScheme !== "screeps-lab-room-plan-digest/v1" ||
    integrity.runtimeVerified !== true ||
    integrity.declaredFingerprint !== plan.projectionFingerprint ||
    integrity.runtimeComputedFingerprint !== plan.projectionFingerprint ||
    integrity.snapshotDigest !== browserDigest
  ) {
    return {
      active: false,
      status: "content-integrity-mismatch",
      reason:
        "The retained plan content does not match its runtime fingerprint and publisher-bound browser digest.",
    };
  }
  return {
    active: true,
    status: "current",
    reason: usability.reason,
  };
}

export function rampartCondition(
  hits: number | null | undefined,
  targetHits: number | null | undefined,
): RampartCondition {
  if (
    !Number.isFinite(hits) ||
    Number(hits) < 0 ||
    !Number.isFinite(targetHits) ||
    Number(targetHits) <= 0
  ) {
    return { state: "unverified", ratio: null, targetHits: null };
  }
  const ratio = Number(hits) / Number(targetHits);
  return {
    state:
      ratio >= 1 ? "at-target" : ratio < 0.5 ? "critical" : "strengthening",
    ratio,
    targetHits: Number(targetHits),
  };
}

const emptyMarker = (
  structureType: string,
  point: Point,
): StrategicStructureMarker => ({
  ...point,
  key: structureKey(structureType, point),
  structureType,
  planned: false,
  built: false,
  constructionSite: false,
  offPlan: false,
  defense: ["rampart", "constructedWall"].includes(structureType),
  plannedStructureIds: [],
  stageId: null,
  minRcl: null,
  underConstruction: false,
  blockerReasons: [],
  owned: null,
  ownership: null,
  hits: null,
  hitsMax: null,
  siteProgress: null,
  siteProgressTotal: null,
  rampartCondition: null,
});

const finiteOrNull = (value: number | null | undefined): number | null =>
  Number.isFinite(value) ? (value ?? null) : null;

const stringOrNull = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export function buildStrategicRoomMapModel(
  snapshot: Snapshot | null,
  development: RoomDevelopmentSummary,
): StrategicRoomMapModel {
  const blueprint = blueprintAuthority(snapshot, development);
  const markerByKey = new Map<string, StrategicStructureMarker>();
  const diagnosticByKey = new Map<string, StrategicDiagnosticMarker>();
  const marker = (structureType: string, point: Point) => {
    const key = structureKey(structureType, point);
    const existing = markerByKey.get(key);
    if (existing) return existing;
    const created = emptyMarker(structureType, point);
    markerByKey.set(key, created);
    return created;
  };

  const markPlanned = (
    structureType: string | null | undefined,
    point: Point | null | undefined,
    details: {
      id?: string | null;
      stage?: RoomDevelopmentStageId | null;
      minRcl?: number | null;
      defense?: boolean;
    } = {},
  ) => {
    const type = stringOrNull(structureType);
    if (!type || !isPoint(point)) return;
    const key = structureKey(type, point);
    diagnosticByKey.set(key, {
      ...point,
      key,
      structureType: type,
      defense:
        details.defense === true ||
        ["rampart", "constructedWall"].includes(type),
    });
    if (!blueprint.active) return;
    const planned = marker(type, point);
    planned.planned = true;
    planned.defense ||= details.defense === true;
    const id = stringOrNull(details.id);
    if (id && !planned.plannedStructureIds.includes(id)) {
      planned.plannedStructureIds.push(id);
    }
    planned.stageId ??= details.stage ?? null;
    planned.minRcl ??= finiteOrNull(details.minRcl);
  };

  for (const road of snapshot?.roomPlan?.roads ?? []) {
    markPlanned("road", road, road);
  }
  for (const structure of snapshot?.roomPlan?.structures ?? []) {
    markPlanned(structure.structureType, structure, structure);
  }
  for (const point of snapshot?.roomPlan?.defense?.perimeter ?? []) {
    markPlanned("rampart", point, { defense: true });
  }
  markPlanned("spawn", snapshot?.roomPlan?.anchors?.spawn, {
    id: "anchor:spawn",
  });
  for (const source of snapshot?.roomPlan?.anchors?.sources ?? []) {
    markPlanned("container", source.container, { id: "anchor:source-buffer" });
  }

  const missingQueue = blueprint.active
    ? development.missingCriticalStructures
    : [];
  for (const requirement of missingQueue) {
    if (!isPoint(requirement)) continue;
    const missing = marker(requirement.structureType, requirement);
    missing.planned = true;
    missing.underConstruction = requirement.underConstruction;
    missing.stageId ??= requirement.stageId;
    missing.minRcl ??= requirement.minRcl;
    if (!missing.plannedStructureIds.includes(requirement.id)) {
      missing.plannedStructureIds.push(requirement.id);
    }
    missing.blockerReasons = [
      ...new Set([
        ...missing.blockerReasons,
        ...requirement.blockers.map((blocker) => blocker.reason),
      ]),
    ];
  }

  for (const structure of snapshot?.colony?.structures ?? []) {
    const type = stringOrNull(structure.type);
    if (!type || !isPoint(structure)) continue;
    const built = marker(type, structure);
    built.built = true;
    built.owned = structure.owned ?? null;
    built.ownership =
      structure.owned === true
        ? "colony"
        : structure.owned === false
          ? "foreign"
          : ["road", "container", "constructedWall"].includes(type)
            ? "neutral"
            : "unverified";
    built.hits = finiteOrNull(structure.hits);
    built.hitsMax = finiteOrNull(structure.hitsMax);
    built.offPlan = blueprint.active && !built.planned;
  }

  for (const site of snapshot?.colony?.constructionSites ?? []) {
    const type = stringOrNull(site.structureType);
    if (!type || !isPoint(site)) continue;
    const construction = marker(type, site);
    construction.constructionSite = true;
    construction.owned = site.owned ?? null;
    construction.ownership =
      site.owned === true
        ? "colony"
        : site.owned === false
          ? "foreign"
          : "unverified";
    construction.siteProgress = finiteOrNull(site.progress);
    construction.siteProgressTotal = finiteOrNull(site.progressTotal);
    construction.offPlan ||= blueprint.active && !construction.planned;
  }

  const targetHits = development.defense.targetHits;
  for (const structure of markerByKey.values()) {
    if (structure.structureType === "rampart" && structure.built) {
      structure.rampartCondition = rampartCondition(structure.hits, targetHits);
    }
  }

  const naturals: StrategicNaturalMarker[] = [];
  const naturalKeys = new Set<string>();
  const markNatural = (
    kind: StrategicNaturalMarker["kind"],
    point: PointLike | null | undefined,
  ) => {
    if (!isPoint(point)) return;
    const key = `${kind}@${pointKey(point)}`;
    if (naturalKeys.has(key)) return;
    naturalKeys.add(key);
    naturals.push({ ...point, key, kind });
  };
  markNatural("controller", snapshot?.colony?.controller ?? null);
  for (const source of snapshot?.colony?.sources ?? []) {
    markNatural("source", source);
  }
  for (const mineral of snapshot?.colony?.minerals ?? []) {
    markNatural("mineral", mineral);
  }

  const anchors: StrategicAnchorMarker[] = [];
  const diagnosticAnchors: StrategicDiagnosticAnchor[] = [];
  const hub = snapshot?.roomPlan?.anchors?.hub;
  if (isPoint(hub)) {
    diagnosticAnchors.push({
      ...hub,
      key: `hub@${pointKey(hub)}`,
      kind: "hub",
    });
  }
  const service = snapshot?.roomPlan?.anchors?.controller?.service;
  if (isPoint(service)) {
    diagnosticAnchors.push({
      ...service,
      key: `controller-service@${pointKey(service)}`,
      kind: "controller-service",
    });
  }
  if (blueprint.active) {
    if (isPoint(hub)) {
      anchors.push({ ...hub, key: `hub@${pointKey(hub)}`, kind: "hub" });
    }
    if (isPoint(service)) {
      anchors.push({
        ...service,
        key: `controller-service@${pointKey(service)}`,
        kind: "controller-service",
      });
    }
  }

  const structures = [...markerByKey.values()].sort(
    (left, right) =>
      left.y - right.y ||
      left.x - right.x ||
      left.structureType.localeCompare(right.structureType),
  );
  return {
    roomName: snapshot?.room ?? null,
    terrain: decodeRoomTerrain(snapshot?.terrain),
    blueprint,
    retainedPlanPresent: Boolean(snapshot?.roomPlan),
    structures,
    naturals,
    anchors,
    diagnosticStructures: blueprint.active ? [] : [...diagnosticByKey.values()],
    diagnosticAnchors: blueprint.active ? [] : diagnosticAnchors,
    missingQueue,
    counts: {
      planned: structures.filter((item) => item.planned).length,
      built: structures.filter((item) => item.built).length,
      constructionSites: structures.filter((item) => item.constructionSite)
        .length,
      offPlan: structures.filter((item) => item.offPlan).length,
      blocked: structures.filter((item) => item.blockerReasons.length > 0)
        .length,
    },
  };
}

export function markersAt(
  model: StrategicRoomMapModel,
  point: Point,
): {
  structures: StrategicStructureMarker[];
  naturals: StrategicNaturalMarker[];
  anchors: StrategicAnchorMarker[];
} {
  return {
    structures: model.structures.filter(
      (item) => item.x === point.x && item.y === point.y,
    ),
    naturals: model.naturals.filter(
      (item) => item.x === point.x && item.y === point.y,
    ),
    anchors: model.anchors.filter(
      (item) => item.x === point.x && item.y === point.y,
    ),
  };
}

export const humanizeStructureType = (structureType: string): string =>
  structureType
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
