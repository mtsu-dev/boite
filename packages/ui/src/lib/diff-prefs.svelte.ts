/*
 * How diffs are drawn on this device: one column whose long lines scroll
 * sideways or wrap at word breaks, or old and new side by side, and whether
 * lines that only moved their spaces count as changed. One choice
 * for every diff in the app, flipped from any diff's header.
 */

export interface DiffPrefs {
  split: boolean;
  /** One column's long lines wrap between words instead of scrolling sideways. */
  wrap: boolean;
  ignoreWhitespace: boolean;
}

export const DIFF_PREFS_STORAGE_KEY = 'boite.diffView';

/*
 * Long lines wrap by default on a desktop (round 17): code cut at the panel's
 * edge read as broken. A phone's column is too narrow for that: wrapped, a
 * line broke inside its tokens ("i +=" over "500"), so there it scrolls
 * sideways under line numbers that stay put. Either stays a choice.
 */
const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;
const DEFAULTS: DiffPrefs = { split: false, wrap: !phone, ignoreWhitespace: false };

function read(): DiffPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DIFF_PREFS_STORAGE_KEY) ?? 'null') as Partial<DiffPrefs> | null;
    return { split: raw?.split === true, wrap: typeof raw?.wrap === 'boolean' ? raw.wrap : DEFAULTS.wrap, ignoreWhitespace: raw?.ignoreWhitespace === true };
  } catch {
    return { ...DEFAULTS };
  }
}

export const diffPrefs = $state<DiffPrefs>(read());

export function setDiffPref<K extends keyof DiffPrefs>(key: K, value: DiffPrefs[K]): void {
  diffPrefs[key] = value;
  try {
    window.localStorage.setItem(DIFF_PREFS_STORAGE_KEY, JSON.stringify(diffPrefs));
  } catch {
    /* a browser that refuses storage still switches for this session */
  }
}
