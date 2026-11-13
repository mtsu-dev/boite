<script lang="ts" module>
  /** One machine in the rail's card: its name, its state in words and the status grammar's tone for its dot. */
  export type MachineLine = { id: string; name: string; state: string; tone: 'success' | 'warning' | 'offline' };
</script>

<script lang="ts">
  import { machineName, listedName, isThisPC, machineHealth, workspace } from '../lib/workspace.svelte';
  import { Monitor } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { Snippet } from 'svelte';
  import type { Store } from '../lib/store.svelte';
  import Menu from './Menu.svelte';
  import { separator, type MenuItem } from '../lib/menu';

  /**
   * The rail's machines button and its menu; the limits live at the foot of
   * the list column (QuotaLine.svelte). One
   * machine that is connected says nothing, so nothing is drawn; a second
   * machine, a filter or a connection in trouble brings back one icon, the
   * chosen machine's name beside it only while it filters the list. Its card
   * and its name say which machine it is and how it is: "Studio: Connected".
   * One glyph per state, whatever the view: the monitor with a green dot while
   * every machine answers, with the offline ring (MachineOffline's) while one
   * is out of reach, switched off or lost alike, and the crossed monitor once
   * none answers. The card and the menu mark an offline machine with that ring.
   */
  let { store, filter = null, onfilter, testid = 'machine-status', card }: {
    store: Store; filter?: string | null; onfilter?: (id: string | null) => void; testid?: string;
    /** The rail's name card, drawn in place of the native tooltip: "Machines", what a click does when it filters, the
     *  trouble, then one line per machine with its state dot ("studio  Connected"). */
    card?: Snippet<[string, string | null, string | null, MachineLine[]]>;
  } = $props();

  const machines = $derived([...workspace.machinesOr(store)]
    .sort((a, b) => Number(isThisPC(b)) - Number(isThisPC(a))));
  const health = $derived(new Map(machines.map(m => [m, machineHealth(m, store)])));
  const issues = $derived(machines.filter(m => health.get(m) === 'lost').length);
  const tones = { ready: 'success', connecting: 'warning', offline: 'offline', lost: 'offline' } as const;
  const chosen = $derived(filter === null ? null : machines.find(m => m.id === filter) ?? null);
  const shown = $derived(machines.length > 1 || issues > 0 || chosen !== null);
  const name = $derived(strings.machines.heading);
  // Off by choice or by sleep, not a fault: quiet, in the status grammar's grey, named in the tooltip and the name.
  const away = $derived(machines.filter(m => health.get(m) === 'offline'));
  /** Out of reach for any reason: what the glyph counts. */
  const down = $derived(machines.filter(m => health.get(m) === 'offline' || health.get(m) === 'lost').length);
  const trouble = $derived(issues > 0 ? `${issues} ${strings.connection.issues}`
    : away.length > 0 ? away.map(m => fill(strings.connection.nameOffline, { name: machineName(m) })).join(', ') : null);
  // Switched off or lost, the word is the ring's: Offline.
  const stateOf = (m: (typeof machines)[number]) => health.get(m) === 'offline' || health.get(m) === 'lost' ? strings.connection.offline : strings.connection[m.store.connection];
  /** Each machine and its state, the chosen one alone while it filters: what the glyph means, in words. */
  const states = $derived((chosen ? [chosen] : machines).map(m => fill(strings.machines.state, { name: machineName(m), state: stateOf(m) })).join(', '));
  const note = $derived(issues > 0 ? `${trouble}. ${states}` : states);
  const label = $derived(`${name} · ${note}`);
  const lines = $derived<MachineLine[]>(machines.map(m => ({ id: m.id, name: machineName(m), state: stateOf(m), tone: tones[health.get(m)!] })));
  const items = $derived<MenuItem[]>([
    ...(machines.length > 1 ? [
      { id: 'all', label: strings.machines.all, checked: filter === null, radio: true },
      ...machines.map(m => ({ id: m.id, label: tones[health.get(m)!] === 'offline' ? fill(strings.connection.nameOffline, { name: listedName(m) }) : listedName(m), status: { tone: tones[health.get(m)!], label: stateOf(m) }, checked: m.id === filter, radio: true })),
      separator('manage-separator')
    ] : []),
    { id: 'manage', label: strings.connection.manage, icon: 'settings' }
  ]);
  function choose(id: string) {
    if (id === 'manage') store.showSettings('machines');
    else onfilter?.(id === 'all' ? null : id);
  }
</script>

<!-- The wrapper stays, empty, so the connection state is always readable on it. -->
<div class="machines" class:filtered={chosen !== null} data-testid={testid === 'machine-status' ? 'status-connection' : `${testid}-status`} data-state={store.connection} aria-live="polite">
  {#if shown}
    <Menu {items} onpick={choose} {label} variant="ghost" {testid} titled={!card}>
      <!-- The rail's optical size and stroke (the chat icon's): the crossed monitor when none answers, else the monitor and one mark, the offline ring while one is away, green while all answer. -->
      <Monitor size={19} />{#if down > 0 && down === machines.length}<span class="strike" data-testid="machine-all-offline" aria-hidden="true"></span>{:else if down > 0}<span class="dot off" data-testid="machine-offline" aria-hidden="true"></span>{:else if store.connection === 'ready'}<span class="dot on" data-testid="machine-online" aria-hidden="true"></span>{/if}
      {#if chosen}<span class="name ui-label">{machineName(chosen)}</span>{/if}
    </Menu>
    {@render card?.(name, machines.length > 1 ? strings.machines.filterHint : null, issues > 0 ? trouble : null, lines)}
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
  .machines :global(.trigger) { position: relative; }
  /* On the screen's lower right corner (the glyph is 19 px in the middle of the button), cut out of the chrome:
     the phone header's dot (MobileNavigation.svelte), so a connection reads the same on both. */
  .dot { position: absolute; left: calc(50% + 5px); top: calc(50% - 1px); width: 7px; height: 7px; border-radius: var(--radius-full); box-shadow: 0 0 0 2px var(--color-frame); }
  .dot.on { background: var(--color-success); }
  /* The offline ring (MachineOffline's mark), filled with the chrome so the glyph does not show through. */
  .dot.off { background: var(--color-frame); box-shadow: inset 0 0 0 1.5px var(--color-muted-foreground), 0 0 0 2px var(--color-frame); }
  .machines :global(.trigger:hover .dot) { box-shadow: 0 0 0 2px var(--color-hover); }
  /* None answers: the monitor crossed out, a stroke of its own weight drawn here (an icon would weigh on the first load), edged in the chrome. */
  .strike { position: absolute; left: calc(50% - 12px); top: calc(50% - 1px); width: 24px; height: 2px; border-radius: var(--radius-full); background: currentColor; box-shadow: 0 0 0 1.5px var(--color-frame); transform: rotate(45deg); }
  .machines :global(.trigger:hover .strike) { box-shadow: 0 0 0 1.5px var(--color-hover); }
  .machines :global(.trigger:hover .dot.off) { background: var(--color-hover); box-shadow: inset 0 0 0 1.5px var(--color-muted-foreground), 0 0 0 2px var(--color-hover); }
</style>
