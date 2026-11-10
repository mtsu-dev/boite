<script lang="ts">
  import { whip } from '../lib/whip.svelte';
  import { playCrack, primeCrackSound } from '../lib/whip/crack';
  import { strings } from '../lib/strings';

  let { mobile = false, onthrown }: { mobile?: boolean; onthrown?: () => void } = $props();

  // Reduced motion takes the rope and the shake away, never the crack: the
  // click sounds it in place and lights the button for one crack's length.
  let still = $state(false);
  let cracked = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Only the label follows the query's change event, which can arrive after a
  // click: the click reads the query itself.
  $effect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { still = motion.matches; };
    sync();
    motion.addEventListener('change', sync);
    return () => { motion.removeEventListener('change', sync); clearTimeout(timer); };
  });

  function crackInPlace() {
    primeCrackSound();
    playCrack();
    cracked = true;
    clearTimeout(timer);
    const token = getComputedStyle(document.documentElement).getPropertyValue('--dur-whip').trim();
    timer = setTimeout(() => { cracked = false; }, parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 0);
  }

  // The click only throws or drops the rope. The window shakes when it cracks.
  function toggle(event: MouseEvent) {
    if (whip.held) { whip.held = false; return; }
    if (reduced()) { crackInPlace(); return; }
    whip.throw(event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2);
    onthrown?.();
  }

  const label = $derived(whip.held ? strings.experiments.whip.drop : still ? strings.experiments.whip.still : strings.experiments.whip.action);
</script>

<button type="button" class="ghost icon whip" class:active={whip.held} class:cracked
  data-testid={mobile ? 'whip-button-mobile' : 'whip-button'}
  title={label} aria-label={label}
  aria-pressed={whip.held} onclick={toggle}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m3 20 5-5 3 3-5 5zM10 16c-3-5-1-12 4-12 6 0 8 7 3 8-3 1-5-2-2-4 3-2 7 1 6 5" />
  </svg>
</button>

<style>
  .whip { position: relative; z-index: calc(var(--z-whip) + 1); flex: none; color: var(--color-muted-foreground); }
  .whip:is(.active, .cracked) { color: var(--color-foreground); background: var(--color-surface-2); }
  @media (max-width: 720px) {
    .whip { width: var(--touch-target); height: var(--touch-target); }
  }
</style>
