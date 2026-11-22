<script lang="ts">
  import { markFeature } from '@boite/contracts';
  import { BACKDROP_SCENES, backdrop } from '../../lib/backdrop/choice.svelte';
  import type { CalmBox, RunningBackdrop } from '../../lib/backdrop/engine';
  import type { SceneId } from '../../lib/backdrop/scenes';

  markFeature('boite-feature:draft-backdrop');

  /**
   * The scene behind the empty new thread screen. `area` is the column it
   * fills: the pieces there marked `data-backdrop-calm` hold the words the
   * scene is dimmed around, and with the composer they are what it is built
   * around. `covered` says the screen is mounted but out of
   * sight, under a phone's list or its settings: the scene waits there.
   */
  let { area = null, covered = false }: { area?: HTMLElement | null; covered?: boolean } = $props();
  let live = $state.raw<RunningBackdrop | null>(null);
  $effect(() => { live?.cover(covered); });

  // Random settles once per empty screen: the scene holds while the screen stays.
  const drawn = BACKDROP_SCENES[Math.floor(Math.random() * BACKDROP_SCENES.length)] ?? 'glyphs';
  let scene = $derived(backdrop.shown === 'random' ? drawn : backdrop.shown);

  /** The words on screen: a piece the layout hides has no box and is left out. */
  function words(): HTMLElement[] {
    return [...(area?.querySelectorAll<HTMLElement>('[data-backdrop-calm]') ?? [])].filter((piece) => piece.offsetWidth > 0 && piece.offsetHeight > 0);
  }

  /** The box around these pieces, from the canvas's top left corner. */
  function around(node: HTMLCanvasElement, pieces: HTMLElement[]): CalmBox | null {
    if (pieces.length === 0) return null;
    const frame = node.getBoundingClientRect();
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const piece of pieces) {
      const box = piece.getBoundingClientRect();
      left = Math.min(left, box.left); top = Math.min(top, box.top);
      right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
    }
    return { x: left - frame.left, y: top - frame.top, width: right - left, height: bottom - top };
  }

  /** The words and the composer under them: the block the eye rests on, the scene's heart. */
  function block(): HTMLElement[] {
    const composer = area?.querySelector<HTMLElement>('[data-testid=composer]');
    return composer && composer.offsetHeight > 0 ? [...words(), composer] : words();
  }

  /** Runs the scene on its canvas. The renderer is fetched here, the first time a scene shows. */
  function play(node: HTMLCanvasElement, id: SceneId) {
    let running: RunningBackdrop | null = null;
    let gone = false;
    // The words move when they wrap, when the composer under them grows and while the screen's entrance plays.
    const settle = () => running?.settle();
    const moved = new ResizeObserver(settle);
    let column: HTMLElement | null = null;
    void import('../../lib/backdrop/engine').then(({ startBackdrop }) => {
      if (gone) return;
      running = live = startBackdrop(node, id, { ready: () => { node.dataset['ready'] = ''; }, calm: () => around(node, words()), heart: () => around(node, block()), covered });
      if (!running || !area) return;
      for (const piece of area.querySelectorAll<HTMLElement>('[data-backdrop-calm], [data-testid=composer]')) moved.observe(piece);
      column = area;
      column.addEventListener('animationend', settle);
    }, () => { /* the screen is whole without its scene */ });
    return {
      destroy() {
        gone = true;
        moved.disconnect();
        column?.removeEventListener('animationend', settle);
        if (live === running) live = null;
        running?.stop();
      }
    };
  }
</script>

{#if scene !== 'off'}
  <!-- A canvas per scene: a stopped one gives its graphics context back for good. -->
  {#key scene}
    <canvas class="backdrop" aria-hidden="true" data-testid="draft-backdrop" data-scene={scene} use:play={scene}></canvas>
  {/key}
{/if}

<style>
  /* Under the heading and the composer, which come after it in the column,
     and never in the way of a click. The renderer reads the text colour, the
     accent and the code face from here. */
  .backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    font-family: var(--font-mono);
    opacity: 0;
    transition: opacity calc(var(--dur-3) * 3) var(--ease-out-quint);
  }

  .backdrop:global([data-ready]) {
    opacity: 1;
  }
</style>
