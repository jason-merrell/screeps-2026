import { infrastructureWorkKey } from "../intents/trace";
import type { Intent } from "../intents/types";

/**
 * Enrich runtime intents with a stable governed work-instance identity when the
 * planner cannot know it until the concrete Screeps object exists.
 *
 * Construction-site creation can identify work from room/coordinates/type
 * before a ConstructionSite object exists. A later build intent only carries
 * the site object ID, so derive the same key from the live site here. This lets
 * one FSPM Activity span siting -> builder handoff without changing Task ID.
 */
export function ensureFspmWorkIdentity(intent: Intent): void {
  const trace = intent.trace;
  if (!trace || trace.workKey) return;

  if (intent.type !== "build") return;
  const site = Game.getObjectById(intent.targetId);
  if (!site) return;

  trace.workKey = infrastructureWorkKey(
    site.pos.roomName,
    site.pos.x,
    site.pos.y,
    site.structureType,
  );
}

export function ensureFspmWorkIdentities(intents: Intent[]): void {
  for (const intent of intents) ensureFspmWorkIdentity(intent);
}
