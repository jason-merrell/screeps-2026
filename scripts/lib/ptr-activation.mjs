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

export async function activatePtrRuntime({
  token,
  host = "https://screeps.com",
  fetchImpl = fetch,
}) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("SCREEPS_TOKEN is required for PTR activation");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("PTR activation requires a fetch implementation");
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
  const activationResponse = await fetchImpl(activationUrl, {
    method: "POST",
    headers,
    body: "{}",
  });
  const activationBody = await parseResponseBody(
    activationResponse,
    "PTR activation",
  );
  assertSuccessfulResponse(
    activationResponse,
    activationBody,
    "PTR activation",
  );

  const statusResponse = await fetchImpl(statusUrl, { headers });
  const statusBody = await parseResponseBody(
    statusResponse,
    "PTR world status",
  );
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
