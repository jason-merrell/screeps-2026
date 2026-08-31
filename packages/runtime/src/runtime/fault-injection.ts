declare const __SCREEPS_TEST_FAULT_FSPM_MAINTENANCE__: boolean | undefined;

/**
 * Compile-time-only private-server fault seam. Normal bundles leave the symbol
 * undefined, so live Memory or console input cannot activate it.
 */
export function injectFspmMaintenanceFaultForTest(): void {
  if (
    typeof __SCREEPS_TEST_FAULT_FSPM_MAINTENANCE__ !== "undefined" &&
    __SCREEPS_TEST_FAULT_FSPM_MAINTENANCE__ === true
  ) {
    throw new Error("injected production-loop FSPM maintenance failure");
  }
}
