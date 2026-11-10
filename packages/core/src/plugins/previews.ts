/*
 * What `plugins.inspect` showed the owner, kept until `plugins.add` installs
 * it: the manifest and the commit it was read at, never fetched again. A
 * preview lives ten minutes and is used once; at most sixteen are kept, the
 * oldest dropped first.
 */

import type { PluginManifest, PluginSource } from '@boite/contracts';
import { invalidParams } from '../errors.ts';
import { newToken } from '../ids.ts';

const PREVIEW_TTL_MS = 10 * 60_000;
const PREVIEW_MAX = 16;

export interface PreviewEntry {
  manifest: PluginManifest;
  source: PluginSource;
}

export class PluginPreviews {
  #entries = new Map<string, PreviewEntry & { expiresAt: number }>();

  /** When a preview read now expires. */
  expiry(): number { return Date.now() + PREVIEW_TTL_MS; }

  /** Keeps the preview and answers its id. */
  put(entry: PreviewEntry, expiresAt: number): string {
    const now = Date.now();
    for (const [key, preview] of this.#entries) if (preview.expiresAt <= now) this.#entries.delete(key);
    while (this.#entries.size >= PREVIEW_MAX) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    const id = newToken();
    this.#entries.set(id, { ...entry, expiresAt });
    return id;
  }

  /** The preview `previewId` names, removed: refused when unknown or expired. */
  take(previewId: unknown): PreviewEntry {
    const expected = 'a previewId plugins.inspect returned in the last 10 minutes';
    if (typeof previewId !== 'string') throw invalidParams(`plugin previewId must be ${expected}`, { field: 'previewId', expected });
    const preview = this.#entries.get(previewId);
    this.#entries.delete(previewId);
    if (preview === undefined || preview.expiresAt <= Date.now()) {
      throw invalidParams(`plugin preview is unknown or expired; inspect the URL again`, { field: 'previewId', expected });
    }
    return { manifest: preview.manifest, source: preview.source };
  }
}
