import { describe, expect, it } from "vitest";

import {
  isOwnedSnapshotObject,
  snapshotOwnership,
} from "../../../scripts/lib/snapshot-ownership.mjs";

describe("snapshot tri-state ownership", () => {
  it("never launders neutral road, container, or wall evidence as colony ownership", () => {
    expect(snapshotOwnership({ type: "road" }, "operator")).toBeNull();
    expect(
      snapshotOwnership({ type: "container", user: "operator" }, "operator"),
    ).toBeNull();
    expect(isOwnedSnapshotObject({ type: "road" }, "operator")).toBe(false);
    expect(
      snapshotOwnership(
        { type: "constructedWall", user: "operator" },
        "operator",
      ),
    ).toBeNull();
  });

  it("distinguishes colony, foreign, and unverifiable user-bearing objects", () => {
    expect(
      snapshotOwnership({ type: "tower", user: "operator" }, "operator"),
    ).toBe(true);
    expect(
      snapshotOwnership({ type: "tower", user: "invader" }, "operator"),
    ).toBe(false);
    expect(snapshotOwnership({ type: "tower" }, "operator")).toBeNull();
  });

  it("classifies construction-site users rather than their target structure type", () => {
    expect(
      snapshotOwnership(
        { type: "constructionSite", structureType: "road", user: "operator" },
        "operator",
      ),
    ).toBe(true);
    expect(
      snapshotOwnership(
        { type: "constructionSite", structureType: "road", user: "invader" },
        "operator",
      ),
    ).toBe(false);
  });
});
