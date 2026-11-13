<script lang="ts">
  import { markFeature } from '@boite/contracts';
  import type { Snippet } from 'svelte';
  import { whip } from '../lib/whip.svelte';
  import { strings } from '../lib/strings';

  /** `name`: the rail's name card, drawn beside the button in place of the native tooltip, as every rail button's. */
  let { mobile = false, onthrown, name }: { mobile?: boolean; onthrown?: () => void; name?: Snippet<[string, string | null]> } = $props();

  // The whip is all motion: under reduced motion the control stays visible,
  // greyed, and its tooltip says where the system turns animations back on.
  let off = $state(false);

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The look follows the query's change event, which can arrive after a
  // click: the click reads the query itself.
  $effect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { off = motion.matches; };
    sync();
    motion.addEventListener('change', sync);
    return () => motion.removeEventListener('change', sync);
  });

  // The click only throws or drops the rope. The window shakes when it cracks.
  function toggle(event: MouseEvent) {
    if (whip.held) { whip.held = false; return; }
    if (reduced()) return;
    whip.throw(event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2);
    onthrown?.();
  }

  const label = $derived(whip.held ? strings.experiments.whip.drop : off ? strings.experiments.whip.off : strings.experiments.whip.action);
  // Marks this module in a bundle: a call no bundler drops (scripts/ci/feature-cut.ts).
  markFeature('boite-feature:whip');
</script>

<!-- data-feature: the marker a build without the Whip must not hold (scripts/ci/feature-cut.ts). -->
<button type="button" class="ghost icon whip" class:active={whip.held} data-feature="boite-feature:whip"
  data-testid={mobile ? 'whip-button-mobile' : 'whip-button'}
  title={name ? undefined : label}
  aria-label={label}
  aria-pressed={whip.held} aria-disabled={off && !whip.held} onclick={toggle}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m3 20 5-5 3 3-5 5zM10 16c-3-5-1-12 4-12 6 0 8 7 3 8-3 1-5-2-2-4 3-2 7 1 6 5" />
  </svg>
</button>
{@render name?.(label, null)}

<style>
  .whip { position: relative; z-index: calc(var(--z-whip) + 1); flex: none; color: var(--color-muted-foreground); }
  .whip.active { color: var(--color-foreground); background: var(--color-surface-2); }
  /* Disabled by the system, not the app: still hoverable, so its tooltip says why. */
  .whip[aria-disabled='true'] { opacity: 0.45; cursor: default; }
  .whip[aria-disabled='true']:is(:hover, :active) { background: transparent; color: var(--color-muted-foreground); transform: none; }
  @media (max-width: 720px) {
    .whip { width: var(--touch-target); height: var(--touch-target); }
  }
</style>
