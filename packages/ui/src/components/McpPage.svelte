<script lang="ts">
  import { BookOpen, Bug, Check, Cloud, Database, ExternalLink, FileText, Folder, GitBranch, ListChecks, LoaderCircle, Pencil, Play, Plug, Plus, Telescope, Trash2, TriangleAlert } from '@lucide/svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { mcpServerSlug, RpcErrorCode, type McpPreset, type McpProbeResult, type McpServer, type McpServerInput, type RpcResult } from '@boite/contracts';
  import { RpcFailure } from '../lib/client';
  import { confirm } from '../lib/confirm.svelte';
  import { errorText } from '../lib/errors';
  import { projectName } from '../lib/format';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import McpForm from './McpForm.svelte';
  import Notice from './Notice.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import SettingSwitch from './SettingSwitch.svelte';

  let { store, phone = false }: { store: Store; phone?: boolean } = $props();
  let catalog = $state.raw<RpcResult<'mcp.list'> | null>(null);
  const tests = new SvelteMap<string, McpProbeResult>();
  const busy = new SvelteMap<string, 'toggle' | 'test' | 'remove'>();
  let error = $state('');
  let edit = $state.raw<{ server?: McpServer; preset?: McpPreset } | null>(null);
  let revision = 0;
  let editor = $state<HTMLDivElement>();
  const t = strings.mcp;
  let blocked = $derived(store.policy?.values.mcp === false);
  let encrypted = $derived(catalog?.encrypted === true);
  const icons = new Map<string, typeof Plug>([
    ['filesystem', Folder], ['github', GitBranch], ['context7', BookOpen], ['postgresql', Database],
    ['playwright', Telescope], ['fetch', Cloud], ['linear', ListChecks], ['notion', FileText], ['sentry', Bug],
  ]);
  let projects = $derived(store.projects.filter(project => project.kind !== 'drafts' && !project.archived));

  $effect(() => {
    const client = store.client;
    if (!client || store.connection !== 'ready' || !store.owner) return;
    const current = ++revision;
    let latest = 0;
    const refresh = () => {
      const request = ++latest;
      void client.call('mcp.list', {}).then(next => {
        if (current === revision && request === latest) catalog = next;
      }, cause => {
        if (current === revision && request === latest) {
          error = cause instanceof RpcFailure && cause.code === RpcErrorCode.MethodNotFound ? t.missing : errorText(cause);
        }
      });
    };
    const off = client.on('mcp.changed', refresh);
    refresh();
    return () => { ++revision; off(); };
  });

  function open(form: NonNullable<typeof edit>): void {
    edit = form;
    requestAnimationFrame(() => editor?.scrollIntoView({ block: 'nearest' }));
  }

  function scopeOf(server: McpServer): string {
    if (server.scope === 'global') return t.global;
    const names = server.projectIds.map(id => {
      const project = projects.find(item => item.id === id);
      return project ? projectName(project) : t.unavailableProject;
    });
    return fill(t.scopeFor, { names: names.join(', ') });
  }

  async function toggle(server: McpServer): Promise<void> {
    const client = store.client;
    if (!client || busy.has(server.id)) return;
    busy.set(server.id, 'toggle');
    try { await client.call('mcp.toggle', { id: server.id, enabled: !server.enabled }); }
    catch (cause) { error = errorText(cause); }
    finally { busy.delete(server.id); }
  }

  async function test(server: McpServer): Promise<void> {
    const client = store.client;
    if (!client || busy.has(server.id)) return;
    busy.set(server.id, 'test');
    try {
      tests.set(server.id, await client.call('mcp.test', { id: server.id }));
    } catch (cause) {
      tests.set(server.id, { ok: false, latencyMs: 0, error: errorText(cause), tools: [] });
    } finally { busy.delete(server.id); }
  }

  async function remove(server: McpServer): Promise<void> {
    const client = store.client;
    if (!client || busy.has(server.id)) return;
    const accepted = await confirm.ask({
      title: fill(t.removalTitle, { name: server.name }), body: t.removalBody,
      confirmLabel: t.remove, cancelLabel: strings.common.cancel, danger: true,
    });
    if (!accepted || store.client !== client || busy.has(server.id)) return;
    busy.set(server.id, 'remove');
    try {
      await client.call('mcp.remove', { id: server.id });
      tests.delete(server.id);
      if (edit?.server?.id === server.id) edit = null;
    } catch (cause) { error = errorText(cause); }
    finally { busy.delete(server.id); }
  }

  function defaultPresetName(preset: McpPreset): string {
    const servers = catalog?.servers ?? [];
    const taken = (candidate: string): boolean => {
      const slug = mcpServerSlug(candidate);
      return servers.some(server => server.id === slug || server.name.toLowerCase() === candidate.toLowerCase());
    };
    if (!taken(preset.name)) return preset.name;
    let index = 2;
    while (taken(`${preset.name} ${index}`)) index += 1;
    return `${preset.name} ${index}`;
  }

  async function save(input: McpServerInput): Promise<void> {
    const client = store.client;
    if (!client) throw new Error(t.missing);
    const sendsSecret = (map?: Record<string, string | null>) => Object.values(map ?? {}).some(value => value !== null && value !== undefined);
    if (!encrypted && (sendsSecret(input.secretEnv) || sendsSecret(input.secretHeaders))) {
      throw new Error(t.plainLinkSecrets);
    }
    const saved = await client.call('mcp.save', input);
    tests.delete(saved.id);
    edit = null;
  }
