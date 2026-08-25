import { build } from "esbuild";

await build({
  entryPoints: ["packages/runtime/src/main.ts"],
  outfile: "packages/runtime/dist/main.js",
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  sourcemap: true,
  minify: false,
  logLevel: "info",
});
