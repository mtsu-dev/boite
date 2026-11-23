import type { GatewayQuotaCredit, GatewayQuotaEntry, GatewayQuotaProvider, QuotaWindow, SubscriptionProxyQuotas } from '@boite/contracts';

export const MAX_BYTES = 1 << 20;
const MAX_PROVIDERS = 32;
const MAX_ENTRIES = 1024;
const MAX_LINES = 16;

type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ObjectValue : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const percent = (value: unknown): number | null => { const n = number(value); return n === null ? null : Math.max(0, Math.min(100, n)); };
/** A share that must already be a percent: anything outside 0..100 is ignored, not clamped. */
const share = (value: unknown): number | null => { const n = number(value); return n !== null && n >= 0 && n <= 100 ? n : null; };
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}
function time(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

function windowOf(raw: unknown): QuotaWindow | null {
  const row = object(raw);
  const id = row && text(row['id'], 80);
  if (!row || !id) return null;
  const remaining = percent(row['remaining_percent']);
  const used = percent(row['used_percent']) ?? (remaining === null ? null : 100 - remaining);
  if (used === null) return null;
  const window: QuotaWindow = { id, label: text(row['label'], 80) ?? id, usedPercent: used, resetsAt: time(row['reset_at']) };
  if (row['primary'] === true) window.primary = true;
  const outside = share(row['outside_percent']);
  if (outside !== null) window.outsidePercent = outside;
  return window;
}

function creditOf(raw: unknown): GatewayQuotaCredit | null {
  const row = object(raw);
  const id = row && text(row['id'], 80);
  if (!row || !id) return null;
  return { id, label: text(row['label'], 80) ?? id, unit: text(row['unit'], 24),
    remaining: number(row['remaining']), limit: number(row['limit']), used: number(row['used']) };
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueRows<T extends { id: string }>(values: unknown[], limit: number, decode: (value: unknown) => T | null): T[] {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (rows.length >= limit) break;
    const row = decode(value);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

const STATUSES: GatewayQuotaEntry['status'][] = ['ready', 'cooldown', 'error', 'disabled'];
const COOLDOWN_REASONS = new Set(['upstream quota exceeded', 'websocket upstream quota exceeded']);

function entryErrors(row: ObjectValue, status: GatewayQuotaEntry['status']): Pick<GatewayQuotaEntry, 'error' | 'statusReason' | 'retryAt'> {
  const legacy = text(row['error'], 300);
  const hasReadError = row['read_error'] !== undefined;
  const legacyCooldown = !hasReadError && status === 'cooldown' && legacy !== null && COOLDOWN_REASONS.has(legacy);
  // With an explicit null, the gateway has confirmed that the quota read did not fail.
  const error = hasReadError ? text(row['read_error'], 300) : legacyCooldown ? null : legacy;
  const fields: Pick<GatewayQuotaEntry, 'error' | 'statusReason' | 'retryAt'> = { error };
  if (row['status_reason'] !== undefined) fields.statusReason = text(row['status_reason'], 300);
  else if (!hasReadError && (legacyCooldown || status === 'error')) fields.statusReason = legacy;
  if (row['retry_at'] !== undefined) {
    const retryAt = text(row['retry_at'], 64);
    fields.retryAt = time(retryAt) !== null ? retryAt : null;
  }
  return fields;
}

function entryOf(raw: unknown, display: GatewayQuotaProvider['display']): GatewayQuotaEntry | null {
  const row = object(raw);
  const id = row && text(row['id'], 160);
  const label = row && text(row['label'], 200);
  if (!row || !id || !label) return null;
  const accounts = number(row['accounts']);
  const status = STATUSES.find((value) => value === row['status']) ?? 'ready';
  const windows = uniqueRows(array(row['windows']).slice(0, MAX_LINES * 4), MAX_LINES, windowOf);
  const credits = uniqueRows(array(row['credits']).slice(0, MAX_LINES * 4), MAX_LINES, creditOf);
  const errors = entryErrors(row, status);
  // Douane treats the aggregate as usable when its members produced windows or credits.
  if (display === 'average' && (windows.length || credits.length)) errors.error = null;
  return {
    id, label, plan: text(row['plan'], 120),
    accounts: accounts !== null && Number.isInteger(accounts) && accounts >= 1 ? Math.min(accounts, 100_000) : 1,
    status, ...errors, updatedAt: time(row['updated_at']), windows, credits,
  };
}

type ProviderName = (providerId: string) => string | null;

/**
 * Douane's `GET /v1/quotas` body, checked field by field. Strings are bounded
 * and stripped of control characters. Invalid rows are dropped.
 */
export function parseGatewayQuotas(raw: unknown, names: ProviderName = () => null): Pick<SubscriptionProxyQuotas, 'providers' | 'updatedAt'> {
  const root = object(raw);
  if (!Array.isArray(root?.['providers'])) throw new Error('Douane quotas expected an object with a providers array.');
  const providers: GatewayQuotaProvider[] = [];
  const seen = new Set<string>();
  let remaining = MAX_ENTRIES;
  for (const value of root['providers'].slice(0, MAX_PROVIDERS * 2)) {
    if (providers.length >= MAX_PROVIDERS) break;
    const row = object(value);
    const providerId = row?.['provider'];
    if (!row || typeof providerId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(providerId) || seen.has(providerId)) continue;
    const display = row['display'] === 'average' ? 'average' : 'accounts';
    const entries = uniqueRows(array(row['entries']), remaining, (item) => entryOf(item, display));
    providers.push({ providerId, name: text(row['name'], 80) ?? names(providerId) ?? providerId, display, entries });
    seen.add(providerId);
    remaining -= entries.length;
  }
  return { providers, updatedAt: time(root['updated_at']) };
}

/** The body, refused past `max` bytes whatever the headers claimed. */
export async function boundedJson(response: Response, max: number): Promise<unknown> {
  const tooLarge = `Douane quotas response exceeded ${max} bytes.`;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) { await response.body?.cancel().catch(() => {}); throw new Error(tooLarge); }
  if (!response.body) throw new Error('Douane quotas returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw new Error(tooLarge); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Douane quotas returned invalid JSON.'); }
}
