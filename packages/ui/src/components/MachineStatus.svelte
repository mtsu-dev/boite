<script lang="ts">
  import { machineName, listedName, isThisPC, machineHealth, workspace } from '../lib/workspace.svelte';
  import { Gauge, Monitor, TriangleAlert } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { lowestLimit } from '../lib/limits-meter';
  import type { Snippet } from 'svelte';
  import type { Store } from '../lib/store.svelte';
  import Menu from './Menu.svelte';
  import { separator, type MenuItem } from '../lib/menu';

  /**
   * The rail's one utility button: the machines and, with `limits`, the
   * glance at the subscription limits, in one menu. Without `limits`, one
   * machine that is connected says nothing, so nothing is drawn; a second
   * machine, a filter or a connection in trouble brings back one icon, the
   * chosen machine's name beside it only while it filters the list. A remote
   * machine that is merely switched off is grey in the menu and raises no
   * warning (`machineHealth`).
   */
  let { store, filter = null, onfilter, limits, meter = null, testid = 'machine-status', card }: {
    store: Store; filter?: string | null; onfilter?: (id: string | null) => void; limits?: () => void; testid?: string;
    /** What the least-off account has left (lib/limits-meter.ts): the gauge reads it in place of the bare glyph. */
    meter?: ReturnType<typeof lowestLimit>;
    /** The rail's name card, drawn beside the button in place of the native tooltip: the name, then the trouble or the machine it filters on. */
    card?: Snippet<[string, string | null]>;
  } = $props();

  const machines = $derived([...workspace.machinesOr(store)]
    .sort((a, b) => Number(isThisPC(b)) - Number(isThisPC(a))));
  const health = $derived(new Map(machines.map(m => [m, machineHealth(m, store)])));
  const issues = $derived(machines.filter(m => health.get(m) === 'lost').length);
  const tones = { ready: 'success', connecting: 'warning', offline: 'neutral', lost: 'danger' } as const;
  const chosen = $derived(filter === null ? null : machines.find(m => m.id === filter) ?? null);
  const shown = $derived(limits !== undefined || machines.length > 1 || issues > 0 || chosen !== null);
  /* The glyph is the Gauge every limits surface wears (Limits page, glance, pinned quota),
     so the card names that first: what the gauge measures, then the machines behind it. */
  const name = $derived(limits ? strings.app.rail.utilities : strings.machines.filter);
  const trouble = $derived(issues > 0 ? `${issues} ${strings.connection.issues}` : null);
  /** The gauge on: limits shown, no trouble to say first, no machine filtering. */
  const gauge = $derived(limits && !issues && chosen === null ? meter : null);
  const left = $derived(gauge ? fill(strings.app.rail.limitsLeft, { percent: String(gauge.left), window: gauge.window, account: gauge.account }) : null);
  const label = $derived(trouble ? `${name} · ${trouble}` : left ? `${name} · ${left}` : name);
  const items = $derived<MenuItem[]>([
    ...(machines.length > 1 ? [
      { id: 'all', label: strings.machines.all, active: filter === null, hideActiveMark: true },
      ...machines.map(m => ({ id: m.id, label: listedName(m), status: { tone: tones[health.get(m)!], label: health.get(m) === 'offline' ? strings.connection.offline : strings.connection[m.store.connection] }, active: m.id === filter })),
      separator('manage-separator')
    ] : []),
    ...(limits ? [{ id: 'limits', label: strings.quotas.glance, glyph: Gauge, testid: 'nav-limits' }] : []),
    { id: 'manage', label: strings.connection.manage, icon: 'settings' }
  ]);
  function choose(id: string) {
    if (id === 'manage') store.showSettings('machines');
    else if (id === 'limits') limits?.();
    else onfilter?.(id === 'all' ? null : id);
  }
</script>

<!-- The wrapper stays, empty, so the connection state is always readable on it. -->
<div class="machines" class:problem={issues > 0} class:filtered={chosen !== null} data-testid={testid === 'machine-status' ? 'status-connection' : `${testid}-status`} data-state={store.connection} aria-live="polite">
  {#if shown}
    <Menu {items} onpick={choose} {label} variant="ghost" {testid} titled={!card}>
      {#if issues}<TriangleAlert size={16} />
      {:else if gauge}
        <!-- The gauge reads its number: the ring is what is left of the lowest window, the figure says it. -->
        <span class="gauge {gauge.tone}" data-testid="limits-gauge" data-left={gauge.left} aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle class="track" cx="12" cy="12" r="10.5" /><circle class="fill" cx="12" cy="12" r="10.5" pathLength="100" stroke-dasharray="{gauge.left} 100" /></svg>
          <span class="figure">{gauge.left}</span>
        </span>
      {:else if limits && chosen === null}<Gauge size={16} />{:else}<Monitor size={16} />{/if}
      {#if chosen}<span class="name ui-label">{machineName(chosen)}</span>{/if}
    </Menu>
    {@render card?.(name, trouble ?? (chosen ? machineName(chosen) : left))}
  {/if}
</div>

<style>
  .machines { min-width: 0; color: var(--color-muted-foreground); }
  .machines :global(.trigger) { font-size: var(--text-xs); }
  /* A filter hides threads, so while one is on the button says which machine. */
  .filtered :global(.trigger) { width: auto; max-width: 160px; padding: 0 8px; gap: 6px; background: var(--color-active); color: var(--color-foreground); }
  /* min-width: a flex item never shrinks below its text otherwise, and a long
     name ran out of the button instead of ending in an ellipsis. */
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gauge { position: relative; display: grid; place-items: center; width: 26px; height: 26px; }
  .gauge svg { position: absolute; inset: 0; transform: rotate(-90deg); }
  .gauge circle { fill: none; stroke-width: 2; }
  .gauge .track { stroke: var(--color-border); }
  .gauge .fill { stroke: currentColor; stroke-linecap: round; }
  .figure { font-size: 10px; font-weight: 600; letter-spacing: -0.3px; font-variant-numeric: tabular-nums; color: var(--color-foreground); }
  /* The limits views' tones: plain while there is room, amber running low, red spent. */
  .gauge.ok { color: var(--color-muted-foreground); }
  .gauge.low { color: var(--color-live); }
  .gauge.out { color: var(--color-danger); }
  .problem { color: var(--color-live); }
  .problem :global(.trigger) { color: var(--color-live); }
</style>
