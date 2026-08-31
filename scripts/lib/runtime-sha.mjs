import { execFileSync } from "node:child_process";

const FULL_SHA = /^[0-9a-f]{40}$/i;

export function resolveProofRuntimeSha({
  environment = process.env,
  runGit = (args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim(),
} = {}) {
  const configured = environment.SCREEPS_RUNTIME_SHA || environment.GITHUB_SHA;
  if (configured) {
    if (!FULL_SHA.test(configured)) {
      throw new Error("Configured runtime SHA must contain exactly 40 hexadecimal characters");
    }
    return configured.toLowerCase();
  }

  if (runGit(["status", "--porcelain", "--untracked-files=normal"])) {
    throw new Error(
      "Cannot prove a runtime SHA from a dirty tree; set SCREEPS_RUNTIME_SHA explicitly for this exact candidate build",
    );
  }
  const sha = runGit(["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(sha)) {
    throw new Error("Git did not resolve a full 40-character runtime SHA");
  }
  return sha.toLowerCase();
}
