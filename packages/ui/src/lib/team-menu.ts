/*
 * A team's menu, wherever its picture or its chat's head draws it: edit the
 * team (name, brief, members), pause or resume it, archive or restore it,
 * each through the owner method the core already has. A paired phone shows
 * the items greyed, with why: changing a team stays on the computer.
 */

import { Archive, ArchiveRestore, Pause, PenLine, Play } from '@lucide/svelte';
import type { Team } from '@boite/contracts';
import { confirm } from './confirm.svelte';
import { separator, type MenuItem } from './menu';
import type { Store } from './store.svelte';
import { fill, strings } from './strings';
import { teamsOf } from './teams.svelte';

/** The items of `team`'s menu on `store`, its machine. */
export function teamMenuItems(store: Store, team: Team): MenuItem[] {
  const labels = strings.teamChat;
  const guest = !store.owner;
  const off = (item: MenuItem): MenuItem => guest ? { ...item, disabled: true, title: labels.onComputer } : item;
  const edit = off({ id: 'edit', label: labels.edit, glyph: PenLine, ...(guest ? { hint: labels.onComputer } : {}) });
  // An archived team still takes out a member whose bot is gone; restoring it no longer waits for that (`docs/internals/teams.md`).
  if (team.archived) return [edit, off({ id: 'restore', label: labels.restore, glyph: ArchiveRestore })];
  return [
    edit,
    off(team.paused ? { id: 'resume', label: labels.resume, glyph: Play } : { id: 'pause', label: labels.pause, glyph: Pause }),
    separator(),
    off({ id: 'archive', label: labels.archive, glyph: Archive, danger: true }),
  ];
}

/**
 * Runs a pick of `teamMenuItems` other than Edit, which the caller opens, on `store`, the team's machine. Archive asks
 * first. A failure is reported as a minor error; the machine's teams are read again either way.
 */
export async function pickTeamAction(store: Store, team: Team, id: string): Promise<void> {
  const labels = strings.teamChat;
  const client = store.client;
  if (!store.owner) return;
  if (!client) { store.reportError(new Error(strings.connection.unavailable), 'minor'); return; }
  try {
    if (id === 'pause' || id === 'resume') await client.call('teams.pause', { teamId: team.id, paused: id === 'pause' });
    else if (id === 'restore') await client.call('teams.archive', { teamId: team.id, archived: false });
    else if (id === 'archive') {
      const sure = await confirm.ask({ title: fill(labels.archiveTitle, { team: team.name }), body: labels.archiveBody, confirmLabel: labels.archive, cancelLabel: strings.common.cancel, danger: true });
      if (sure) await client.call('teams.archive', { teamId: team.id, archived: true });
    } else return;
  } catch (error) {
    store.reportError(error, 'minor');
  } finally {
    void teamsOf(store).refresh();
  }
}
