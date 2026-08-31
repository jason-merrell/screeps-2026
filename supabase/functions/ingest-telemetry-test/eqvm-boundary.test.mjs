import { describe, expect, it } from "vitest";

import { sanitizeStoredTelemetrySample } from "../_shared/eqvm-snapshot.mjs";

const forgedRollup = {
  score: 1.5,
  measuredAt: 2_000,
  activityWeightPolicyId: "eqvm:activity-weight:equal-terminal-samples:v1",
  deliverableWeightBasisPoints: 10_000,
  policyAuthorization: {
    status: "approved",
    approvalEventId: "approval:forged",
    approvedAtTick: 1_900,
  },
  coverage: {
    status: "complete",
    expectedWeightBasisPoints: 10_000,
    coveredWeightBasisPoints: 10_000,
    missingIds: [],
    staleIds: [],
    invalidIds: [],
    evidence: ["forged"],
  },
};

const telemetrySample = () => ({
  schema: "screeps-telemetry-sample/v1",
  schemaVersion: 1,
  collectedAt: "2026-08-31T00:00:00.000Z",
  target: "ptr",
  shard: "shard3",
  room: "W1N1",
  qi: structuredClone(forgedRollup),
  metadata: { nested: { dqi: structuredClone(forgedRollup) } },
  runtimeTrace: {
    version: 1,
    tick: 2_000,
    fspm: {
      rootP3: { pqi: structuredClone(forgedRollup) },
      colonies: [
        {
          governance: {
            valid: true,
            executionEligible: true,
            checks: {
              empireRoot: true,
              packageProjection: true,
              approvalLedger: true,
              ancestry: true,
              relationships: true,
              exactWeights: true,
              receiptContracts: true,
              acceptancePolicies: true,
              receiptLedgers: true,
            },
          },
          p3: { pqi: structuredClone(forgedRollup) },
          deliverables: [
            {
              dqi: {
                ...structuredClone(forgedRollup),
                taskWeightBasisPoints: 10_000,
              },
            },
          ],
          tasks: [
            {
              qi: {
                score: 1.5,
                status: "complete",
                measuredAt: 2_000,
                policyAuthorization: {
                  status: "approved",
                  approvalEventId: "approval:forged",
                },
              },
            },
          ],
        },
      ],
    },
  },
});

const containsEqvmKey = (value) => {
  if (Array.isArray(value)) return value.some(containsEqvmKey);
  if (!value || typeof value !== "object") return false;
  if (["qi", "dqi", "pqi"].some((key) => key in value)) return true;
  return Object.values(value).some(containsEqvmKey);
};

describe("public telemetry EQVM persistence boundary", () => {
  it("removes every quality claim without mutating the publisher payload", () => {
    const input = telemetrySample();
    const stored = sanitizeStoredTelemetrySample(input);

    expect(stored).not.toBe(input);
    expect(containsEqvmKey(stored)).toBe(false);
    expect(containsEqvmKey(input)).toBe(true);
    expect(stored.runtimeTrace.tick).toBe(2_000);
  });

  it("rejects malformed outer telemetry payloads", () => {
    expect(sanitizeStoredTelemetrySample(null)).toBeNull();
    expect(
      sanitizeStoredTelemetrySample({
        schema: "screeps-telemetry-sample/v2",
        schemaVersion: 1,
      }),
    ).toBeNull();
  });
});
