import { describe, expect, it } from "vitest";

import { traceFencedCapture } from "../../../scripts/lib/trace-fenced-capture.mjs";

describe("snapshot trace-fenced capture", () => {
  it("settles trace-before, then the complete payload, then trace-after", async () => {
    const events = [];
    let traceRead = 0;
    const result = await traceFencedCapture(
      async () => {
        traceRead += 1;
        events.push(`trace:${traceRead}:start`);
        await Promise.resolve();
        events.push(`trace:${traceRead}:end`);
        return { tick: traceRead };
      },
      async () => {
        events.push("payload:start");
        await Promise.all([Promise.resolve(), Promise.resolve()]);
        events.push("payload:end");
        return { plan: true, objects: true, terrain: true };
      },
    );

    expect(events).toEqual([
      "trace:1:start",
      "trace:1:end",
      "payload:start",
      "payload:end",
      "trace:2:start",
      "trace:2:end",
    ]);
    expect(result).toEqual({
      initialTrace: { tick: 1 },
      payload: { plan: true, objects: true, terrain: true },
      finalTrace: { tick: 2 },
    });
  });
});
