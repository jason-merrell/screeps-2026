import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const gitSha = () => {
  if (process.env.SCREEPS_RUNTIME_SHA) return process.env.SCREEPS_RUNTIME_SHA;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    const status = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      { encoding: "utf8" },
    );
    if (status.trim()) return null;
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};

const runtimeSha = gitSha();

await build({
  entryPoints: ["packages/runtime/src/main.ts"],
  outfile: "packages/runtime/dist/main.js",
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  sourcemap: true,
  minify: false,
  define: {
    __SCREEPS_RUNTIME_SHA__: JSON.stringify(runtimeSha),
    __SCREEPS_TEST_FAULT_FSPM_MAINTENANCE__: "false",
  },
  logLevel: "info",
});
