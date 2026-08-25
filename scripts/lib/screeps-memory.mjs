import { gunzipSync } from "node:zlib";

export function decodeScreepsMemory(body) {
  const data = body?.data;
  if (typeof data !== "string" || data.length === 0) return null;

  try {
    const json = data.startsWith("gz:")
      ? gunzipSync(Buffer.from(data.slice(3), "base64")).toString("utf8")
      : data;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function decodeScreepsSegment(body) {
  const data = body?.data;
  if (typeof data !== "string" || data.length === 0) return null;

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function summarizeMemoryResponse(response) {
  const data = response?.body?.data;
  return {
    ok: Boolean(response?.ok),
    status: response?.status ?? 0,
    hasData: typeof data === "string" && data.length > 0,
    dataPrefix: typeof data === "string" ? data.slice(0, 3) : null,
    dataLength: typeof data === "string" ? data.length : 0,
    bodyOk: response?.body?.ok ?? null,
    bodyError: response?.body?.error ?? null,
  };
}

export const summarizeSegmentResponse = summarizeMemoryResponse;
