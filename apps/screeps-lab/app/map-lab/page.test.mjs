import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const mapSource = readFileSync(
  new URL("../../components/strategic-room-map.tsx", import.meta.url),
  "utf8",
);

describe("map lab responsive and accessibility contracts", () => {
  it("uses a deliberate wide operator layout with state-aware navigation", () => {
    expect(pageSource).toContain("w-[min(1380px,calc(100vw-24px))]");
    expect(pageSource).toContain('layout="operator"');
    expect(pageSource).toContain(
      'aria-current={mode === "current" ? "page" : undefined}',
    );
    expect(pageSource).toContain(
      'aria-current={mode === "tampered" ? "page" : undefined}',
    );
    expect(pageSource).toContain("Development map · deterministic fixture");
  });

  it("keeps mobile state, layer, and zoom targets at least 44 pixels", () => {
    expect(pageSource).toContain("min-h-11");
    expect(mapSource).toContain("min-h-11");
    expect(mapSource).toContain("size-11");
    expect(mapSource).toContain("h-11");
    expect(mapSource).toContain("sm:min-h-9");
    expect(mapSource).toContain("sm:size-8");
  });

  it("keeps the actionable queue beside the map without changing fail-closed copy", () => {
    expect(mapSource).toContain(
      "xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.75fr)]",
    );
    expect(mapSource).toContain(
      "Withheld until runtime projection usability is current",
    );
    expect(mapSource).toContain(
      "Stale or invalid retained coordinates are never presented as an",
    );
  });
});
