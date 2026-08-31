import { describe, expect, it } from "vitest";
import { MEMORY_VERSION } from "../packages/runtime/src/memory/schema.ts";
import { expectedProductionMemoryVersion } from "./production-runtime-schema.mjs";

describe("production runtime schema", () => {
  it("sources the smoke target from the runtime schema without a duplicated version", () => {
    expect(expectedProductionMemoryVersion()).toBe(MEMORY_VERSION);
    expect(expectedProductionMemoryVersion()).toBeGreaterThan(0);
  });
});
