import { describe, expect, it, vi } from "vitest";
import { activatePtrRuntime } from "../../../scripts/lib/ptr-activation.mjs";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("PTR runtime activation", () => {
  it("activates PTR and verifies the resulting world status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: 1, result: { nModified: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1, status: "normal" }));

    await expect(
      activatePtrRuntime({
        token: "test-token",
        host: "https://example.invalid/base",
        fetchImpl,
      }),
    ).resolves.toEqual({ activationAccepted: true, status: "normal" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0].href).toBe(
      "https://example.invalid/ptr/api/user/activate-ptr",
    );
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
      headers: { "X-Token": "test-token" },
    });
    expect(fetchImpl.mock.calls[1][0].href).toBe(
      "https://example.invalid/ptr/api/user/world-status",
    );
  });

  it("fails before reading status when activation is rejected", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: 0, error: "rejected" }, 403));

    await expect(
      activatePtrRuntime({ token: "test-token", fetchImpl }),
    ).rejects.toThrow("PTR activation failed (403)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when world status is missing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));

    await expect(
      activatePtrRuntime({ token: "test-token", fetchImpl }),
    ).rejects.toThrow("PTR world status response omitted status");
  });

  it.each(["empty", "lost", "maintenance"])(
    "rejects %s world status after accepted activation",
    async (status) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ ok: 1, result: { nModified: 0 } }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: 1, status }));

      await expect(
        activatePtrRuntime({ token: "test-token", fetchImpl }),
      ).rejects.toThrow(
        `PTR world status is '${status}', expected 'normal' after activation`,
      );
    },
  );

  it("rejects an empty HTTP 200 activation response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null));

    await expect(
      activatePtrRuntime({ token: "test-token", fetchImpl }),
    ).rejects.toThrow("PTR activation failed (200)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects world status without an explicit API acknowledgement", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: 1, result: { nModified: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ status: "normal" }));

    await expect(
      activatePtrRuntime({ token: "test-token", fetchImpl }),
    ).rejects.toThrow("PTR world status failed (200)");
  });

  it("requires a token without making a request", async () => {
    const fetchImpl = vi.fn();

    await expect(activatePtrRuntime({ token: "", fetchImpl })).rejects.toThrow(
      "SCREEPS_TOKEN is required for PTR activation",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
