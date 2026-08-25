export type Intent =
  | CreepIntent
  | SpawnIntent
  | CreateConstructionSiteIntent
  | TowerAttackIntent;
export type CreepIntent =
  | HarvestIntent
  | TransferIntent
  | BuildIntent
  | RepairIntent
  | UpgradeIntent;

interface IntentBase {
  priority: number;
  reason: string;
}

interface CreepIntentBase extends IntentBase {
  creepName: string;
}

export interface HarvestIntent extends CreepIntentBase {
  type: "harvest";
  sourceId: Id<Source>;
}

export interface TransferIntent extends CreepIntentBase {
  type: "transfer";
  targetId: Id<StructureSpawn | StructureExtension | StructureTower>;
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
