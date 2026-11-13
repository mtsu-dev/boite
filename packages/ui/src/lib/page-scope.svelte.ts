import { getContext, setContext, untrack, type Snippet } from 'svelte';

/** Where a settings card's rows are saved: this device, or the machine the page changes. */
export type ScopeKind = 'device' | 'machine';
/** What the line under a page's title may say: one of those, or every machine of the group. */
export type PageLine = ScopeKind | 'group';

const KEY = Symbol('page-scope');

/**
 * The cards of one settings page and where each applies (`CardScope.svelte`).
 * The line under the page's title says once where most of its cards apply;
 * only a card that differs from it carries its own tag, the first such
 * machine card holding the machine picker when there are several machines.
 */
export class PageScope {
  #cards = $state<{ id: symbol; kind: ScopeKind }[]>([]);
  readonly #base: () => ScopeKind | null;
  readonly #picker: () => Snippet<[string]> | undefined;
  readonly #fixed: (() => PageLine | null) | undefined;

  /** `base`: the page's own scope, or null for a page that saves no setting of its own; it settles a tie. `picker`: the machine picker, given the words around it. */
  /** `fixed`: the line a page declares itself (`lib/settings-tabs.ts`), whatever its cards count to. */
  constructor(base: () => ScopeKind | null, picker: () => Snippet<[string]> | undefined, fixed?: () => PageLine | null) {
    this.#fixed = fixed;
    this.#base = base;
    this.#picker = picker;
  }

  /** Called from a card's effect: untracked, so the effect does not rerun on its own registration. */
  add(kind: ScopeKind): { id: symbol; remove: () => void } {
    const id = Symbol(kind);
    untrack(() => { this.#cards = [...this.#cards, { id, kind }]; });
    return { id, remove: () => untrack(() => { this.#cards = this.#cards.filter((card) => card.id !== id); }) };
  }

  /** The scope the line under the title states: the one most cards share, else the page's own. */
  get line(): PageLine | null {
    const fixed = this.#fixed?.();
    if (fixed) return fixed;
    const machines = this.#cards.filter((card) => card.kind === 'machine').length;
    const devices = this.#cards.length - machines;
    if (devices === machines) return this.#base() ?? (devices > 0 ? 'device' : null);
    return devices > machines ? 'device' : 'machine';
  }

  /** Whether a card of this kind says where it applies: only when the line does not. */
  tags(kind: ScopeKind): boolean {
    return kind !== this.line;
  }

  /** Whether a machine card is on the page, to hold the picker when the line is not the machine's. */
  get hasMachineCard(): boolean {
    return this.#cards.some((card) => card.kind === 'machine');
  }

  /** The machine picker, held by the first machine card when the line is not the machine's. */
  pickerFor(id: symbol): Snippet<[string]> | undefined {
    return this.line !== 'machine' && this.#cards.find((card) => card.kind === 'machine')?.id === id ? this.#picker() : undefined;
  }
}

export function providePageScope(scope: PageScope): PageScope {
  return setContext(KEY, scope);
}

/** The page's scope, or undefined outside Settings: a card then always says where it applies. */
export function pageScope(): PageScope | undefined {
  return getContext<PageScope | undefined>(KEY);
}
