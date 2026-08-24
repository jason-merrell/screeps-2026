# Spawn advisor

The spawn advisor ranks candidate tiles for a room using terrain-aware path cost and room geometry.

It is intentionally an on-demand console tool. It adds no per-tick planning work unless you call it.

## Initial spawn

Screeps requires the first spawn to be placed manually, and your code does not have object vision in an unowned room. Use the offline command with coordinates read from the world map:

```js
spawnAdvisorOffline(
  "W1N1",
  [
    [source1X, source1Y],
    [source2X, source2Y],
  ],
  [controllerX, controllerY],
  5,
);
```

The command uses `Game.map.getRoomTerrain(roomName)` for terrain and the supplied source/controller coordinates for anchor positions. It prints the top candidates and draws ranked circles with `RoomVisual`.

## Owned or visible rooms

Once the room is visible to your code, the advisor can discover sources and the controller automatically:

```js
spawnAdvisor("W1N1", 5);
```

## Score

Each candidate is scored from 0 to 100 using:

- 35% average terrain-aware access to energy sources
- 15% terrain-aware access to the controller
- 25% buildable terrain in a 9x9 neighborhood
- 15% distance from room edges
- 10% low-swamp terrain in a 7x7 neighborhood

Path scoring treats plains as cost 1, swamps as cost 5, and walls as impassable. The weights are an initial heuristic, not a permanent doctrine. Future room planning can evolve the model to include planned road topology, extension/storage footprints, mineral access, defensive perimeter cost, and traffic forecasts.
