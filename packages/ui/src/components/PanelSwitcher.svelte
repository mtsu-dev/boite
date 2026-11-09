<script lang="ts">
  import { ChevronDown, PanelRight } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import { panelSwitch } from '../lib/panel-switch.svelte';
  import Menu from './Menu.svelte';

  /**
   * The open panel's door (`PanelDoor.svelte`): its icon and name with a
   * chevron, and the panel switcher, the showing panel checked and the way to
   * close in its list. It comes with the panel's chunk (`RightPanel.svelte`
   * hands it over), so the entry carries only the closed door. The door styles it.
   */
  let { inPanel = false }: { inPanel?: boolean } = $props();
  const Glyph = $derived(panelSwitch.glyph ?? PanelRight);
</script>

<Menu items={panelSwitch.items()} onpick={(id) => panelSwitch.pick(id)} placement="bottom" align="end" variant="ghost" cap={640}
  label={fill(strings.thread.panelSwitch, { name: panelSwitch.title || panelSwitch.name })} heading={strings.thread.panelMenu} testid="panel-add">
  <span class="door-face">
    <Glyph size={16} strokeWidth={1.75} />
    <span class="name ui-label" data-testid={inPanel ? 'panel-title' : 'panel-door-name'}>{panelSwitch.name}</span>
    <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
  </span>
</Menu>
