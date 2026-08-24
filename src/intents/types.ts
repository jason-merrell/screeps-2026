export type Intent = HarvestIntent | TransferIntent | UpgradeIntent;

interface IntentBase {
  creepName: string;
  priority: number;
  reason: string;
}

export interface HarvestIntent extends IntentBase {
  type: "harvest";
  sourceId: Id<Source>;
}

export interface TransferIntent extends IntentBase {
  type: "transfer";
  targetId: Id<StructureSpawn | StructureExtension>;
  resource: ResourceConstant;
}

export interface UpgradeIntent extends IntentBase {
  type: "upgrade";
  controllerId: Id<StructureController>;
}
