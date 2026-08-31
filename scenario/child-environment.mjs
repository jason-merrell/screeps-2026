const SAFE_HOST_ENVIRONMENT_KEYS = Object.freeze([
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "WINDIR",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "CI",
]);

/**
 * Native scenario children execute an intentionally isolated legacy private
 * server. Pass only host process mechanics plus explicit scenario inputs; do
 * not expose repository credentials, npm tokens, or deployment secrets.
 */
export function isolatedScenarioEnvironment(
  overrides,
  hostEnvironment = process.env,
) {
  const environment = { TZ: "UTC" };
  for (const key of SAFE_HOST_ENVIRONMENT_KEYS) {
    const value = hostEnvironment[key];
    if (typeof value === "string" && value.length > 0) environment[key] = value;
  }
  return { ...environment, ...overrides };
}
