<script lang="ts">
  import Notice from './Notice.svelte';
  import { untrack } from 'svelte';
  import { lockedBy } from '../lib/policy';
  import { errorText } from '../lib/errors';
  import InfoTip from './InfoTip.svelte';
  import PolicyLock from './PolicyLock.svelte';
  import { Download, ExternalLink, Play, Plus, Puzzle, RefreshCw, RotateCw, Search, ShieldAlert, Square, TriangleAlert } from '@lucide/svelte';
  import type { PluginAdds, PluginAppState, PluginGatewayState, PluginManifest, PluginPermission, PluginPool, PluginPreview, PluginRejected, PluginSettingValue, PluginState, PluginUpdates, RpcParams } from '@boite/contracts';
  import { PLUGIN_ADD_SECTION, PLUGIN_PERMISSIONS, gatewayDashboardReachable } from '@boite/contracts';
  import { pluginUi } from '../lib/plugin-ui.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { besideCore } from '../lib/gateway-dashboard';
  import { openExternal } from '../lib/links';
  import GatewayMoveDialog from './GatewayMoveDialog.svelte';
  import PluginConsent, { type ConsentRequest } from './PluginConsent.svelte';
  import { asGrants, consentForEdit, consentForInstall, consentForPreview, grantsEditable } from '../lib/plugin-consent';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { relativeTime } from '../lib/format';
  import { confirm } from '../lib/confirm.svelte';
  import QuotaList from './QuotaList.svelte';
  import { SnapshotFeed } from '../lib/snapshot-feed';
  import { hasFiles, isOn, permissionTitle, pluginMatches, type PluginFilter } from '../lib/plugin-card';
  import PluginCard from './PluginCard.svelte';
  import PluginDialog from './PluginDialog.svelte';

  /**
   * One machine's plugins. The page mounts a fresh one per machine, so an
   * answer still on its way from the previous core lands in a discarded page.
   */
  let { store }: { store: Store } = $props();
  /** The admin policy forbids installs: the buttons that download are off, removing stays open. */
  const installLocked = $derived(lockedBy(store.policy, 'plugins.install') !== null);
  const t = strings.plugins;

  let plugins = $state<PluginState[]>([]);
  let pools = $state<Record<string, PluginPool[]>>({});
  let busy = $state<Record<string, boolean>>({});
  let checking = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});
  let error = $state('');
  /** The gateway plugin whose connections dialog is open. */
  let moving = $state(false);
  /** The consent dialog's question, and who waits for its answer. A core without grants installs everything, as it always did. */
  let consent = $state<ConsentRequest | null>(null);
  let answerConsent: ((grants: string[] | null) => void) | null = null;
  const asksGrants = $derived(store.core?.features?.pluginGrants === true);

  let url = $state('');
  let ref = $state('');
  let inspecting = $state(false);
  let adding = $state(false);
  let preview = $state<PluginPreview | null>(null);
  let inspectError = $state('');

  let loaded = $state(false);
  let query = $state('');
  let filter = $state<PluginFilter>('all');
  /** The URL form, open from its button, a preview on screen, or a `boite plugin add` on its way. */
  let addOpen = $state(false);
  const addShown = $derived(addOpen || preview !== null || Boolean(store.pluginSource));
  /** The plugin whose gear dialog is open. */
  let openId = $state<string | null>(null);
  const opened = $derived(openId === null ? null : plugins.find((plugin) => plugin.id === openId) ?? null);

  const FILTERS: { id: PluginFilter; label: string }[] = [
    { id: 'all', label: t.filterAll },
    { id: 'enabled', label: t.filterEnabled },
    { id: 'disabled', label: t.filterDisabled },
  ];

  /** One grid: what has files on disk first, then the recommended ones still to install. */
  let installed = $derived(plugins.filter(hasFiles));
  let recommended = $derived(plugins.filter((plugin) => !hasFiles(plugin)));
  let shown = $derived([...installed, ...recommended].filter((plugin) => pluginMatches(plugin, query, filter)));

  const messageOf = (cause: unknown) => (errorText(cause));
  const short = (commit: string) => commit.slice(0, 7);
  const bare = (address: string) => address.replace(/^https:\/\//, '');
  const providerName = (id: string) => store.providers.find((provider) => provider.id === id)?.name ?? id;

  /** The core's order: recommended plugins as shipped, then the others, from a URL or a folder, by id. */
  function order(a: PluginState, b: PluginState): number {
    const recommended = Number(b.origin === 'recommended') - Number(a.origin === 'recommended');
    if (recommended !== 0) return recommended;
    return a.origin === 'recommended' ? 0 : a.id.localeCompare(b.id);
  }

  /**
   * A URL plugin that comes back not installed is gone: its uninstall or its first install's cancel.
   * A known plugin keeps its place, so a row does not jump under the pointer after Stop or a switch.
   */
  function put(next: PluginState) {
    const rest = plugins.filter((plugin) => plugin.id !== next.id);
    if (next.version === null) delete pools[next.id];
    if (next.origin === 'url' && next.status === 'not-installed') plugins = rest;
    else if (rest.length < plugins.length) plugins = plugins.map((plugin) => plugin.id === next.id ? next : plugin);
    else plugins = [...rest, next].sort(order);
  }

  async function loadPools(id: string, refresh = false) {
    const client = store.client;
    if (!client || busy[id]) return;
    busy[id] = true;
    try {
      pools[id] = await client.call('plugins.accounts', { id, refresh });
      delete errors[id];
    } catch (cause) {
      errors[id] = messageOf(cause);
    } finally {
      busy[id] = false;
    }
  }

  /** Opens the consent dialog; null when the owner cancels it. */
  function ask(request: ConsentRequest): Promise<string[] | null> {
    answerConsent?.(null);
    return new Promise((resolve) => { answerConsent = resolve; consent = request; });
  }
  function answered(grants: string[] | null) {
    const waiting = answerConsent;
    answerConsent = null;
    consent = null;
    waiting?.(grants);
  }

  /** Install, update or retry once the owner ticked what the version may reach; a schema 1 plugin sends no grants. */
  async function install(plugin: PluginState) {
    if (!asksGrants) return change(plugin, 'plugins.install');
    const request = consentForInstall(plugin);
    const grants = await ask(request);
    if (grants !== null) await change(plugin, 'plugins.install', request.requested === null ? undefined : asGrants(grants));
  }

  /** What an installed plugin's token reaches, from its row: the core reissues the token. */
  async function editGrants(plugin: PluginState) {
    const client = store.client;
    const grants = await ask(consentForEdit(plugin));
    if (!client || grants === null) return;
    busy[plugin.id] = true;
    try {
      put(await client.call('plugins.setGrants', { id: plugin.id, grants: asGrants(grants) }));
      delete errors[plugin.id];
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      busy[plugin.id] = false;
    }
  }

  async function change(plugin: PluginState, method: 'plugins.install' | 'plugins.cancel' | 'plugins.uninstall', grants?: PluginPermission[]) {
    const client = store.client;
    if (!client) return;
    if (method === 'plugins.uninstall' && !await confirm.ask({
      title: fill(t.removeTitle, { name: plugin.name }), body: plugin.gateway ? fill(t.removeGatewayBody, { dir: plugin.gateway.dataDir }) : t.removeBody,
      confirmLabel: t.remove, cancelLabel: strings.common.cancel, danger: true
    })) return;
    busy[plugin.id] = true;
    try {
      put(await client.call(method, { id: plugin.id, ...(grants ? { grants } : {}) }));
      delete errors[plugin.id];
      if (method === 'plugins.uninstall' && openId === plugin.id) openId = null;
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      busy[plugin.id] = false;
    }
  }

  async function accountAction(plugin: PluginState, provider: string, action: RpcParams<'plugins.accountAction'>['action'], email?: string) {
    const client = store.client;
    if (!client) return;
    if (action !== 'add' && !await confirm.ask({
      title: action === 'switch' ? t.switchTitle : t.forgetTitle,
      body: action === 'switch' ? t.switchBody : t.forgetBody,
      confirmLabel: action === 'switch' ? t.switch : t.forget,
      cancelLabel: strings.common.cancel, danger: action === 'remove'
    })) return;
    busy[plugin.id] = true;
    try {
      pools[plugin.id] = await client.call('plugins.accountAction', { id: plugin.id, provider, action, ...(email ? { email } : {}) });
      delete errors[plugin.id];
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      busy[plugin.id] = false;
    }
  }

  /**
   * A plugin card's Preview (`boite plugin add`): the repository it names,
   * read once, as if the owner had pasted it. Installing stays their click.
   */
  $effect(() => {
    const asked = store.pluginSource;
    if (!asked || store.connection !== 'ready') return;
    untrack(() => {
      store.pluginSource = null;
      addOpen = true;
      url = asked.url;
      ref = asked.ref ?? '';
      void inspect();
    });
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void inspect();
  }

  async function inspect() {
    const client = store.client;
    if (!client || url.trim() === '' || inspecting) return;
    inspecting = true;
    inspectError = '';
    preview = null;
    try {
      preview = await client.call('plugins.inspect', { url: url.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) });
    } catch (cause) {
      inspectError = messageOf(cause);
    } finally {
      inspecting = false;
    }
  }

  async function add() {
    const client = store.client;
    const previewId = preview?.previewId;
    if (!client || !previewId || adding) return;
    const request = asksGrants && preview ? consentForPreview(preview) : null;
    const grants = request ? await ask(request) : [];
    if (grants === null || preview?.previewId !== previewId) return;
    adding = true;
    try {
      put(await client.call('plugins.add', { previewId, ...(request?.requested ? { grants: asGrants(grants) } : {}) }));
      preview = null;
      url = '';
      ref = '';
    } catch (cause) {
      inspectError = messageOf(cause);
      preview = null;
    } finally {
      adding = false;
    }
  }

  /**
   * The card's switch. Off stops what the plugin runs and takes back its token
   * and what it adds to agents; on gives them back. Its files and settings stay.
   */
  async function setEnabled(plugin: PluginState, enabled: boolean) {
    const client = store.client;
    if (!client || busy[plugin.id]) return;
    busy[plugin.id] = true;
    let next: PluginState | null = null;
    try {
      next = await client.call('plugins.setEnabled', { id: plugin.id, enabled });
      put(next);
      delete errors[plugin.id];
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      busy[plugin.id] = false;
    }
    if (next && enabled && next.status === 'installed' && next.pools.length > 0) void loadPools(next.id);
  }

  /** One declared setting from the gear dialog; the answer is the core's refusal, or null once it kept the value. */
  async function saveSetting(plugin: PluginState, key: string, value: PluginSettingValue): Promise<string | null> {
    const client = store.client;
    if (!client) return strings.plugins.settingOffline;
    try {
      put(await client.call('plugins.settings.set', { id: plugin.id, values: { [key]: value } }));
      return null;
    } catch (cause) {
      return messageOf(cause);
    }
  }

  function toggleAdd() {
    if (addShown) {
      addOpen = false;
      preview = null;
      inspectError = '';
    } else {
      addOpen = true;
    }
  }

  /** Start, stop or restart a desktop app; the core answers with the plugin's new state. */
  async function appAction(plugin: PluginState, action: RpcParams<'plugins.app'>['action']) {
    const client = store.client;
    if (!client) return;
    busy[plugin.id] = true;
    try {
      put(await client.call('plugins.app', { id: plugin.id, action }));
      delete errors[plugin.id];
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      busy[plugin.id] = false;
    }
  }

  /** Start, stop or restart a gateway; the core answers once it answers `/health`, or failed to. */
  async function gatewayAction(plugin: PluginState, action: RpcParams<'plugins.gateway'>['action']) {
    const client = store.client;
    if (!client) return;
    busy[plugin.id] = true;
    try {
      put(await client.call('plugins.gateway', { id: plugin.id, action }));
      delete errors[plugin.id];
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      busy[plugin.id] = false;
    }
  }

  /** Whether the plugin's desktop app and gateway start with Boite; nothing running changes. */
  async function setAutostart(plugin: PluginState, autostart: boolean) {
    const client = store.client;
    if (!client) return;
    busy[plugin.id] = true;
    try {
      put(await client.call('plugins.autostart', { id: plugin.id, autostart }));
      delete errors[plugin.id];
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      busy[plugin.id] = false;
    }
  }

  function gatewayLine(gateway: PluginGatewayState): string {
    switch (gateway.status) {
      case 'running': return fill(t.gatewayRunning, { version: gateway.version ?? '', port: String(gateway.port) }).trim();
      case 'starting': return t.gatewayStarting;
      case 'updating': return t.gatewayUpdating;
      case 'crashed': return t.gatewayCrashed;
      default: return gateway.enabled || gateway.autostart ? t.appStopped : t.appOff;
    }
  }

  /** Its dashboard, where this client can reach a loopback address: beside the core only. */
  function gatewayDashboard(gateway: PluginGatewayState): string | null {
    const url = `http://127.0.0.1:${gateway.port}/admin/`;
    return gateway.status === 'running' && gatewayDashboardReachable(url, besideCore(store)) ? url : null;
  }

  /** What a plugin adds, one chip each: `boite <command>`, `/slash`, a skill's name, its guide lines. */
  function addsItems(adds: PluginAdds | null | undefined): string[] {
    if (!adds) return [];
    return [
      ...adds.commands.map((name) => `boite ${name}`),
      ...adds.slashCommands.map((name) => `/${name}`),
      ...adds.skills,
      ...(adds.prompt ? [t.addsPrompt] : []),
      ...(adds.ui ? [strings.pluginUi.adds] : []),
    ];
  }

  /** The same, read from a manifest a preview shows. */
  function manifestAdds(manifest: PluginManifest): PluginAdds {
    return {
      commands: (manifest.provides.commands ?? []).map((command) => command.name),
      skills: (manifest.provides.skills ?? []).map((skill) => skill.name),
      slashCommands: (manifest.provides.slashCommands ?? []).map((command) => command.name),
      prompt: manifest.provides.prompt !== undefined,
      ui: manifest.provides.ui !== undefined,
    };
  }

  function appLine(app: PluginAppState): string {
    switch (app.status) {
      case 'running': return t.appRunning;
      case 'starting': return t.appStarting;
      case 'crashed': return app.exitCode === null ? t.appCrashedSignal : fill(t.appCrashed, { code: String(app.exitCode) });
      case 'unavailable': return t.appUnavailable;
      default: return app.enabled || app.autostart ? t.appStopped : t.appOff;
    }
  }

  /** What the last look at the plugin's update source found, quietly: a source that failed or was ignored is no alarm. */
  function updatesLine(updates: PluginUpdates): string {
    if (updates.checking) return t.checkingUpdates;
    if (updates.error) return fill(t.updateFailed, { error: updates.error });
    if (updates.available) {
      return fill(t.updateFound, { source: bare(updates.source.url), ref: updates.source.ref, commit: short(updates.available.commit), time: relativeTime(updates.available.checkedAt) });
    }
    if (updates.ignored) return fill(t.updateIgnored, { reason: updates.ignored });
    return updates.checkedAt === null ? '' : fill(t.upToDate, { time: relativeTime(updates.checkedAt) });
  }

  /** Reads the plugin's update source now; the core answers with the state it leaves. */
  async function checkUpdates(plugin: PluginState) {
    const client = store.client;
    if (!client || checking[plugin.id]) return;
    checking[plugin.id] = true;
    try {
      for (const next of await client.call('plugins.checkUpdates', { id: plugin.id })) put(next);
      delete errors[plugin.id];
    } catch (cause) {
      errors[plugin.id] = messageOf(cause);
    } finally {
      checking[plugin.id] = false;
    }
  }

  $effect(() => {
    const client = store.client;
    if (!client) return;
    // An update that lands while the list is out is applied after it, never under it.
    const feed = new SnapshotFeed<PluginState>((value) => {
      const before = plugins.find((plugin) => plugin.id === value.id);
      put(value);
      if (value.status === 'installed' && value.pools.length > 0 && before?.status !== 'installed') void loadPools(value.id);
    });
    const off = client.on('plugins.updated', (value) => feed.push(value));
    let disposed = false, listed = false;
    void feed.read(() => client.call('plugins.list', {}), (rows) => {
      plugins = rows;
      listed = true;
      loaded = true;
    }).then(async () => {
      // The list as it stands once the updates held meanwhile are applied.
      if (disposed || !listed) return;
      const rows = plugins;
      for (const plugin of rows) {
        if (plugin.origin === 'recommended' && plugin.version === null && plugin.updates != null) void checkUpdates(plugin);
      }
      await Promise.all(rows.filter((plugin) => plugin.status === 'installed' && plugin.pools.length > 0).map((plugin) => loadPools(plugin.id)));
    }, (cause) => {
      if (!disposed) error = messageOf(cause);
    });
    return () => { disposed = true; feed.dispose(); off(); };
  });
</script>

{#snippet refusal(rejected: PluginRejected)}
  <Notice icon={ShieldAlert} tone="danger" role="alert" testid="plugin-rejected" kind={rejected.field} title={t.refusedTitle}>
    <dl class="facts refusal">
      <dt>{t.refusedFile}</dt><dd class="mono">{rejected.file}</dd>
      <dt>{t.refusedField}</dt><dd class="mono">{rejected.field}</dd>
      <dt>{t.refusedExpected}</dt><dd>{rejected.expected}</dd>
    </dl>
  </Notice>
{/snippet}

{#snippet autostartSwitch(plugin: PluginState, on: boolean | undefined)}
  <!-- A core older than plugins.autostart sends no `autostart`: nothing to switch there. -->
  {#if on !== undefined}
    <label class="autostart">
      <input type="checkbox" role="switch" checked={on} disabled={busy[plugin.id] === true} data-testid="plugin-autostart" data-plugin={plugin.id}
        onchange={(event) => { event.currentTarget.checked = on; void setAutostart(plugin, !on); }} />
      <span class="ui-label">{t.startWithBoite}</span>
    </label>
  {/if}
{/snippet}

<!-- The rows of a facts list: what a plugin adds, and what its own token reaches when it runs something. -->
{#snippet extras(adds: PluginAdds | null | undefined, permissions: readonly PluginPermission[], scoped: boolean)}
  {@const items = addsItems(adds)}
  {#if items.length > 0}
    <dt class="with-tip"><span class="ui-label">{t.adds}</span><InfoTip topic={t.adds} text={t.addsHint} /></dt>
    <dd><ul class="chips">{#each items as item (item)}<li class="ui-chip" class:mono={item !== t.addsPrompt && item !== strings.pluginUi.adds} data-testid="plugin-adds-item">{item}</li>{/each}</ul></dd>
  {/if}
  {#if permissions.length > 0 || scoped}
    <dt class="with-tip"><span class="ui-label">{t.reaches}</span><InfoTip topic={t.reaches} text={t.reachesHint} /></dt>
    <dd>
      {#if permissions.length > 0}
        <ul class="chips">{#each permissions as permission (permission)}<li class="ui-chip" class:danger={PLUGIN_PERMISSIONS[permission]?.danger === true} title={PLUGIN_PERMISSIONS[permission]?.danger === true ? strings.pluginUi.danger : permission} data-testid="plugin-permission" data-permission={permission}>{permissionTitle(permission)}</li>{/each}</ul>
      {:else}<span class="subtle">{t.reachesNothing}</span>{/if}
    </dd>
  {/if}
{/snippet}

<!-- What the gear dialog shows under the settings: where the plugin comes from, what it adds, its program and its accounts. -->
{#snippet details(plugin: PluginState)}
  {@const working = busy[plugin.id] === true}
  {@const on = isOn(plugin)}
  {#if plugin.source}
    <p class="meta">
      <a href={plugin.homepage ?? plugin.source.url} target="_blank" rel="noreferrer">{bare(plugin.source.url)}</a>
      <span class="mono">{fill(t.atCommit, { ref: plugin.source.ref, commit: short(plugin.source.commit) })}</span>
    </p>
  {:else if plugin.homepage}
    <p class="meta"><a href={plugin.homepage} target="_blank" rel="noreferrer" data-testid="plugin-home">{bare(plugin.homepage)}</a></p>
  {/if}
  {#if plugin.origin === 'dev' && plugin.devPath}
    <p class="meta" data-testid="plugin-dev-path"><span class="mono">{plugin.devPath}</span><InfoTip topic={t.dev} text={fill(t.devHint, { id: plugin.id })} /></p>
  {/if}
  {#if plugin.updates}
    {@const line = updatesLine(plugin.updates)}
    {@const looking = plugin.updates.checking || checking[plugin.id] === true}
    <div class="updates">
      {#if line}<p class="hint" data-testid="plugin-updates" data-plugin={plugin.id} data-available={plugin.updates.available?.version ?? ''}><span data-testid="plugin-updates-line">{line}</span></p>{/if}
      {#if plugin.status !== 'installing'}
        <button class="ghost small" class:spinning={looking} data-testid="plugin-check-updates" data-plugin={plugin.id}
          disabled={working || looking} onclick={() => void checkUpdates(plugin)}><RefreshCw size={14} /><span class="ui-label">{t.checkUpdates}</span></button>
      {/if}
    </div>
  {/if}
  {#if hasFiles(plugin) && !on}<p class="hint" data-testid="plugin-off-hint">{t.offHint}</p>{/if}
  {#if plugin.status === 'installed' && addsItems(plugin.adds).length > 0}
    <dl class="facts extras" data-testid="plugin-extras">{@render extras(plugin.adds, [], false)}</dl>
  {/if}
  {#if plugin.error}<p class="bad" role="alert">{plugin.error}</p>{/if}
  {#if store === workspace.primary && pluginUi.status[plugin.id]}
    {@const ui = pluginUi.status[plugin.id]!}
    <div class="ui-state" data-testid="plugin-ui-state" data-plugin={plugin.id} data-ui-state={ui.state}>
      <p class="state">
        <span class="dot" class:ok={ui.state === 'running'} class:live={ui.state === 'loading'} class:bad={ui.state === 'failed'}></span><span class="ui-label">{
          ui.state === 'running' ? strings.pluginUi.running
          : ui.state === 'loading' ? strings.pluginUi.loading
          : ui.state === 'skipped' ? strings.pluginUi.skipped
          : fill(strings.pluginUi.failed, { error: ui.error ?? '' })}</span>
      </p>
      {#if ui.state === 'failed' || ui.state === 'running'}
        <button class="ghost small" data-testid="plugin-ui-reload" data-plugin={plugin.id} onclick={() => void pluginUi.reload(plugin.id)}><RotateCw size={14} /><span class="ui-label">{strings.pluginUi.reload}</span></button>
      {/if}
    </div>
  {/if}
  {#if errors[plugin.id]}<p class="bad" role="alert">{errors[plugin.id]}</p>{/if}
  {#if plugin.rejected}{@render refusal(plugin.rejected)}{/if}
  {#if plugin.status === 'installed' && on && plugin.app}
    {@const app = plugin.app}
    {@const live = app.status === 'running' || app.status === 'starting'}
    <div class="desktop-app" data-testid="plugin-app" data-plugin={plugin.id} data-app-status={app.status}>
      <div class="app-head">
        <p class="state" data-testid="plugin-app-state">
          <span class="dot" class:ok={app.status === 'running'} class:live={app.status === 'starting'}
            class:bad={app.status === 'crashed' || app.status === 'unavailable'}></span><span class="ui-label app-name">{app.kind === 'service' ? t.service : t.app}</span><span aria-hidden="true">·</span><span class="ui-label">{appLine(app)}</span>
        </p>
        <div class="act">
          {#if live}
            <button class="quiet small" data-testid="plugin-app-restart" data-plugin={plugin.id} disabled={working} onclick={() => void appAction(plugin, 'restart')}><RotateCw size={14} /><span class="ui-label">{t.appRestart}</span></button>
            <button class="quiet small" data-testid="plugin-app-stop" data-plugin={plugin.id} disabled={working} onclick={() => void appAction(plugin, 'stop')}><Square size={14} /><span class="ui-label">{t.appStop}</span></button>
          {:else}
            <button class="small" data-testid="plugin-app-start" data-plugin={plugin.id} disabled={working || app.status === 'unavailable'} onclick={() => void appAction(plugin, 'start')}><Play size={14} /><span class="ui-label">{t.appStart}</span></button>
          {/if}
        </div>
      </div>
      {@render autostartSwitch(plugin, app.autostart)}
      {#if app.error}<p class={app.status === 'crashed' ? 'bad' : 'hint'} data-testid="plugin-app-error">{app.error}</p>{/if}
    </div>
  {/if}
  {#if plugin.status === 'installed' && on && plugin.gateway}
    {@const gateway = plugin.gateway}
    {@const live = gateway.status !== 'stopped' && gateway.status !== 'crashed'}
    {@const dashboard = gatewayDashboard(gateway)}
    <div class="desktop-app" data-testid="plugin-gateway" data-plugin={plugin.id} data-gateway-status={gateway.status}>
      <div class="app-head">
        <p class="state" data-testid="plugin-gateway-state">
          <span class="dot" class:ok={gateway.status === 'running'} class:live={gateway.status === 'starting' || gateway.status === 'updating'}
            class:bad={gateway.status === 'crashed'}></span><span class="ui-label app-name">{t.gateway}</span><span aria-hidden="true">·</span><span class="ui-label gateway-line">{gatewayLine(gateway)}</span>
          <InfoTip topic={t.gateway} text={fill(t.gatewayData, { dir: gateway.dataDir })} />
        </p>
        <div class="act">
          {#if live}
            <button class="quiet small" data-testid="plugin-gateway-restart" data-plugin={plugin.id} disabled={working} onclick={() => void gatewayAction(plugin, 'restart')}><RotateCw size={14} /><span class="ui-label">{t.appRestart}</span></button>
            <button class="quiet small" data-testid="plugin-gateway-stop" data-plugin={plugin.id} disabled={working} onclick={() => void gatewayAction(plugin, 'stop')}><Square size={14} /><span class="ui-label">{t.appStop}</span></button>
          {:else}
            <button class="small" data-testid="plugin-gateway-start" data-plugin={plugin.id} disabled={working} onclick={() => void gatewayAction(plugin, 'start')}><Play size={14} /><span class="ui-label">{t.appStart}</span></button>
          {/if}
        </div>
      </div>
      {#if !plugin.app}{@render autostartSwitch(plugin, gateway.autostart)}{/if}
      {#if gateway.error}<p class={gateway.status === 'crashed' ? 'bad' : 'hint'} data-testid="plugin-gateway-error">{gateway.error}</p>{/if}
      {#if gateway.status === 'running' && (dashboard || plugin.id === 'douane')}
        <div class="act gateway-act">
          {#if dashboard}<button class="ghost small" data-testid="plugin-gateway-open" data-plugin={plugin.id} onclick={() => void openExternal(dashboard)}><ExternalLink size={14} /><span class="ui-label">{fill(strings.subscriptionProxy.openGateway, { name: plugin.name })}</span></button>{/if}
          {#if plugin.id === 'douane' && store.core?.features?.gatewayMove === true}
            <!-- The connections dialog takes the screen: the gear dialog steps aside so one Escape closes one dialog. -->
            <button class="ghost small" data-testid="plugin-gateway-move" data-plugin={plugin.id} onclick={() => { openId = null; moving = true; }}><span class="ui-label">{strings.subscriptionProxy.move.open}</span></button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  {#if plugin.status === 'installed' && on && plugin.pools.length > 0}
    <div class="pools">
      <div class="pools-head">
        <h4 class="section-label"><span class="ui-label">{t.pools}</span><InfoTip topic={t.pools} text={t.cliScope} /></h4>
        <button class="quiet small" data-testid="plugin-refresh" data-plugin={plugin.id} disabled={working} onclick={() => void loadPools(plugin.id, true)}><RefreshCw size={14} /><span class="ui-label">{strings.common.refresh}</span></button>
      </div>
      {#each pools[plugin.id] ?? [] as pool (pool.provider)}
        <div class="pool" data-testid="plugin-pool" data-plugin={plugin.id} data-provider={pool.provider}>
          <div class="pool-head">
            <h5><span class="ui-label">{providerName(pool.provider)}</span></h5>
            <button class="quiet small" disabled={working} onclick={() => void accountAction(plugin, pool.provider, 'add')}><span class="ui-label">{t.add}</span></button>
          </div>
          {#if pool.accounts.length === 0}<p class="hint">{t.empty}</p>{/if}
          {#each pool.accounts as account (account.email)}
            <div class="saved-account" class:active={account.active} data-testid="plugin-account" data-email={account.email}>
              <div class="account-head">
                <strong class="ui-label">{account.email}</strong>
                {#if account.active}<span class="tag ui-label-box" data-testid="plugin-account-active"><span class="ui-label">{t.active}</span></span>{/if}
                <span class="account-actions">
                  {#if !account.active}
                    <button class="quiet small" disabled={working} data-testid="plugin-switch" onclick={() => void accountAction(plugin, pool.provider, 'switch', account.email)}><span class="ui-label">{t.switch}</span></button>
                  {/if}
                  <button class="ghost small" disabled={working} onclick={() => void accountAction(plugin, pool.provider, 'remove', account.email)}><span class="ui-label">{t.forget}</span></button>
                </span>
              </div>
              <QuotaList rows={[{ accountId: account.email, providerId: pool.provider, providerName: account.email, label: '', enabled: true,
                status: account.checkedSecondsAgo === null ? 'unavailable' : 'ready', windows: account.windows,
                checkedAt: account.checkedSecondsAgo === null ? null : Date.now() - account.checkedSecondsAgo * 1000, error: null }]} />
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="page" data-testid="plugins-page">
  <header>
    <div><h1 class="ui-label-box"><span class="ui-label">{t.heading}</span><InfoTip topic={t.heading} text={t.intro} /></h1></div>
  </header>
  {#if error}<p class="bad" role="alert">{error}</p>{/if}

  <div class="toolbar">
    <label class="search">
      <Search size={15} strokeWidth={1.75} />
      <input type="search" bind:value={query} placeholder={t.search} aria-label={t.search} autocomplete="off" spellcheck="false" data-testid="plugins-search" />
    </label>
    <div class="segmented" role="group" aria-label={t.filter} data-testid="plugins-filter">
      {#each FILTERS as entry (entry.id)}
        <button type="button" class:on={filter === entry.id} aria-pressed={filter === entry.id} data-testid="plugins-filter-{entry.id}" onclick={() => { filter = entry.id; }}><span class="ui-label">{entry.label}</span></button>
      {/each}
    </div>
    <span class="end">
      <PolicyLock {store} keys={['plugins.install', 'plugins.recommended']} />
      <button type="button" class="small from-url" class:on={addShown} aria-expanded={addShown} aria-controls="settings-{PLUGIN_ADD_SECTION}"
        data-testid="plugins-from-url" onclick={toggleAdd}><Plus size={14} /><span class="ui-label">{t.fromUrl}</span></button>
    </span>
  </div>

  {#if addShown}
    <section id="settings-{PLUGIN_ADD_SECTION}" class="card add" aria-labelledby="plugins-add" data-testid="plugins-add">
      <h2 id="plugins-add" class="section-label"><span class="ui-label">{t.addHeading}</span><InfoTip topic={t.addHeading} text={t.addHint} /><PolicyLock {store} keys={['plugins.install']} /></h2>
      <!-- Text, not url: owner/repo and a page copied without https are read by the core. -->
      <form onsubmit={submit}>
        <!-- svelte-ignore a11y_autofocus: the button that opens the form asks for the address next. -->
        <input class="url" data-testid="plugin-url" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus={addOpen && !preview}
          aria-label={t.urlLabel} placeholder={t.urlPlaceholder} bind:value={url} disabled={installLocked} />
        <input class="ref" data-testid="plugin-ref" autocomplete="off" autocapitalize="off" spellcheck="false"
          aria-label={t.refLabel} title={t.refLabel} placeholder={t.refPlaceholder} bind:value={ref} disabled={installLocked} />
        <button type="submit" data-testid="plugin-inspect" disabled={url.trim() === '' || inspecting || installLocked}><span class="ui-label">{inspecting ? t.inspecting : t.inspect}</span></button>
      </form>
      {#if inspectError}<p class="bad" role="alert" data-testid="plugin-inspect-error">{inspectError}</p>{/if}
      {#if preview}
        <div class="preview" data-testid="plugin-preview" data-rejected={preview.rejected !== null}>
          {#if preview.manifest}
            <div class="line">
              <span class="glyph" aria-hidden="true"><Puzzle size={16} strokeWidth={1.75} /></span>
              <div class="who">
                <h3>{preview.manifest.name}<span class="version">v{preview.manifest.version}</span></h3>
                <p class="state"><span class="ui-label">{preview.manifest.description}</span></p>
              </div>
            </div>
          {/if}
          {#if preview.rejected}
            {@render refusal(preview.rejected)}
          {/if}
          <dl class="facts">
            <dt>{t.previewSource}</dt>
            <dd><span class="wrap">{bare(preview.source.url)}</span> <span class="mono subtle">{fill(t.atCommit, { ref: preview.source.ref, commit: short(preview.source.commit) })}</span></dd>
            {#if preview.replaces}<dt>{t.previewReplaces}</dt><dd>v{preview.replaces}</dd>{/if}
            {#if preview.rejected === null && preview.artifact}
              <dt>{t.previewDownloads}</dt><dd class="mono wrap" data-testid="plugin-artifact">{preview.artifact.url}</dd>
              <dt>{t.previewDigest}</dt><dd class="mono wrap">{preview.artifact.sha256}</dd>
              <dt>{t.previewRuns}</dt>
              <dd><ul class="commands mono">{#each preview.commands as command (command)}<li>{command}</li>{/each}</ul></dd>
              {#if preview.manifest?.provides.accountPools}
                <dt>{t.previewPools}</dt>
                <dd>{preview.manifest.provides.accountPools.providers.map(providerName).join(', ')}</dd>
              {/if}
              {#if preview.manifest?.provides.desktopApp}
                <dt>{t.previewApp}</dt>
                <dd data-testid="plugin-preview-app">{preview.manifest.schema === 2 ? t.previewAppScoped : t.previewAppBody}</dd>
              {/if}
              {#if preview.manifest?.provides.gateway}
                <dt>{t.previewGateway}</dt>
                <dd data-testid="plugin-preview-gateway">{t.previewGatewayBody}</dd>
              {/if}
            {/if}
            {#if preview.rejected === null && preview.manifest?.schema === 2}
              {@render extras(manifestAdds(preview.manifest), preview.manifest.permissions ?? [], preview.manifest.executable !== undefined)}
            {/if}
          </dl>
          {#if preview.rejected === null}
            <p class="trust" data-testid="plugin-trust"><TriangleAlert size={15} strokeWidth={1.75} />{preview.manifest?.schema === 2 && preview.manifest.executable === undefined ? t.trustText : t.trust}</p>
          {/if}
          <div class="act end">
            <button class="quiet small" data-testid="plugin-dismiss" onclick={() => { preview = null; }}><span class="ui-label">{preview.rejected ? strings.common.dismiss : strings.common.cancel}</span></button>
            {#if preview.previewId && preview.manifest}
              <button class="primary small" data-testid="plugin-add" disabled={adding || installLocked} onclick={() => void add()}><Download size={14} /><span class="ui-label">{fill(t.confirmAdd, { name: preview.manifest.name })}</span></button>
            {/if}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if shown.length > 0}
    <div class="grid" data-testid="plugins-grid">
      {#each shown as plugin (plugin.id)}
        <PluginCard {plugin} working={busy[plugin.id] === true} {installLocked} error={errors[plugin.id]}
          onopen={() => { openId = plugin.id; }} ontoggle={(on) => void setEnabled(plugin, on)}
          oninstall={() => void install(plugin)} oncancel={() => void change(plugin, 'plugins.cancel')} />
      {/each}
    </div>
  {:else if loaded}
    <p class="empty" data-testid="plugins-empty">{t.noMatch}</p>
  {/if}
</div>

<PluginDialog plugin={opened} working={openId !== null && busy[openId] === true} onclose={() => { openId = null; }}
  onsave={saveSetting} onuninstall={(plugin) => void change(plugin, 'plugins.uninstall')}
  onedit={opened && asksGrants && grantsEditable(opened) ? (plugin) => void editGrants(plugin) : null} {details} />
<GatewayMoveDialog {store} open={moving} target="plugin" onclose={() => { moving = false; }} />
<PluginConsent request={consent} onanswer={answered} />

<style>
  .page { container-type: inline-size; }
  .hint { margin: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); line-height: 1.5; }
  .bad { margin: 0; font-size: var(--text-sm); color: var(--color-danger); overflow-wrap: anywhere; }

  /* The search, the filter and the URL form's button on one line. */
  .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  /* The settings search's field (SettingsShell.svelte): an edge that brightens on focus, the caret the one lit point. */
  .search { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2); height: var(--input); padding: 0 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-hover); color: var(--color-subtle); transition: border-color var(--dur-2); }
  .search:focus-within { border-color: var(--color-composer-focus); }
  .search :global(svg) { flex: none; }
  .search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; outline: none; box-shadow: none; font-size: var(--text-sm); color: var(--color-foreground); }
  .search input::-webkit-search-cancel-button { display: none; }
  /* The filter is app.css's one segmented control. */
  .end { flex: none; display: flex; align-items: center; gap: 6px; }
  .from-url { gap: 6px; height: var(--input); }
  .from-url.on { border-color: var(--color-edge); background: var(--color-active); }

  /* Cards as wide as a name and two lines need; as many across as the column holds. */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
  .empty { margin: 24px 0; text-align: center; font-size: var(--text-sm); color: var(--color-muted-foreground); }

  .line { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
  .glyph { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-muted-foreground); }
  .who { flex: 1; min-width: 0; display: grid; gap: 3px; padding-top: 1px; }
  h3 { margin: 0; display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--text-base); font-weight: 600; overflow-wrap: anywhere; }
  .version { font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); }
  .state { margin: 0; display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }

  /* Hue is for status only: green once running, amber while starting, red when it failed. */
  .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--color-subtle); }
  .dot.ok { background: var(--color-success); }
  .dot.live { background: var(--color-live); }
  .dot.bad { background: var(--color-danger); }

  .act { display: flex; align-items: center; gap: 4px; flex: none; flex-wrap: wrap; justify-content: flex-end; }
  .spinning :global(svg) { animation: spin 0.9s linear infinite var(--loops); }
  @keyframes spin { to { transform: rotate(360deg); } }
  .act.end { justify-content: flex-end; }
  .gateway-act { justify-content: flex-start; }
  .gateway-line { font-variant-numeric: tabular-nums; }
  .act button, .pools button, .account-actions button, .updates button { gap: 6px; }

  .meta { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .meta a { color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  .meta a:hover { color: var(--color-foreground); }
  .meta .mono { font-size: var(--text-xs); }
  .updates { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; }

  .refusal { margin-top: 4px; }

  .facts { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; font-size: var(--text-sm); }
  .facts dt { color: var(--color-muted-foreground); }
  .facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .wrap { overflow-wrap: anywhere; word-break: break-all; }
  .commands { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  /* A command that wraps keeps its continuation indented, so it still reads as one line. */
  .commands li { padding-left: 2ch; text-indent: -2ch; }

  .pools { display: grid; gap: 10px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--color-border); }
  /* The desktop app's own strip: one line of what it is doing, and the buttons that change it. */
  .desktop-app { display: grid; gap: 6px; padding: 6px 6px 6px 12px; border-radius: var(--radius-md); background: var(--color-surface-2); }
  .app-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .autostart { --switch-width: 32px; --switch-height: 20px; display: flex; align-items: center; gap: 8px; width: fit-content; font-size: var(--text-sm); color: var(--color-muted-foreground); cursor: pointer; }
  .app-name { color: var(--color-foreground); font-weight: 500; }
  .pools-head .section-label { display: flex; align-items: center; gap: 6px; }
  .pools-head, .pool-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h4 { margin: 0; }
  h5 { margin: 0; font-size: var(--text-sm); font-weight: 600; }
  .pool { display: grid; gap: 8px; }
  /* One box per saved login: its name, its buttons and its limits together. */
  .saved-account { display: grid; gap: 10px; padding: 10px 12px; border-radius: var(--radius-lg); background: var(--color-surface-2); }
  .account-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .account-head strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); font-weight: 600; }
  .extras { align-items: baseline; }
  .with-tip { display: inline-flex; align-items: center; gap: 4px; }
  .chips { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px; }
  .ui-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--color-foreground); }
  .ui-chip.danger { border-color: var(--color-danger); color: var(--color-danger); }
  .ui-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
  .ui-state .state { min-width: 0; overflow-wrap: anywhere; }
  .tag { flex: none; padding: 1px 6px; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); font-size: var(--text-xs); font-weight: 500; }
  .account-actions { display: flex; margin-left: auto; gap: 4px; flex: none; }

  /* The URL form opens between the toolbar and the grid. */
  .add { display: grid; gap: 12px; padding: 14px; margin-bottom: 14px; animation: rise var(--dur-3) var(--ease-out-quint); }
  .add > h2 { margin: 0; display: flex; align-items: center; gap: 6px; }
  form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 160px) auto; align-items: center; gap: 8px; }
  form input { width: 100%; }
  /* The button lines up with the fields beside it. */
  form button { height: var(--input); }
  .preview { display: grid; gap: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); animation: rise var(--dur-3) var(--ease-out-quint); }
  .trust { margin: 0; display: flex; align-items: flex-start; gap: 8px; font-size: var(--text-sm); color: var(--color-muted-foreground); line-height: 1.5; }
  .trust :global(svg) { flex: none; margin-top: 2px; color: var(--color-live); }

  /* The settings column, not the window: the page is as narrow in a split shell as on a phone. */
  @container (max-width: 560px) {
    .toolbar { flex-wrap: wrap; }
    .search { flex-basis: 100%; }
    .segmented { flex: 1; }
    .segmented button { flex: 1; min-width: 0; padding: 0 6px; }
    .grid { grid-template-columns: minmax(0, 1fr); }
    form { grid-template-columns: minmax(0, 1fr); }
    form button { justify-self: start; }
    .facts { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .facts dd + dt { margin-top: 8px; }
    .pools-head { align-items: flex-start; }
  }
  @media (prefers-reduced-motion: reduce) { .add, .preview, .spinning :global(svg) { animation: none; } }
</style>
