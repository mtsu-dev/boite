/**
 * What the core knows about OpenCode beyond its two descriptors. OpenCode 1
 * (`opencode`) and OpenCode 2 (`opencode-v2`) are two programs with one
 * gateway, one model naming and one subscription, so what is read off a model
 * id or billed to OpenCode Go is the same for both. Where they differ is where
 * the login lives: version 1 writes `auth.json`, version 2 a `credential`
 * table in `opencode.db`.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderId } from '@boite/contracts';

export const OPENCODE_V2: ProviderId = 'opencode-v2';

export function isOpenCode(providerId: ProviderId): boolean {
  return providerId === 'opencode' || providerId === OPENCODE_V2;
}

/**
 * `env` with OpenCode 2's inline configuration (`OPENCODE_CONFIG_CONTENT`)
 * passed through `edit`. Everything else the configuration carries is kept;
 * one that is not a JSON object is left unchanged, since OpenCode refuses it
 * either way.
 */
function editInlineConfig(env: Record<string, string>, edit: (config: Record<string, unknown>) => Record<string, unknown>): Record<string, string> {
  let config: unknown;
  try {
    config = JSON.parse(env['OPENCODE_CONFIG_CONTENT'] ?? '{}');
  } catch {
    return env;
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return env;
  return { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(edit(config as Record<string, unknown>)) };
}

function section(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const declared = config[key];
  return declared !== null && typeof declared === 'object' && !Array.isArray(declared) ? declared as Record<string, unknown> : {};
}

/**
 * A process environment of `providerId` with OpenCode 2's own background
 * compaction switched on or off (`enabled`, the thread type's
 * `backgroundCompaction`) in its inline configuration. Off is written too, so
 * a profile that turned it on does not outrank the owner. Other providers pass
 * through.
 */
export function openCodeBackgroundCompaction(providerId: ProviderId, enabled: boolean, env: Record<string, string>): Record<string, string> {
  if (providerId !== OPENCODE_V2) return env;
  return editInlineConfig(env, config => ({ ...config, experimental: { ...section(config, 'experimental'), background_compaction: enabled } }));
}

/**
 * The `compaction.buffer` that puts OpenCode 2's automatic compaction at the
 * owner's limit (`tokens`) for a model of `window` input tokens: OpenCode
 * compacts above `window - buffer` (`calculateCeiling` in its
 * `session/compaction.ts`). Null keeps OpenCode's own ceiling, `window` less
 * the larger of 15% and 16 000 tokens: no limit, an unknown window, or a limit
 * at or above the window, which no request reaches.
 */
export function openCodeCompactionBuffer(window: number, tokens: number | null): number | null {
  const size = Number.isFinite(window) ? Math.floor(window) : 0;
  if (tokens === null || size <= 0 || tokens >= size) return null;
  return size - tokens;
}

/** `env` with `buffer` as OpenCode 2's `compaction.buffer`; null leaves it as it is. */
export function withOpenCodeCompactionBuffer(env: Record<string, string>, buffer: number | null): Record<string, string> {
  if (buffer === null) return env;
  return editInlineConfig(env, config => ({ ...config, compaction: { ...section(config, 'compaction'), buffer } }));
}

/**
 * The API key OpenCode 2 stored for one integration (`opencode-go`), null when
 * there is none. `dataHome` is the account's `XDG_DATA_HOME`. The value column
 * is JSON, `{ "type": "key", "key": "..." }` for a key sign-in.
 */
export function openCode2Key(dataHome: string, integration: string): string | null {
  const file = join(dataHome, 'opencode', 'opencode.db');
  if (!existsSync(file)) return null;
  let db: Database | null = null;
  try {
    db = new Database(file, { readonly: true });
    const row = db
      .query('SELECT value FROM credential WHERE integration_id = ? AND active = 1 ORDER BY time_updated DESC LIMIT 1')
      .get(integration) as { value?: unknown } | null;
    if (row === null || typeof row.value !== 'string') return null;
    const value = JSON.parse(row.value) as { type?: unknown; key?: unknown };
    return value.type === 'key' && typeof value.key === 'string' && value.key.length > 0 ? value.key : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
