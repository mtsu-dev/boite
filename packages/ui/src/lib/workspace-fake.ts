import { Store } from './store.svelte';
import type { Workspace } from './workspace.svelte';

/**
 * The fake machines a dev build with the fake client adds beside its own: Builder,
 * and Lab with `&machines=2`, joined in one group. `current` is false once the
 * workspace boot that asked for them was superseded.
 */
export async function addFakeMachines(workspace: Workspace, current: () => boolean): Promise<void> {
  const store = workspace.primary;
  const { FakeClient } = await import('./fake-client');
  if (!current()) return;
  const params = new URLSearchParams(window.location.search);
  // `?desktopUpdate=<phase>` makes it a Windows PC whose desktop app reports an update.
  const desktopApp = params.get('desktopUpdate') !== null;
  // `&load=<n>` streams on this machine too: a second machine at work feeds its own store.
  const load = params.get('load') ? { load: Number(params.get('load')), ...(params.get('loadtick') ? { loadTickMs: Number(params.get('loadtick')) } : {}) } : {};
  // `&machines=2` adds Lab after Builder, for the density checks of a group of three machines.
  const fakes = [
    { url: 'builder.test', coreId: 'fake-builder', label: 'Builder', options: { desktopApp, ...load } },
    ...(Number(params.get('machines')) >= 2 ? [{ url: 'lab.test', coreId: 'fake-lab', label: 'Lab', options: {} }] : [])
  ];
  const remotes: Store[] = [];
  for (const fake of fakes) {
    const remote = new Store();
    remote.machineId = `http://${fake.url}`;
    remote.visible = false;
    remote.attach(new FakeClient({ coreId: fake.coreId, coreName: fake.label, publicUrl: `https://${fake.url}`, ...fake.options }));
    await remote.connect();
    if (!current()) {
      for (const made of [...remotes, remote]) { made.client?.close(); made.detach(); }
      return;
    }
    remote.booted = true;
    if (remote.core) remote.core.os = fake.coreId === 'fake-builder' && desktopApp ? 'windows' : 'linux';
    const machine = { id: remote.machineId, label: fake.label, store: remote };
    workspace.restoreProfile(machine);
    workspace.machines = [...workspace.machines, machine];
    remotes.push(remote);
  }
  const remote = remotes[0]!;
  // The fake machines are one group, so the group card has members to show.
  if (store.client && remotes.every((one) => one.client) && (await store.client.call('group.get', {})) === null) {
    await store.client.call('group.create', { name: 'Home' });
    for (const one of remotes) {
      const { invite } = await store.client.call('group.invite', {});
      await one.client!.call('group.join', { invite });
    }
    await Promise.all([store.loadGroup(), ...remotes.map((one) => one.loadGroup())]);
  }
  // `&remote=1` gives the open conversation a subagent on this machine; `&remote=away` then closes this machine's connection.
  const subagent = params.get('remote');
  if ((subagent === '1' || subagent === 'away') && store.client && remote.client) {
    await remote.client.call('settings.set', { groupThreads: true });
    await store.client.call('delegation.spawn', { threadId: 't-trace', machine: 'Builder', task: 'Build the release on this machine and report the artifact sizes.', title: 'Build the release on Builder', requestId: 'demo-remote-subagent' });
    if (subagent === 'away') remote.client.close();
  }
}
