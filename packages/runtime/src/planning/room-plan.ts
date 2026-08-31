export const ROOM_PLAN_VERSION = 4;
export const ROOM_PLAN_HORIZON_RCL = 8;
/** Increment whenever planner/layout/defense algorithms materially change. */
export const ROOM_PLAN_PLANNER_REVISION = 1;

export interface PlannedPoint {
  x: number;
  y: number;
}

export type PlanActivation = "automatic" | "demand" | "defense";
export type ReservationKind = "hard" | "soft";
export type RoomDevelopmentStageId =
  | "bootstrap"
  | "logistics"
  | "core-economy"
  | "advanced-operations"
  | "mature-rcl8";
export type PlanPhase =
  | "bootstrap-capacity"
  | "bootstrap-defense"
  | "source-logistics"
  | "controller-logistics"
  | "core-economy"
  | "capacity-expansion"
  | "energy-distribution"
  | "advanced-operations"
  | "mature-operations"
  | "defense-envelope"
  | "strategic-roads";

export interface RoomDevelopmentStage {
  id: RoomDevelopmentStageId;
  title: string;
  minRcl: number;
  weight: number;
  prerequisiteStageIds: RoomDevelopmentStageId[];
  objective: string;
}

export const ROOM_DEVELOPMENT_STAGES = [
  {
    id: "bootstrap",
    title: "Bootstrap Base",
    minRcl: 1,
    weight: 15,
    prerequisiteStageIds: [],
    objective:
      "Maintain a viable spawn core, initial capacity, and first-response defense.",
  },
  {
    id: "logistics",
    title: "Logistics Base",
    minRcl: 2,
    weight: 15,
    prerequisiteStageIds: ["bootstrap"],
    objective:
      "Buffer owned sources and connect the colony through durable transport corridors.",
  },
  {
    id: "core-economy",
    title: "Core Economy Base",
    minRcl: 4,
    weight: 25,
    prerequisiteStageIds: ["bootstrap", "logistics"],
    objective:
      "Establish storage-centered logistics, legal capacity growth, and stronger defense.",
  },
  {
    id: "advanced-operations",
    title: "Advanced Operations Base",
    minRcl: 6,
    weight: 20,
    prerequisiteStageIds: ["core-economy"],
    objective:
      "Enable terminal logistics, links, minerals, laboratories, and redundant spawning.",
  },
  {
    id: "mature-rcl8",
    title: "Mature RCL8 Base",
    minRcl: 8,
    weight: 25,
    prerequisiteStageIds: ["advanced-operations"],
    objective:
      "Realize the complete strategic RCL8 footprint and its defensive envelope.",
  },
] as const satisfies readonly RoomDevelopmentStage[];

export interface RoomPlanReservation extends PlannedPoint {
  id: string;
  kind: ReservationKind;
  reason: string;
}

export interface RoomPlanStructure extends PlannedPoint {
  id: string;
  structureType: BuildableStructureConstant;
  minRcl: number;
  priority: number;
  activation: PlanActivation;
  reservation: ReservationKind;
  phase: PlanPhase;
  reason: string;
  /** Stage metadata is optional only while persisted pre-v4 plans drain. */
  stage?: RoomDevelopmentStageId;
  /** Relative outcome importance inside the stage realization score. */
  strategicWeight?: number;
  /** Demand infrastructure may be planned without blocking the stage realization gate. */
  requiredForStage?: boolean;
}

export interface RoomPlanRoad extends PlannedPoint {
  id: string;
  minRcl: number;
  activation: PlanActivation;
  phase: "strategic-roads";
  reason: string;
  stage?: RoomDevelopmentStageId;
  strategicWeight?: number;
  requiredForStage?: boolean;
}

export type RoadNodeKind =
  | "spawn"
  | "hub"
  | "source"
  | "controller"
  | "storage"
  | "terminal"
  | "tower"
  | "lab"
  | "advanced";

export interface RoomPlanRoadNode extends PlannedPoint {
  id: string;
  kind: RoadNodeKind;
}

export interface RoomPlanRoadEdge {
  id: string;
  from: string;
  to: string;
  tiles: PlannedPoint[];
}

export interface RoomPlanSourceAnchor extends PlannedPoint {
  sourceId: string;
  container: PlannedPoint;
}

/**
 * Mutable operational projection used to schedule Screeps work. This is not an
 * authoritative FSPM record: governed Requirements, Deliverables, Activities,
 * receipts, and decisions live in the Portfolio and its authority ledgers.
 */
export interface RoomPlan {
  /** Stable projection identity; not an FSPM Plan authority record. */
  planId?: string;
  /** Traceability link to the authoritative governed construction Deliverable. */
  deliverableId?: string;
  /** Code-owned revision of the algorithms that produced this projection. */
  plannerRevision?: number;
  /** Monotonic epoch of this mutable operational projection. */
  projectionRevision?: number;
  /** Deterministic content identity; not governance or authority evidence. */
  projectionFingerprint?: string;
  version: number;
  horizonRcl: number;
  roomName: string;
  generatedAt: number;
  generatedReason: string;
  stages?: RoomDevelopmentStage[];
  anchors: {
    spawn: PlannedPoint & { name: string };
    hub: PlannedPoint;
    controller: (PlannedPoint & { service: PlannedPoint }) | null;
    sources: RoomPlanSourceAnchor[];
  };
  reservations: RoomPlanReservation[];
  structures: RoomPlanStructure[];
  roads: RoomPlanRoad[];
  roadGraph: {
    nodes: RoomPlanRoadNode[];
    edges: RoomPlanRoadEdge[];
  };
  defense: {
    strategy: "pending-mincut" | "terrain-mincut-v1";
    protectedTiles: PlannedPoint[];
    perimeter: PlannedPoint[];
  };
  invalidatedAt?: number;
  invalidationReason?: string;
}
