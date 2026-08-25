import type { IntentTrace } from "./types";

export type TraceDomain = "economy" | "spawning" | "construction" | "defense";

interface IntentTraceInput {
  roomName: string;
  domain: TraceDomain;
  task: string;
  activity: string;
}

export function createIntentTrace(input: IntentTraceInput): IntentTrace {
  const scope = `${input.roomName}:${input.domain}`;
  return {
    contractId: `contract:colony:${input.roomName}`,
    requirementId: `requirement:${scope}`,
    deliverableId: `deliverable:${scope}`,
    taskId: `task:${scope}:${input.task}`,
    activityId: `activity:${Game.time}:${scope}:${input.activity}`,
  };
}