</script>

<div class="mcp-page" class:phone data-testid="mcp-page">
  {#if error}<Notice icon={TriangleAlert} tone="danger" detail={error} role="alert" />{/if}
  {#if blocked}<Notice icon={TriangleAlert} tone="caution" detail={t.blocked} />{/if}
  {#if catalog}
    <div class="layout">
      <SettingsSection title={t.installed} testid="mcp-installed">
        {#snippet actions()}
          <button class="ghost add-custom" onclick={() => open({})}><Plus size={15} />{t.addCustom}</button>
        {/snippet}
        {#if catalog.servers.length === 0}
          <p class="empty">{t.empty}</p>
        {/if}
        {#each catalog.servers as server (server.id)}
          {@const result = tests.get(server.id)}
          {@const ServerIcon = icons.get(server.id) ?? icons.get(server.id.replace(/-\d+$/, '')) ?? Plug}
          <div class="server">
            <div class="server-head">
              <div class="server-icon"><ServerIcon size={17} strokeWidth={1.75} /></div>
              <div class="server-title">
                <strong>{server.name}</strong>
                <div class="metadata"><span class="transport">{t[server.transport]}</span><span title={scopeOf(server)}>{scopeOf(server)}</span></div>
              </div>
              <SettingSwitch aria-label={fill(t.toggle, { name: server.name })} checked={server.enabled} disabled={busy.has(server.id)} onclick={event => { event.preventDefault(); void toggle(server); }} />
            </div>
            <div class="server-actions">
              <button type="button" class="ghost" disabled={blocked || busy.has(server.id)} aria-label={fill(t.testServer, { name: server.name })} onclick={() => test(server)}>
                {#if busy.get(server.id) === 'test'}<LoaderCircle class="mcp-spinner" size={14} />{t.testing}
                {:else}<Play size={14} />{t.test}{/if}
              </button>
              <button type="button" class="ghost" disabled={busy.has(server.id)} onclick={() => open({ server })}><Pencil size={14} />{t.edit}</button>
              <button type="button" class="ghost remove" disabled={busy.has(server.id)} onclick={() => remove(server)}><Trash2 size={14} />{t.remove}</button>
            </div>
            {#if result && busy.get(server.id) !== 'test'}
              {#if result.ok}
                <details class="probe" data-testid="mcp-probe">
                  <summary><span class="success"><Check size={15} />{result.tools.length === 1 ? t.oneTool : fill(t.toolCount, { count: String(result.tools.length) })}</span><span class="time">{result.latencyMs} ms</span></summary>
                  {#if result.tools.length > 0}
                    <ul>
                      {#each result.tools as tool}
                        <li><code>{tool.name}</code>{#if tool.description}<span>{tool.description}</span>{/if}</li>
                      {/each}
                    </ul>
                  {/if}
                </details>
              {:else}<p class="failure" role="alert">{result.error}</p>{/if}
            {/if}
          </div>
        {/each}
      </SettingsSection>

      {#if edit}
        <div class="editor" bind:this={editor}>
          {#key edit}
            <McpForm server={edit.server} preset={edit.preset} defaultName={edit.preset ? defaultPresetName(edit.preset) : undefined} {projects} os={store.core?.os ?? 'windows'} {encrypted} onsave={save} oncancel={() => edit = null} />
          {/key}
        </div>
      {/if}
    </div>

    <SettingsSection title={t.catalog} testid="mcp-catalog">
      <div class="catalog">
        {#each catalog.presets as preset (preset.id)}
          {@const Icon = icons.get(preset.id) ?? Plug}
          {@const description = t.descriptions[preset.id as keyof typeof t.descriptions] ?? preset.description}
          <div class="preset">
            <Icon size={18} strokeWidth={1.75} />
            <div class="preset-copy"><strong>{preset.name}</strong><p>{description}</p></div>
            <div class="preset-actions">
              <a href={preset.docsUrl} title={t.docs} aria-label={t.docs + ' ' + preset.name} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>
              <button class="ghost" aria-label={fill(t.addPreset, { name: preset.name })} onclick={() => open({ preset })}><Plus size={14} />{t.add}</button>
            </div>
          </div>
        {/each}
      </div>
    </SettingsSection>
  {:else if !error}
    <p class="empty" role="status">{t.loading}</p>
  {/if}
</div>

<style>
  .mcp-page { flex: 1 1 auto; overflow: auto; align-content: start; padding: var(--space-4); }
  .mcp-page.phone { overflow: visible; padding-top: var(--space-2); }
  @media (min-width: 721px) {
    .mcp-page:not(.phone) { padding: 20px max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)) var(--space-8); }
  }
  .mcp-page, .layout { display: grid; gap: var(--space-4); min-width: 0; }
  .layout:has(.editor) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
  .editor { min-width: 0; }
  .mcp-page :global(.card) { display: grid; gap: var(--space-2); padding: var(--space-3); margin: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--card-fill); }
  .mcp-page :global(.card > h2) { margin: 0 0 var(--space-1); display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .mcp-page :global(.mcp-spinner) { animation: mcp-spin 800ms linear infinite var(--loops); }
  @keyframes mcp-spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .mcp-page :global(.mcp-spinner) { animation: none; } }
  .empty { margin: 0; color: var(--color-subtle); padding: var(--space-3) 0; }
  .add-custom, .server-actions button, .preset-actions button { display: inline-flex; align-items: center; gap: var(--space-1); }
  .add-custom { margin-inline-start: auto; }
  .server { display: grid; gap: var(--space-2); padding: var(--space-3) 0; }
  .server + .server { border-top: 1px solid var(--color-border); }
  .server-head { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .server-icon { display: grid; place-items: center; width: var(--control); height: var(--control); flex: none; background: var(--color-surface-2); border-radius: var(--radius-sm); color: var(--color-subtle); }
  .server-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .metadata { display: flex; gap: var(--space-2); align-items: center; color: var(--color-subtle); font-size: var(--text-xs); }
  .metadata > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transport { padding: 1px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-2); }
  .server-actions { display: flex; gap: var(--space-1); flex-wrap: wrap; }
  .remove { color: var(--color-subtle); }
  .remove:hover, .failure { color: var(--color-danger); }
  .failure { margin: 0; overflow-wrap: anywhere; }
  .probe { padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: var(--text-sm); }
  .probe summary { cursor: pointer; }
  .success { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--color-success); vertical-align: middle; }
  .time { float: inline-end; color: var(--color-subtle); }
  .probe ul { list-style: none; padding: 0; margin: var(--space-2) 0 0; color: var(--color-subtle); }
  .probe li { display: grid; padding: var(--space-1); gap: var(--space-1); overflow-wrap: anywhere; }
  .probe li + li { border-top: 1px solid var(--color-border); }
  .probe code { color: var(--color-foreground); }
  .catalog { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: var(--space-2); }
  .preset { display: flex; gap: var(--space-2); align-items: flex-start; padding: var(--space-2); min-width: 0; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
  .preset > :global(svg) { color: var(--color-subtle); flex: none; margin-top: var(--space-1); }
  .preset-copy { flex: 1; min-width: 0; }
  .preset p { margin: 0; color: var(--color-subtle); font-size: var(--text-xs); line-height: 1.4; }
  .preset-actions { display: flex; flex-direction: column-reverse; align-items: flex-end; gap: var(--space-1); }
  .preset-actions a { padding-inline: var(--space-2); color: var(--color-subtle); }
  @media (max-width: 850px) {
    .layout:has(.editor) { grid-template-columns: minmax(0, 1fr); }
  }
</style>
