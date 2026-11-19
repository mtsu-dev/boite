import type { Attachment, PreviewReference, SentFrom } from './messages';
import type { PermissionMode } from './threads';
import type { ExperimentId } from './experiments';

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

export interface ComposerRpcMethods {
  'composer.list': { params: {}; result: ComposerRecord[] };
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
}
