import { getContext, setContext, untrack, type Snippet } from 'svelte';

/** Where a settings card's rows are saved: this device, or the machine the page changes. */
export type ScopeKind = 'device' | 'machine';

const KEY = Symbol('page-scope');

/**
 * The cards of one settings page and where each applies (`CardScope.svelte`).
 * A page whose cards all share its own scope says it once under its title and
 * its cards carry no tag; a page that mixes them tags every card instead, the
 * first machine card holding the machine picker when there are several.
 */
export class PageScope {
  #cards = $state<{ id: symbol; kind: ScopeKind }[]>([]);
  readonly #base: () => ScopeKind | null;
  readonly #picker: () => Snippet<[string]> | undefined;

  /** `base`: the page's own scope, or null for a page that saves no setting of its own. `picker`: the machine picker, given the words around it. */
  constructor(base: () => ScopeKind | null, picker: () => Snippet<[string]> | undefined) {
    this.#base = base;
    this.#picker = picker;
  }

  /** Called from a card's effect: untracked, so the effect does not rerun on its own registration. */
  add(kind: ScopeKind): { id: symbol; remove: () => void } {
    const id = Symbol(kind);
    untrack(() => { this.#cards = [...this.#cards, { id, kind }]; });
    return { id, remove: () => untrack(() => { this.#cards = this.#cards.filter((card) => card.id !== id); }) };
  }

  /** True when the cards must say their scope: the page has none of its own, or a card's differs from it. */
  get mixed(): boolean {
    const base = this.#base();
    return base === null || this.#cards.some((card) => card.kind !== base);
  }

  /** The one scope the line under the title states, or null when the cards say theirs. */
  get line(): ScopeKind | null {
    return this.mixed ? null : this.#base();
  }

  /** Whether a machine card is on the page, to hold the picker when the page mixes scopes. */
  get hasMachineCard(): boolean {
    return this.#cards.some((card) => card.kind === 'machine');
  }

  /** The machine picker on a mixed page, held by its first machine card. */
  pickerFor(id: symbol): Snippet<[string]> | undefined {
    return this.mixed && this.#cards.find((card) => card.kind === 'machine')?.id === id ? this.#picker() : undefined;
  }
}

export function providePageScope(scope: PageScope): PageScope {
  return setContext(KEY, scope);
}

/** The page's scope, or undefined outside Settings: a card then always says where it applies. */
export function pageScope(): PageScope | undefined {
  return getContext<PageScope | undefined>(KEY);
}
