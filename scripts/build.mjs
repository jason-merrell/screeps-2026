import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  sourcemap: true,
  minify: false,
  logLevel: "info",
});
