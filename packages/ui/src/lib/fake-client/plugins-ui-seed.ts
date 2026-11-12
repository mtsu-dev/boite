/*
 * The example plugin's real interface files (`examples/plugins/hello/ui`),
 * served by the fake's `plugins.ui` once Hello is added from a URL whose last
 * segment is `hello`. The fake client only ships in dev and e2e builds.
 */
import manifestText from '../../../../../examples/plugins/hello/boite-plugin.json?raw';
import script from '../../../../../examples/plugins/hello/ui/index.js?raw';
import style from '../../../../../examples/plugins/hello/ui/style.css?raw';
import type { PluginManifest } from '@boite/contracts';

export const HELLO_MANIFEST = JSON.parse(manifestText) as PluginManifest;

/** The files each fake plugin with an interface ships, by id. */
export const FAKE_UI: Record<string, { script: string | null; style: string | null }> = {
  hello: { script, style },
};

/** A short stable digest: the fake needs change detection, not a hash a core would trust. */
export function fakeDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
