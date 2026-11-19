<script lang="ts">
  import { Monitor, MonitorSmartphone } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { ScopeKind } from '../lib/page-scope.svelte';
  import { strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  let { title, page, scope, scopeTemplate, kind, picker, heading, mobile = false, limits = false }: {
    title: string;
    page: string;
    scope?: string | null;
    scopeTemplate?: string;
    kind?: ScopeKind | null;
    picker?: Snippet<[string]>;
    heading?: Snippet;
    mobile?: boolean;
    limits?: boolean;
  } = $props();
  function infoOf(page: string): string {
    switch (page) {
      case 'keyboard': return strings.keyboard.intro;
      case 'voice': return strings.speech.description;
      case 'accounts': return strings.providerSettings.intro;
      case 'plugins': return strings.plugins.intro;
      case 'usage': return `${strings.usage.intro} ${strings.usage.note}`;
      case 'machines': return strings.machines.intro;
      case 'experiments': return strings.settings.experiments.intro;
      case 'diagnostics': return strings.diagnostics.intro;
      case 'task-manager': return strings.taskManager.scope;
      case 'worktrees': return strings.settings.worktrees.intro;
      default: return '';
    }
  }
  const info = $derived(infoOf(page));
  const picks = $derived(kind === 'machine' ? picker : undefined);
</script>

<div class="heading" class:mobile class:limits>
  <h1 class="ui-label-box">
    {#if heading}{@render heading()}{:else}<span class="ui-label">{title}</span>{/if}
    {#if info}<InfoTip topic={title} text={info} testid={mobile ? 'mobile-settings-info' : 'settings-info'} />{/if}
  </h1>
  {#if scope}
    <p class="scope page-scope" class:picks data-testid={mobile ? 'mobile-settings-page-scope' : 'settings-scope'} data-scope={kind}>
      {#if kind === 'device'}<MonitorSmartphone size={14} strokeWidth={1.75} aria-hidden="true" />
      {:else if !picks}<Monitor size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
      {#if picks}{@render picks(scopeTemplate ?? strings.settings.scopeMachine)}{:else}<span class="ui-label">{scope}</span>{/if}
    </p>
  {/if}
</div>

<style>
  .heading { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
  h1 { min-width: 0; margin: 0; color: var(--color-foreground); font-size: var(--settings-title); font-weight: 650; line-height: 1.2; letter-spacing: -0.02em; }
  .mobile { flex: 1; align-items: stretch; }
  .mobile h1 { font-size: var(--text-md); font-weight: 600; line-height: inherit; letter-spacing: inherit; }
  .mobile.limits h1 { margin-right: 54px; }
  .mobile .page-scope { min-width: 0; margin: 2px 0 0; color: var(--color-subtle); line-height: 1.3; }
  .page-scope > .ui-label { min-width: 0; overflow-wrap: anywhere; }
  .page-scope > :global(svg) { flex: none; }
  .scope :global(.trigger.text) { margin: -2px 0; color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  .scope :global(.pick-name) { overflow: hidden; max-width: 28ch; text-overflow: ellipsis; white-space: nowrap; }
</style>
