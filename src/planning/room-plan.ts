export const ROOM_PLAN_VERSION = 1;
export const ROOM_PLAN_HORIZON_RCL = 3;

export interface PlannedPoint {
  x: number;
  y: number;
}

export type PlanActivation = "automatic" | "demand";
export type ReservationKind = "hard" | "soft";
export type PlanPhase =
  | "bootstrap-capacity"
  | "bootstrap-defense"
  | "source-logistics"
  | "controller-logistics"
  | "strategic-roads";

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
}

export interface RoomPlanRoad extends PlannedPoint {
  id: string;
  minRcl: number;
  activation: PlanActivation;
  phase: "strategic-roads";
  reason: string;
}

export type RoadNodeKind = "spawn" | "hub" | "source" | "controller";

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

export interface RoomPlan {
  version: number;
  horizonRcl: number;
  roomName: string;
  generatedAt: number;
  generatedReason: string;
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
    strategy: "pending-mincut";
    protectedTiles: PlannedPoint[];
    perimeter: PlannedPoint[];
  };
  invalidatedAt?: number;
  invalidationReason?: string;
}
