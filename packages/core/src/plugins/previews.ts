/*
 * What `plugins.inspect` showed the owner, kept for `plugins.add` to install
 * exactly that manifest at that commit. A preview is used once and expires.
 */

import type { PluginManifest, PluginSource } from '@boite/contracts';
import { invalidParams } from '../errors.ts';
import { newToken } from '../ids.ts';

export const PREVIEW_TTL_MS = 10 * 60_000;
const PREVIEW_MAX = 16;

export interface Previewed {
  manifest: PluginManifest;
  source: PluginSource;
}

export class PluginPreviews {
  #entries = new Map<string, Previewed & { expiresAt: number }>();

  /** Keeps a preview until `expiresAt`, the oldest going past 16; answers its id. */
  put(previewed: Previewed, expiresAt: number): string {
    const now = Date.now();
    for (const [key, preview] of this.#entries) if (preview.expiresAt <= now) this.#entries.delete(key);
    while (this.#entries.size >= PREVIEW_MAX) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    const previewId = newToken();
    this.#entries.set(previewId, { ...previewed, expiresAt });
    return previewId;
  }

  /** What `previewId` showed, once; refused naming the field when it is unknown or expired. */
  take(previewId: unknown): Previewed {
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
