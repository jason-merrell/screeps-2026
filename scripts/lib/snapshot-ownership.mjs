const neutralStructureTypes = new Set(["road", "container", "constructedWall"]);

/**
 * Snapshot ownership is tri-state. Roads and containers are public game-world
 * infrastructure, so reporting them as colony-owned would manufacture evidence.
 */
export const snapshotOwnership = (object, controllerUser) => {
  if (!object || typeof object !== "object") return null;
  if (neutralStructureTypes.has(object.type)) return null;
  if (typeof object.user !== "string" || typeof controllerUser !== "string") {
    return null;
  }
  return object.user === controllerUser;
};

export const isOwnedSnapshotObject = (object, controllerUser) =>
  snapshotOwnership(object, controllerUser) === true;
