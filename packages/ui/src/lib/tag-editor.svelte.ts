import { checkProjectTags, PROJECT_TAG_MAX, PROJECT_TAGS_MAX, projectTagKey } from '@boite/contracts';

/** What the tag dialog edits: one project's tags, with the tags other projects carry offered beside them. */
export interface TagRequest {
  project: string;
  tags: string[];
  /** Tags already used on any project of any connected machine, sorted by name. */
  known: string[];
}

/**
 * The tag dialog's state, outside the component so a menu can await it like
 * `confirm.prompt`: `edit` answers the tags to store, or null when cancelled.
 * The list is checked with the core's own rule as it changes, so Save never
 * sends what the core refuses.
 */
class TagEditor {
  current = $state<TagRequest | null>(null);
  tags = $state<string[]>([]);
  typed = $state('');
  #resolve: ((tags: string[] | null) => void) | null = null;

  edit(request: TagRequest): Promise<string[] | null> {
    this.#settle(null);
    this.current = request;
    this.tags = [...request.tags];
    this.typed = '';
    return new Promise(resolve => { this.#resolve = resolve; });
  }

  get full(): boolean { return this.tags.length >= PROJECT_TAGS_MAX; }

  /** What the field holds, trimmed, too long to be a tag. */
  get tooLong(): boolean { return [...this.typed.trim()].length > PROJECT_TAG_MAX; }

  /** The known tags not on the project yet that hold what is typed, all of them while the field is empty. */
  get suggestions(): string[] {
    const held = new Set(this.tags.map(projectTagKey));
    const query = projectTagKey(this.typed.trim());
    return (this.current?.known ?? []).filter(tag => !held.has(projectTagKey(tag)) && (!query || projectTagKey(tag).includes(query)));
  }

  /**
   * Adds `tag`, or what is typed, and empties the field, which also filtered
   * the offers; a tag already there, an empty or too long one, or a full
   * list changes nothing.
   */
  add(tag = this.typed): boolean {
    const checked = checkProjectTags([...this.tags, tag]);
    if (!checked.ok || checked.tags.length === this.tags.length) return false;
    this.tags = checked.tags;
    this.typed = '';
    return true;
  }

  remove(tag: string): void {
    this.tags = this.tags.filter(held => held !== tag);
  }

  /** Saves the list, with a tag still typed in the field added first. */
  save(): void {
    if (this.typed.trim()) {
      if (this.tooLong || this.full) return;
      this.add();
    }
    this.#settle([...this.tags]);
  }

  cancel(): void { this.#settle(null); }

  #settle(tags: string[] | null): void {
    const resolve = this.#resolve;
    this.#resolve = null;
    this.current = null;
    resolve?.(tags);
  }
}

export const tagEditor = new TagEditor();
