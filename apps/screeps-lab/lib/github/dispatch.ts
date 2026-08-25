import { createSign } from "node:crypto";

const owner = "jason-merrell";
const repo = "screeps-2026";
const workflow = "screeps-observability.yml";

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function createAppJwt(appId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

async function createInstallationToken() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  const encodedPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();

  if (!appId || !installationId || !encodedPrivateKey) {
    return null;
  }

  const privateKey = Buffer.from(encodedPrivateKey, "base64").toString("utf8");
  const appJwt = createAppJwt(appId, privateKey);
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub installation token request failed: ${response.status}`);
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub installation token response omitted token");
  return body.token;
}

export async function wakeNativeSnapshotWorker() {
  const token = await createInstallationToken();
  if (!token) return false;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub workflow dispatch failed: ${response.status}`);
  }

  return true;
}
