<script lang="ts">
  import { Monitor } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { HostMark } from '../lib/machine-host';

  /**
   * A machine named as a place wherever it stands beside a project or a thread (a list card's head, the palette, a
   * phone card, Recent's place line): one monitor glyph and "on <machine>", so "Builder" reads as where the work
   * runs, not a tag. Out of reach, its state follows as a small mark of its own, never run into the name.
   */
  let { host, size = 12, testid }: { host: HostMark; size?: number; testid?: string } = $props();
</script>

<span class="machine-place" class:offline={host.away} data-testid={testid} data-state={host.state} title={host.text}>
  <span class="on"><Monitor {size} strokeWidth={1.75} aria-hidden="true" /><span class="ui-label">{fill(strings.connection.onMachine, { name: host.label })}</span></span>{#if host.away}<span class="away" data-testid="machine-away">{host.state === 'connecting' ? strings.connection.connecting : strings.connection.offline}</span>{/if}
</span>

<style>
  .machine-place { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-xs); font-weight: 400; color: var(--color-subtle); white-space: nowrap; }
  .on { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
  .on > :global(svg) { flex: none; }
  .on > .ui-label { overflow: hidden; text-overflow: ellipsis; }
  /* Its state, a small mark beside the name in the readable secondary ink: the name stays the place. */
  .away { flex: none; padding: 1px 6px; border: 1px solid var(--color-edge); border-radius: var(--radius-sm); color: var(--color-muted-foreground); line-height: 1.3; }
</style>
