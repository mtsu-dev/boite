<script lang="ts">
  import { ChevronDown, GitBranch, WrapText } from '@lucide/svelte';
  import { diffPrefs, setDiffPref } from '../lib/diff-prefs.svelte';
  import { separator, type MenuItem } from '../lib/menu';
  import { strings } from '../lib/strings';
  import Menu from './Menu.svelte';

  /**
   * How a diff is laid out, behind one menu whose trigger names the layout in
   * use ("No wrap", "Wrap lines", "Side by side"): the current choice reads at
   * rest and says what the menu changes. Side by side is offered only where two
   * columns fit. The whitespace switch follows the layouts. The Changes panel
   * also hands it the branch it reads: one row under the switches, read and not
   * tapped.
   */
  let { split = false, branch }: { split?: boolean; branch?: { name: string; title: string; hint?: string } } = $props();

  /** The layout drawn: side by side falls back to the one-column choice where it does not fit. */
  let layout = $derived<'split' | 'wrap' | 'nowrap'>(split && diffPrefs.split ? 'split' : diffPrefs.wrap ? 'wrap' : 'nowrap');
  const NAMES = { nowrap: () => strings.chat.diffNoWrap, wrap: () => strings.chat.diffWrap, split: () => strings.chat.diffSplit };

  let items = $derived<MenuItem[]>([
    { id: 'nowrap', label: strings.chat.diffNoWrap, checked: layout === 'nowrap', radio: true, testid: 'diff-nowrap' },
    { id: 'wrap', label: strings.chat.diffWrap, checked: layout === 'wrap', radio: true, testid: 'diff-wrap' },
    ...(split ? [{ id: 'split', label: strings.chat.diffSplit, checked: layout === 'split', radio: true, testid: 'diff-split' }] : []),
    separator('sep-whitespace'),
    { id: 'whitespace', label: strings.chat.diffIgnoreWhitespace, checked: diffPrefs.ignoreWhitespace, testid: 'diff-whitespace' },
    ...(branch ? [separator('sep-branch'), { id: 'branch', label: branch.name, title: branch.title, hint: branch.hint, glyph: GitBranch, disabled: true, testid: 'diff-branch' }] : [])
  ]);

  function pick(id: string): void {
    if (id === 'whitespace') setDiffPref('ignoreWhitespace', !diffPrefs.ignoreWhitespace);
    else if (id === 'split') setDiffPref('split', true);
    else if (id === 'wrap' || id === 'nowrap') {
      setDiffPref('split', false);
      setDiffPref('wrap', id === 'wrap');
    }
  }
</script>

<span class="diff-options">
  <Menu {items} onpick={pick} switches placement="bottom" align="end" variant="text" label={strings.chat.diffView} testid="diff-options">
    <WrapText size={14} strokeWidth={1.75} /><span class="ui-label" data-testid="diff-layout">{NAMES[layout]()}</span><ChevronDown size={13} strokeWidth={1.75} />
  </Menu>
</span>

<style>
  .diff-options { display: inline-flex; flex: none; min-width: 0; color: var(--color-muted-foreground); }
  .diff-options :global(.trigger) { height: var(--control-sm); gap: 4px; }
</style>
