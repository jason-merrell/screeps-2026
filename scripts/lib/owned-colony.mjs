export const findOwnedSpawnInObjects = (objects, preferredName = "") => {
  if (!Array.isArray(objects)) return null;

  const controller = objects.find(
    (object) =>
      object?.type === "controller" &&
      typeof object.user === "string" &&
      object.user.length > 0,
  );
  if (!controller) return null;

  const spawns = objects.filter(
    (object) =>
      object?.type === "spawn" &&
      typeof object.user === "string" &&
      object.user === controller.user,
  );
  if (spawns.length === 0) return null;

  const spawn = spawns.find((candidate) => candidate.name === preferredName) || spawns[0];
  return {
    name: spawn.name,
    x: spawn.x,
    y: spawn.y,
    user: spawn.user,
    controller: {
      x: controller.x,
      y: controller.y,
      level: controller.level ?? null,
      user: controller.user,
    },
  };
};
