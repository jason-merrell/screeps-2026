import { describe, expect, it } from "vitest";
import { roomPlanProjectionFingerprint } from "../../../packages/runtime/src/planning/room-plan-projection";
import {
  roomPlanIntegrityEvidence,
  runtimeRoomPlanFingerprint,
  snapshotRoomPlanDigest,
} from "../../../scripts/lib/room-plan-integrity.mjs";
import { captureConsistencyEvidence } from "../../../scripts/lib/snapshot-capture-consistency.mjs";

const roomPlan = () => ({
  roomName: "E52N38",
  version: 4,
  horizonRcl: 8,
  plannerRevision: 1,
  projectionRevision: 12,
  generatedAt: 123,
  generatedReason: "test",
  planId: "room:E52N38",
  deliverableId: "fspm:room-plan",
  anchors: { spawn: { x: 10, y: 10 } },
  structures: [
    {
      id: "spawn:10:10",
      structureType: "spawn",
      x: 10,
      y: 10,
      minRcl: 1,
      priority: 100,
      reason: "bootstrap anchor",
    },
  ],
  roads: [],
  defense: { strategy: "terrain-mincut-v1", perimeter: [] },
});

const trace = (tick, fingerprint = "rpf1-0000000000000000") => ({
  tick,
  settlement: {
    plans: [
      {
        roomName: "E52N38",
        plannerRevision: 1,
        projectionRevision: 12,
        projectionFingerprint: fingerprint,
      },
    ],
  },
});

describe("room-plan publication integrity", () => {
  it("accepts a valid runtime fingerprint while binding the sanitized browser shape", () => {
    const raw = roomPlan();
    expect(runtimeRoomPlanFingerprint(raw)).toBe(
      roomPlanProjectionFingerprint(raw),
    );
    raw.projectionFingerprint = runtimeRoomPlanFingerprint(raw);
    const sanitized = {
      ...raw,
      generatedAt: null,
      structures: raw.structures.map(({ reason: _reason, ...structure }) => ({
        ...structure,
        phase: null,
      })),
    };
    const evidence = roomPlanIntegrityEvidence(raw, sanitized);

    expect(evidence).toMatchObject({
      declaredFingerprint: raw.projectionFingerprint,
      runtimeComputedFingerprint: raw.projectionFingerprint,
      runtimeVerified: true,
      snapshotDigest: snapshotRoomPlanDigest(sanitized),
    });
  });

  it("rejects a coordinate mutation that retains the old declared epoch", () => {
    const raw = roomPlan();
    raw.projectionFingerprint = runtimeRoomPlanFingerprint(raw);
    raw.structures[0].x = 11;

    expect(roomPlanIntegrityEvidence(raw, raw)).toMatchObject({
      declaredFingerprint: raw.projectionFingerprint,
      runtimeVerified: false,
    });
  });
});

describe("snapshot before/after trace fence", () => {
  it("accepts only one exact tick and room projection epoch", () => {
    const initial = trace(200, "rpf1-1111111111111111");
    expect(
      captureConsistencyEvidence(initial, structuredClone(initial), "E52N38"),
    ).toMatchObject({
      status: "matched",
      initialTick: 200,
      finalTick: 200,
    });
  });

  it("marks tick, epoch, or missing evidence as non-atomic", () => {
    expect(
      captureConsistencyEvidence(
        trace(200, "rpf1-1111111111111111"),
        trace(201, "rpf1-1111111111111111"),
        "E52N38",
      ).status,
    ).toBe("mixed");
    expect(
      captureConsistencyEvidence(
        trace(200, "rpf1-1111111111111111"),
        trace(200, "rpf1-2222222222222222"),
        "E52N38",
      ).status,
    ).toBe("mixed");
    expect(captureConsistencyEvidence(null, null, "E52N38").status).toBe(
      "unverified",
    );
  });
});
