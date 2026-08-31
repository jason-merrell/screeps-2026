import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const collectorPath = path.join(repositoryRoot, "scripts/collect-insights.mjs");

const ROOM = "E52N38";
const SHARD = "shard3";
const OTHER_SHARD = "shard2";
const ACCOUNT_ID = "ptr-account-id";
const RUNTIME_SHA = "0123456789abcdef0123456789abcdef01234567";
const AUTH_EMAIL_CANARY = "auth-private-canary@example.invalid";
const AUTH_NESTED_CANARY = "AUTH_NESTED_PRIVATE_CANARY";
const BRANCH_ID_CANARY = "BRANCH_PRIVATE_ID_CANARY";
const BRANCH_MODULE_CANARY = "BRANCH_MODULE_PRIVATE_CANARY";
const BRANCH_PRIVATE_CANARY = "BRANCH_NESTED_PRIVATE_CANARY";
const PRIVATE_CANARIES = [
  AUTH_EMAIL_CANARY,
  AUTH_NESTED_CANARY,
  BRANCH_ID_CANARY,
  BRANCH_MODULE_CANARY,
  BRANCH_PRIVATE_CANARY,
];

const json = (response, body, status = 200) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
};

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const locateCanaries = (value, pathLabel = "$", hits = []) => {
  if (typeof value === "string") {
    for (const canary of PRIVATE_CANARIES) {
      if (value.includes(canary)) hits.push(`${pathLabel}: ${canary}`);
    }
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      locateCanaries(child, `${pathLabel}[${index}]`, hits);
    });
    return hits;
  }
  if (value === null || typeof value !== "object") return hits;

  for (const [key, child] of Object.entries(value)) {
    for (const canary of PRIVATE_CANARIES) {
      if (key.includes(canary)) hits.push(`${pathLabel}.${key}: ${canary}`);
    }
    locateCanaries(child, `${pathLabel}.${key}`, hits);
  }
  return hits;
};

