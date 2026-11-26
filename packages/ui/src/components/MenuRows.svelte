<script lang="ts">
  import { Check, ChevronRight, Settings } from '@lucide/svelte';
  import type { MenuItem } from '../lib/menu';
  import BackRow from './BackRow.svelte';
  import PrivateText from './PrivateText.svelte';
  import ProjectTile from './ProjectTile.svelte';

  let { ordered, pick, sheet = false, switches = false, atPointer = false }: {
    ordered: MenuItem[];
    pick: (item: MenuItem) => void;
    sheet?: boolean;
    switches?: boolean;
    atPointer?: boolean;
  } = $props();
</script>

{#each ordered as item (item.id)}
  {#if item.separator && item.label}
    <!-- A labelled rule opens a section: its words, no line. -->
    <div class="section ui-label" class:sheet role="presentation"><PrivateText text={item.label} /></div>
  {:else if item.separator}
    <div class="separator" role="separator"></div>
  {:else if item.back}
    <!-- One way back for every second level: it names the level and draws its own rule. -->
    <BackRow label={item.label} title={item.title} disabled={item.disabled} tabindex={atPointer ? -1 : undefined} data-value={item.id} data-testid={item.testid} onclick={() => pick(item)} />
  {:else}
  <button
    type="button"
    class="item"
    class:at-pointer={atPointer}
    class:with-switches={switches}
    tabindex={atPointer ? -1 : undefined}
    class:active={item.active}
    class:danger={item.danger}
    class:checkable={item.checked !== undefined || item.active !== undefined}
    class:inline-hint={!switches && !!item.hint && (atPointer || !!item.status)}
    class:radio={item.radio}
    class:submenu={item.submenu}
    class:glyphed={!switches && !!item.glyph}
    class:iconed={switches && !!(item.icon || item.glyph)}
    class:clip={item.clip}
    role={item.checked === undefined ? 'menuitem' : item.radio ? 'menuitemradio' : 'menuitemcheckbox'}
    aria-checked={item.checked}
    aria-haspopup={item.submenu ? 'menu' : undefined}
    disabled={item.disabled}
    data-row
    data-value={item.id}
    data-testid={item.testid}
    data-preload-view={item.preload}
    title={item.title}
    onclick={() => pick(item)}
  >
    <span class="label">
      {#if item.icon === 'settings'}<Settings size={14} strokeWidth={1.75} />{/if}
      {#if item.projectTile}<ProjectTile project={item.projectTile.project} store={item.projectTile.store} size={18} />{/if}
      {#if item.glyph}<span class="glyph" class:live={item.live} aria-hidden="true"><item.glyph size={16} strokeWidth={1.75} /></span>{/if}
      {#if item.status}<span class="status-dot" data-tone={item.status.tone} role="img" aria-label={item.status.label} title={item.status.label}></span>{/if}
      <span class="ui-label"><PrivateText text={item.label} /></span>
      {#if item.submenu}<span class="more" aria-hidden="true"><ChevronRight size={14} strokeWidth={1.75} /></span>{/if}
    </span>
    <!-- A submenu row's chevron stands for the context menu's '›' hint: one mark, not two. -->
    {#if item.hint && !item.submenu}
      <span class="hint ui-label"><PrivateText text={item.hint} /></span>
    {/if}
    {#if switches && item.checked !== undefined && !item.radio}
      <span class="switch" class:on={item.checked} aria-hidden="true"></span>
    {:else if item.checked || item.active}<span class="check"><Check size={14} aria-hidden="true" /></span>{/if}
  </button>
  {/if}
{/each}

<style>
  .separator { height: 1px; background: var(--color-border); margin: var(--space-1) var(--overlay-row-pad); }
  /* A section title is read, never tapped: its trimmed label box (`.ui-label`) reaches over the row above, which keeps the tap. */
  .section { padding: var(--space-3) var(--overlay-row-pad) var(--space-2); font-size: var(--text-meta); font-weight: 600; color: var(--color-subtle); pointer-events: none; }
  .section:first-child, :global(.sheet-title) + .section { padding-top: var(--space-1); }
  .section.sheet { padding-top: var(--space-4); }
  .section.sheet:first-child, :global(.sheet-title) + .section.sheet { padding-top: 0; }
  .separator:first-child, .separator:last-child, .separator + .separator,
  :global(.sheet-title) + .separator, :global(.heading) + .separator, :global(.back-rule) + .separator { display: none; }
  .label { display: flex; align-items: center; gap: var(--space-2); }
  .glyph { display: inline-flex; flex: 0 0 16px; color: var(--color-muted-foreground); margin-right: 2px; }
  .glyph.live { color: var(--color-live); }
  /* A hint under a row with a glyph starts under its words, not under the glyph: the line reads as the label's. */
  .item.glyphed:not(.inline-hint) > .hint { padding-left: calc(18px + var(--space-2)); }
  .item.danger .glyph { color: inherit; }
  /* The rows pack in the middle of a tall phone row: stretched, they left the label high and the check low. */
  .item.checkable { display: grid; grid-template-columns: minmax(0, 1fr) 14px; column-gap: 8px; align-content: center; }
  /* With no hint there is no second line for the check to centre across. */
  .item.checkable:not(:has(> .hint)) .check { grid-row: 1; }
  .checkable .hint { grid-column: 1; grid-row: 2; }
  /* The one selection mark of every menu: a chosen row (`checked` or `active`) wears this check, nothing else. */
  .check { display: flex; grid-column: 2; grid-row: 1 / span 2; align-self: center; color: var(--color-accent); }
  /* A row with a status dot (a changed file) keeps its counts on the label's line, at the right. */
  .item.checkable.inline-hint { grid-template-columns: minmax(0, 1fr) auto 14px; align-items: center; }
  .inline-hint .hint { grid-column: 2; grid-row: 1; }
  .inline-hint .check { grid-column: 3; grid-row: 1; }
  /* A switch row is a menu row's height (44 px under a finger, app.css); a hint grows it. */
  .item.with-switches.checkable { grid-template-columns: minmax(0, 1fr) 36px; min-height: var(--overlay-row); padding: var(--space-1) var(--space-3); column-gap: var(--space-3); }
  .item.with-switches.radio .check { justify-self: center; }
  .with-switches .label { gap: 9px; }
  .with-switches .glyph { margin-right: 0; }
  .with-switches .hint { font-size: var(--text-xs); }
  /* Under the words, past the 14 px icon and its 9 px gap; a row with no icon starts its hint under its name. */
  .with-switches.iconed > .hint { padding-left: 23px; }
  /* The shared switch (app.css), a little smaller in a menu row. */
  .switch { --switch-width: 36px; --switch-height: 22px; grid-column: 2; grid-row: 1 / span 2; align-self: center; }
  .status-dot { display: inline-block; width: 6px; height: 6px; flex: none; border-radius: 50%; margin-right: 8px; vertical-align: middle; background: var(--color-live); }
  .status-dot[data-tone='success'] { background: var(--color-success); }
  .status-dot[data-tone='danger'] { background: var(--color-danger); }
  .status-dot[data-tone='neutral'] { background: var(--color-muted-foreground); }
  /* A machine out of reach: the offline ring, as on its list line (MachineOffline). */
  .status-dot[data-tone='offline'] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-muted-foreground); }
  /* A one-line item is as tall as a context menu row; a hint below grows it.
     Labels are trimmed to their capitals, so the gap keeps descenders off the hint. */
  .separator, .section, .item { flex: none; }

  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--space-1);
    height: auto;
    min-height: var(--overlay-row);
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    white-space: normal;
  }

  /* A row with a line under its name is a block of two: more air around it than inside it, so the
     hint reads as its own row's and never as a title over the next one. */
  .item:has(> .hint):not(.inline-hint) { padding-block: var(--space-2); }

  /* Hover fills only where a pointer hovers: under a finger the last row
     touched kept its fill after the sheet opened or the press ended. Keyboard
     focus wears the shared accent ring (app.css). */
  @media (hover: hover) {
    .item:hover:not(:disabled) {
      background: var(--color-hover);
    }
  }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .item:active:not(:disabled) {
    transform: none;
    background: var(--color-active);
  }

  .item.danger {
    color: var(--color-danger);
  }

  .label {
    font-weight: 400;
  }

  /* A clipped row keeps one line: the label takes the row's width and ends in an ellipsis (`MenuItem.clip`). */
  .item.clip { align-items: stretch; }
  .item.clip .label { min-width: 0; }
  .item.clip .label .ui-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* A row that opens more rows: its chevron at the far edge. */
  .submenu .label { align-self: stretch; }
  .more { display: inline-flex; margin-left: auto; color: var(--color-subtle); }

  .hint {
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }
  .item.at-pointer { flex-direction: row; align-items: center; justify-content: space-between; gap: var(--space-2); width: 100%; }
  .at-pointer .label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .at-pointer .hint { color: var(--color-subtle); white-space: nowrap; }
</style>
