/**
 * Where a wrapped line of code may break besides its spaces: after an
 * operator or a separator, so a phone's column breaks `total +=` / `500`
 * at the operator instead of inside a name. A `<wbr>` adds no character,
 * so a copied line stays the source; in the one-line layout (`white-space:
 * pre`) it does nothing.
 */

const OPERATOR = /[.,;:()[\]{}=+\-*/|&<>?!%^~]/;
const ENTITY_CHAR: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };

/** One visible character of escaped HTML at `at`: an entity counts as the character it stands for. */
function charAt(html: string, at: number): { char: string; length: number } {
  if (html[at] === '&') {
    const end = html.indexOf(';', at);
    if (end > at && end - at <= 6) {
      const entity = html.slice(at, end + 1);
      return { char: ENTITY_CHAR[entity] ?? entity, length: entity.length };
    }
  }
  return { char: html[at] ?? '', length: 1 };
}

/**
 * The escaped HTML of a line (a highlighter's spans, the word marks) with a
 * break opportunity after the last operator of each run, never inside a tag
 * or an entity, and none where a space or the line's end already breaks.
 */
export function breakAfterOperators(html: string): string {
  let out = '';
  let run = '';
  for (let at = 0; at < html.length;) {
    if (html[at] === '<') {
      const end = html.indexOf('>', at);
      const close = end < 0 ? html.length : end + 1;
      out += html.slice(at, close);
      at = close;
      continue;
    }
    const { char, length } = charAt(html, at);
    // A run of operators (`=>`, `+=`, `);`) breaks after its last one, and only before code that follows;
    // a tag's opening (`<`, `</`) stays with its name, so `</p>` never splits.
    if (run && !OPERATOR.test(char) && !/\s/.test(char) && !/<\/?$/.test(run)) out += '<wbr>';
    run = OPERATOR.test(char) ? run + char : '';
    out += html.slice(at, at + length);
    at += length;
  }
  return out;
}

/** A plain line as text content, for the rows drawn before the grammar has run. */
export function escapeCode(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
