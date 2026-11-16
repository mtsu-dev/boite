import type { AgentNotice, MessagePart } from '@boite/contracts';

const DETAIL_MAX = 500;

type NoticePart = Extract<MessagePart, { type: 'notice' }>;

/**
 * The four integrity notices of the CLI (fields as CLI 2.1.325 declares them).
 * Three are not in the SDK's types, so the frame is read field by field:
 * - `session_writes_lost`: `error_code` (`ENOSPC`, `EDQUOT`, more may come),
 *   `lost` (`transcript`, `global_config`), `transcript_session_ids`.
 * - `file_attachments_missing`: `message_uuid`, `sent_count`, `missing`
 *   (`file_uuid` and a `reason` code each).
 * - `instruction_size_warning`: `total_chars`, `total_limit_chars`,
 *   `file_count`, `largest_chars` when one file alone is over the limit.
 * - `mirror_error`: `error`, `key` (`projectKey`, `sessionId`, `subpath`).
 * None ends the turn. Null for any other frame.
 */
export function noticePart(message: unknown): NoticePart | null {
  if (typeof message !== 'object' || message === null) return null;
  const frame = message as Record<string, unknown>;
  if (frame['type'] !== 'system') return null;
  const subtype = frame['subtype'];
  const read = subtype === 'session_writes_lost' ? writesLost(frame)
    : subtype === 'file_attachments_missing' ? attachmentsMissing(frame)
    : subtype === 'instruction_size_warning' ? instructionsLarge(frame)
    : subtype === 'mirror_error' ? mirrorFailed(frame)
    : null;
  if (read === null) return null;
  return { type: 'notice', notice: read.notice, detail: `${String(subtype)}: ${read.detail}`.slice(0, DETAIL_MAX) };
}

function writesLost(frame: Record<string, unknown>): { notice: AgentNotice; detail: string } {
  const code = text(frame['error_code']);
  const lost = strings(frame['lost']);
  const sessions = strings(frame['transcript_session_ids']);
  const cause = code === 'ENOSPC' ? 'disk_full' : code === 'EDQUOT' ? 'quota' : 'other';
  // `lost` is never empty; an unknown value is read as the worse case, the transcript.
  const transcript = lost.length === 0 || lost.some(entry => entry !== 'global_config');
  const said = [code || 'unknown error', lost.length > 0 ? `lost ${lost.join(', ')}` : '', sessions.length > 0 ? `sessions ${sessions.join(', ')}` : ''];
  return { notice: { kind: 'writes_lost', cause, transcript }, detail: said.filter(Boolean).join('; ') };
}

function attachmentsMissing(frame: Record<string, unknown>): { notice: AgentNotice; detail: string } {
  const missing = Array.isArray(frame['missing']) ? frame['missing'] as unknown[] : [];
  const files = missing.map((entry) => {
    const file = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {};
    return `${text(file['file_uuid']) || '?'} (${text(file['reason']) || '?'})`;
  });
  const count = Math.max(files.length, 1);
  const sent = Math.max(whole(frame['sent_count']) ?? count, count);
  const message = text(frame['message_uuid']);
  return {
    notice: { kind: 'attachments_missing', missing: count, sent },
    detail: [message ? `message ${message}` : '', files.join(', ')].filter(Boolean).join('; '),
  };
}

function instructionsLarge(frame: Record<string, unknown>): { notice: AgentNotice; detail: string } | null {
  const chars = whole(frame['total_chars']);
  const limit = whole(frame['total_limit_chars']);
  if (chars === null || limit === null) return null;
  const files = whole(frame['file_count']) ?? 1;
  const largest = whole(frame['largest_chars']);
  return {
    notice: { kind: 'instructions_large', chars, limit, files },
    detail: `${chars} chars in ${files} ${files === 1 ? 'file' : 'files'}, limit ${limit}${largest === null ? '' : `; largest ${largest}`}`,
  };
}

function mirrorFailed(frame: Record<string, unknown>): { notice: AgentNotice; detail: string } {
  const key = typeof frame['key'] === 'object' && frame['key'] !== null ? frame['key'] as Record<string, unknown> : {};
  const where = [
    text(key['projectKey']) ? `project ${text(key['projectKey'])}` : '',
    text(key['sessionId']) ? `session ${text(key['sessionId'])}` : '',
    text(key['subpath']),
  ].filter(Boolean).join(', ');
  return { notice: { kind: 'mirror_failed' }, detail: [text(frame['error']) || 'unknown error', where].filter(Boolean).join('; ') };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
