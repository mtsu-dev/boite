/**
 * The pings of a team post, drawn in the accent colour: `@name` for each
 * member and `@tous` or `@everyone`, by the rule the routing reads them with
 * (`teamMentions`, `packages/contracts/src/teams.ts`). The post's prose is
 * rendered Markdown, so the names are wrapped in its text once drawn; code
 * and links keep their own look.
 */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest name first, so "Games pro" wins over "Games". */
export function pingPattern(names: readonly string[]): RegExp {
  const words = [...new Set(names.map(name => name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length).map(escape);
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(@(?:${[...words, 'tous', 'everyone'].join('|')}))(?![\\p{L}\\p{N}_-])`, 'giu');
}

const SKIP = 'code, pre, a, .ping, .katex';

function wrap(root: HTMLElement, pattern: RegExp): void {
  // Each pass reads the text as written: the last pass's spans go first, so a name that left the team loses
  // its colour and a span's edge never stands for a word boundary the text does not have.
  const old = root.querySelectorAll('.ping');
  for (const ping of old) ping.replaceWith(document.createTextNode(ping.textContent ?? ''));
  if (old.length > 0) root.normalize();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.includes('@') && !node.parentElement?.closest(SKIP)) texts.push(node as Text);
  }
  for (const text of texts) {
    const value = text.nodeValue ?? '';
    const pieces: Node[] = [];
    let at = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index + match[1]!.length;
      if (start > at) pieces.push(document.createTextNode(value.slice(at, start)));
      const ping = document.createElement('span');
      ping.className = 'ping';
      ping.textContent = match[2]!;
      pieces.push(ping);
      at = start + match[2]!.length;
    }
    if (pieces.length === 0) continue;
    if (at < value.length) pieces.push(document.createTextNode(value.slice(at)));
    text.replaceWith(...pieces);
  }
}

/** Wraps the pings under `node`, again whenever its prose is drawn anew or the names change. */
export function pings(node: HTMLElement, names: readonly string[]) {
  let pattern = pingPattern(names);
  const observer = new MutationObserver(() => run());
  function run(): void {
    observer.disconnect();
    wrap(node, pattern);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
  }
  run();
  return {
    update(next: readonly string[]) { pattern = pingPattern(next); run(); },
    destroy() { observer.disconnect(); }
  };
}
