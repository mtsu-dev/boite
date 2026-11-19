<script lang="ts">
  import type { PluginSetting, PluginSettingValue } from '@boite/contracts';
  import { pluginSettingProblem } from '@boite/contracts';
  import { ChevronDown } from '@lucide/svelte';
  import type { MenuItem } from '../lib/menu';
  import { fill, strings } from '../lib/strings';
  import Menu from './Menu.svelte';
  import SettingField from './SettingField.svelte';
  import SettingSwitch from './SettingSwitch.svelte';

  /**
   * One setting a plugin's manifest declares, drawn the way Boite draws its
   * own: a switch, a slider, a number, a line of text or a menu of choices.
   * A switch, a choice and a slider let go save at once; a typed value saves
   * when the field is left or Enter is pressed, once it passes the manifest's rule.
   */
  let { setting, value, disabled, onsave }: {
    setting: PluginSetting;
    value: PluginSettingValue;
    disabled: boolean;
    /** Resolves to the core's refusal, or null once it kept the value. */
    onsave: (value: PluginSettingValue) => Promise<string | null>;
  } = $props();

  const t = strings.plugins;
  /** What the control shows while typed or dragged, back to the saved value once it lands. */
  let draft = $state<string | null>(null);
  let problem = $state('');

  $effect(() => {
    void value;
    draft = null;
  });

  async function save(next: PluginSettingValue) {
    const wrong = pluginSettingProblem(setting, next);
    if (wrong !== null) { problem = fill(t.settingInvalid, { expected: wrong }); return; }
    problem = '';
    if (next === value) { draft = null; return; }
    const refusal = await onsave(next);
    if (refusal !== null) problem = refusal;
    else draft = null;
  }

  function typed(raw: string) {
    if (setting.type === 'text') { void save(raw); return; }
    // An empty or half-typed number is not a number: the rule says what is expected.
    void save(raw.trim() === '' ? Number.NaN : Number(raw));
  }

  const shown = $derived(draft ?? String(value));
  const items = $derived<MenuItem[]>(setting.type === 'select'
    ? setting.options.map((option) => ({ id: option.value, label: option.label, checked: option.value === value, radio: true }))
    : []);
  const picked = $derived(setting.type === 'select' ? setting.options.find((option) => option.value === value)?.label ?? String(value) : '');
  /** How far along its range a slider sits, for the filled part of its track. */
  const fillShare = $derived(setting.type === 'slider' ? ((Number(shown) - setting.min) / (setting.max - setting.min)) * 100 : 0);
</script>

<SettingField title={setting.label} hint={setting.description} error={problem} errorTestid="plugin-setting-error"
  field={setting.type !== 'select'} stacked={setting.type === 'text'} data-testid="plugin-setting" data-key={setting.key} data-type={setting.type}>
  {#snippet control(attributes)}
  <div class="control" class:wide={setting.type === 'text'}>
    {#if setting.type === 'switch'}
      <SettingSwitch {...attributes} checked={value === true} {disabled}
        data-testid="plugin-setting-input" onchange={(event) => { event.currentTarget.checked = value === true; void save(value !== true); }} />
    {:else if setting.type === 'slider'}
      <input {...attributes} type="range" min={setting.min} max={setting.max} step={setting.step ?? 'any'} value={shown} {disabled} style:--fill="{fillShare}%"
        data-testid="plugin-setting-input"
        oninput={(event) => { draft = event.currentTarget.value; }} onchange={(event) => void save(Number(event.currentTarget.value))} />
      <output for={attributes.id} class="readout" data-testid="plugin-setting-readout">{shown}</output>
    {:else if setting.type === 'number'}
      <input {...attributes} class="number" type="number" inputmode="decimal" min={setting.min} max={setting.max} step={setting.step ?? 'any'} value={shown} {disabled}
        data-testid="plugin-setting-input"
        oninput={(event) => { draft = event.currentTarget.value; }} onchange={(event) => typed(event.currentTarget.value)} />
    {:else if setting.type === 'text'}
      <input {...attributes} class="line" type="text" autocomplete="off" spellcheck="false" maxlength={1000} value={shown} {disabled}
        data-testid="plugin-setting-input"
        oninput={(event) => { draft = event.currentTarget.value; }} onchange={(event) => typed(event.currentTarget.value)} />
    {:else}
      <span class="menu">
        <Menu {items} onpick={(id) => void save(id)} label={setting.label} placement="bottom" align="end" {disabled} testid="plugin-setting-menu">
          <span class="ui-label">{picked}</span><ChevronDown size={14} />
        </Menu>
      </span>
    {/if}
  </div>
  {/snippet}
</SettingField>

<style>
  .control { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; }
  .number { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
  .line { width: min(240px, 100%); }
  .menu { display: inline-flex; }
  .menu :global(button) { gap: 6px; }

  /* The slider: a thin track, filled up to the thumb in the accent. */
  input[type='range'] {
    appearance: none; width: 150px; height: 18px; min-height: 0; margin: 0; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; cursor: pointer;
  }
  input[type='range']:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 4px; border-radius: var(--radius-sm); }
  input[type='range']::-webkit-slider-runnable-track {
    height: 4px; border-radius: 999px;
    background: linear-gradient(to right, var(--color-accent) var(--fill), var(--color-surface-3) var(--fill));
  }
  input[type='range']::-moz-range-track { height: 4px; border-radius: 999px; background: var(--color-surface-3); }
  input[type='range']::-moz-range-progress { height: 4px; border-radius: 999px; background: var(--color-accent); }
  input[type='range']::-webkit-slider-thumb {
    appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%;
    background: var(--color-foreground); border: 2px solid var(--color-surface); box-shadow: var(--shadow-e1);
    transition: transform var(--dur-1) var(--ease-out-quint);
  }
  input[type='range']::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--color-foreground); border: 2px solid var(--color-surface); }
  input[type='range']:active::-webkit-slider-thumb { transform: scale(1.15); }
  input[type='range']:disabled { opacity: .5; cursor: default; }
  .readout { min-width: 3ch; text-align: right; font-family: var(--font-mono); font-size: var(--text-sm); font-variant-numeric: tabular-nums; color: var(--color-foreground); }

  /* A line of text takes the row's width under its label on a narrow dialog. */
  @media (max-width: 720px) {
    .control.wide, .wide .line { width: 100%; }
    input[type='range'] { width: 120px; }
  }
</style>
