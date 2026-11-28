import { createHash } from 'node:crypto';
import type { Attachment, ComposerAttachment, ComposerCursor, ComposerPage, ComposerRecord, ComposerValue } from '@boite/contracts';
import { answerAttachmentError, composerInputThreadId, composerPage, composerRevision, COMPOSER_RECORD_MAX_BYTES, decodedBytes, isComposerKey, privateTerminalComposerId, stableComposerValue, ATTACHMENTS_PER_TURN, ATTACHMENTS_TOTAL_MAX_BYTES } from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams, notFound, refused } from './errors.ts';
import type { Connection } from './router.ts';
import { collectStoredComposerAssets } from './journal/composer-assets.ts';
import { runWrite } from './journal/statements.ts';

type Row = { section: ComposerRecord['section']; id: string; revision: number; updated_at: number; value: string | null };
export interface Delivery {
  id: string; section: ComposerRecord['section']; record_id: string;
  status: 'creating' | 'submitting' | 'delivered' | 'uncertain'; thread_id: string | null; request_id: string; fingerprint: string;
}

export const digest = (value: unknown): string => createHash('sha256').update(stableComposerValue(value)).digest('hex');
export const recordKey = (section: string, id: string): string => JSON.stringify([section, id]);
const wireBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const PRIVATE_PENDING_LIMITS = { perConnection: 64 * 1024 * 1024, global: 128 * 1024 * 1024, ttlMs: 15 * 60_000 };
type PendingPrivateAsset = { ownerId: string; bytes: number; expiresAt: number };

/** Composer data has its own rows: typing never rewrites a message or an attachment. */
export class ComposerStorage {
  readonly #privateRecords = new Map<string, ComposerRecord>();
  readonly #privateAssets = new Map<string, Attachment>();
  readonly #privateDeliveries = new Map<string, Delivery>();
  readonly #privateOwners = new Map<string, Connection>();
  readonly #privateAssetOwners = new Map<string, string>();
  readonly #pendingAssets = new Map<string, Set<string>>();
  readonly #pendingPrivateAssets = new Map<string, PendingPrivateAsset>();
  readonly #pendingOwnerBytes = new Map<string, number>();
  readonly #pendingLimits: typeof PRIVATE_PENDING_LIMITS;
  #pendingBytes = 0;
  #pendingExpiry: ReturnType<typeof setTimeout> | undefined;
  readonly #connections = new Set<string>();
  readonly queued = new Map<string, Pick<ComposerRecord, 'section' | 'id'>>();
  readonly #core: Core;

  constructor(core: Core, pendingLimits = PRIVATE_PENDING_LIMITS) {
    this.#core = core;
    this.#pendingLimits = pendingLimits;
    core.journal.collectComposerAssets = assets => this.#collectAssets(assets);
    // No client can still be uploading here. Messages already own their bytes;
    // only live composer references retain an uploaded composer asset.
    core.journal.db.run(`DELETE FROM composer_assets WHERE id NOT IN (
      SELECT json_extract(a.value, '$.assetId') FROM composer_records r, json_each(r.value, '$.input.attachments') a
      UNION SELECT json_extract(a.value, '$.assetId') FROM composer_records r, json_each(r.value, '$.input.queued') q, json_each(q.value, '$.attachments') a
    )`);
    const queued = core.journal.db.query("SELECT section, id FROM composer_records WHERE value IS NOT NULL AND json_array_length(value, '$.input.queued') > 0").all() as Pick<ComposerRecord, 'section' | 'id'>[];
    for (const record of queued) this.queued.set(recordKey(record.section, record.id), record);
  }

