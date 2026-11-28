<script lang="ts">
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import type { CompactionTarget } from '@boite/contracts';
  import { compactionPolicy, type CompactionWrites } from '../lib/compaction-settings';
  import InfoTip from './InfoTip.svelte';

  /**
   * The `backgroundCompaction` setting: near the automatic compaction's token
   * limit, a copy of the session compacts while the thread goes on, and the
   * thread takes it at the next pause (`docs/internals/context.md`, "Background compaction").
   * Common background compaction stays local; per-type policies follow the
   * group's compaction defaults when the machine inherits its settings.
   */
  let { store, target, writes }: { store: Store; target: CompactionTarget; writes: CompactionWrites } = $props();
  const uid = $props.id();

  /** A switch saves when it flips; a refusal puts it back. */
  let saving = $state(false);
  export function flush() {
    return writes.idle();
  }
  async function save(input: HTMLInputElement) {
    saving = true;
    try {
      if (!await writes.save(store, target, { backgroundCompaction: input.checked }).catch(() => false)) input.checked = !input.checked;
    } finally { saving = false; }
  }
</script>

<!-- The copies run on the core's machine and spend its accounts, so only the owner turns it on; an agent asks through a settings card. -->
{#if store.owner}
  <section data-testid="background-compaction-settings">
    <label for="{uid}-on" class="master">
      <span class="words">
        <h2 class="ui-label-box"><span class="ui-label" id="{uid}-on-name">{strings.settings.backgroundCompaction}</span><InfoTip topic={strings.settings.backgroundCompaction} text={strings.settings.backgroundCompactionHint} /></h2>
        <span class="effect" id="{uid}-on-effect">{strings.settings.effects.backgroundCompaction}</span>
      </span>
      <input id="{uid}-on" aria-labelledby="{uid}-on-name" aria-describedby="{uid}-on-effect" type="checkbox" role="switch" data-testid="background-compaction-on"
        checked={compactionPolicy(store.settings, target).backgroundCompaction} disabled={!store.settings || saving} onchange={(event) => void save(event.currentTarget)} />
    </label>
  </section>
{/if}

<style>
  .master { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; cursor: pointer; }
  .master .words { display: grid; gap: 6px; flex: 1; min-width: 0; }
  .effect { color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.5; }
  .master .words h2 { margin: 0; }
</style>
