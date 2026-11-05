import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '../../paths.ts';
import type { SessionContext } from '../types.ts';

/** The one variable the extension reads: the thread's limit, the switch and the core's thresholds, as JSON. */
export const COMPACTION_ENV = 'BOITE_COMPACTION';
/** Set in `details` of every compaction entry the extension writes, so the divider says `background`. */
export const BACKGROUND_MARKER = 'boiteBackground';
export const COMPACTION_EXTENSION = 'pi-compaction.mjs';
const RUN_MODULE = 'pi-compaction-run.mjs';

/**
 * The value of `BOITE_COMPACTION` for a launch, or null when the thread has no
 * background compaction (the experiment off, or no token limit): pi then runs
 * without the extension. A session launched with another value is replaced at
 * its next idle turn.
 */
export function compactionSetting(ctx: Pick<SessionContext, 'backgroundCompaction'>): string | null {
  const setting = ctx.backgroundCompaction?.();
  if (setting === undefined || !setting.background || setting.tokens === null) return null;
  return JSON.stringify({ tokens: setting.tokens, background: true, ratios: setting.ratios });
}

/** A compaction whose `details` the extension marked: the copy made in the background. */
export function isBackgroundCompaction(details: unknown): boolean {
  return typeof details === 'object' && details !== null && (details as Record<string, unknown>)[BACKGROUND_MARKER] === true;
}

/** Writes the extension's two modules with `write` and returns the path `--extension` takes. */
export function writeCompactionExtension(write: (name: string, code: string) => string): string {
  write(RUN_MODULE, RUN_SOURCE);
  return write(COMPACTION_EXTENSION, ENTRY_SOURCE);
}

/**
 * Boite's own directory of pi extensions, in the core's data directory and
 * outside every account and transcript. A file is rewritten only when its code
 * changed, through a rename, so a pi starting at the same time never reads half
 * of one.
 */
export function extensionWriter(dir: string = join(resolveDataDir(), 'pi-extensions')): (name: string, code: string) => string {
  return (name, code) => {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    if (existsSync(path) && readFileSync(path, 'utf8') === code) return path;
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, code, { mode: 0o600 });
    renameSync(temporary, path);
    return path;
  };
}

/**
 * The entry pi loads. It reads the setting, and pi's own `compact` and default
 * reserve from the package pi maps for its extensions, so the summary is the
 * one pi writes itself. pi does not export `prepareCompaction`: the run module
 * prepares the copy from the session projection.
 */
const ENTRY_SOURCE = `import { compact, DEFAULT_COMPACTION_SETTINGS } from '@earendil-works/pi-coding-agent';
import { install } from './${RUN_MODULE}';

export default function boiteCompaction(pi) {
  const setting = JSON.parse(process.env.${COMPACTION_ENV} || 'null');
  if (!setting || setting.background !== true || typeof setting.tokens !== 'number') return;
  install(pi, setting, { compact, settings: DEFAULT_COMPACTION_SETTINGS });
}
`;

/**
 * Boite's background compaction inside a pi run, OpenCode 2's ported to pi's
 * extension API. At a `turn_end` whose context passes the start band below
 * the limit, a copy starts: everything before that turn's assistant entry (the
 * anchor) is summarized by `compact`, unawaited, while the run goes on. At the
 * first `turn_end` that reaches the limit the copy is awaited and appended as
 * a compaction entry that keeps the entries from the anchor on, so tool calls
 * and their results stay whole. pi's own threshold compaction takes a ready
 * copy instead of summarizing; an overflow is left to pi.
 */
