export type EqvmRecord = Record<string, unknown>;

export declare function sanitizeEqvmPolicyAuthorization(
  value: unknown,
): EqvmRecord | null;

export declare function sanitizeWeightedEqvmIndex(
  value: unknown,
  weightKey: "taskWeightBasisPoints" | "deliverableWeightBasisPoints",
  maximumTick?: number | null,
): EqvmRecord | null;

export declare function sanitizeTaskQi(
  value: unknown,
  maximumTick?: number | null,
): EqvmRecord | null;

export declare function enforceEqvmSnapshotBoundary<T>(runtimeTrace: T): T;

export declare function sanitizeStoredObservabilitySnapshot<T extends object>(
  value: unknown,
): T | null;

export declare function sanitizeStoredTelemetrySample<T extends object>(
  value: unknown,
): T | null;
