const parseResponseBody = async (response, label) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON (${response.status})`);
  }
};

const assertSuccessfulResponse = (response, body, label) => {
  const hasExplicitError =
    body !== null &&
    typeof body === "object" &&
    Object.hasOwn(body, "error") &&
    body.error !== null &&
    body.error !== "";
  if (!response.ok || body?.ok !== 1 || hasExplicitError) {
    throw new Error(`${label} failed (${response.status})`);
  }
};

export const DEFAULT_PTR_REQUEST_TIMEOUT_MS = 10_000;

const requestWithDeadline = async ({
  url,
  init,
  label,
  fetchImpl,
  requestTimeoutMs,
}) => {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId;
  const request = (async () => {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await parseResponseBody(response, label);
    return { response, body };
  })();
  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new Error(`${label} timed out after ${requestTimeoutMs} milliseconds`),
      );
    }, requestTimeoutMs);
  });

  try {
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `${label} timed out after ${requestTimeoutMs} milliseconds`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export async function activatePtrRuntime({
  token,
  host = "https://screeps.com",
  fetchImpl = fetch,
  requestTimeoutMs = DEFAULT_PTR_REQUEST_TIMEOUT_MS,
}) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("SCREEPS_TOKEN is required for PTR activation");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("PTR activation requires a fetch implementation");
  }
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 60_000
  ) {
    throw new Error(
      "PTR activation request timeout must be an integer from 1 through 60000 milliseconds",
    );
  }

  let activationUrl;
  let statusUrl;
  try {
    activationUrl = new URL("/ptr/api/user/activate-ptr", host);
    statusUrl = new URL("/ptr/api/user/world-status", host);
  } catch {
    throw new Error("SCREEPS_HOST must be an absolute URL");
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "X-Token": token,
  };
  const {
    response: activationResponse,
    body: activationBody,
  } = await requestWithDeadline({
    url: activationUrl,
    init: {
      method: "POST",
      headers,
      body: "{}",
    },
    label: "PTR activation",
    fetchImpl,
    requestTimeoutMs,
  });
  assertSuccessfulResponse(
    activationResponse,
    activationBody,
    "PTR activation",
  );

  const { response: statusResponse, body: statusBody } =
    await requestWithDeadline({
      url: statusUrl,
      init: { headers },
      label: "PTR world status",
      fetchImpl,
      requestTimeoutMs,
    });
  assertSuccessfulResponse(statusResponse, statusBody, "PTR world status");
  if (
    typeof statusBody?.status !== "string" ||
    statusBody.status.length === 0
  ) {
    throw new Error("PTR world status response omitted status");
  }
  if (statusBody.status !== "normal") {
    throw new Error(
      `PTR world status is '${statusBody.status}', expected 'normal' after activation`,
    );
  }

  return {
    activationAccepted: true,
    status: statusBody.status,
  };
}
