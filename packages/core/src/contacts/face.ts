/*
 * The name a contact reads for this owner. Once the group has a Bots host
 * (`Group.botsHome`), the whole group is one Boite to a contact, named after
 * the group: no machine of it ever gives its own host name. Without one, a
 * machine is still a machine, as before.
 */
import type { Core } from '../core.ts';

/** The group's name while it has a Bots host, or undefined. */
export function groupFace(core: Core): string | undefined {
  const roster = core.group.roster;
  if (roster === null || core.group.roleOf('botsHome') === null) return undefined;
  return roster.name.trim().slice(0, 100) || undefined;
}

/** The name contact-facing answers give this core: the group's with a Bots host, this machine's otherwise. */
export function contactFace(core: Core): string {
  return groupFace(core) ?? (core.info().hostname ?? 'Boite').slice(0, 100);
}
