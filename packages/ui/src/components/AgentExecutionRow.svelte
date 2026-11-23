<script lang="ts">
  import { Workflow } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { ThreadContextMode } from '@boite/contracts';
  import type { executionRoute } from '../lib/execution-route';
  import type { StatusMarkProps } from '../lib/status-tone';
  import { strings } from '../lib/strings';
  import ContextModeBadge from './ContextModeBadge.svelte';
  import Elapsed from './Elapsed.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import StatusMark from './StatusMark.svelte';

  let {
    title, subtitle, route, context, requested = false, mark, outcome, status,
    startedAt = null, finishedAt = null, active = false, tokens, compact = false,
    routeTestId, contextTestId, effortTestId, tokensTestId, chips, titleAside, children
  }: {
    title: string; subtitle?: string; route?: ReturnType<typeof executionRoute> | null;
    context?: ThreadContextMode | null; requested?: boolean; mark?: StatusMarkProps;
    outcome?: string | null; status?: string; startedAt?: number | null; finishedAt?: number | null;
    active?: boolean; tokens?: string | null; compact?: boolean; routeTestId?: string;
    contextTestId?: string; effortTestId?: string; tokensTestId?: string;
    chips?: Snippet; titleAside?: Snippet; children?: Snippet;
  } = $props();
</script>

<span class="execution" class:compact>
  <span class="avatar" class:generic={!route} role={route ? 'img' : undefined} aria-label={route?.maker} title={route?.maker}>
    {#if route}<ProviderLogo providerId={route.logo} size={20} />{:else}<Workflow size={16} strokeWidth={1.75} />{/if}
    {#if mark}<StatusMark {...mark} corner />{/if}
  </span>
  <span class="member-main">
    <strong class="title"><span class="ui-label">{title}</span>{@render titleAside?.()}</strong>
    {#if route || subtitle || context || chips}
      <span class="route" data-testid={routeTestId} title={route?.label}>
        {#if route}
          <span class="model ui-label">{route.name}</span>
          {#if route.effort}<span class="effort ui-label" data-testid={effortTestId}>{route.effort}</span>{/if}
        {:else if subtitle}
          <span class="ui-label">{subtitle}</span>
        {/if}
        {#if context}<ContextModeBadge mode={context} compact {requested} testid={contextTestId} />{/if}
        {@render chips?.()}
      </span>
    {/if}
  </span>
  {#if outcome || startedAt !== null || tokens}
    <span class="meta">
      {#if outcome}<span class="outcome ui-label" data-status={status}>{outcome}</span>{/if}
      {#if startedAt !== null}<Elapsed {startedAt} {finishedAt} {active} />{/if}
      {#if tokens}<span class="tokens ui-label" data-testid={tokensTestId} title={tokensTestId ? strings.workflow.tokensHelp : undefined}>{tokens}</span>{/if}
    </span>
  {/if}
  {@render children?.()}
</span>

<style>
  .execution { width: 100%; min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 0 10px; }
  .avatar { --ring: var(--color-background); position: relative; width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--color-surface-2); border: 1px solid var(--color-border); }
  .avatar.generic { color: var(--color-muted-foreground); }
  .member-main { min-width: 0; display: grid; gap: 6px; padding-top: 1px; }
  .title { min-width: 0; display: flex; align-items: center; gap: 5px; font-size: var(--text-sm); font-weight: 600; }
  .title .ui-label, .model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .route { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .model { color: var(--color-foreground); font-weight: 500; }
  .effort { flex: none; padding: 3px 6px; border-radius: var(--radius-sm); background: var(--color-surface-3); color: var(--color-muted-foreground); }
  .meta { display: grid; justify-items: end; gap: 6px; padding-top: 2px; color: var(--color-muted-foreground); font-size: var(--text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .outcome { font-weight: 500; }
  .outcome[data-status='error'], .outcome[data-status='failed'], .outcome[data-status='interrupted'] { color: var(--color-danger); }
  .compact { grid-template-columns: auto minmax(0, 1fr); }
  .compact .title { align-items: baseline; flex-wrap: wrap; gap: var(--space-1); line-height: 1.25; }
  .compact .title > .ui-label:first-child { overflow: visible; overflow-wrap: anywhere; white-space: normal; text-box: normal; }
  .compact .route { flex-wrap: wrap; gap: 4px; }
  .compact .route > .model { text-box: normal; padding: 0; margin: 0; }
  .compact .effort { text-box: normal; line-height: 1; }
  .compact .meta { grid-column: 2; display: flex; flex-wrap: wrap; gap: 2px 6px; padding-top: var(--space-2); white-space: normal; }
</style>
