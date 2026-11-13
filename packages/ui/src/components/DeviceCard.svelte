<script lang="ts">
  import { untrack } from 'svelte';
  import CardScope from './CardScope.svelte';
  import ShellSettings from './ShellSettings.svelte';
  import { strings } from '../lib/strings';
  import { readTerminalGpu, setTerminalGpu } from '../lib/terminal-cursor';

  /** This device's own choices: whether the app stays in the tray, starts at sign-in, and how it draws a terminal. */
  const uid = $props.id();
  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  let terminalGpu = $state(untrack(() => readTerminalGpu()));
</script>

<section class="card" id="settings-app" data-testid="settings-card-device">
  <h2><span class="ui-label">{strings.settingsMap.thisDevice}</span><CardScope /></h2>
  {#if inShell}<ShellSettings />{/if}
  <label for="{uid}-terminal-gpu" class="switch-row">
    <span class="text"><span class="ui-label" id="{uid}-terminal-gpu-name">{strings.settings.terminalGpu}</span><span class="hint" id="{uid}-terminal-gpu-effect">{strings.settings.terminalGpuHint}</span></span>
    <input id="{uid}-terminal-gpu" aria-labelledby="{uid}-terminal-gpu-name" aria-describedby="{uid}-terminal-gpu-effect" type="checkbox" role="switch" checked={terminalGpu} data-testid="terminal-gpu"
      onchange={(event) => { terminalGpu = event.currentTarget.checked; setTerminalGpu(terminalGpu); }} />
  </label>
</section>
