<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import { diffPrefs, setDiffPref } from '../lib/diff-prefs.svelte';
  import type { MenuItem } from '../lib/menu';
  import { strings } from '../lib/strings';
  import Menu from './Menu.svelte';

  /**
   * A diff's two switches behind one named menu: a word reads where two bare
   * glyphs did not. Side by side is offered only where two columns fit.
   */
  let { split = false }: { split?: boolean } = $props();

  let items = $derived<MenuItem[]>([
    { id: 'whitespace', label: strings.chat.diffIgnoreWhitespace, checked: diffPrefs.ignoreWhitespace, testid: 'diff-whitespace' },
    ...(split ? [{ id: 'split', label: strings.chat.diffSideBySide, checked: diffPrefs.split, testid: 'diff-split' }] : [])
  ]);

  function pick(id: string): void {
    if (id === 'whitespace') setDiffPref('ignoreWhitespace', !diffPrefs.ignoreWhitespace);
    else if (id === 'split') setDiffPref('split', !diffPrefs.split);
  }
</script>

<span class="diff-options">
  <Menu {items} onpick={pick} switches placement="bottom" align="end" variant="text" label={strings.chat.diffView} testid="diff-options">
    <span class="ui-label">{strings.chat.diffView}</span><ChevronDown size={13} strokeWidth={1.75} />
  </Menu>
</span>

<style>
  .diff-options { display: inline-flex; flex: none; color: var(--color-muted-foreground); }
  .diff-options :global(.trigger) { height: var(--control-sm); gap: 2px; }
</style>
