/**
 * The browser profiles of this desktop. Each is a WebView2 profile the shell
 * opens (`src/browser.rs`), so they belong to the computer showing the browser,
 * and they are kept in the settings of the core this shell started. App.svelte
 * points `source` at that core's Store, or at the active one when there is no
 * local core (`?fake=1`, a plain browser).
 */
import {
  browserEngineOf,
  browserProfilesOf,
  DEFAULT_BROWSER_PROFILE,
  findBrowserProfile,
  PRIVATE_BROWSER_PROFILE,
  type BrowserEngine,
  type BrowserProfile,
  type Settings
} from '@boite/contracts';
import { secureId } from './secure-id';
import { strings } from './strings';

interface ProfileSource {
  readonly settings: Settings | null;
  saveSettings(patch: Partial<Settings>): Promise<boolean>;
}

class BrowserProfiles {
  source = $state.raw<ProfileSource | null>(null);

  #of = $derived(browserProfilesOf(this.source?.settings));

  /** The profiles the user made, without the built-in default and private ones. */
  get list(): BrowserProfile[] {
    return this.#of.profiles;
  }

  /** The profile a tab opens in when nobody chose one. */
  get defaultId(): string {
    return this.#of.defaultId;
  }

  /** What a tab's profile reads as. An id no longer listed reads as itself. */
  name(id: string | undefined): string {
    if (id === undefined || id === DEFAULT_BROWSER_PROFILE) return strings.browserProfiles.default;
    if (id === PRIVATE_BROWSER_PROFILE) return strings.browserProfiles.private;
    return this.list.find((profile) => profile.id === id)?.name ?? id;
  }

  /** A name, an id, `default` or `private`, as an agent names it. */
  find(wanted: string): string | null {
    return findBrowserProfile(this.list, wanted);
  }

  /** What runs the profile's agent tabs, as the core reads it: default included. */
  engine(id: string): BrowserEngine {
    return browserEngineOf(this.source?.settings, id);
  }

  /** The owner's choice of engine; the built-in default keeps its own setting beside the list. */
  saveEngine(id: string, engine: BrowserEngine): Promise<boolean> {
    if (id !== DEFAULT_BROWSER_PROFILE) return this.save((profiles) => profiles.map((profile) => (profile.id === id ? { ...profile, engine } : profile)));
    const source = this.source;
    if (!source) return Promise.resolve(false);
    const saved = this.#saving.then(() => source.saveSettings({ browserBuiltinProfiles: { default: { engine } } }));
    this.#saving = saved.catch(() => {});
    return saved;
  }

  #saving: Promise<unknown> = Promise.resolve();

  /** Applies each edit to the list left by the previous save, on the source that received it. */
  save(change: (profiles: BrowserProfile[]) => BrowserProfile[] | null, defaultId?: string): Promise<boolean> {
    const source = this.source;
    if (!source) return Promise.resolve(false);
    const saved = this.#saving.then(() => {
      const current = browserProfilesOf(source.settings);
      const profiles = change(current.profiles);
      if (!profiles) return false;
      const chosen = defaultId ?? current.defaultId;
      const kept = profiles.some((profile) => profile.id === chosen) ? chosen : DEFAULT_BROWSER_PROFILE;
      return source.saveSettings({ browserProfiles: profiles, browserDefaultProfile: kept });
    });
    this.#saving = saved.catch(() => {});
    return saved;
  }
}

export const browserProfiles = new BrowserProfiles();

/**
 * A new profile's id names its folder for good: WebView2 removes a deleted
 * profile's folder only when the browser process exits, so an id is never
 * derived from a name that could come back.
 */
export function newProfileId(): string {
  return `p-${secureId().slice(0, 12)}`;
}
