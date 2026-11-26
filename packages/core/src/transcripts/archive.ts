/*
 * Reading what the archive holds: a file's lines, through zstd when its name
 * says so, an archive's records, and where a blob is filed. Kept apart from
 * the compaction (`session.ts`), which only the worker loads.
 */

import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { constants, createZstdDecompress } from 'node:zlib';
import type { TranscriptRecord } from './records.ts';

export type TranscriptSource = 'claude' | 'codex';

const UNZSTD = { [constants.ZSTD_d_windowLogMax]: 31 };

/** Where a blob is filed: two levels keep a directory short. */
export function blobPath(dir: string, sha: string, ext: string): string {
  return join(dir, sha.slice(0, 2), `${sha}.${ext}`);
}

/** A file as a stream, through zstd when its name says so. A read error ends the stream it feeds. */
export function opened(path: string, zstd = path.endsWith('.zst')): AsyncIterable<Buffer> {
  const file = createReadStream(path, { highWaterMark: 1 << 20 });
  if (!zstd) return file as AsyncIterable<Buffer>;
  const plain = createZstdDecompress({ params: UNZSTD });
  file.once('error', error => plain.destroy(error));
  plain.once('close', () => file.destroy());
  return file.pipe(plain) as AsyncIterable<Buffer>;
}

/** The lines of a session file or of an archive, empty ones left out. */
export async function* lines(path: string): AsyncGenerator<string> {
  const source = opened(path);
  let parts: Buffer[] = [];
  for await (const chunk of source) {
    let start = 0;
    for (;;) {
      const at = chunk.indexOf(10, start);
      if (at < 0) break;
      parts.push(chunk.subarray(start, at));
      const line = parts.length === 1 ? parts[0]!.toString('utf8') : Buffer.concat(parts).toString('utf8');
      parts = [];
      start = at + 1;
      if (line.length > 0) yield line;
    }
    // Copied: the stream reuses nothing, but a subarray would pin the whole chunk.
    if (start < chunk.length) parts.push(Buffer.from(chunk.subarray(start)));
  }
  if (parts.length > 0) {
    const line = Buffer.concat(parts).toString('utf8');
    if (line.length > 0) yield line;
  }
}

/** Reads an archive's records in order; `take` returning false stops the read. */
export async function readArchive(path: string, take: (entry: TranscriptRecord, line: number) => boolean | void): Promise<void> {
  let index = 0;
  for await (const line of lines(path)) {
    index += 1;
    let entry: TranscriptRecord;
    try { entry = JSON.parse(line) as TranscriptRecord; } catch { continue; }
    if (take(entry, index) === false) return;
  }
}
