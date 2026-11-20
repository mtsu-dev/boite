/**
 * `boite state`: what the user sees in Boite, read-only (docs/internals/cli.md#state).
 * Settings come from `agent.settings` with what each does (`SETTING_HELP`, the
 * English of the Settings pages); every other domain is one `agent.state` call.
 * `boite settings [page|key]` prints its rows through `settingsLines` too.
 */
import { SETTING_HELP, SETTINGS_PAGES, STATE_DOMAINS, isSettingsPage, isStateDomain, type SettingReading, type SettingsReading, type StateReading } from '@boite/contracts';
import { ShortUsage, Usage } from './cli-args.ts';
import type { CoreClient } from './client.ts';

type Printer = (lines: string[], value: unknown) => void;

/** The rows of `boite settings`, or only one page's or one key's; null when `filter` names neither. */
export function selectSettings(settings: readonly SettingReading[], filter: string | undefined): SettingReading[] | null {
  if (filter === undefined) return [...settings];
  const shown = isSettingsPage(filter) ? settings.filter(reading => reading.page === filter) : settings.filter(reading => reading.key === filter);
  return shown.length === 0 && !isSettingsPage(filter) ? null : shown;
}

/** One setting per line: key, value, page#card, the app's name for it; with `help`, what it does on the next line. */
export function settingsLines(shown: readonly SettingReading[], help: boolean): string[] {
  return shown.flatMap(reading => {
    const row = `${reading.key} ${JSON.stringify(reading.value)} ${reading.page}#${reading.section}${reading.label === undefined ? '' : ` ${JSON.stringify(reading.label)}`}${reading.sensitive ? ' (sensitive)' : ''}`;
    const text = help ? SETTING_HELP[reading.key] : undefined;
    return text === undefined ? [row] : [row, `    ${text}`];
  });
}

/** `settings` read through one path: unknown names fail the same way for `boite settings` and `boite state settings`. */
export async function readSettingsFor(client: CoreClient, threadId: string, filter: string | undefined, command: string): Promise<{ read: SettingsReading; shown: SettingReading[] }> {
  const read = await client.call('agent.settings', { threadId });
  const shown = selectSettings(read.settings, filter);
  if (shown === null) throw new Usage(`${command}: unknown key or page ${filter}; pages: ${SETTINGS_PAGES.join(', ')}; boite settings lists the keys`);
  return { read, shown };
}

const MB = 1024 * 1024;
const when = (at: number | null): string => (at === null ? 'never' : new Date(at).toISOString().replace(/\.\d+Z$/, 'Z'));
const memory = (bytes: number): string => `${Math.round(bytes / MB)} MB`;

