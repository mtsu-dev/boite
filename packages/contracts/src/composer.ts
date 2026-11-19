import type { Attachment, PreviewReference, SentFrom } from './messages';
import type { PermissionMode } from './threads';
import type { ExperimentId } from './experiments';
import { RPC_MAX_FRAME_BYTES } from './attachment-limits';
import { utf8Bytes } from './transport';

export interface ComposerChoice {
  providerId: string;
  accountId: string;
  /** Initial mode for a new thread; existing threads use their live permission selection. */
  permissionMode: PermissionMode;
  model: string | null;
  effort: string | null;
  speed?: string | null;
}

export interface ComposerDraft {
  id?: string;
  createdAt?: number;
  projectId: string | null;
  worktree: boolean;
  worktreeExplicit?: true;
  incognito?: true;
}

export interface ComposerAttachment {
  kind: 'image' | 'file';
  mimeType: string;
  name: string | null;
  assetId: string;
}

export interface ComposerQueuedPrompt {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  previewReferences?: PreviewReference[];
  afterBoundary?: string;
  choice?: ComposerChoice;
  /** The enqueueing app's experiments, retained across reconnect and restart. */
  experiments?: ExperimentId[];
  /** Origin captured by the core on acceptance; null means an unidentified client. */
  sentFrom?: SentFrom | null;
  request?: {
    id: string;
    choice: ComposerChoice | null;
    queuedAt: number;
    failed?: string;
    sent?: true;
    start?: { projectId: string; worktree: boolean; incognito: boolean };
  };
}

export interface ComposerInput {
  text: string;
  attachments: ComposerAttachment[];
  previewReferences?: PreviewReference[];
  queued: ComposerQueuedPrompt[];
  paused: boolean;
  editing?: string | null;
}

export interface ComposerValue {
  input: ComposerInput;
  draft?: ComposerDraft;
  choice?: ComposerChoice | null;
  parked?: number;
}

export interface ComposerRecord {
  section: 'inputs' | 'drafts';
  id: string;
  revision: number;
  updatedAt: number;
  /** Core-authored: this record and its tombstones belong only to this connection, in memory. */
  privateMode?: true;
  value: ComposerValue | null;
}

export type ComposerKey = Pick<ComposerRecord, 'section' | 'id'>;
export type ComposerRevision = Pick<ComposerRecord, 'section' | 'id' | 'revision' | 'updatedAt'>;
export type ComposerCursor = ComposerKey & { privateMode?: true };
export interface ComposerPage { records: ComposerRecord[]; next?: ComposerCursor }

export const COMPOSER_RECORD_MAX_BYTES = RPC_MAX_FRAME_BYTES - 1024;
export const composerBytes = (value: unknown): number => utf8Bytes(JSON.stringify(value));

export function isComposerKey(value: unknown): value is ComposerKey {
  if (!value || typeof value !== 'object') return false;
  const { section, id } = value as Partial<ComposerKey>;
  return (section === 'inputs' || section === 'drafts') && typeof id === 'string' && id.length > 0;
}

/** Only edits to an existing box with the same routing and no server-owned queue can wait for a read. */
export function composerRevision(record: ComposerRecord, previous: ComposerRecord, bytes = composerBytes): ComposerRevision | undefined {
  const value = record.value, old = previous.value;
  if (!value || !old || record.privateMode || value.input.queued.length || old.input.queued.length ||
    JSON.stringify([value.draft, value.choice, value.parked]) !== JSON.stringify([old.draft, old.choice, old.parked]) ||
    bytes(record) < 64 * 1024) return undefined;
  const { section, id, revision, updatedAt } = record;
  return { section, id, revision, updatedAt };
}

/** A single record may exceed the page budget, up to the transport's record limit. */
export function composerPage(source: Iterable<ComposerRecord>, bytes = composerBytes): ComposerPage {
  const records: ComposerRecord[] = [];
  let size = 2;
  for (const row of source) {
    const length = bytes(row) + 1;
    if (records.length && size + length >= 4 * 1024 * 1024) {
      const { section, id, privateMode } = records.at(-1)!;
      return { records, next: { section, id, ...(privateMode ? { privateMode } : {}) } };
    }
    records.push(row);
    size += length;
  }
  return { records };
}

export interface ComposerRpcMethods {
  'composer.list': { params: {}; result: ComposerRecord[] };
  'composer.listPage': { params: { after?: ComposerCursor }; result: ComposerPage };
  'composer.get': { params: ComposerKey; result: ComposerRecord };
  /** Owner terminal submission. The request id also names the turn when the queue delivers it. */
  'composer.enqueue': {
    params: { threadId: string; prompt: string; clientRequestId: string };
    result: { requestId: string; status: 'queued' | 'held' | 'sent'; turnId?: string; reason?: string };
  };
  /** sendNow interrupts the active turn before delivering queued input as a new turn. Pending cards still hold delivery. */
  'composer.put': { params: Pick<ComposerRecord, 'section' | 'id' | 'value'> & { expectedRevision: number; sendNow?: true }; result: { accepted: boolean; record: ComposerRecord } };
  'composer.asset.put': { params: { attachment: Attachment; incognito?: true }; result: { assetId: string } };
  'composer.asset.get': { params: { assetId: string }; result: Attachment };
}

export interface ComposerRpcEvents {
  'composer.updated': ComposerRecord;
  'composer.revision': ComposerRevision;
}
