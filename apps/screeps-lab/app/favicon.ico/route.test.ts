import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("favicon route", () => {
  it("serves a cacheable icon instead of a first-load 404", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toContain("<svg");
  });
});
