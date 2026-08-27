# Survival traffic bench

Use the browser Simulation / Survival room as a fast correctness lab for traffic behavior. The simulator executes the script in the browser, so its CPU values are not comparable to PTR/MMO. Use this bench for movement correctness, then use PTR for server-runtime CPU benchmarking.

## Commands

Load the current `main` bundle in Survival, then use the Simulation console:

```js
simTraffic.scenarios()
// "headOn | funnel | crossing"

simTraffic.start("headOn")
simTraffic.status()
simTraffic.stop()
```

The harness only activates in the Simulation room (`Game.rooms.sim`). While a scenario is active it bypasses normal colony planning and controls only creeps whose names begin with `simTraffic-`.

## Scenarios

### `headOn`

Two `[MOVE]` creeps stage at opposite ends of an automatically discovered 11-tile open lane, then exchange destinations with different movement priorities. This stresses direct head-on congestion and swap behavior.

### `funnel`

Three `[MOVE]` creeps approach from left, top, and bottom and converge through the same central region before splitting into three nearby destinations. This stresses merge/funnel congestion.

### `crossing`

Four `[MOVE]` creeps stage at the four cardinal ends of the arena and travel to the opposite side. This creates simultaneous crossing traffic through the same center.

## Results

`simTraffic.status()` reports cumulative movement metrics:

- movement requests
- cached-path attempts
- fresh path finds
- congestion-triggered repaths
- stuck requests
- fatigue waits
- intentional contention yields
- head-on swap attempts
- successful head-on swaps

`contentionYields` counts lower-priority movement requests that deliberately wait because a higher-priority request reserved the same direct next tile. It is an observability metric, not a guarded optimization target: some yielding is the desired behavior when it prevents false stuck debt and unnecessary repathing.

The stress phase has bounded deadlines. A scenario ends in `complete` when every participant reaches its goal, or `failed` if it exceeds its deadline.

The harness persists state in `Memory.simTraffic`, so browser-simulator global resets do not erase an in-progress scenario. The debug globals are reinstalled whenever the script global is recreated.

## Testing contract

Simulation answers: **does traffic coordination behave correctly under stress?**

PTR answers: **what does that behavior cost on the real server runtime?**

Do not compare Simulation CPU numbers with PTR/MMO CPU measurements.

## References

- Official debugging docs: https://docs.screeps.com/debugging.html
- Community simulator notes: https://wiki.screepspl.us/Sim/
- Community pathfinding maturity guidance: https://wiki.screepspl.us/Maturity_Matrix/
