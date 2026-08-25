# Logistics Model

Screeps 2026 treats logistics as derived resource flow rather than permanent creep roles.

## Reference patterns

The design intentionally synthesizes mature Screeps patterns:

- source-edge specialization: producer -> container/link -> carrier
- mission cohesion: source harvesting and transport demand are planned together
- generalized transport: transporters are selected from current resource demand rather than fixed identities

## Bootstrap phases

1. Generalist fallback: collect until full, deliver until empty.
2. Buffered source: activate planned source containers once RCL2 and workforce stability justify the capital cost.
3. Derived allocation: assign one best producer to each buffered source and use remaining CARRY-capable creeps as transporters.
4. Throughput sizing: compare route production against available carry throughput and let spawning close the deficit.

Assignments are recomputed from world state. Creep identity is not strategic state.
