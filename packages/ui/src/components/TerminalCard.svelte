<script lang="ts">
  import { untrack } from 'svelte';
  import CardScope from './CardScope.svelte';
  import { readTerminalCursor, setTerminalCursor, type TerminalCursor } from '../lib/terminal-cursor';
  import { featureOn } from '../lib/features.svelte';
  import { setFeature } from '../lib/features';
  import { strings } from '../lib/strings';

  /** Desktop details few people change: the terminal's cursor and the scrollbars' manner. */
  const uid = $props.id();
  let terminalCursor = $state<TerminalCursor>(untrack(() => readTerminalCursor()));
  let cursors = $derived<{ id: TerminalCursor; label: string }[]>([
    { id: 'bar', label: strings.settings.terminalCursorBar },
    { id: 'block', label: strings.settings.terminalCursorBlock },
    { id: 'underline', label: strings.settings.terminalCursorUnderline }
  ]);
  function pickTerminalCursor(next: TerminalCursor) {
    terminalCursor = next;
    setTerminalCursor(next);
  }
</script>

<section class="card" id="settings-details">
  <h2><span class="ui-label">{strings.settings.terminalAndScrollbars}</span><CardScope /></h2>
  <div class="switch-row">
    <span class="text ui-label">{strings.settings.terminalCursor}</span>
    <div class="segmented" role="group" aria-label={strings.settings.terminalCursor}>
      {#each cursors as option (option.id)}
        <button type="button" class:on={terminalCursor === option.id} aria-pressed={terminalCursor === option.id} data-testid="terminal-cursor-{option.id}" onclick={() => pickTerminalCursor(option.id)}><span class="ui-label">{option.label}</span></button>
      {/each}
    </div>
  </div>
  <label class="switch-row" for="{uid}-edge-scrollbars">
    <span class="text"><span class="ui-label" id="{uid}-edge-scrollbars-name">{strings.features.edgeScrollbars.title}</span><span class="hint" id="{uid}-edge-scrollbars-effect">{strings.features.edgeScrollbars.hint}</span></span>
    <input id="{uid}-edge-scrollbars" aria-labelledby="{uid}-edge-scrollbars-name" aria-describedby="{uid}-edge-scrollbars-effect" type="checkbox" role="switch" checked={featureOn('edge-scrollbars')} data-testid="setting-edge-scrollbars"
      onchange={event => setFeature('edge-scrollbars', event.currentTarget.checked)} />
  </label>
</section>
