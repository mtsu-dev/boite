<script lang="ts">
  /**
   * A debater's round face in a debate's card and salon (`docs/debates.md`):
   * the first letter of the model's name on its series colour, the same
   * colour for the same debater everywhere. `me` is the owner, `mod` the AI
   * that writes the summary and did not debate.
   */
  let { kind = 'ai', series = 0, label, size = 28 }: {
    kind?: 'ai' | 'me' | 'mod';
    /** The debater's place in the debate, from 0: it picks the colour. */
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
  .me { background: var(--color-surface-3); color: var(--color-foreground); }
  .mod { background: transparent; border: 1px solid var(--color-border); color: var(--color-muted-foreground); }
</style>
