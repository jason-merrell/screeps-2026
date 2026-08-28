export type Intent =
  | CreepIntent
  | SpawnIntent
  | CreateConstructionSiteIntent
  | TowerAttackIntent;
export type CreepIntent =
  | MoveIntent
  | HarvestIntent
  | WithdrawIntent
  | TransferIntent
  | BuildIntent
  | RepairIntent
  | UpgradeIntent;

export interface IntentTrace {
  /**
   * Current FSPM authority for newly generated work. Optional only so persisted
   * pre-migration traces remain decodable while the legacy contract field drains.
   */
  p3Id?: string;
  /** Legacy pre-P3-migration authority. New runtime traces must not emit it. */
  contractId?: string;
  requirementId: string;
  deliverableId: string;
  taskId: string;
  procedureId: string;
  /** Stable governed work-instance identity across Procedure/actor/target transitions. */
  workKey?: string;
  activityId?: string;
}

interface IntentBase {
  priority: number;
  reason: string;
  trace?: IntentTrace;
}

interface CreepIntentBase extends IntentBase {
  creepName: string;
}

export interface MoveIntent extends CreepIntentBase {
  type: "move";
  targetId: Id<StructureContainer | StructureSpawn>;
  range: number;
}

export interface HarvestIntent extends CreepIntentBase {
  type: "harvest";
  sourceId: Id<Source>;
}

export interface WithdrawIntent extends CreepIntentBase {
  type: "withdraw";
  targetId: Id<StructureContainer | Tombstone | Ruin>;
  resource: ResourceConstant;
}

export interface TransferIntent extends CreepIntentBase {
  type: "transfer";
  targetId: Id<StructureSpawn | StructureExtension | StructureTower | StructureContainer>;
  resource: ResourceConstant;
}

export interface BuildIntent extends CreepIntentBase {
  type: "build";
  targetId: Id<ConstructionSite>;
}

export interface RepairIntent extends CreepIntentBase {
  type: "repair";
  targetId: Id<Structure>;
}

export interface UpgradeIntent extends CreepIntentBase {
  type: "upgrade";
  controllerId: Id<StructureController>;
}

export interface SpawnIntent extends IntentBase {
  type: "spawn";
  spawnName: string;
  body: BodyPartConstant[];
  name: string;
}

export interface CreateConstructionSiteIntent extends IntentBase {
  type: "createConstructionSite";
  roomName: string;
  x: number;
  y: number;
  structureType: BuildableStructureConstant;
}

export interface TowerAttackIntent extends IntentBase {
  type: "towerAttack";
  towerId: Id<StructureTower>;
  targetId: Id<Creep>;
}
