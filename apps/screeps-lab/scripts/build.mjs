import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const outputRoot = ".vercel/output";

await rm(outputRoot, { recursive: true, force: true });
await mkdir(`${outputRoot}/static`, { recursive: true });
await cp("index.html", `${outputRoot}/static/index.html`);
await writeFile(
  `${outputRoot}/config.json`,
  `${JSON.stringify({ version: 3 }, null, 2)}\n`,
  "utf8",
);

console.log("Built Screeps Lab control-plane shell.");
