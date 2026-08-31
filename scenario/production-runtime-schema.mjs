import { MEMORY_VERSION } from "../packages/runtime/src/memory/schema.ts";

export function expectedProductionMemoryVersion() {
  if (!Number.isInteger(MEMORY_VERSION) || MEMORY_VERSION < 1) {
    throw new Error(
      `Runtime MEMORY_VERSION must be a positive integer; received ${String(MEMORY_VERSION)}`,
    );
  }
  return MEMORY_VERSION;
}
