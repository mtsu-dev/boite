/**
 * Whether the desktop draws the full left app rail (`AppRail.svelte`) with the
 * mochis, teams and shortcuts along the window's left edge. Off by default:
 * without it, the sidebar's foot holds Activity, Contacts, Mochis, machines,
 * updates, limits and Settings, and the Mochis page lists every mochi and team
 * in the sidebar column. Stored per device, like the other display switches.
 */
export const MOCHI_LAYOUT_STORAGE_KEY = 'boite.mochi-layout';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(MOCHI_LAYOUT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

class MochiLayout {
  on = $state(false);

  constructor() {
    this.load();
  }

  load(): void {
    this.on = readStored();
  }

  set(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    try {
      window.localStorage.setItem(MOCHI_LAYOUT_STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* keep the choice for this session when storage is unavailable */
    }
  }

  toggle(): void {
    this.set(!this.on);
  }
}

export const mochiLayout = new MochiLayout();
