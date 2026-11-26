<script lang="ts">
  import { ExternalLink, Plus, TriangleAlert, X } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { mcpEnvKey, mcpHttpOriginChanged, type McpPreset, type McpPresetField, type McpScope, type McpServer, type McpServerInput, type McpTransport, type Os, type Project } from '@boite/contracts';
  import { errorText } from '../lib/errors';
  import { projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import Notice from './Notice.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import SettingSwitch from './SettingSwitch.svelte';

  let { server, preset, projects, os, encrypted = true, onsave, oncancel }: {
    server?: McpServer;
    preset?: McpPreset;
    projects: Project[];
    os: Os;
    encrypted?: boolean;
    onsave: (input: McpServerInput) => Promise<void>;
    oncancel: () => void;
  } = $props();

  interface Entry { id: number; key: string; value: string; secret: boolean; savedKey?: string }
  const t = strings.mcp;
  const start = untrack(() => ({ server, preset }));
  let sequence = 0;
  const fields = start.preset?.fields ?? [];
  const argumentsOf = start.server?.args ?? start.preset?.args ?? [];
  let name = $state(start.server?.name ?? start.preset?.name ?? '');
  let transport = $state<McpTransport>(start.server?.transport ?? start.preset?.transport ?? 'stdio');
  let command = $state(start.server?.command ?? start.preset?.command ?? '');
  let url = $state(start.server?.url ?? start.preset?.url ?? '');
  let args = $state(argumentsOf.join('\n'));
  let presetArgs = $state<Record<string, string>>({});
  let scope = $state<McpScope>(start.server?.scope ?? 'global');
  let selection = $state(start.server?.projectIds.slice() ?? []);
  let customized = $state(start.preset === undefined);
  let pending = $state(false);
  let error = $state('');
  let env = $state(entries('env'));
  let headers = $state(entries('header'));
  let originChanged = $derived(transport === 'http' && !!start.server?.secretHeaderKeys.length && mcpHttpOriginChanged(start.server.url, url));
  const uid = $props.id();

  function entries(target: 'env' | 'header'): Entry[] {
    const display = target === 'env' ? start.server?.env : start.server?.headers;
    const secret = target === 'env' ? start.server?.secretEnvKeys : start.server?.secretHeaderKeys;
    return [
      ...Object.entries(display ?? {}).map(([key, value]) => ({ id: ++sequence, key, value, secret: false })),
      ...(secret ?? []).map(key => ({ id: ++sequence, key, value: '', secret: true, savedKey: key })),
      ...fields.filter(field => field.target === target).map(field => ({ id: ++sequence, key: field.key, value: '', secret: true })),
    ];
  }

  function fieldLabel(field: McpPresetField): string {
    if (field.target === 'arg' && field.key === 'root') return t.directory;
    if (field.key === 'GITHUB_PERSONAL_ACCESS_TOKEN') return t.githubToken;
    if (field.key === 'DATABASE_URI') return t.databaseUrl;
    if (field.key === 'CONTEXT7_API_KEY') return t.apiKey;
    if (field.key.toLowerCase() === 'authorization') return preset?.id === 'notion' ? t.oauthAuthorization : t.authorization;
    return field.label;
  }

  function setTransport(next: McpTransport): void {
    transport = next;
    customized = true;
  }

  function customize(): void {
    args = [...argumentsOf, ...fields.filter(field => field.target === 'arg').map(field => presetArgs[field.key] ?? '')].join('\n');
    customized = true;
  }

  function addEntry(): void {
    const rows = transport === 'stdio' ? env : headers;
    rows.push({ id: ++sequence, key: '', value: '', secret: false });
  }

  function removeEntry(id: number): void {
    if (transport === 'stdio') env = env.filter(entry => entry.id !== id);
    else headers = headers.filter(entry => entry.id !== id);
  }

  function values(rows: Entry[], savedKeys: string[], normalize: (key: string) => string) {
    const shown: [string, string][] = [];
    const secret: [string, string | null][] = [];
    const kept = new Set<string>();
    const names = new Set<string>();
    for (const entry of rows) {
      const key = entry.key.trim();
      if (!key && !entry.value) continue;
      if (names.has(normalize(key))) throw new Error(t.distinctKeys);
      names.add(normalize(key));
      if (!entry.secret) shown.push([key, entry.value]);
      else if (entry.value !== '') {
        secret.push([key, entry.value]);
        kept.add(normalize(key));
      } else if (entry.savedKey && normalize(entry.savedKey) === normalize(key)) {
        kept.add(normalize(key));
      } else if (entry.savedKey) throw new Error(t.renamedSecret);
    }
    for (const key of savedKeys) if (!kept.has(normalize(key))) secret.push([key, null]);
    return { shown: Object.fromEntries(shown), secret: Object.fromEntries(secret) };
  }

  function pick(projectId: string, checked: boolean): void {
    selection = checked ? [...selection, projectId] : selection.filter(id => id !== projectId);
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    pending = true;
    error = '';
    try {
      const vars = values(transport === 'stdio' ? env : [], server?.secretEnvKeys ?? [], key => mcpEnvKey(key, os));
      const httpRows = transport === 'http' ? headers : [];
      const auth = values(originChanged ? httpRows.filter(entry => !entry.savedKey || entry.value !== '' || !entry.secret) : httpRows,
        originChanged ? [] : server?.secretHeaderKeys ?? [], key => key.toLowerCase());
      const nextArgs = customized
        ? args === '' ? [] : args.split(/\r?\n/)
        : [...argumentsOf, ...fields.filter(field => field.target === 'arg').map(field => presetArgs[field.key] ?? '').filter(Boolean)];
      await onsave({
        ...(server ? { id: server.id } : { enabled: true }), name, transport, scope,
        projectIds: scope === 'global' ? [] : [...selection],
        ...(transport === 'stdio' ? { command, args: nextArgs } : { url }),
        env: vars.shown, secretEnv: vars.secret, headers: auth.shown, secretHeaders: auth.secret,
      });
    } catch (cause) { error = errorText(cause); }
    finally { pending = false; }
  }

  let activeRows = $derived(transport === 'stdio' ? env : headers);
  let hasSecretRows = $derived(activeRows.some(row => row.secret));
</script>

<SettingsSection title={server ? fill(t.editServer, { name: server.name }) : preset ? fill(t.addPreset, { name: preset.name }) : t.addCustom} testid="mcp-form">
  <form onsubmit={save}>
    {#if preset && !customized}
      {#each fields as field (field.key)}
        <label class="input-field">
          <span>{fieldLabel(field)}{#if !field.required} <small>{t.optional}</small>{/if}</span>
          {#if field.target === 'arg'}
            <input required={field.required} bind:value={presetArgs[field.key]} />
          {:else}
            {@const entry = (field.target === 'header' ? headers : env).find(item => item.key === field.key)}
            {#if entry}<input type="password" autocomplete="off" required={field.required} bind:value={entry.value} />{/if}
          {/if}
        </label>
      {/each}
      <div class="preset-options">
        <a href={preset.docsUrl} target="_blank" rel="noreferrer">{t.docs}<ExternalLink size={13} /></a>
        <button type="button" class="ghost" onclick={customize}>{t.customize}</button>
      </div>
    {:else}
      <label class="input-field">
        <span>{t.name}</span>
        <input required maxlength={80} bind:value={name} />
      </label>
      <fieldset>
        <legend>{t.transport}</legend>
        <div class="choices">
          <label><input type="radio" name="{uid}-transport" checked={transport === 'stdio'} onchange={() => setTransport('stdio')} />{t.stdio}</label>
          <label><input type="radio" name="{uid}-transport" checked={transport === 'http'} onchange={() => setTransport('http')} />{t.http}</label>
        </div>
      </fieldset>
      {#if transport === 'stdio'}
        <div class="launch-fields">
          <label class="input-field"><span>{t.command}</span><input required bind:value={command} /></label>
          <label class="input-field"><span>{t.args}</span><textarea rows={2} placeholder={t.argsHint} bind:value={args}></textarea></label>
        </div>
      {:else}
        <label class="input-field"><span>{t.url}</span><input type="url" required bind:value={url} /></label>
        {#if originChanged}<Notice icon={TriangleAlert} tone="caution" detail={t.originChanged} />{/if}
      {/if}
      <fieldset>
        <legend>{transport === 'stdio' ? t.env : t.headers}</legend>
        {#each activeRows as entry (entry.id)}
          <div class="entry">
            <input aria-label={t.key} placeholder={t.key} required={entry.value !== ''} bind:value={entry.key} />
            <input aria-label={t.value} placeholder={entry.savedKey && entry.secret && !originChanged ? t.savedValue : t.value}
              type={entry.secret ? 'password' : 'text'} autocomplete="off" bind:value={entry.value} />
            <label class="secret-toggle"><SettingSwitch checked={entry.secret} onchange={event => entry.secret = event.currentTarget.checked} />{t.secret}</label>
            {#if entry.savedKey && entry.secret && entry.value === '' && !originChanged}<span class="saved">{t.saved}</span>{/if}
            <button type="button" class="icon-button small" aria-label={fill(t.removeEntry, { key: entry.key || t.key })} onclick={() => removeEntry(entry.id)}><X size={15} /></button>
          </div>
        {/each}
        <button type="button" class="ghost" onclick={addEntry}><Plus size={15} />{transport === 'stdio' ? t.addVariable : t.addHeader}</button>
      </fieldset>
    {/if}

    <fieldset>
      <legend>{t.scope}</legend>
      <div class="choices">
        <label><input type="radio" name="{uid}-scope" checked={scope === 'global'} onchange={() => scope = 'global'} />{t.global}</label>
        <label><input type="radio" name="{uid}-scope" checked={scope === 'projects'} onchange={() => scope = 'projects'} />{t.projects}</label>
      </div>
      {#if scope === 'projects'}
        <div class="project-picker">
          {#each projects as project (project.id)}
            <label><input type="checkbox" checked={selection.includes(project.id)} onchange={event => pick(project.id, event.currentTarget.checked)} />{projectName(project)}</label>
          {/each}
          {#each selection.filter(id => !projects.some(project => project.id === id)) as id (id)}
            <label><input type="checkbox" checked onchange={event => pick(id, event.currentTarget.checked)} />{t.unavailableProject}</label>
          {/each}
          {#if projects.length === 0}<small>{t.noProjects}</small>{/if}
        </div>
      {/if}
    </fieldset>

    {#if !encrypted && hasSecretRows}<Notice icon={TriangleAlert} tone="caution" detail={t.plainLinkSecrets} />{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={oncancel} disabled={pending}>{strings.common.cancel}</button>
      <button type="submit" class="primary" disabled={pending || (scope === 'projects' && !selection.some(id => projects.some(project => project.id === id)))}>{strings.common.save}</button>
    </div>
  </form>
</SettingsSection>

<style>
  form, fieldset, .input-field { display: grid; gap: var(--space-2); min-width: 0; }
  form { gap: var(--space-4); }
  fieldset { border: 0; margin: 0; padding: 0; }
  legend, .input-field span { color: var(--color-foreground); font-size: var(--text-sm); font-weight: 550; }
  legend { margin-bottom: var(--space-2); }
  .input-field input, textarea, .entry > input { width: 100%; min-width: 0; }
  textarea { resize: vertical; }
  small { color: var(--color-subtle); font-weight: normal; }
  .launch-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-3); align-items: start; }
  .entry { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .entry > input { flex: 1 1 95px; }
  .secret-toggle, .choices label, .project-picker label { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
  .saved { color: var(--color-subtle); font-size: var(--text-xs); }
  .choices, .preset-options, .actions { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
  .choices label { min-height: var(--control); }
  .choices input, .project-picker input { accent-color: var(--color-accent); }
  .project-picker { display: grid; gap: var(--space-1); max-height: 176px; overflow: auto; }
  .project-picker label { min-height: var(--control-sm); overflow-wrap: anywhere; }
  .preset-options a, button.ghost { display: inline-flex; gap: var(--space-1); align-items: center; justify-self: start; }
  .actions { justify-content: flex-end; }
  .error { margin: 0; color: var(--color-danger); overflow-wrap: anywhere; }
  @media (max-width: 560px) {
    .launch-fields { grid-template-columns: 1fr; }
    .entry > input { flex-basis: 40%; }
  }
</style>
