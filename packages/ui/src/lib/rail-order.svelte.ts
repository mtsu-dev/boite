/**
 * The order of the app rail's pictures (AppRail.svelte), bots and teams mixed, as the user dragged them. Each entry
 * is `machineId:bot:id` or `machineId:team:id`; this device keeps it, the way it keeps its column widths. With
 * nothing saved, or for a picture the saved order does not name yet, the rail's own order stands: teams first, then
 * pinned bots, then the rest as they were made.
 */
const STORAGE_KEY = 'boite.rail.order';

function read(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    // A damaged order starts over from the rail's own.
    return [];
  }
}

class RailOrder {
  current = $state<string[]>(read());

  /** Keeps a new order; a full or blocked storage keeps it for this session only. */
  save(order: string[]): void {
    this.current = order;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order.slice(0, 500))); } catch { /* Storage full or off. */ }
  }
}

export const railOrder = new RailOrder();
