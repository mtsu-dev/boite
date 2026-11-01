/**
 * How `boite settings` reads what the agent typed: values, a bot setting's
 * words, the page of a card and an image file for a bot to wear.
 */
import { readFileSync, statSync } from 'node:fs';
import { AGENT_PICTURE_MAX_BYTES } from '@boite/contracts';
import { Usage } from './cli-args.ts';

/** A value as typed: JSON when it parses (60, true, null, ["a"]), the bare word otherwise. */
export function settingValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * A bot setting as typed: the text keys take the words as they are, so a
 * name such as `007` stays text; `projects` takes `+name -name` edits or a
 * list (`a,b`, `a b` or JSON), the other keys a value as `settingValue` reads it.
 */
export function agentSettingArg(key: string, tokens: string[]): unknown {
  const raw = tokens.join(' ').trim();
  if (['name', 'domain', 'instructions', 'avatar', 'status'].includes(key)) return raw;
  if (key !== 'projects') return settingValue(raw);
  if (raw.startsWith('[') || raw.startsWith('{')) return settingValue(raw);
  const items = raw.split(/[\s,]+/).filter(item => item.length > 0);
  const edits = items.filter(item => /^[+-]./.test(item));
  if (edits.length === 0) return items;
  if (edits.length !== items.length) throw new Usage('settings bot request projects takes +name -name edits or a list, not both');
  return { add: edits.filter(item => item.startsWith('+')).map(item => item.slice(1)), remove: edits.filter(item => item.startsWith('-')).map(item => item.slice(1)) };
}

/**
 * An image file as the `data:` URL `agents.picture.put` takes, its type read
 * from its first bytes. No resizing here: a file over the bound is refused
 * with what to do, and the core checks the bytes again.
 */
export function pictureDataUrl(path: string): string {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Usage(`picture: ${path} is not a file`);
    size = stat.size;
  } catch (error) {
    if (error instanceof Usage) throw error;
    throw new Usage(`picture: no file at ${path}`);
  }
  if (size === 0 || size > AGENT_PICTURE_MAX_BYTES) throw new Usage(`picture: ${path} is ${size} bytes; a bot's picture is at most ${AGENT_PICTURE_MAX_BYTES} (shrink it to about 256x256 first)`);
  let bytes: Buffer;
  try { bytes = readFileSync(path); } catch (error) { throw new Usage(`picture: cannot read ${path}: ${(error as Error).message}`); }
  const head = bytes.subarray(0, 12).toString('latin1');
  const type = head.startsWith('\x89PNG') ? 'image/png'
    : head.startsWith('\xff\xd8\xff') ? 'image/jpeg'
      : head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP' ? 'image/webp'
        : /^GIF8[79]a/.test(head) ? 'image/gif' : null;
  if (type === null) throw new Usage(`picture: ${path} is not a PNG, JPEG, WebP or GIF image`);
  return `data:${type};base64,${bytes.toString('base64')}`;
}

/** A bot's instructions run to thousands of characters: a listing shows their start; one key or --json gives them whole. */
export function clipped(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}… (${text.length} characters)` : text;
}

/** `resources#limits` into a page and a card. */
export function settingsPlace(raw: string): { page: string; section?: string } {
  const parts = raw.split('#');
  if (parts.length > 2) throw new Usage('settings open takes one page, with an optional #card');
  const [page = '', section] = parts;
  return section === undefined || section.length === 0 ? { page } : { page, section };
}
