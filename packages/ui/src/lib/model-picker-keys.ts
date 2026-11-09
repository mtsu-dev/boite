import type { Closing } from './closing.svelte';

/**
 * What the model picker's keyboard reads and moves. The arrows cross the whole
 * popover (tiles, the account button, model rows, the legacy submenu), so every
 * query starts from the picker's root or its open menu.
 */
export interface PickerKeyState {
  popover: Closing;
  legacy: Closing;
  root(): HTMLElement | undefined;
  menu(): HTMLElement | undefined;
  searchBox(): HTMLInputElement | undefined;
  legacyOpen(): boolean;
  searchable(): boolean;
  modelQuery(): string;
  clearQuery(): void;
}

/** The picker's keydown handler, shared by its trigger, its popover and its legacy submenu. */
export function pickerKeydown(picker: PickerKeyState): (event: KeyboardEvent) => void {
  function focusable(): HTMLElement[] {
    return Array.from(activeMenu()?.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)') ?? []);
  }

  function activeMenu(): HTMLElement | null {
    return picker.legacyOpen() ? picker.root()?.querySelector<HTMLElement>('[data-testid=picker-legacy-menu]') ?? null : picker.menu() ?? null;
  }

  /** The model rows alone: what the arrows walk once the search field has the focus. The account button heads the column above them. */
  function modelRows(): HTMLElement[] {
    return Array.from(activeMenu()?.querySelectorAll<HTMLElement>('.models [data-row]:not(:disabled):not([data-testid=picker-account])') ?? []);
  }

  function handleEscape(event: KeyboardEvent) {
    event.stopPropagation();
    if (picker.legacyOpen()) {
      picker.legacy.hide();
      picker.root()?.querySelector<HTMLElement>('[data-testid=picker-legacy]')?.focus();
      return;
    }
    // The query goes first: closing on it would throw away what was just typed.
    if (picker.searchable() && picker.modelQuery() !== '') {
      picker.clearQuery();
      picker.searchBox()?.focus();
      return;
    }
    picker.popover.hide();
  }

  function handleLegacyNavigation(event: KeyboardEvent, active: HTMLElement | null): boolean {
    if (event.key === 'ArrowRight' && active?.dataset.testid === 'picker-legacy') {
      event.preventDefault();
      picker.legacy.show();
      queueMicrotask(() => picker.root()?.querySelector<HTMLElement>('[data-testid=picker-legacy-menu] [data-model]')?.focus());
      return true;
    }
    if (event.key === 'ArrowLeft' && active?.closest('[data-testid=picker-legacy-menu]')) {
      event.preventDefault();
      picker.legacy.hide();
      picker.root()?.querySelector<HTMLElement>('[data-testid=picker-legacy]')?.focus();
      return true;
    }
    return false;
  }

  function handleModelSearch(event: KeyboardEvent, active: HTMLElement | null): boolean {
    if (picker.legacyOpen()) return false;
    const searchBox = picker.searchBox();
    if (!picker.searchable() || (active !== searchBox && !active?.hasAttribute('data-model'))) return false;
    if (event.key === 'Enter') {
      // A focused row is activated by the browser too; taking the default keeps it to one pick.
      event.preventDefault();
      const row = active === searchBox ? modelRows()[0] : active;
      row?.click();
      return true;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
    event.preventDefault();
    const list = modelRows();
    const here = active === searchBox || !active ? -1 : list.indexOf(active);
    if (event.key === 'ArrowDown') list[Math.min(here + 1, list.length - 1)]?.focus();
    else if (here === 0) searchBox?.focus();
    // Above the field, the provider's name when it switches accounts.
    else if (here === -1) activeMenu()?.querySelector<HTMLElement>('[data-testid=picker-account]:not(:disabled)')?.focus();
    else list[here - 1]?.focus();
    return true;
  }

  function handleRowNavigation(event: KeyboardEvent, active: HTMLElement | null) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // Below the account button comes the search field, then the models.
    const searchBox = picker.searchBox();
    if (event.key === 'ArrowDown' && active?.dataset.testid === 'picker-account' && picker.searchable() && searchBox) {
      event.preventDefault();
      searchBox.focus();
      return;
    }
    const list = focusable();
    if (list.length === 0) return;
    event.preventDefault();
    const index = active ? list.indexOf(active) : -1;
    const next = event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  /**
   * A letter typed on a tile, a button or a row goes to the search field: the
   * focus moves before the browser inserts it, so the field receives it. Space
   * stays a button's own key.
   */
  function handleTyping(event: KeyboardEvent, active: HTMLElement | null) {
    if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
    const searchBox = picker.searchBox();
    if (!searchBox || !picker.searchable() || picker.legacyOpen() || active === searchBox || active instanceof HTMLInputElement) return;
    searchBox.focus();
  }

  return function onkeydown(event: KeyboardEvent) {
    if (!picker.popover.open) return;
    const active = document.activeElement as HTMLElement | null;
    if (event.key === 'Escape') return handleEscape(event);
    handleTyping(event, active);
    if (handleLegacyNavigation(event, active)) return;
    if (handleModelSearch(event, active)) return;
    handleRowNavigation(event, active);
  };
}
