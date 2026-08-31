declare const __SCREEPS_RUNTIME_SHA__: string | null | undefined;

/**
 * Git commit embedded into the exact bundle being executed. Development builds
 * from a dirty worktree deliberately report null instead of claiming the HEAD
 * commit describes bytes that it does not contain.
 */
export const runtimeBuildSha: string | null =
  typeof __SCREEPS_RUNTIME_SHA__ === "string" &&
  __SCREEPS_RUNTIME_SHA__.trim().length > 0
    ? __SCREEPS_RUNTIME_SHA__
    : null;
