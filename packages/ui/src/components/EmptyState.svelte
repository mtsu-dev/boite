<script lang="ts" module>
  import type { Robot } from '../lib/robots';
  /** The house creature: a plain jelly with round eyes and a smile, no hat or gear, in its own teal. */
  export const HOUSE_BOT: Robot = { family: 'jelly', shape: 0, color: 6, eyes: 0, mouth: 1, top: 0, cheeks: 1, gear: 0 };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import RobotFace from './agents/RobotFace.svelte';

  /**
   * The one empty view of the app (first run, "All caught up", a list with
   * nothing in it): a drawn bot in its colours, one line, one action, as one
   * block centred in whatever card holds it. The rail keeps its bots grey;
   * here they are shown as drawn. `action` is the button or the short note
   * under the line.
   */
  let { line, robot = HOUSE_BOT, testid, markTestid, small = false, action }: {
    line: string;
    robot?: Robot;
    testid?: string;
    markTestid?: string;
    /** A list's empty pane rather than a whole screen: a smaller bot and line. */
    small?: boolean;
    action?: Snippet;
  } = $props();
</script>

<div class="empty-state" class:small data-testid={testid}>
  <span class="mark" data-testid={markTestid} aria-hidden="true"><RobotFace {robot} /></span>
  <h1 class="line">{line}</h1>
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .empty-state { flex: 1; align-self: stretch; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-4); min-height: 0; padding: var(--space-8) var(--space-6); text-align: center; animation: rise var(--dur-3) var(--ease-out-quint); }
  .mark { display: block; width: 96px; height: 96px; margin-bottom: var(--space-2); }
  .mark :global(svg.robot) { display: block; width: 100%; height: 100%; border-radius: 50%; }
  .line { max-width: 24ch; margin: 0; font-size: var(--text-lg); font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; text-wrap: balance; }
  .action { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); margin-top: var(--space-1); }
  .action :global(p) { max-width: 36ch; margin: 0; font-size: var(--text-base); line-height: 1.5; color: var(--color-muted-foreground); }
  .small { gap: var(--space-3); }
  .small .mark { width: 64px; height: 64px; margin-bottom: var(--space-1); }
  .small .line { font-size: var(--text-md); }
</style>
