const eventName = process.env.GITHUB_EVENT_NAME || "workflow_dispatch";
const commentBody = process.env.SCREEPS_REQUEST || "";
const commentId = process.env.SCREEPS_COMMENT_ID || "";
const inputRoom = process.env.SCREEPS_INPUT_ROOM || "";
const inputShard = process.env.SCREEPS_INPUT_SHARD || "";
const runId = process.env.GITHUB_RUN_ID || "manual";
const outputPath = process.env.GITHUB_OUTPUT;

const roomPattern = /^[WE]\d+[NS]\d+$/i;
const shardPattern = /^shard\d+$/i;

const fail = (message) => {
  throw new Error(`Invalid Screeps insights request: ${message}`);
};

const normalizeRoom = (value) => {
  if (!value) return "";
  if (!roomPattern.test(value)) fail(`invalid room '${value}'`);
  return value.toUpperCase();
};

const normalizeShard = (value) => {
  if (!value) return "";
  if (!shardPattern.test(value)) fail(`invalid shard '${value}'`);
  return value.toLowerCase();
};

let requestId;
let room = "";
let sector = "";
let shard = "";
let mode = "collect";
let command = "/collect";

if (eventName === "issue_comment") {
  if (!/^\d+$/.test(commentId)) fail("missing immutable issue comment id");
  requestId = commentId;

  const tokens = commentBody.trim().split(/\s+/).filter(Boolean);
  const commandToken = tokens[0];
  if (!["/collect", "/scan", "/recommend-start"].includes(commandToken)) {
    fail("command must begin with exactly /collect, /scan, or /recommend-start");
  }

  mode =
    commandToken === "/scan"
      ? "scan"
      : commandToken === "/recommend-start"
        ? "recommend"
        : "collect";

  const args = new Map();
  for (const token of tokens.slice(1)) {
    const match = token.match(/^([a-z]+)=(.+)$/i);
    if (!match) fail(`unexpected token '${token}'`);

    const key = match[1].toLowerCase();
    const value = match[2];
    const allowed =
      mode === "scan" ? ["sector", "shard"] : mode === "recommend" ? ["shard"] : ["room", "shard"];
    if (!allowed.includes(key)) fail(`unknown key '${key}' for ${commandToken}`);
    if (args.has(key)) fail(`duplicate key '${key}'`);
    args.set(key, value);
  }

  shard = normalizeShard(args.get("shard") || "");

  if (mode === "scan") {
    sector = normalizeRoom(args.get("sector") || "");
    if (!sector) fail("/scan requires sector=<ROOM>");
    command = ["/scan", `sector=${sector}`, shard && `shard=${shard}`]
      .filter(Boolean)
      .join(" ");
  } else if (mode === "recommend") {
    command = ["/recommend-start", shard && `shard=${shard}`].filter(Boolean).join(" ");
  } else {
    room = normalizeRoom(args.get("room") || "");
    if (shard && !room) fail("shard requires room");
    command = ["/collect", room && `room=${room}`, shard && `shard=${shard}`]
      .filter(Boolean)
      .join(" ");
  }
} else {
  requestId = runId;
  room = normalizeRoom(inputRoom.trim());
  shard = normalizeShard(inputShard.trim());
  if (shard && !room) fail("shard requires room");
  command = ["/collect", room && `room=${room}`, shard && `shard=${shard}`]
    .filter(Boolean)
    .join(" ");
}

const marker = `<!-- screeps-insights-request:${requestId}:complete -->`;
const artifactName = `screeps-insights-request-${requestId}`;

if (!outputPath) fail("GITHUB_OUTPUT is unavailable");

const lines = [
  `request_id=${requestId}`,
  `mode=${mode}`,
  `room=${room}`,
  `sector=${sector}`,
  `shard=${shard}`,
  `command=${command}`,
  `marker=${marker}`,
  `artifact_name=${artifactName}`,
];

const { appendFile } = await import("node:fs/promises");
await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");

console.log(`Validated insights request ${requestId}: ${command}`);
