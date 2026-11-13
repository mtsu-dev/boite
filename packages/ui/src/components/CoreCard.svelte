<script lang="ts">
  import CardScope from './CardScope.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /** The core this window talks to: what to read out when asking for help. */
  let { store }: { store: Store } = $props();
</script>

<section class="card" id="settings-core">
  <h2><span class="ui-label">{strings.settings.core}</span><CardScope {store} /></h2>
  {#if store.core}
    <dl>
      <dt>{strings.settings.version}</dt>
      <dd data-testid="settings-version">{store.core.version}</dd>
      <dt>{strings.settings.protocol}</dt>
      <dd>{store.core.protocolVersion}</dd>
      <dt>{strings.settings.os}</dt>
      <dd>{store.core.os}</dd>
      <dt>{strings.settings.pid}</dt>
      <dd>{store.core.pid}</dd>
      <dt>{strings.settings.endpoint}</dt>
      <dd class="mono" data-testid="settings-endpoint">{store.core.endpoint.host}:{store.core.endpoint.port}</dd>
      <dt>{strings.settings.dataDir}</dt>
      <dd class="mono">{store.core.dataDir}</dd>
    </dl>
  {:else}
    <p class="hint">{strings.settings.noCore}</p>
  {/if}
</section>

<style>
  /* The settings row grammar: the name at the start, its value at the end, a hairline between rows,
     so the card reads across its whole width instead of leaving its right half empty. */
  dl { display: grid; grid-template-columns: 140px 1fr; margin: 0; }
  /* Both cells fill the row on one line height, so each row's hairline runs straight across both columns
     (baseline alignment let the 13 px name and the 14 px value draw theirs at two heights). */
  dt, dd { padding: 7px 0; line-height: 20px; }
  dt:not(:first-of-type), dd:not(:first-of-type) { border-top: 1px solid var(--color-border); }
  dt { color: var(--color-muted-foreground); font-size: var(--text-sm); }
  /* Versions and numbers read in the sans; only an address and a path stay mono. */
  dd { margin: 0; padding-left: var(--space-3); text-align: end; overflow: hidden; text-overflow: ellipsis; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
</style>
