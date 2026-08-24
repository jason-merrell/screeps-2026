export type Capability = "harvest" | "haul" | "build" | "repair" | "upgrade" | "combat" | "heal" | "claim";

export function capabilitiesOf(creep: Creep): Set<Capability> {
  const active = (part: BodyPartConstant) => creep.getActiveBodyparts(part) > 0;
  const capabilities = new Set<Capability>();

  if (active(WORK)) {
    capabilities.add("harvest");
    capabilities.add("build");
    capabilities.add("repair");
    capabilities.add("upgrade");
  }
  if (active(CARRY)) capabilities.add("haul");
  if (active(ATTACK) || active(RANGED_ATTACK)) capabilities.add("combat");
  if (active(HEAL)) capabilities.add("heal");
  if (active(CLAIM)) capabilities.add("claim");

  return capabilities;
}
