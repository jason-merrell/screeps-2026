import { activatePtrRuntime } from "./lib/ptr-activation.mjs";

const target = (process.env.SCREEPS_TARGET || "ptr").toLowerCase();
if (target !== "ptr") {
  throw new Error(`PTR activation refuses target '${target}'`);
}

const result = await activatePtrRuntime({
  token: process.env.SCREEPS_TOKEN,
  host: process.env.SCREEPS_HOST || "https://screeps.com",
});

console.log(
  `PTR activation request accepted; world status '${result.status}'.`,
);
