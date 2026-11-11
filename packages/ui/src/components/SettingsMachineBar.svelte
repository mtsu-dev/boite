<script lang="ts">
  import { ChevronDown, Info } from '@lucide/svelte';
  import Menu from './Menu.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import { fill, strings } from '../lib/strings';
  import { listedName, machineName, workspace, type Machine } from '../lib/workspace.svelte';

  /**
   * The machine a settings page changes, picked above every page that belongs
   * to one machine. One that follows its group's default machine says so, and
   * each setting changed on it anyway carries a star (`SyncMark.svelte`).
   */
  let { machine, machines, onpick, picker = true }: {
    machine: Machine;
    machines: Machine[];
    onpick: (id: string) => void;
    /** False on a desktop page whose header scope is the picker (SettingsScope.svelte): the bar keeps its notes. */
    picker?: boolean;
  } = $props();
  let items = $derived(machines.map((entry) => ({ id: entry.id, label: listedName(entry), active: entry === machine })));
  let words = $derived(strings.settings.scopeMachine.split('{machine}'));
  let home = $derived(workspace.settingsSync.sourceName(machine));
  let connected = $derived(workspace.settingsSync.source(machine) !== undefined);
  /** The default machine itself, while others follow it. */
  let isHome = $derived(home === undefined && machine.store.group?.settingsHome === machine.store.group?.self && machine.store.group?.settingsHome !== undefined
    && (machine.store.group?.cores.length ?? 0) > 1);
</script>

<div class="machine-bar" data-testid="settings-machine-bar">
  {#if picker && machines.length > 1}
    <!-- The scope line's words around the picker: "Agent settings apply on [studio v]". -->
    <p class="scope-line">
      {#if words[0]?.trim()}<span class="ui-label">{words[0].trim()}</span>{/if}
      <Menu {items} label={strings.machines.pick} placement="bottom" testid="settings-machine" onpick={onpick}>
        <MachineIcon icon={machine.icon} os={machine.store.core?.os} size={15} /><span class="name ui-label">{listedName(machine)}</span><ChevronDown size={13} />
      </Menu>
      {#if words[1]?.trim()}<span class="ui-label">{words[1].trim()}</span>{/if}
    </p>
  {/if}
  {#if home !== undefined}
    <p class="info" role="note" data-testid="settings-follows">
      <Info size={15} aria-hidden="true" />
      <span>{fill(strings.machines.follows, { machine: machineName(machine), home })}{#if !connected}{' '}{fill(strings.machines.followsAway, { home })}{/if}</span>
    </p>
  {:else if isHome}
    <p class="info quiet" role="note" data-testid="settings-is-home">
      <Info size={15} aria-hidden="true" />
      <span>{fill(strings.machines.isHome, { machine: machineName(machine) })}</span>
    </p>
  {/if}
</div>

<style>
  .machine-bar {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    max-width: var(--settings-width);
  }
  .machine-bar:empty { display: none; }
  .scope-line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 28ch;
  }
  .info {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    margin: 0;
    padding: 10px 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .info :global(svg) { flex: none; margin-top: 2px; color: var(--color-muted-foreground); }
  .info.quiet { border-color: var(--color-border); background: var(--color-surface); color: var(--color-muted-foreground); }
  .info.quiet :global(svg) { color: var(--color-muted-foreground); }
</style>
