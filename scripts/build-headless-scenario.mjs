import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("scenario/dist", { recursive: true });

await build({
  entryPoints: ["src/scenarios/headless-traffic.ts"],
  outfile: "scenario/dist/main.js",
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});
