import { ensureDomainHierarchy, ensureProcedure, ensureTask, type FspmDomain } from "../planning/fspm";
import type { IntentTrace } from "./types";

export type TraceDomain = FspmDomain;

interface IntentTraceInput {
  roomName: string;
  domain: TraceDomain;
  task: string;
  procedure?: string;
  activity?: string;
}

export function createIntentTrace(input: IntentTraceInput): IntentTrace {
  const { portfolio, requirement, deliverable } = ensureDomainHierarchy(
    input.roomName,
    input.domain,
  );
  const task = ensureTask(input.roomName, input.domain, input.task);
  const procedureKey = input.procedure ?? input.activity ?? "execute-task";
  const procedure = ensureProcedure(input.roomName, input.domain, input.task, procedureKey);

  return {
    contractId: portfolio.contract.id,
    requirementId: requirement.id,
    deliverableId: deliverable.id,
    taskId: task.id,
    procedureId: procedure.id,
  };
}