describe("PTR insights collection contract", () => {
  it("keeps explicit shard evidence atomic and recursively redacts API canaries", async () => {
    const requests = [];
    const encodedMemoryVersion = `gz:${gzipSync(Buffer.from("10")).toString(
      "base64",
    )}`;
    const observability = JSON.stringify({
      version: 1,
      tick: 999,
      runtimeSha: RUNTIME_SHA,
      memoryVersion: 10,
      cpu: { limit: 50, bucket: 9_000, total: 2.5 },
      settlement: {
        plans: [
          {
            roomName: ROOM,
            development: { evaluatedAt: 999 },
          },
        ],
      },
    });

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const query = Object.fromEntries(url.searchParams.entries());
      requests.push({
        method: request.method,
        pathname: url.pathname,
        query,
        token: request.headers["x-token"],
      });

      switch (url.pathname) {
        case "/ptr/api/auth/me":
          json(response, {
            ok: 1,
            _id: ACCOUNT_ID,
            username: "operator",
            email: AUTH_EMAIL_CANARY,
            password: true,
            cpu: 50,
            cpuShard: { [SHARD]: 50 },
            cpuShardUpdatedTime: 1_000,
            subscription: false,
            promoPeriodUntil: Date.now() + 7 * 24 * 60 * 60 * 1_000,
            privateAccountState: {
              nested: AUTH_NESTED_CANARY,
            },
          });
          break;
        case "/ptr/api/user/world-status":
          json(response, { ok: 1, status: "normal" });
          break;
        case "/ptr/api/user/world-start-room":
          json(response, { ok: 1, room: [] });
          break;
        case "/ptr/api/user/rooms":
          json(response, {
            ok: 1,
            shards: {
              [SHARD]: [ROOM],
              [OTHER_SHARD]: [ROOM],
            },
            reservations: {},
          });
          break;
        case "/ptr/api/user/branches":
          json(response, {
            ok: 1,
            list: [
              {
                _id: BRANCH_ID_CANARY,
                branch: "default",
                activeWorld: true,
                activeSim: false,
                modules: {
                  main: `module.exports.loop = () => "${BRANCH_MODULE_CANARY}";`,
                },
                privateBranchState: {
                  nested: BRANCH_PRIVATE_CANARY,
                },
              },
            ],
          });
          break;
        case "/ptr/api/user/stats":
          json(response, { ok: 1, stats: {} });
          break;
        case "/ptr/api/game/time":
          json(response, { ok: 1, time: 1_000 });
          break;
        case "/ptr/api/user/memory":
          json(response, { ok: 1, data: encodedMemoryVersion });
          break;
        case "/ptr/api/user/memory-segment":
          json(response, { ok: 1, data: observability });
          break;
        case "/ptr/api/game/room-status":
          json(response, { ok: 1, status: "normal" });
          break;
        case "/ptr/api/game/room-overview":
          json(response, { ok: 1, stats: {} });
          break;
        case "/ptr/api/game/room-terrain":
          json(response, {
            ok: 1,
            terrain: [{ room: ROOM, terrain: "0".repeat(2_500) }],
          });
          break;
        case "/ptr/api/game/room-objects":
          json(response, {
            ok: 1,
            objects: [
              {
                _id: "controller-id",
                type: "controller",
                room: ROOM,
                user: query.shard === SHARD ? ACCOUNT_ID : "other-account-id",
                level: 8,
                x: 25,
                y: 25,
              },
            ],
          });
          break;
        default:
          json(
            response,
            { ok: 0, error: `unexpected route ${url.pathname}` },
            404,
          );
      }
    });

    const directory = await mkdtemp(
      path.join(tmpdir(), "screeps-ptr-collector-contract-"),
    );

    try {
      await listen(server);
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("mock Screeps server did not expose a TCP port");
      }

      let childResult;
      try {
        childResult = await execFileAsync(process.execPath, [collectorPath], {
          cwd: directory,
          env: {
            ...process.env,
            SCREEPS_TOKEN: "test-token",
            SCREEPS_HOST: `http://127.0.0.1:${address.port}`,
            SCREEPS_TARGET: "ptr",
            SCREEPS_ROOM: ROOM,
            SCREEPS_REQUESTED_SHARD: SHARD,
            SCREEPS_SHARD: "shard0",
            SCREEPS_BRANCH: "default",
            SCREEPS_EXPECTED_RUNTIME_SHA: RUNTIME_SHA,
            SCREEPS_EXPECTED_MEMORY_VERSION: "10",
            SCREEPS_OBSERVABILITY_SEGMENT: "99",
            SCREEPS_REQUEST_ID: "ptr-contract-test",
            SCREEPS_COMMAND: `/collect target=ptr room=${ROOM} shard=${SHARD}`,
          },
          timeout: 15_000,
          maxBuffer: 2 * 1024 * 1024,
        });
      } catch (error) {
        const stderr =
          error && typeof error === "object" && "stderr" in error
            ? String(error.stderr)
            : String(error);
        throw new Error(`collector process failed:\n${stderr}`);
      }

      expect(childResult.stderr).toBe("");
      const artifact = JSON.parse(
        await readFile(
          path.join(directory, "artifacts/screeps-insights.json"),
          "utf8",
        ),
      );

      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
      expect(
        requests.every(({ pathname }) => pathname.startsWith("/ptr/api/")),
      ).toBe(true);
      expect(requests.every(({ token }) => token === "test-token")).toBe(true);

      const oneRequest = (pathname) => {
        const matches = requests.filter(
          (request) => request.pathname === pathname,
        );
        expect(matches, `requests for ${pathname}`).toHaveLength(1);
        return matches[0];
      };

      expect(oneRequest("/ptr/api/user/rooms").query).toEqual({
        id: ACCOUNT_ID,
        interval: "8",
      });
      expect(oneRequest("/ptr/api/user/stats").query).toEqual({
        id: ACCOUNT_ID,
        interval: "8",
      });
      expect(oneRequest("/ptr/api/game/time").query).toEqual({ shard: SHARD });
      expect(oneRequest("/ptr/api/user/memory").query).toEqual({
        path: "version",
        shard: SHARD,
      });
      expect(oneRequest("/ptr/api/user/memory-segment").query).toEqual({
        segment: "99",
        shard: SHARD,
      });

      for (const pathname of [
        "/ptr/api/game/room-status",
        "/ptr/api/game/room-overview",
        "/ptr/api/game/room-terrain",
        "/ptr/api/game/room-objects",
      ]) {
        expect(oneRequest(pathname).query).toMatchObject({
          room: ROOM,
          shard: SHARD,
        });
      }
      expect(oneRequest("/ptr/api/game/room-terrain").query.encoded).toBe("1");
      expect(
        requests.filter(
          ({ query }) => query.room === ROOM && query.shard === OTHER_SHARD,
        ),
      ).toEqual([]);

      expect(artifact.runtimeReadiness).toMatchObject({
        status: "ready",
        expected: {
          room: ROOM,
          shard: SHARD,
          runtimeSha: RUNTIME_SHA,
          memoryVersion: 10,
        },
        evidence: {
          activeBranch: "default",
          roomListed: true,
          controllerOwned: true,
        },
      });
      expect(locateCanaries(artifact)).toEqual([]);
    } finally {
      if (server.listening) await close(server);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("World insights collection compatibility", () => {
  it("keeps World room and stats collection independent of auth/me", async () => {
    const requests = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push({
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
      });

      switch (url.pathname) {
        case "/api/user/world-status":
          json(response, { ok: 1, status: "normal" });
          break;
        case "/api/user/world-start-room":
          json(response, { ok: 1, room: [] });
          break;
        case "/api/user/rooms":
          json(response, { ok: 1, shards: { [SHARD]: [ROOM] } });
          break;
        case "/api/user/branches":
          json(response, {
            ok: 1,
            list: [
              {
                branch: "default",
                activeWorld: true,
                modules: { main: BRANCH_MODULE_CANARY },
              },
            ],
          });
          break;
        case "/api/user/stats":
          json(response, { ok: 1, stats: {} });
          break;
        case "/api/game/room-status":
          json(response, { ok: 1, status: "normal" });
          break;
        case "/api/game/room-overview":
          json(response, { ok: 1, stats: {} });
          break;
        case "/api/game/room-terrain":
          json(response, {
            ok: 1,
            terrain: [{ room: ROOM, terrain: "0".repeat(2_500) }],
          });
          break;
        case "/api/game/room-objects":
          json(response, { ok: 1, objects: [] });
          break;
        default:
          json(
            response,
            { ok: 0, error: `unexpected route ${url.pathname}` },
            404,
          );
      }
    });
    const directory = await mkdtemp(
      path.join(tmpdir(), "screeps-world-collector-contract-"),
    );

    try {
      await listen(server);
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("mock Screeps server did not expose a TCP port");
      }

      const childResult = await execFileAsync(
        process.execPath,
        [collectorPath],
        {
          cwd: directory,
          env: {
            ...process.env,
            SCREEPS_TOKEN: "test-token",
            SCREEPS_HOST: `http://127.0.0.1:${address.port}`,
            SCREEPS_TARGET: "world",
            SCREEPS_ROOM: ROOM,
            SCREEPS_REQUESTED_SHARD: SHARD,
            SCREEPS_REQUEST_ID: "world-contract-test",
            SCREEPS_COMMAND: `/collect room=${ROOM} shard=${SHARD}`,
          },
          timeout: 15_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );

      expect(childResult.stderr).toBe("");
      expect(requests.some(({ pathname }) => pathname === "/api/auth/me")).toBe(
        false,
      );
      expect(
        requests.find(({ pathname }) => pathname === "/api/user/rooms")?.query,
      ).toEqual({ interval: "8" });
      expect(
        requests.find(({ pathname }) => pathname === "/api/user/stats")?.query,
      ).toEqual({ interval: "8" });

      const artifact = JSON.parse(
        await readFile(
          path.join(directory, "artifacts/screeps-insights.json"),
          "utf8",
        ),
      );
      expect(artifact.target).toBe("world");
      expect(artifact.runtimeReadiness).toBeUndefined();
      expect(artifact.roomSnapshots[ROOM].shard).toBe(SHARD);
      expect(JSON.stringify(artifact)).not.toContain(BRANCH_MODULE_CANARY);
    } finally {
      if (server.listening) await close(server);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
