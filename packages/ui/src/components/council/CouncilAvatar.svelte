<script lang="ts">
  /**
   * A member's round face in a council's card and salon (`docs/council.md`):
   * the first letter of the model's name on its series colour, the same
   * colour for the same member everywhere. `me` is the owner, `mod` a post
   * no member wrote: the parent thread's changes, or an old debate's summary.
   */
  let { kind = 'ai', series = 0, label, size = 28 }: {
    kind?: 'ai' | 'me' | 'mod';
    /** The member's place in the council, from 0: it picks the colour. */
    series?: number;
    /** The letter or two drawn inside. */
    label: string;
    size?: number;
  } = $props();
</script>

<span
  class="av"
  class:me={kind === 'me'}
  class:mod={kind === 'mod'}
  style:--av-size="{size}px"
  style:--av-fill={kind === 'ai' ? `var(--series-${(series % 8) + 1})` : undefined}
  aria-hidden="true"
>{label}</span>

<style>
  .av {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--av-size);
    height: var(--av-size);
    border-radius: 50%;
    background: var(--av-fill);
    color: var(--color-surface);
    font-size: calc(var(--av-size) * 0.4);
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
  /* The series colours are a chart's: under the light theme's white letter they read 3 to 4:1,
     so a face takes its colour at half lightness at most. */
  :global([data-theme='light']) .av:not(.me, .mod) { background: oklch(from var(--av-fill) min(l, 0.5) c h); }
  .me { background: var(--color-surface-3); color: var(--color-foreground); }
  .mod { background: transparent; border: 1px solid var(--color-border); color: var(--color-muted-foreground); }
</style>
