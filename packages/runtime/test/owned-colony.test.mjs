import { describe, expect, it } from "vitest";
import { findOwnedSpawnInObjects } from "../../../scripts/lib/owned-colony.mjs";

describe("owned colony discovery", () => {
  it("adopts a spawn owned by the same user as the room controller", () => {
    const result = findOwnedSpawnInObjects([
      { type: "controller", x: 35, y: 23, user: "user-a", level: 1 },
      { type: "spawn", name: "PTR-old-request", x: 33, y: 15, user: "user-a" },
      { type: "spawn", name: "Foreign", x: 10, y: 10, user: "user-b" },
    ]);

    expect(result).toEqual({
      name: "PTR-old-request",
      x: 33,
      y: 15,
      user: "user-a",
      controller: { x: 35, y: 23, level: 1, user: "user-a" },
    });
  });

  it("prefers the current request spawn when it is present", () => {
    const result = findOwnedSpawnInObjects(
      [
        { type: "controller", x: 20, y: 20, user: "user-a", level: 2 },
        { type: "spawn", name: "PTR-old", x: 10, y: 10, user: "user-a" },
        { type: "spawn", name: "PTR-current", x: 11, y: 11, user: "user-a" },
      ],
      "PTR-current",
    );

    expect(result?.name).toBe("PTR-current");
  });

  it("rejects a spawn whose owner does not match the owned controller", () => {
    const result = findOwnedSpawnInObjects([
      { type: "controller", x: 20, y: 20, user: "user-a", level: 1 },
      { type: "spawn", name: "Foreign", x: 10, y: 10, user: "user-b" },
    ]);

    expect(result).toBeNull();
  });
});
