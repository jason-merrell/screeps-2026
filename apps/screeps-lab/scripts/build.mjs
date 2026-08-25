import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const outputRoot = ".vercel/output";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

await rm(outputRoot, { recursive: true, force: true });
await mkdir(`${outputRoot}/static`, { recursive: true });
await cp("index.html", `${outputRoot}/static/index.html`);
await writeFile(
  `${outputRoot}/static/supabase-config.js`,
  `window.__SCREEPS_LAB_CONFIG__ = ${JSON.stringify({
    supabaseUrl,
    supabaseKey,
  })};\n`,
  "utf8",
);
await writeFile(
  `${outputRoot}/config.json`,
  `${JSON.stringify({ version: 3 }, null, 2)}\n`,
  "utf8",
);

console.log(
  `Built Screeps Lab control-plane shell (${supabaseUrl && supabaseKey ? "Supabase enabled" : "GitHub compatibility mode"}).`,
);
