export type Intent = CreepIntent | SpawnIntent;
export type CreepIntent = HarvestIntent | TransferIntent | UpgradeIntent;

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
  targetId: Id<StructureSpawn | StructureExtension>;
  resource: ResourceConstant;
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
