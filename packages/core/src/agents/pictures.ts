/**
 * The pictures the owner imports for bots in place of a robot. Each is a file
 * in `<data>/agent-pictures`, named by the first 16 hex digits of its SHA-256,
 * and a profile names it as `img:<hash>` in its avatar: a few bytes in every
 * snapshot, the image itself fetched once per client (`agents.picture.get`).
 *
 * Only PNG, JPEG, WebP and GIF whose first bytes match their type are kept,
 * never SVG, and at most `AGENT_PICTURE_MAX_BYTES`. A picture no bot wears is
 * removed a day after it was stored, the next time one is imported: the form
 * or the agent that imported it saves it within that day or drops it. Beyond
 * `UNWORN_PICTURES_MAX` unworn pictures, the oldest go sooner.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_PICTURE_CODE, AGENT_PICTURE_MAX_BYTES, AGENT_PICTURE_TYPES } from '@boite/contracts';
import { invalidParams, notFound } from '../errors.ts';
import { looksLike } from '../project-icons.ts';

type PictureType = (typeof AGENT_PICTURE_TYPES)[number];
const EXTENSIONS: Record<PictureType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type as PictureType])) as Record<string, PictureType>;
/** How long a picture no bot wears is kept: the form that imported it has this long to save it. */
export const UNWORN_PICTURE_MS = 24 * 60 * 60 * 1000;
/** At most this many pictures no bot wears, the one being imported included: the oldest go first. */
export const UNWORN_PICTURES_MAX = 32;
/** The base64 length of the largest picture, so a larger one is refused before it is decoded. */
const BASE64_MAX = Math.ceil(AGENT_PICTURE_MAX_BYTES / 3) * 4;
const DATA_URL = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]*={0,2})$/;

function fits(type: PictureType, bytes: Uint8Array): boolean {
  if (type === 'image/gif') return bytes.length >= 6 && /^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6)));
  return looksLike(type, bytes);
}

export class AgentPictures {
  readonly #folder: string;

  /** `worn` lists the avatars the bots of this machine wear now. */
  constructor(dataDir: string, private readonly worn: () => Iterable<string>) {
    this.#folder = join(dataDir, 'agent-pictures');
  }

  /** Stores the picture a `data:` URL carries and returns the avatar that names it. */
  put(dataUrl: unknown): { avatar: string } {
    if (typeof dataUrl !== 'string') throw invalidParams('dataUrl: expected a data: URL of a PNG, JPEG, WebP or GIF image');
    const comma = dataUrl.indexOf(',');
    if (comma < 0 || dataUrl.length - comma - 1 > BASE64_MAX + 4) {
      throw invalidParams(`dataUrl: expected a base64 data: URL of at most ${AGENT_PICTURE_MAX_BYTES} bytes`, { field: 'dataUrl', max: AGENT_PICTURE_MAX_BYTES });
    }
    const match = DATA_URL.exec(dataUrl);
    const type = match?.[1] as PictureType | undefined;
    if (!match || !type || !(AGENT_PICTURE_TYPES as readonly string[]).includes(type)) {
      throw invalidParams(`dataUrl: expected data:<type>;base64,<bytes> with a type among ${AGENT_PICTURE_TYPES.join(', ')}`, { field: 'dataUrl', expected: AGENT_PICTURE_TYPES });
    }
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.length === 0 || bytes.length > AGENT_PICTURE_MAX_BYTES) {
      throw invalidParams(`dataUrl: the picture is ${bytes.length} bytes; expected 1 to ${AGENT_PICTURE_MAX_BYTES}`, { field: 'dataUrl', bytes: bytes.length, max: AGENT_PICTURE_MAX_BYTES });
    }
    if (!fits(type, bytes)) throw invalidParams(`dataUrl: the bytes are not a ${type} image`, { field: 'dataUrl', expected: type });
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    mkdirSync(this.#folder, { recursive: true });
    this.#prune(hash);
    const file = join(this.#folder, `${hash}.${EXTENSIONS[type]}`);
    const held = this.#find(hash);
    if (held === null) {
      const partial = `${file}.${process.pid}.tmp`;
      writeFileSync(partial, bytes);
      renameSync(partial, file);
    } else {
      // Imported again: the form that asked has a day from now to save it.
      const now = new Date();
      utimesSync(held.file, now, now);
    }
    return { avatar: `img:${hash}` };
  }

  /** The picture an avatar names, as a `data:` URL. */
  get(avatar: unknown): { dataUrl: string } {
    const found = typeof avatar === 'string' && AGENT_PICTURE_CODE.test(avatar) ? this.#find(avatar.slice(4)) : null;
    if (found === null) throw notFound(`avatar: no picture ${String(avatar)} on this machine; expected img:<16 hex digits> returned by agents.picture.put`, { field: 'avatar' });
    return { dataUrl: `data:${found.type};base64,${readFileSync(found.file).toString('base64')}` };
  }

  /** Whether this machine holds the picture an `img:` avatar names. */
  has(avatar: string): boolean {
    return AGENT_PICTURE_CODE.test(avatar) && this.#find(avatar.slice(4)) !== null;
  }

  #find(hash: string): { file: string; type: PictureType } | null {
    for (const [ext, type] of Object.entries(TYPES)) {
      const file = join(this.#folder, `${hash}.${ext}`);
      try { if (statSync(file).isFile()) return { file, type }; } catch { /* not this type */ }
    }
    return null;
  }

  /** Removes the pictures no bot wears that were stored more than a day ago, the oldest beyond `UNWORN_PICTURES_MAX`, and any write left half done. */
  #prune(keep: string): void {
    const worn = new Set([...this.worn()].filter(avatar => AGENT_PICTURE_CODE.test(avatar)).map(avatar => avatar.slice(4)));
    const before = Date.now() - UNWORN_PICTURE_MS;
    let names: string[];
    try { names = readdirSync(this.#folder); } catch { return; }
    const kept: { file: string; at: number }[] = [];
    for (const name of names) {
      const hash = name.split('.')[0]!;
      if (hash === keep || worn.has(hash)) continue;
      const file = join(this.#folder, name);
      try {
        const at = statSync(file).mtimeMs;
        if (at < before) rmSync(file, { force: true });
        else kept.push({ file, at });
      } catch { /* gone meanwhile */ }
    }
    // Agents import too: however many they store in a day, the unworn ones stay a bounded few.
    kept.sort((a, b) => a.at - b.at);
    for (const { file } of kept.slice(0, Math.max(0, kept.length - (UNWORN_PICTURES_MAX - 1)))) rmSync(file, { force: true });
  }
}