/** The lines of one `agent.state` reading. */
function stateLines(reading: StateReading): string[] {
  switch (reading.domain) {
    case 'version': {
      const v = reading.version;
      return [`version: ${v.version}`, `channel: ${v.channel}${v.track === null ? '' : ` (updates: ${v.track})`}`, `platform: ${v.platform} ${v.arch}`, `build: ${v.build}${v.bun === null ? '' : `, Bun ${v.bun}`}`];
    }
    case 'limits':
      if (reading.limits.length === 0) return ['limits: no account reports a quota'];
      return reading.limits.map(limit => {
        const windows = limit.windows.map(window => `${window.label} ${Math.round(window.usedPercent)}%${window.resetsAt === null ? '' : ` resets ${when(window.resetsAt)}`}`).join('; ');
        return `${limit.provider} ${JSON.stringify(limit.account)}: ${limit.status}${limit.gateway ? ' via gateway' : ''}${windows ? `, ${windows}` : ''}${limit.error ? ` [${limit.error}]` : ''} (read ${when(limit.checkedAt)})`;
      });
    case 'machines':
      return reading.machines.map(machine => machine.kind === 'machine'
        ? `machine ${JSON.stringify(machine.name)}: ${machine.self ? 'this machine, online' : machine.reached ? 'online (answered since start)' : 'not reached since start'}${machine.os ? `, ${machine.os}` : ''}${machine.version ? `, ${machine.version}` : ''}`
        : `device ${JSON.stringify(machine.name)}: ${machine.current ? 'connected now' : `last seen ${when(machine.lastSeenAt)}`}${machine.version ? `, ${machine.version}` : ''}`);
    case 'updates': {
      const u = reading.updates;
      const app = (name: string, status: typeof u.server) => status === null ? [] : [`${name}: ${status.phase}${status.version ? ` ${status.version}` : ''}${status.error ? ` [${status.error}]` : ''}`];
      return [`version: ${u.version} (${u.channel})`, ...app('server update', u.server), ...app('desktop update', u.desktop),
        ...(u.agents.length === 0 ? ['agents: none installed'] : u.agents.map(agent => `${agent.provider}: ${agent.installed ?? 'unknown'}${agent.offered ? ` -> ${agent.available} available` : ''}, ${agent.state} (${agent.route})${agent.error ? ` [${agent.error}]` : ''}`))];
    }
    case 'inbox':
      if (reading.inbox.length === 0) return ['inbox: nothing needs the user'];
      return reading.inbox.map(row => `${row.nested ? '  under the row above: ' : ''}${row.threadId} ${row.section === 'needs' ? 'needs you' : 'update'}: ${row.kind}, ${JSON.stringify(row.title)}${row.project ? ` in ${row.project}` : ''} (${when(row.at)})`);
    case 'tasks':
      if (reading.tasks.length === 0) return ['tasks: no agent process runs'];
      return reading.tasks.map(task => `${task.threadId} ${JSON.stringify(task.title)}: ${task.processes} processes, ${memory(task.memoryBytes)}, ${Math.round(task.cpuPercent)}% CPU (${task.status})`);
    case 'route': {
      const r = reading.route;
      const gateway = r.gateway === null ? 'route: no subscription gateway; every agent reaches its provider directly'
        : `route: ${r.gateway.name} ${r.gateway.enabled ? 'in use' : 'configured, off'} (${r.gateway.mode}, ${r.gateway.origin})`;
      const served = r.providers.filter(provider => provider.viaGateway).map(provider => provider.id);
      return [gateway, `through it: ${served.length === 0 ? 'none' : served.join(', ')}`];
    }
    case 'summary': {
      const s = reading.summary;
      const top = s.limits.highest;
      return [
        `version: ${s.version.version} (${s.version.channel}, ${s.version.platform})`,
        `route: ${s.route.gateway === null ? 'direct, no gateway' : `${s.route.gateway} for ${s.route.providers} providers`}`,
        `machines: ${s.machines.online}/${s.machines.total} online, ${s.machines.devices} paired devices`,
        `updates: ${s.updates.failing} failing, ${s.updates.available} available`,
        `inbox: ${s.inbox.needs} need the user, ${s.inbox.updates} updates`,
        `limits: ${s.limits.accounts} accounts${top === null ? '' : `, highest ${top.provider} ${JSON.stringify(top.account)} ${top.label} ${Math.round(top.usedPercent)}%`}`,
        `tasks: ${s.tasks.processes} processes, ${memory(s.tasks.memoryBytes)}`,
      ];
    }
  }
}

/** The one usage line a wrong `boite state` prints, instead of the whole help. */
export const STATE_USAGE = `usage: boite state [settings [page|key]|${STATE_DOMAINS.filter(name => name !== 'summary').join('|')}] [--json]`;

export async function stateCommand(client: CoreClient, threadId: string, rest: string[], print: Printer): Promise<void> {
  const [domain, filter] = rest;
  if (domain === 'settings') {
    if (rest.length > 2) throw new ShortUsage(STATE_USAGE);
    const { read, shown } = await readSettingsFor(client, threadId, filter, 'state settings');
    const value = { app: read.app, settings: shown.map(reading => ({ ...reading, ...(SETTING_HELP[reading.key] === undefined ? {} : { help: SETTING_HELP[reading.key] }) })) };
    print(shown.length === 0 ? [`settings: page ${filter} has no setting an agent reads`] : settingsLines(shown, true), value);
    return;
  }
  const wanted = domain ?? 'summary';
  if (!isStateDomain(wanted) || rest.length > 1) throw new ShortUsage(STATE_USAGE);
  const reading = await client.call('agent.state', { threadId, domain: wanted });
  print(stateLines(reading), reading);
}
