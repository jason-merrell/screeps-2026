import {
  ensureFspmTraceLineage,
  type FspmDomain,
} from "../planning/fspm";
import type { IntentTrace } from "./types";

export type TraceDomain = FspmDomain;

interface IntentTraceInput {
  roomName: string;
  domain: TraceDomain;
  task: string;
  procedure?: string;
  activity?: string;
  workKey?: string;
}

export function infrastructureWorkKey(
  roomName: string,
  x: number,
  y: number,
  structureType: StructureConstant,
): string {
  return `infrastructure:${roomName}:${x}:${y}:${structureType}`;
}

function legacyProcedureKey(activity: string): string {
  const parts = activity.split(":");
  // Legacy callers encoded `<actor>:<procedure>:<target>` into `activity`.
  // Preserve compatibility while ensuring concrete target identity no longer
  // creates a new governed Procedure definition.
  if (parts.length >= 3 && parts[1]) return parts[1];
  return activity;
}

export function createIntentTrace(input: IntentTraceInput): IntentTrace {
  const procedureKey =
    input.procedure ??
    (input.activity ? legacyProcedureKey(input.activity) : "execute-task");
  return ensureFspmTraceLineage({
    roomName: input.roomName,
    domain: input.domain,
    taskKey: input.task,
    procedureKey,
    ...(input.workKey ? { workKey: input.workKey } : {}),
  });
}
