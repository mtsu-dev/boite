/**
 * A file link as the chat draws it: a chip with the file's kind, its name and
 * the whole path on hover, in place of the path written out. What a click on
 * one does is `lib/file-open.svelte.ts`; this module stays pure, so the
 * Markdown renderer can draw chips without loading anything.
 */

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export type FileKind = 'image' | 'video' | 'audio' | 'code' | 'doc' | 'archive' | 'program' | 'folder' | 'file';

const KINDS: Array<[FileKind, RegExp]> = [
  ['image', /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|tiff?|heic)$/i],
  ['video', /\.(mp4|mov|webm|mkv|avi|m4v)$/i],
  ['audio', /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i],
  ['program', /\.(exe|com|bat|cmd|msi|appimage|app|ps1|vbs|lnk|sh|command|desktop|deb|rpm|dmg|apk)$/i],
  ['archive', /\.(zip|7z|rar|tar|gz|tgz|xz|bz2|zst)$/i],
  ['doc', /\.(md|markdown|txt|pdf|docx?|odt|rtf|csv|tsv|xlsx?|ods|pptx?|odp|log|epub)$/i],
  ['code', /\.[a-z\d]{1,8}$/i]
];

/** Files whose names carry no extension; any other name without a dot reads as a folder. */
const DOTLESS_DOCS = /^(readme|license|licence|changelog|copying|notice|authors|contributing)$/i;
const DOTLESS_CODE = /^(makefile|dockerfile|containerfile|justfile|procfile|gemfile|rakefile|vagrantfile|cmakelists)$/i;

/** The kind a path's name says, which picks the chip's icon. A path ending in a separator is a folder. */
export function fileKind(path: string): FileKind {
  if (/[\\/]$/.test(path)) return 'folder';
  const name = baseName(path);
  for (const [kind, pattern] of KINDS) if (pattern.test(name)) return kind;
  if (DOTLESS_DOCS.test(name)) return 'doc';
  if (DOTLESS_CODE.test(name)) return 'code';
  return name.includes('.') ? 'file' : 'folder';
}

/** A program to confirm before it runs: what a click launches rather than opens. */
export function programPath(path: string): boolean {
  return fileKind(path) === 'program';
}

/** The last part of a path, its folder separator dropped. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** The folder a path sits in, as written: what tells two files of one name apart. */
function parentName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts.at(-2)! : '';
}

/** `C:\x` or `c:/x`: a path only a Windows machine can mean. */
export function drivePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}

/** An absolute path on some machine: a drive, or a POSIX root. */
export function absolutePath(path: string): boolean {
  return drivePath(path) || path.startsWith('/');
}

/**
 * A path the thread's machine cannot hold: a drive letter (a NAS mapped as
 * `N:` on the user's PC) named in a thread on Linux or macOS. It is looked for
 * on the computer showing the chat instead.
 */
export function foreignPath(path: string, threadOs: string | undefined): boolean {
  return drivePath(path) && threadOs !== undefined && threadOs !== 'windows';
}

/**
 * A file link's HTML. Without a label of its own (a path written as code or
 * bare), the chip shows the file's name and its line; the parent folder waits
 * in it, hidden, for when two files of one name share an answer
 * (`markCollisions`). `data-source` is what a copied selection carries.
 */
export function fileChipHtml(label: string, raw: string, target: string, line: number | undefined): string {
  const written = raw.trim();
  const own = label !== raw;
  const path = escapeHtml(target);
  const attributes = `href="#file" class="file-chip" data-file-path="${path}"${line ? ` data-file-line="${line}"` : ''} data-kind="${fileKind(target)}"`;
  if (own) return `<a ${attributes} title="${escapeHtml(written)}">${escapeHtml(label)}</a>`;
  const parent = parentName(target);
  const name = `${baseName(target)}${line ? `:${line}` : ''}`;
  return `<a ${attributes} title="${escapeHtml(written)}" data-source="${escapeHtml(written)}">`
    + (parent ? `<span class="file-chip-dir">${escapeHtml(parent)}/</span>` : '')
    + `<span class="file-chip-name">${escapeHtml(name)}</span></a>`;
}

/**
 * Two chips of one name and different paths in `root` show their folder
 * (`collide`), so `src/index.ts` and `test/index.ts` never read the same.
 */
export function markCollisions(root: ParentNode): void {
  const byName = new Map<string, Set<string>>();
  const chips = [...root.querySelectorAll<HTMLElement>('a.file-chip[data-source]')];
  for (const chip of chips) {
    const name = baseName(chip.dataset.filePath ?? '').toLowerCase();
    const paths = byName.get(name) ?? new Set<string>();
    paths.add(chip.dataset.filePath ?? '');
    byName.set(name, paths);
  }
  for (const chip of chips) {
    const many = (byName.get(baseName(chip.dataset.filePath ?? '').toLowerCase())?.size ?? 0) > 1;
    chip.classList.toggle('collide', many);
  }
}