  list(ownerId?: string): ComposerRecord[] {
    const memory = [...this.#privateRecords.values()].filter(record => ownerId === undefined || this.owner(record)?.id === ownerId);
    return [...(this.#core.journal.db.query('SELECT * FROM composer_records ORDER BY section, id').all() as Row[]).map(row => this.#decode(row)), ...memory].map(record => structuredClone(record));
  }

  listPage(ownerId: string, after: ComposerCursor | undefined): ComposerPage {
    if (after !== undefined && (!isComposerKey(after) || (after.privateMode !== undefined && after.privateMode !== true))) {
      throw invalidParams('composer.listPage.after: expected a cursor from an earlier page');
    }
    return composerPage(this.#orderedRecords(ownerId, after), wireBytes);
  }

  *#orderedRecords(ownerId: string, after: ComposerCursor | undefined): Iterable<ComposerRecord> {
    if (!after?.privateMode) {
      const statement = this.#core.journal.db.prepare(after
        ? 'SELECT * FROM composer_records WHERE (section, id) > (?, ?) ORDER BY section, id'
        : 'SELECT * FROM composer_records ORDER BY section, id');
      try {
        const rows = after ? statement.iterate(after.section, after.id) : statement.iterate();
        for (const row of rows) yield this.#decode(row as Row);
      } finally { statement.finalize(); }
    }
    const compare = (a: ComposerCursor, b: ComposerCursor) => a.section !== b.section ? (a.section < b.section ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    yield* [...this.#privateRecords.values()].filter(record => this.owner(record)?.id === ownerId && (!after?.privateMode || compare(record, after) > 0)).sort(compare);
  }

  owner(record: Pick<ComposerRecord, 'section' | 'id'>): Connection | undefined { return this.#privateOwners.get(recordKey(record.section, record.id)); }
  forgetThread(threadId: string): void {
    const ids = [threadId, privateTerminalComposerId(threadId)];
    for (const id of ids) {
      const key = recordKey('inputs', id);
      const value = this.#privateRecords.get(key)?.value;
      this.queued.delete(key); this.#privateRecords.delete(key); this.#privateOwners.delete(key);
      if (value) this.#collectAssets(this.references(value).map(reference => reference.assetId));
    }
    for (const [id, delivery] of this.#privateDeliveries) {
      if (delivery.thread_id !== threadId && !(delivery.section === 'inputs' && ids.includes(delivery.record_id))) continue;
      if (delivery.section === 'drafts' && delivery.status === 'delivered') { delivery.thread_id = null; delivery.fingerprint = ''; }
      else this.#privateDeliveries.delete(id);
    }
  }
  requireOwner(record: Pick<ComposerRecord, 'section' | 'id'>, connectionId: string): void {
    const owner = this.owner(record);
    if (owner && owner.id !== connectionId) throw notFound('composer.id: this private composer belongs to another connection');
  }

  get(section: ComposerRecord['section'], id: string): ComposerRecord {
    const memory = this.#privateRecords.get(recordKey(section, id));
    if (memory) return structuredClone(memory);
    const row = this.#core.journal.db.query('SELECT * FROM composer_records WHERE section = ? AND id = ?').get(section, id) as Row | null;
    return row ? this.#decode(row) : { section, id, revision: 0, updatedAt: 0, value: null };
  }

  #decode(row: Row): ComposerRecord {
    return { section: row.section, id: row.id, revision: row.revision, updatedAt: row.updated_at, value: row.value === null ? null : JSON.parse(row.value) };
  }

  privateMode(section: ComposerRecord['section'], id: string, value: ComposerValue | null): boolean {
    return this.#privateRecords.has(recordKey(section, id)) || value?.draft?.incognito === true ||
      value?.input.queued.some(item => item.request?.start?.incognito) === true ||
      (section === 'inputs' && this.#core.journal.getThread(composerInputThreadId(id))?.incognito === true);
  }

  save(section: ComposerRecord['section'], id: string, value: ComposerValue | null, owner?: Connection, excludeConnection?: string): ComposerRecord {
    const previous = this.get(section, id);
    const references = value ? this.references(value).map(reference => reference.assetId) : [];
    const privateMode = this.privateMode(section, id, value);
    const record: ComposerRecord = { section, id, value, revision: previous.revision + 1, updatedAt: Date.now(), ...(privateMode ? { privateMode: true } : {}) };
    const bytes = wireBytes(record);
    if (bytes > COMPOSER_RECORD_MAX_BYTES) throw invalidParams(`composer.value: expected at most ${COMPOSER_RECORD_MAX_BYTES} serialized UTF-8 bytes`);
    if (privateMode) {
      if (previous.revision && !this.#privateRecords.has(recordKey(section, id))) throw refused('composer: a persisted composer cannot become incognito; use a new draft');
      const connection = this.#privateOwners.get(recordKey(section, id)) ?? owner;
      if (!connection) throw refused('composer: an incognito record requires its originating connection');
      this.#track(connection);
      this.#privateOwners.set(recordKey(section, id), connection);
      this.#privateRecords.set(recordKey(section, id), record);
    } else runWrite(this.#core.journal.db, `INSERT INTO composer_records VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(section,id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, value=excluded.value`,
    section, id, record.revision, record.updatedAt, value === null ? null : JSON.stringify(value));
    if (value?.input.queued.length) this.queued.set(recordKey(section, id), { section, id });
    else this.queued.delete(recordKey(section, id));
    for (const assetId of references) {
      const privateOwner = this.#pendingPrivateAssets.get(assetId)?.ownerId;
      if (privateOwner !== undefined && privateOwner === (this.owner(record) ?? owner)?.id) this.#removePendingPrivate(assetId);
      const pending = this.#pendingAssets.get(assetId);
      if (owner) pending?.delete(owner.id);
      if (pending?.size === 0) this.#pendingAssets.delete(assetId);
    }
    if (previous.value) this.#collectAssets(this.references(previous.value).map(reference => reference.assetId).filter(assetId => !references.includes(assetId)));
    const privateOwner = this.#privateOwners.get(recordKey(section, id));
    if (privateOwner) {
      if (privateOwner.id !== excludeConnection) privateOwner.sendEvent('composer.updated', structuredClone(record));
    } else this.#core.bus.emit('composer.updated', structuredClone(record), { excludeConnection, composerRevision: composerRevision(record, previous, () => bytes) });
    if (previous.value?.input.queued.length && !value?.input.queued.length) this.#queueEmptied(record);
    return record;
  }

  #queueEmptied({ section, id }: Pick<ComposerRecord, 'section' | 'id'>): void {
    if (section !== 'inputs' || composerInputThreadId(id) !== id) return;
    this.#core.bus.whenCommitted(() => this.#core.delegation.composerQueueEmptied(id));
  }

  putAsset(attachment: Attachment, incognito: boolean, owner: Connection): { assetId: string } {
    const error = answerAttachmentError([attachment]);
    if (error) throw invalidParams(`composer.asset.put: ${error.message}`);
    this.#track(owner);
    const assetId = `${incognito ? 'private-' : ''}${digest(incognito ? [owner.id, attachment] : attachment)}`;
    if (incognito) {
      this.#putPrivateAsset(assetId, attachment, owner.id);
      return { assetId };
    }
    runWrite(this.#core.journal.db, 'INSERT OR IGNORE INTO composer_assets VALUES (?, ?, ?, ?, ?, ?)', assetId, JSON.stringify(attachment), attachment.kind, attachment.mimeType, attachment.name, decodedBytes(attachment.data));
    const pending = this.#pendingAssets.get(assetId) ?? new Set<string>();
    pending.add(owner.id); this.#pendingAssets.set(assetId, pending);
    return { assetId };
  }

  #putPrivateAsset(id: string, attachment: Attachment, ownerId: string): void {
    this.#expirePendingPrivate();
    const pending = this.#pendingPrivateAssets.get(id);
    const expiresAt = performance.now() + this.#pendingLimits.ttlMs;
    if (pending) {
      // A retry holds the same bytes and goes to the end of the expiry queue.
      this.#pendingPrivateAssets.delete(id);
      this.#pendingPrivateAssets.set(id, { ...pending, expiresAt });
    } else if (!this.#privateAssets.has(id)) {
      // Count the retained base64 plus an allowance for each object's fields.
      const bytes = attachment.data.length + Buffer.byteLength(attachment.name ?? '') + Buffer.byteLength(attachment.mimeType) + 256;
      const ownerBytes = (this.#pendingOwnerBytes.get(ownerId) ?? 0) + bytes;
      if (ownerBytes > this.#pendingLimits.perConnection || this.#pendingBytes + bytes > this.#pendingLimits.global) {
        throw refused('composer.asset.put: pending incognito attachments exceed the byte budget; save the draft before uploading more');
      }
      this.#pendingPrivateAssets.set(id, { ownerId, bytes, expiresAt });
      this.#pendingOwnerBytes.set(ownerId, ownerBytes);
      this.#pendingBytes += bytes;
      this.#privateAssets.set(id, structuredClone(attachment));
      this.#privateAssetOwners.set(id, ownerId);
    }
    this.#schedulePendingExpiry();
  }

  #removePendingPrivate(id: string): void {
    const pending = this.#pendingPrivateAssets.get(id);
    if (pending === undefined) return;
    this.#pendingPrivateAssets.delete(id);
    this.#pendingBytes -= pending.bytes;
    const ownerBytes = this.#pendingOwnerBytes.get(pending.ownerId)! - pending.bytes;
    if (ownerBytes === 0) this.#pendingOwnerBytes.delete(pending.ownerId);
    else this.#pendingOwnerBytes.set(pending.ownerId, ownerBytes);
  }

  #expirePendingPrivate(): void {
    const now = performance.now();
    for (const [id, pending] of this.#pendingPrivateAssets) {
      if (pending.expiresAt > now) break;
      this.#removePendingPrivate(id);
      this.#privateAssets.delete(id);
      this.#privateAssetOwners.delete(id);
    }
  }

  #schedulePendingExpiry(): void {
    const next = this.#pendingPrivateAssets.values().next().value;
    if (this.#pendingExpiry !== undefined || next === undefined) return;
    this.#pendingExpiry = setTimeout(() => {
      this.#pendingExpiry = undefined;
      this.#expirePendingPrivate();
      this.#schedulePendingExpiry();
    }, Math.max(1, Math.ceil(next.expiresAt - performance.now())));
    this.#pendingExpiry.unref();
  }

  close(): void {
    clearTimeout(this.#pendingExpiry);
    this.#pendingExpiry = undefined;
  }

  #track(connection: Connection): void {
    if (this.#connections.has(connection.id)) return;
    this.#connections.add(connection.id);
    connection.onClose?.(() => {
      this.#connections.delete(connection.id);
      const assets = new Set<string>(), records = new Set<string>();
      for (const [key, owner] of this.#privateOwners) if (owner.id === connection.id) {
        const value = this.#privateRecords.get(key)?.value;
        if (value) for (const reference of this.references(value)) assets.add(reference.assetId);
        const queued = this.queued.get(key);
        this.#privateRecords.delete(key); this.#privateOwners.delete(key); this.queued.delete(key); records.add(key);
        if (queued) this.#queueEmptied(queued);
      }
      // Consumed ids stay in memory until their thread is forgotten or the core exits.
      // A reconnect can bring an unacknowledged copy plus new input: discarding these
      // receipts would batch the old input again under a different turn request id.
      for (const [id, delivery] of this.#privateDeliveries) {
        if (delivery.status !== 'delivered' && records.has(recordKey(delivery.section, delivery.record_id))) this.#privateDeliveries.delete(id);
      }
      for (const [id, ownerId] of this.#privateAssetOwners) if (ownerId === connection.id) {
        this.#removePendingPrivate(id);
        assets.add(id);
      }
      for (const [id, pending] of this.#pendingAssets) if (pending.delete(connection.id)) {
        if (!pending.size) this.#pendingAssets.delete(id);
        assets.add(id);
      }
      this.#collectAssets(assets);
    });
  }

  #collectAssets(assetIds: Iterable<string>): void {
    const stored: string[] = [];
    for (const id of new Set(assetIds)) {
      if (this.#pendingAssets.has(id) || this.#pendingPrivateAssets.has(id)) continue;
      if ([...this.#privateRecords.values()].some(record => record.value && this.references(record.value).some(reference => reference.assetId === id))) continue;
      if (!id.startsWith('private-')) { stored.push(id); continue; }
      this.#privateAssets.delete(id); this.#privateAssetOwners.delete(id);
    }
    collectStoredComposerAssets(this.#core.journal.db, stored);
  }

  readAsset(assetId: string): Attachment {
    const memory = this.#privateAssets.get(assetId);
    if (memory) return structuredClone(memory);
    const row = this.#core.journal.db.query('SELECT attachment FROM composer_assets WHERE id = ?').get(assetId) as { attachment: string } | null;
    if (!row) throw notFound('composer.assetId: expected an uploaded attachment');
    return JSON.parse(row.attachment);
  }

  getAsset(assetId: string, ownerId?: string): Attachment {
    const memory = [...this.#privateRecords.values()].some(record => (ownerId === undefined || this.owner(record)?.id === ownerId) && record.value && this.references(record.value).some(attachment => attachment.assetId === assetId));
    const stored = typeof assetId === 'string' && this.#core.journal.db.query(`SELECT 1 FROM composer_records r
      WHERE EXISTS (SELECT 1 FROM json_each(r.value, '$.input.attachments') a WHERE json_extract(a.value, '$.assetId') = ?1)
      OR EXISTS (SELECT 1 FROM json_each(r.value, '$.input.queued') q, json_each(q.value, '$.attachments') a WHERE json_extract(a.value, '$.assetId') = ?1) LIMIT 1`).get(assetId);
    if (typeof assetId !== 'string' || (!memory && !stored)) {
      throw notFound('composer.assetId: expected an attachment referenced by a composer record');
    }
    return this.readAsset(assetId);
  }

  references(value: ComposerValue): ComposerAttachment[] { return [...value.input.attachments, ...value.input.queued.flatMap(item => item.attachments)]; }

  validateAssets(value: ComposerValue, privateMode: boolean, ownerId?: string): void {
    for (const input of [value.input, ...value.input.queued]) {
      if (input.attachments.length > ATTACHMENTS_PER_TURN) throw invalidParams(`composer.attachments: expected at most ${ATTACHMENTS_PER_TURN} attachments per input`);
      let bytes = 0;
      for (const reference of input.attachments) {
        if (!privateMode && reference.assetId.startsWith('private-')) throw refused('composer.assetId: a memory-only attachment requires an incognito record');
        if (reference.assetId.startsWith('private-') && this.#privateAssetOwners.get(reference.assetId) !== ownerId) throw notFound('composer.assetId: expected a private attachment uploaded by this connection');
        const privateAsset = this.#privateAssets.get(reference.assetId);
        const metadata = privateAsset ? { kind: privateAsset.kind, mime_type: privateAsset.mimeType, name: privateAsset.name, bytes: decodedBytes(privateAsset.data) }
          : this.#core.journal.db.query('SELECT kind, mime_type, name, bytes FROM composer_assets WHERE id = ?').get(reference.assetId) as { kind: string; mime_type: string; name: string | null; bytes: number } | null;
        if (!metadata) throw notFound('composer.assetId: expected an uploaded attachment');
        if (metadata.kind !== reference.kind || metadata.name !== reference.name || metadata.mime_type !== reference.mimeType) throw invalidParams('composer.attachment: metadata must match the uploaded attachment');
        bytes += metadata.bytes;
      }
      if (bytes > ATTACHMENTS_TOTAL_MAX_BYTES) throw invalidParams(`composer.attachments: expected at most ${ATTACHMENTS_TOTAL_MAX_BYTES} bytes per input`);
    }
  }

  delivery(id: string): Delivery | null {
    return this.#privateDeliveries.get(id) ?? this.#core.journal.db.query('SELECT * FROM composer_deliveries WHERE id = ?').get(id) as Delivery | null;
  }

  reserve(delivery: Delivery, privateMode: boolean): void {
    if (privateMode) this.#privateDeliveries.set(delivery.id, delivery);
    else this.#core.journal.db.query(`INSERT INTO composer_deliveries VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, thread_id=excluded.thread_id`)
      .run(delivery.id, delivery.section, delivery.record_id, delivery.status, delivery.thread_id, delivery.request_id, delivery.fingerprint);
  }

  status(id: string, status: Delivery['status'], threadId?: string): void {
    const memory = this.#privateDeliveries.get(id);
    if (memory) { memory.status = status; if (threadId !== undefined) memory.thread_id = threadId; }
    else this.#core.journal.db.query('UPDATE composer_deliveries SET status = ?, thread_id = COALESCE(?, thread_id) WHERE id = ?').run(status, threadId ?? null, id);
  }

  release(id: string): void {
    this.#privateDeliveries.delete(id);
    this.#core.journal.db.query('DELETE FROM composer_deliveries WHERE id = ?').run(id);
  }
}
