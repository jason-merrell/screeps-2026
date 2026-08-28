import type { Intent } from "../intents/types";

/**
 * Local room progression ends at RCL8. Any controller energy spent after that
 * point is either downgrade maintenance or strategic GCL investment, both of
 * which require explicit policy outside the routine delivery fallback.
 */
export function allowsRoutineControllerProgress(level: number | undefined): boolean {
  return level !== undefined && level > 0 && level < 8;
}

/**
 * Remove upgrade intents that cannot truthfully represent room progression.
 *
 * This is intentionally fail-closed: an unresolved controller or a capped
 * controller cannot consume routine local surplus energy. Explicit RCL8
 * maintenance and GCL investment are separate governed policies.
 */
export function enforceRoutineControllerProgress(intents: Intent[]): Intent[] {
  return intents.filter((intent) => {
    if (intent.type !== "upgrade") return true;
    const controller = Game.getObjectById(intent.controllerId);
    return controller?.my === true && allowsRoutineControllerProgress(controller.level);
  });
}
