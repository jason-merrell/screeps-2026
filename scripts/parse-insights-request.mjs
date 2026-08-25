const eventName = process.env.GITHUB_EVENT_NAME || "workflow_dispatch";
const commentBody = process.env.SCREEPS_REQUEST || "";
const commentId = process.env.SCREEPS_COMMENT_ID || "";
const inputRoom = process.env.SCREEPS_INPUT_ROOM || "";
const inputShard = process.env.SCREEPS_INPUT_SHARD || "";
const runId = process.env.GITHUB_RUN_ID || "manual";
const outputPath = process.env.GITHUB_OUTPUT;

const roomPattern = /^[WE]\d+[NS]\d+$/i;
const shardPattern = /^shard\d+$/i;
const scenarioNames = new Set(["head-on", "funnel", "crossing", "traffic-suite"]);

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

const normalizeTarget = (value, fallback = "world") => {
  const target = (value || fallback).toLowerCase();
  if (target !== "world" && target !== "ptr") fail(`invalid target '${target}'`);
  return target;
};

let requestId;
let room = "";
let sector = "";
let shard = "";
let target = "world";
let mode = "collect";
let experiment = "";
let scenario = "";
let command = "/collect";

if (eventName === "issue_comment") {
  if (!/^\d+$/.test(commentId)) fail("missing immutable issue comment id");
  requestId = commentId;

  const tokens = commentBody.trim().split(/\s+/).filter(Boolean);
  const commandToken = tokens[0];
  if (
    ![
      "/collect",
      "/scan",
      "/recommend-start",
      "/place-start",
      "/deploy-code",
      "/experiment",
      "/scenario",
      "/snapshot",
    ].includes(commandToken)
  ) {
    fail(
      "command must begin with exactly /collect, /scan, /recommend-start, /place-start, /deploy-code, /experiment, /scenario, or /snapshot",
    );
  }

  mode =
    commandToken === "/scan"
      ? "scan"
      : commandToken === "/recommend-start"
        ? "recommend"
        : commandToken === "/place-start"
          ? "place-start"
          : commandToken === "/deploy-code"
            ? "deploy-code"
            : commandToken === "/experiment"
              ? "experiment"
              : commandToken === "/scenario"
                ? "scenario"
                : commandToken === "/snapshot"
                  ? "snapshot"
                  : "collect";

  const args = new Map();
  for (const token of tokens.slice(1)) {
    const match = token.match(/^([a-z]+)=(.+)$/i);
    if (!match) fail(`unexpected token '${token}'`);

    const key = match[1].toLowerCase();
    const value = match[2];
    const allowed =
      mode === "scan"
        ? ["sector", "shard"]
        : mode === "recommend"
          ? ["shard"]
          : mode === "place-start"
            ? ["target", "shard"]
            : mode === "deploy-code"
              ? ["target"]
              : mode === "experiment"
                ? ["name", "target", "shard"]
                : mode === "scenario"
                  ? ["name"]
                  : mode === "snapshot"
                    ? ["room", "shard", "target"]
                    : ["room", "shard", "target"];
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
  } else if (mode === "place-start") {
    target = normalizeTarget(args.get("target") || "", "");
    command = ["/place-start", `target=${target}`, shard && `shard=${shard}`]
      .filter(Boolean)
      .join(" ");
  } else if (mode === "deploy-code") {
    target = normalizeTarget(args.get("target") || "", "");
    command = `/deploy-code target=${target}`;
  } else if (mode === "experiment") {
    target = normalizeTarget(args.get("target") || "", "");
    if (target !== "ptr") {
      fail("/experiment currently requires target=ptr; experiments cannot mutate or observe World");
    }
    experiment = (args.get("name") || "").toLowerCase();
    if (experiment !== "bootstrap-rcl3") {
      fail("/experiment currently requires name=bootstrap-rcl3");
    }
    command = [
      "/experiment",
      `name=${experiment}`,
      "target=ptr",
      shard && `shard=${shard}`,
    ]
      .filter(Boolean)
      .join(" ");
  } else if (mode === "scenario") {
    scenario = (args.get("name") || "").toLowerCase();
    if (!scenarioNames.has(scenario)) {
      fail("/scenario requires name=head-on, name=funnel, name=crossing, or name=traffic-suite");
    }
    target = "headless";
    command = `/scenario name=${scenario}`;
  } else if (mode === "snapshot") {
    room = normalizeRoom(args.get("room") || "");
    shard = normalizeShard(args.get("shard") || "");
    target = normalizeTarget(args.get("target") || "", "");
    if (!room) fail("/snapshot requires room=<ROOM>");
    if (!shard) fail("/snapshot requires shard=<SHARD>");
    if (target !== "ptr") {
      fail("/snapshot currently requires target=ptr while the control-plane contract is proven on PTR");
    }
    command = ["/snapshot", "target=ptr", `room=${room}`, `shard=${shard}`].join(" ");
  } else {
    room = normalizeRoom(args.get("room") || "");
    target = normalizeTarget(args.get("target") || "world");
    if (shard && !room) fail("shard requires room");
    command = [
      "/collect",
      target !== "world" && `target=${target}`,
      room && `room=${room}`,
      shard && `shard=${shard}`,
    ]
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
  `target=${target}`,
  `experiment=${experiment}`,
  `scenario=${scenario}`,
  `command=${command}`,
  `marker=${marker}`,
  `artifact_name=${artifactName}`,
];

const { appendFile } = await import("node:fs/promises");
await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");

console.log(`Validated insights request ${requestId}: ${command}`);