const RUN_SOURCE = `export const MARKER = '${BACKGROUND_MARKER}';

export function install(pi, setting, deps) {
  const limit = setting.tokens, ratios = setting.ratios;
  const start = Math.max(ratios.minTokens, ratios.startRatio * limit);
  const tail = Math.min(ratios.tailTokens, ratios.tailShare * limit);
  let copy = null;
  // Copies that failed since the context was last compacted.
  let failures = 0;

  function drop() {
    const gone = copy;
    if (gone === null) return;
    copy = null;
    clearTimeout(gone.timer);
    gone.controller.abort();
    gone.settle();
  }
  function fail(entry) {
    if (copy !== entry) return;
    failures += 1;
    drop();
  }
  function begin(ctx, anchor, tokens) {
    const model = ctx.model;
    const preparation = model ? prepareUpTo(ctx.sessionManager.buildSessionProjection(), anchor, tokens, deps.settings) : undefined;
    if (preparation === undefined) return;
    const entry = { anchor, tokens, controller: new AbortController(), result: null, timer: null, settle: () => {} };
    entry.done = new Promise((resolve) => { entry.settle = resolve; });
    copy = entry;
    // A copy still running after the timeout is stopped, and counts as failed.
    entry.timer = setTimeout(() => fail(entry), ratios.timeoutMs);
    entry.timer.unref?.();
    summarize(ctx, model, preparation, entry.controller.signal).then((result) => {
      if (copy !== entry) return;
      clearTimeout(entry.timer);
      entry.result = result;
      entry.settle();
    }, () => fail(entry));
  }
  async function summarize(ctx, model, preparation, signal) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(auth.error);
    const target = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
    return deps.compact(preparation, target, auth.apiKey, auth.headers, undefined, signal, ctx.thinkingLevel, undefined, auth.env);
  }
  // The ready copy, taken; null and dropped when the context grew past the tail limit or left its anchor.
  function take(ctx, tokens) {
    const taken = copy;
    if (taken === null || taken.result === null) return null;
    if (tokens - taken.tokens > tail || !ctx.sessionManager.getBranch().some((entry) => entry.id === taken.anchor)) {
      drop();
      return null;
    }
    copy = null;
    failures = 0;
    return taken;
  }
  function details(taken) {
    return { ...(taken.result.details ?? {}), [MARKER]: true };
  }

  pi.on('turn_end', async (event, ctx) => {
    const tokens = ctx.getContextUsage()?.tokens;
    if (typeof tokens !== 'number') return undefined;
    if (tokens >= limit) {
      if (copy !== null) await copy.done;
      const taken = take(ctx, tokens);
      if (taken === null) return undefined;
      // The chain's entries so far go on: a handler's list replaces them.
      const draft = { type: 'compaction', summary: taken.result.summary, firstKeptEntryId: taken.anchor, details: details(taken), usage: taken.result.usage };
      return { entries: [...(event.entries ?? []), draft] };
    }
    if (copy !== null && copy.result !== null && tokens - copy.tokens > tail) drop();
    if (copy === null && tokens >= start && failures < ratios.maxFailures && event.messageEntryId) begin(ctx, event.messageEntryId, tokens);
    return undefined;
  });

  pi.on('session_before_compact', (event, ctx) => {
    if (event.reason !== 'threshold') return undefined;
    const taken = take(ctx, ctx.getContextUsage()?.tokens ?? event.preparation.tokensBefore);
    if (taken === null) return undefined;
    return { compaction: { summary: taken.result.summary, firstKeptEntryId: taken.anchor, tokensBefore: event.preparation.tokensBefore, usage: taken.result.usage, details: details(taken) } };
  });

  // Any compaction starts a new context: a copy of the one before is of nothing.
  pi.on('session_compact', () => { drop(); failures = 0; });
  pi.on('session_shutdown', () => { drop(); });
}

// What pi's prepareCompaction makes, cut at the anchor: the messages since the
// last compaction and before the anchor, which the summary replaces.
export function prepareUpTo(projection, anchor, tokensBefore, settings) {
  const entries = projection.entries;
  const end = entries.findIndex((entry) => entry.sourceEntry.id === anchor);
  const previous = entries.findIndex((entry) => entry.sourceEntry.type === 'compaction' && entry.messages.length > 0);
  if (end < 0 || end <= previous) return undefined;
  const messagesToSummarize = entries.slice(previous + 1, end)
    .flatMap((entry) => entry.sourceEntry.type === 'compaction' ? [] : entry.messages.filter((message) => message.role !== 'system'));
  if (messagesToSummarize.length === 0) return undefined;
  const earlier = previous < 0 ? null : entries[previous].sourceEntry;
  const fileOps = { read: new Set(), written: new Set(), edited: new Set() };
  if (earlier !== null && earlier.details && (!earlier.fromHook || earlier.details[MARKER] === true)) {
    for (const path of earlier.details.readFiles ?? []) fileOps.read.add(path);
    for (const path of earlier.details.modifiedFiles ?? []) fileOps.edited.add(path);
  }
  for (const message of messagesToSummarize) noteFiles(message, fileOps);
  return { firstKeptEntryId: anchor, messagesToSummarize, turnPrefixMessages: [], isSplitTurn: false, tokensBefore,
    previousSummary: earlier === null ? undefined : earlier.summary, fileOps, settings };
}

function noteFiles(message, fileOps) {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return;
  for (const block of message.content) {
    const path = block && block.type === 'toolCall' && typeof block.arguments?.path === 'string' ? block.arguments.path : null;
    if (path === null) continue;
    if (block.name === 'read') fileOps.read.add(path);
    else if (block.name === 'write') fileOps.written.add(path);
    else if (block.name === 'edit') fileOps.edited.add(path);
  }
}
`;
