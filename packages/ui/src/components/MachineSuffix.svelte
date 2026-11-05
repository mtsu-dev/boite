<script lang="ts">
  import MachineIcon from './MachineIcon.svelte';
  import type { Machine } from '../lib/workspace.svelte';
  import { strings } from '../lib/strings';

  /**
   * A machine named after its project, as the Recent rows name it
   * ("render-farm · ☰ Builder"): the dot, the machine's 12 px glyph and its
   * name, in the muted tier, red while it does not answer. The caller draws
   * it only where `namesMachine` says so, never for this PC.
   */
  let { machine, testid }: { machine: Machine; testid?: string } = $props();
  const away = $derived(machine.store.connection !== 'ready');
</script>

<span class="machine-suffix" class:offline={away} data-testid={testid} title={`${machine.label} · ${strings.connection[machine.store.connection]}`}
  ><span class="dot" aria-hidden="true">·</span><MachineIcon icon={machine.icon} os={machine.store.core?.os} size={12} /><span class="label ui-label">{machine.label}</span></span>

<style>
  .machine-suffix {
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    gap: 4px;
    min-width: 0;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 400;
  }
  .machine-suffix > :global(svg) { flex: none; }
  /* The dot stands 8 px from the glyph, as "· Failed" stands from its word. */
  .dot { flex: none; margin-right: 4px; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offline { color: var(--color-danger); }
</style>
