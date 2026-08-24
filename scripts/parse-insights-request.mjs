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
let shard = "";
let command = "/collect";

if (eventName === "issue_comment") {
  if (!/^\d+$/.test(commentId)) fail("missing immutable issue comment id");
  requestId = commentId;

  const tokens = commentBody.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] !== "/collect") fail("command must begin with exactly /collect");

  const args = new Map();
  for (const token of tokens.slice(1)) {
    const match = token.match(/^([a-z]+)=(.+)$/i);
    if (!match) fail(`unexpected token '${token}'`);

    const key = match[1].toLowerCase();
    const value = match[2];
    if (key !== "room" && key !== "shard") fail(`unknown key '${key}'`);
    if (args.has(key)) fail(`duplicate key '${key}'`);
    args.set(key, value);
  }

  room = normalizeRoom(args.get("room") || "");
  shard = normalizeShard(args.get("shard") || "");
  if (shard && !room) fail("shard requires room");

  command = ["/collect", room && `room=${room}`, shard && `shard=${shard}`]
    .filter(Boolean)
    .join(" ");
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
  `room=${room}`,
  `shard=${shard}`,
  `command=${command}`,
  `marker=${marker}`,
  `artifact_name=${artifactName}`,
];

const { appendFile } = await import("node:fs/promises");
await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");

console.log(`Validated insights request ${requestId}: ${command}`);
