/**
 * The showcase seed: public sample data that fills every screen of the app for
 * the capture rig. Loaded only by the rig's own Vite server, after the fake
 * core's demo seeds (`team`, `agents`, `subagents`, `board`, `debates`).
 * Everything here is invented: projects, people (generic first names) and code.
 */
import type { AgentProfile, AgentRuntimeConfig, Message, MessagePart, PermissionRequest, Project, Thread, ThreadStatus, Turn } from '../../packages/contracts/src/index';
import type { FakeClientOptions, FakeContext } from '../../packages/ui/src/lib/fake-client/context';
import { FAKE_CHANGES, FAKE_DIFFS } from '../../packages/ui/src/lib/fake-client/files';
import { settlePermission } from '../../packages/ui/src/lib/fake-client/requests';
import { T0 } from '../../packages/ui/src/lib/fake-client/shared';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ROOT = 'C:\\src';

/** A page query flag set to 1. The rig's server runs the seed in the page, so the flags are the page's. */
const flag = (name: string): boolean => Boolean(globalThis.location) && new URLSearchParams(globalThis.location.search).get(name) === '1';

export function seedShowcase(ctx: FakeContext, options: FakeClientOptions): void {
  if (options.uninstalled) return;
  if (options.coreId === 'fake-builder') { seedBuilder(ctx); dropEcho(ctx); return; }
  if (options.coreId === 'fake-lab') { seedLab(ctx); dropEcho(ctx); return; }
  const now = Date.now();
  const shift = now - 3 * HOUR - T0;
  rebase(ctx, shift);
  // What the fake core makes later (a team post, an archive) is dated on the same moved clock.
  const clock = ctx.now.bind(ctx);
  ctx.now = () => clock() + shift;
  projects(ctx, now);
  retitleDemos(ctx, now);
  flagship(ctx, now);
  questionThread(ctx, now);
  permissionThread(ctx);
  extraThreads(ctx, now);
  // `?dense=1`: a sidebar about twice as long, the load B1's density is measured on.
  if (flag('dense')) denseThreads(ctx, now);
  // `?calm=1`: the workspace of one person on a normal day, after every demo seed added its threads.
  if (flag('calm')) calm(ctx, now);
  changes(ctx);
  dropEcho(ctx);
}

// ---------------------------------------------------------------------------
// Time: the base seed is dated September 2026; move it to a few hours ago.
// ---------------------------------------------------------------------------

/** Adds `delta` to every timestamp of the base seed's day, so rows read "2h ago" and not a date two months back. */
function rebase(ctx: FakeContext, delta: number): void {
  const old = (value: number) => value > T0 - 60 * DAY && value < T0 + 30 * DAY;
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 8 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(entry => walk(entry, depth + 1)); return; }
    if (Object.getPrototypeOf(value) !== Object.prototype) return;
    const record = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry === 'number' && old(entry)) record[key] = entry + delta;
      else if (key !== 'text' && key !== 'data') walk(entry, depth + 1);
    }
  };
  for (const thread of ctx.threads.values()) walk(thread);
  walk(ctx.processes); walk(ctx.scheduler); walk(ctx.todos); walk(ctx.importable);
  for (const pending of ctx.pendingPermissions.values()) walk(pending.request);
  for (const pending of ctx.pendingQuestions.values()) walk(pending.request);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const ORBIT = `${ROOT}\\orbit`;

/** A small mark for Orbit's folder logo: a ring around a dot on a blue square. */
const ORBIT_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#3b5bdb"/>' +
  '<ellipse cx="12" cy="12" rx="8" ry="4.2" fill="none" stroke="#fff" stroke-width="1.6" transform="rotate(-25 12 12)"/>' +
  '<circle cx="12" cy="12" r="2.6" fill="#fff"/><circle cx="18.6" cy="8.6" r="1.3" fill="#ffd43b"/></svg>';

const NEW_PROJECTS: (Omit<Project, 'createdAt'> & { age: number })[] = [
  { id: 'p-atlas', name: 'atlas-api', path: `${ROOT}\\atlas-api`, repository: true, icon: { kind: 'tech', id: 'go' }, age: 40 * DAY },
  { id: 'p-courier', name: 'courier-mobile', path: `${ROOT}\\courier-mobile`, repository: true, icon: { kind: 'tech', id: 'flutter' }, age: 30 * DAY },
  { id: 'p-lumen', name: 'lumen-docs', path: `${ROOT}\\lumen-docs`, repository: true, icon: { kind: 'tech', id: 'next' }, age: 25 * DAY },
  { id: 'p-garden', name: 'pixel-garden', path: `${ROOT}\\pixel-garden`, repository: true, icon: { kind: 'tech', id: 'rust' }, age: 20 * DAY },
  { id: 'p-sandbox', name: 'sandbox', path: `${ROOT}\\sandbox`, repository: false, age: 60 * DAY },
];

function projects(ctx: FakeContext, now: number): void {
  const orbit = ctx.projects.find(p => p.id === 'p-boite');
  if (orbit) { orbit.name = 'orbit'; orbit.path = ORBIT; }
  ctx.projectImages.set('p-boite', { version: 'b7e43f2a9c10', dataUrl: `data:image/svg+xml;base64,${btoa(ORBIT_LOGO)}` });
  if (orbit?.icon?.kind === 'image') orbit.icon = { kind: 'image', version: 'b7e43f2a9c10' };
  const notes = ctx.projects.find(p => p.id === 'p-notes');
  if (notes) { notes.name = 'field-notes'; notes.path = `${ROOT}\\field-notes`; }
  for (const { age, ...project } of NEW_PROJECTS) ctx.projects.push({ ...project, createdAt: now - age });
  const moved = (cwd: string) => cwd.replace('C:\\src\\.boite-worktrees\\boite', `${ORBIT}\\.boite\\worktrees`).replace('C:\\src\\boite', ORBIT).replace('C:\\src\\notes', `${ROOT}\\field-notes`);
  for (const thread of ctx.threads.values()) thread.cwd = moved(thread.cwd);
  for (const worktree of ctx.worktrees) worktree.path = moved(worktree.path);
}

// ---------------------------------------------------------------------------
// The demo threads, given titles and agents that read like real work
// ---------------------------------------------------------------------------

const TITLES: Record<string, string> = {
  't-team-running': 'Audit the CSV edge cases',
  't-team-done': 'Review the import copy',
  't-team-waiting': 'Run the import test suite',
  't-team-interrupted': 'Build the preview release',
  't-descriptors': 'Summarize the user interviews',
  't-parser': 'Rework the date parser',
  't-native': 'Review the plugin boundaries',
  't-cli': 'Audit the CLI flags',
  't-subagents-work': 'Split the dashboard store',
  't-subagents-work-1': 'Move the filters part',
  't-subagents-work-2': 'Move the charts part',
  't-subagents-ask': 'Migrate the settings page',
};

/** Claude and Codex models, spread over the rows so the provider marks vary. */
const AGENTS = [
  { providerId: 'claude', accountId: 'a-claude-main', model: 'claude-opus-5-5', effort: 'high' },
  { providerId: 'claude', accountId: 'a-claude-main', model: 'claude-sonnet-5-5', effort: 'medium' },
  { providerId: 'codex', accountId: 'a-codex', model: 'gpt-6.1-sol', effort: 'high' },
  { providerId: 'claude', accountId: 'a-claude-side', model: 'claude-fable-5-1', effort: 'xhigh' },
] as const;

function retitleDemos(ctx: FakeContext, now: number): void {
  let index = 0;
  for (const thread of ctx.threads.values()) {
    if (TITLES[thread.id]) { thread.title = TITLES[thread.id]!; thread.titleSource = 'user'; }
    // Bots keep their own engine; project threads get a real agent.
    if (thread.projectId === null || thread.agentSessionId) continue;
    if (thread.providerId === 'echo' || thread.providerId === 'antigravity') {
      Object.assign(thread, AGENTS[index++ % AGENTS.length]);
      thread.promptCache = undefined;
    }
  }
  const parser = ctx.threads.get('t-parser');
  if (parser) { parser.archivedAt = now - 2 * DAY; parser.branch = 'orbit/rework-the-date-parser'; }
}

/** Where the showcase puts what the base seed ran on Echo. */
const ECHO_TO = { providerId: 'claude', accountId: 'a-claude-main', model: 'claude-opus-5-5' } as const;

/**
 * The real core lists Echo only under `BOITE_ECHO=1`, so a user never sees it:
 * the showcase drops it too, unless `?echo=1`. What the base seed ran on it
 * (bots, team threads, past turns, logs) runs on Claude instead.
 */
function dropEcho(ctx: FakeContext): void {
  if (globalThis.location && new URLSearchParams(globalThis.location.search).get('echo') === '1') return;
  const route = <T extends { providerId: string; accountId: string; model?: string | null }>(entry: T): T =>
    entry.providerId !== 'echo' ? entry : { ...entry, providerId: ECHO_TO.providerId, accountId: ECHO_TO.accountId, ...('model' in entry ? { model: entry.model === null ? null : ECHO_TO.model } : {}) };
  for (const thread of ctx.threads.values()) {
    if (thread.providerId === 'echo') Object.assign(thread, { ...ECHO_TO, effort: 'high' });
    if (thread.promptCache?.accountId === 'a-echo') thread.promptCache = undefined;
    for (const turn of thread.turns) {
      if (turn.execution?.providerId === 'echo') Object.assign(turn.execution, { providerId: thread.providerId, accountId: thread.accountId, model: thread.model, effort: thread.effort });
    }
  }
  // The agents' own maps: the seed edits them in place, as `rebase` does the threads.
  const agents = ctx.agents as unknown as { profiles: Map<string, AgentProfile>; configs: Map<string, AgentRuntimeConfig> };
  for (const profile of agents.profiles.values()) profile.selection = route(profile.selection);
  for (const config of agents.configs.values()) {
    config.defaultRoute = route(config.defaultRoute);
    config.allowedRoutes = config.allowedRoutes.map(route);
  }
  for (const record of ctx.logs) {
    if (record.providerId !== 'echo') continue;
    record.providerId = ECHO_TO.providerId;
    if (record.model) record.model = ECHO_TO.model;
  }
  ctx.hooks.providers = ctx.hooks.providers.filter(entry => entry.providerId !== 'echo');
  for (const key of [...ctx.modelCatalogs.keys()]) if (key.startsWith('echo::')) ctx.modelCatalogs.delete(key);
  ctx.accounts = ctx.accounts.filter(account => account.providerId !== 'echo');
  ctx.providers = ctx.providers.filter(provider => provider.id !== 'echo');
}

// ---------------------------------------------------------------------------
// The flagship thread: a long working session on Orbit, still running
// ---------------------------------------------------------------------------

type Step = { name: string; input: unknown; output: string | null; status?: 'done' | 'running' | 'error'; exitCode?: number };

function tool(ctx: FakeContext, at: number, step: Step): MessagePart {
  return {
    type: 'tool', toolId: `tool-showcase-${++ctx.seq}`, name: step.name, input: step.input, output: step.output,
    status: step.status ?? 'done', startedAt: at, finishedAt: step.status === 'running' ? null : at + 4_000,
    ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
  };
}

function turn(thread: Thread, id: string, at: number, minutes: number, status: Turn['status'] = 'done'): Turn {
  return {
    id, threadId: thread.id, status, queuedAt: at, startedAt: at, finishedAt: status === 'running' ? null : at + minutes * MINUTE,
    usage: status === 'running' ? null : { inputTokens: 18_400 + minutes * 900, outputTokens: 2_100 + minutes * 140, cacheReadTokens: 96_000, cacheWriteTokens: 4_200, costUsdEquivalent: 0.11 + minutes * 0.02 },
    error: null,
  };
}

function message(thread: Thread, turnId: string, role: Message['role'], at: number, parts: MessagePart[], state: Message['state'] = 'complete'): Message {
  return { id: `m-showcase-${thread.id}-${thread.messages.length + 1}`, threadId: thread.id, turnId, role, parts, state, createdAt: at };
}

/** A mockup of the import preview, drawn once on a canvas: the picture the user attached. */
function mockup(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 880; canvas.height = 520;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#f4f5f8'; g.fillRect(0, 0, 880, 520);
    g.fillStyle = '#ffffff'; g.fillRect(40, 40, 800, 440);
    g.strokeStyle = '#d0d4dc'; g.lineWidth = 2; g.strokeRect(40, 40, 800, 440);
    g.fillStyle = '#1f2430'; g.font = 'bold 26px sans-serif'; g.fillText('Import contacts', 72, 92);
    g.fillStyle = '#6b7280'; g.font = '17px sans-serif'; g.fillText('customers-2026.csv  ·  4,812 rows  ·  6 columns', 72, 124);
    const columns = ['Name', 'Email', 'Company', 'Plan', 'Signed up'];
    const rows = [['Ada', 'ada@example.com', 'Northwind', 'Team', '2026-03-02'], ['Liam', 'liam@example.com', 'Contoso', 'Free', '2026-04-18'], ['Noor', 'noor@example.com', 'Fabrikam', 'Pro', '2026-05-07'], ['Mateo', 'mateo@example.com', 'Initech', 'Team', '2026-06-21']];
    g.fillStyle = '#eef1f7'; g.fillRect(72, 150, 736, 44);
    g.font = 'bold 16px sans-serif'; g.fillStyle = '#374151';
    columns.forEach((name, i) => g.fillText(name, 88 + i * 146, 178));
    g.font = '16px sans-serif';
    rows.forEach((row, r) => {
      g.fillStyle = r % 2 ? '#fafbfc' : '#ffffff'; g.fillRect(72, 194 + r * 44, 736, 44);
      g.fillStyle = '#1f2430'; row.forEach((cell, i) => g.fillText(cell, 88 + i * 146, 222 + r * 44));
    });
    g.fillStyle = '#3b5bdb'; g.beginPath(); g.roundRect(640, 410, 168, 46, 10); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 17px sans-serif'; g.fillText('Import 4,812 rows', 656, 439);
    g.fillStyle = '#e03131'; g.font = '15px sans-serif'; g.fillText('3 rows have an invalid email and will be skipped', 72, 440);
    return canvas.toDataURL('image/png').split(',')[1] ?? null;
  } catch { return null; }
}

const PLAN = `## Plan

1. **Parse** the file in a worker with a strict RFC 4180 reader, so a 50 MB export never blocks the page.
2. **Preview** the first 200 rows and let the user map each column to a field.
3. **Validate** every row before anything is written, and list the rows that will be skipped.
4. **Import** in batches of 500 through the existing \`/contacts/bulk\` endpoint.

| Step | Where | New code |
| --- | --- | --- |
| Parse | \`src/lib/csv/parse.ts\` | worker + reader |
| Preview | \`src/routes/import/+page.svelte\` | table, column menu |
| Validate | \`src/lib/csv/validate.ts\` | email, date and plan rules |
| Import | \`src/lib/api/contacts.ts\` | batched upload with retry |

The upload helper already retries on 429, so the import reuses it.`;

const PARSER_DONE = `### The parser is in

\`parse.ts\` now reads quoted fields the way spreadsheets write them:

- a doubled quote inside a quoted field is one quote;
- a newline inside quotes stays in the field;
- a stray quote in an unquoted field is an error with its line and column, never a silent guess.

\`\`\`ts
export function parseLine(line: string, state: ReaderState): string[] {
  const cells: string[] = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  if (quoted) state.open = true;
  return [...cells, cell];
}
\`\`\`

All 42 parser tests pass, including the 9 new ones for quotes and line breaks.`;

const REVIEW_SUMMARY = `I started a workflow that reviews each parser file for malformed-input bugs, and four subagents for the rest:

- **Audit the CSV edge cases**: empty lines, a BOM, semicolon exports from European spreadsheets.
- **Review the import copy**: labels, the skipped-rows message and the empty state.
- **Run the import test suite** on the full fixture set.
- **Build the preview release** so you can try it on staging.

I will merge their findings into one change once they report.`;

function flagship(ctx: FakeContext, now: number): void {
  const thread = ctx.threads.get('t-trace');
  if (!thread) return;
  const start = now - 95 * MINUTE;
  Object.assign(thread, {
    title: 'Add CSV import to the contacts page', titleSource: 'user', providerId: 'claude', accountId: 'a-claude-main',
    model: 'claude-opus-5-5', effort: 'high', permissionMode: 'default', branch: 'orbit/csv-import', cwd: `${ORBIT}\\.boite\\worktrees\\csv-import`,
    pinned: true, unread: false, createdAt: start, updatedAt: now - 40_000, lastUserMessageAt: now - 75_000,
    context: { tokens: 118_400, window: 200_000, at: now - MINUTE }, load: { processes: 3, cpuPercent: 18, memoryBytes: 640 * 1024 * 1024 },
    pullRequest: { number: 128, url: 'https://github.com/example/orbit/pull/128', state: 'OPEN' },
  });
  thread.promptCache = { at: now - 4 * MINUTE, ttlSeconds: 3600, source: 'reported', readTokens: 96_000, model: 'claude-opus-5-5', accountId: 'a-claude-main' };
  thread.turns = [];
  thread.messages = [];
  const image = mockup();

  // Turn 1: the ask, a look around, the plan.
  const turn1 = turn(thread, 'turn-showcase-1', start, 6);
  thread.turns.push(turn1);
  thread.messages.push(message(thread, turn1.id, 'user', start, [
    { type: 'text', text: 'Add CSV import to the contacts page. People drop a file, see a preview, map the columns, then import. It has to handle the exports our customers send, which are messy.' },
  ]));
  thread.messages.push(message(thread, turn1.id, 'assistant', start + 20_000, [
    { type: 'thinking', text: 'Start with what already exists: the contacts routes, the API client and whether there is any CSV code. Then propose a plan before touching anything.', startedAt: start + 5_000, finishedAt: start + 14_000 },
    { type: 'text', text: 'Let me look at how the contacts page and the API client are built today.' },
    tool(ctx, start + 30_000, { name: 'Grep', input: { pattern: 'contacts/bulk|parseCsv', path: 'src' }, output: 'src/lib/api/contacts.ts:41:  bulk: (rows: ContactInput[]) => post("/contacts/bulk", rows),\nsrc/routes/contacts/+page.svelte:12:import { contacts } from "$lib/api/contacts";' }),
    tool(ctx, start + 50_000, { name: 'Read', input: { file_path: 'src/lib/api/contacts.ts' }, output: 'import { post, withRetry } from "./http";\n\nexport const contacts = {\n  list: (query: string) => get(`/contacts?${query}`),\n  bulk: (rows: ContactInput[]) => withRetry(() => post("/contacts/bulk", rows)),\n};' }),
    tool(ctx, start + 70_000, { name: 'Glob', input: { pattern: 'src/routes/contacts/**' }, output: 'src/routes/contacts/+page.svelte\nsrc/routes/contacts/+page.ts\nsrc/routes/contacts/[id]/+page.svelte' }),
    { type: 'text', text: PLAN },
  ]));

  // Turn 2: a picture of the design, the parser written and tested.
  const at2 = start + 12 * MINUTE;
  const turn2 = turn(thread, 'turn-showcase-2', at2, 14);
  thread.turns.push(turn2);
  thread.messages.push(message(thread, turn2.id, 'user', at2, [
    { type: 'text', text: 'Good plan. Here is the design for the preview. Keep the parser strict about quotes.' },
    ...(image ? [{ type: 'image' as const, mimeType: 'image/png' as const, data: image, alt: 'import-preview.png' }] : []),
  ]));
  thread.messages.push(message(thread, turn2.id, 'assistant', at2 + 30_000, [
    { type: 'text', text: 'The design maps well onto the plan. I will write the parser first, test it, then build the preview around it.' },
    tool(ctx, at2 + MINUTE, { name: 'Write', input: { file_path: 'src/lib/csv/parse.ts', content: 'export interface ReaderState { open: boolean; line: number }\n\nexport function parseLine(line: string, state: ReaderState): string[] {\n  // ...\n}\n' }, output: 'Created src/lib/csv/parse.ts (64 lines)' }),
    tool(ctx, at2 + 2 * MINUTE, { name: 'Edit', input: { file_path: 'src/lib/api/contacts.ts', old_string: '  bulk: (rows: ContactInput[]) => withRetry(() => post("/contacts/bulk", rows)),', new_string: '  bulk: (rows: ContactInput[]) => withRetry(() => post("/contacts/bulk", rows)),\n  /** Sends rows in batches of 500 and reports progress after each one. */\n  importAll: async (rows: ContactInput[], progress: (done: number) => void) => {\n    for (let i = 0; i < rows.length; i += 500) {\n      await contacts.bulk(rows.slice(i, i + 500));\n      progress(Math.min(i + 500, rows.length));\n    }\n  },' }, output: 'The file src/lib/api/contacts.ts has been updated.' }),
    tool(ctx, at2 + 4 * MINUTE, { name: 'Bash', input: { command: 'bun test src/lib/csv', description: 'Run the parser tests' }, output: 'bun test v1.3.2\n\nsrc/lib/csv/parse.test.ts:\n✓ reads a plain line [0.12ms]\n✓ keeps a doubled quote as one quote [0.08ms]\n✓ keeps a newline inside quotes [0.10ms]\n✗ rejects a stray quote in an unquoted field [0.21ms]\n  expected error at 1:7, got none\n\n 41 pass\n 1 fail\nRan 42 tests across 3 files. [118.00ms]', status: 'error', exitCode: 1 }),
    { type: 'text', text: 'One test fails: a stray quote in an unquoted field was accepted. Fixing the reader.' },
    tool(ctx, at2 + 6 * MINUTE, { name: 'Edit', input: { file_path: 'src/lib/csv/parse.ts', old_string: '    else if (char === \'"\') quoted = !quoted;', new_string: '    else if (char === \'"\' && (cell === \'\' || quoted)) quoted = !quoted;\n    else if (char === \'"\') throw new CsvError(state.line, i + 1, \'stray quote\');' }, output: 'The file src/lib/csv/parse.ts has been updated.' }),
    tool(ctx, at2 + 7 * MINUTE, { name: 'Bash', input: { command: 'bun test src/lib/csv', description: 'Run the parser tests again' }, output: 'bun test v1.3.2\n\n 42 pass\n 0 fail\nRan 42 tests across 3 files. [104.00ms]', exitCode: 0 }),
    { type: 'text', text: PARSER_DONE },
  ]));

  // Turn 3: reviewers and a workflow; the delegation demo's cards follow it. It ends as the
  // demo's run starts (150 s ago), before its children (85 s ago), so their lines sit under
  // it, a past turn, and turn 4 starts after them (75 s ago).
  const at3 = now - 270_000;
  const turn3 = turn(thread, 'turn-showcase-3', at3, 2);
  thread.turns.push(turn3);
  thread.messages.push(message(thread, turn3.id, 'user', at3, [{ type: 'text', text: 'Spin up reviewers for the parser and run the whole suite while you build the preview.' }]));
  thread.messages.push(message(thread, turn3.id, 'assistant', at3 + 40_000, [
    tool(ctx, at3 + 20_000, { name: 'Bash', input: { command: 'boite workflow run review-parser.json', description: 'Start the parser review workflow' }, output: 'Workflow "Review the parser" started: 5 steps, 2 at a time.' }),
    { type: 'text', text: REVIEW_SUMMARY },
  ]));

  // Turn 4: the preview built, the push waiting on the user's approval.
  const at4 = now - 75_000;
  const turn4 = turn(thread, 'turn-showcase-4', at4, 0, 'running');
  thread.turns.push(turn4);
  thread.messages.push(message(thread, turn4.id, 'user', at4, [{ type: 'text', text: 'Wire the Import button into the contacts toolbar, then push and open the PR.' }]));
  const live = message(thread, turn4.id, 'assistant', at4 + 15_000, [
    { type: 'thinking', text: 'The toolbar already has an Export button; Import goes beside it and opens the new route. Then commit, push and open the pull request.', startedAt: at4 + 5_000, finishedAt: at4 + 12_000 },
    tool(ctx, at4 + 18_000, { name: 'Read', input: { file_path: 'src/routes/contacts/+page.svelte' }, output: '<Toolbar>\n  <Button href="/contacts/export">Export</Button>\n</Toolbar>' }),
    tool(ctx, at4 + 24_000, { name: 'Edit', input: { file_path: 'src/routes/contacts/+page.svelte', old_string: '  <Button href="/contacts/export">Export</Button>', new_string: '  <Button href="/contacts/import" icon="upload">Import</Button>\n  <Button href="/contacts/export">Export</Button>' }, output: 'The file src/routes/contacts/+page.svelte has been updated.' }),
    tool(ctx, at4 + 30_000, { name: 'Bash', input: { command: 'bun run check && git add -A && git commit -m "Add CSV import to the contacts page"', description: 'Check and commit' }, output: 'svelte-check found 0 errors and 0 warnings\n[orbit/csv-import 4f1c2ab] Add CSV import to the contacts page\n 6 files changed, 412 insertions(+), 3 deletions(-)', exitCode: 0 }),
    { type: 'text', text: 'Everything checks out and is committed. Pushing the branch needs your approval.' },
    { type: 'permission', requestId: 'req-showcase-push', toolName: 'Bash', decision: null },
  ], 'streaming');
  thread.messages.push(live);
  thread.status = 'waiting';
  thread.runningSince = at4;
  thread.requestSince = now - 40_000;
  const request: PermissionRequest = {
    id: 'req-showcase-push', threadId: thread.id, turnId: turn4.id, toolName: 'Bash',
    input: { command: 'git push -u origin orbit/csv-import', description: 'Push the branch to open the pull request' },
    description: 'Push the branch to open the pull request', createdAt: now - 40_000,
  };
  ctx.pendingPermissions.set(request.id, {
    request,
    resolve: (decision) => {
      settlePermission(ctx, thread, live, live.parts.length - 1, request, decision);
      thread.status = 'running';
      ctx.touch(thread);
    },
  });
  ctx.usage.set(thread.id, { inputTokens: 184_000, outputTokens: 22_600, cacheReadTokens: 1_240_000, cacheWriteTokens: 48_000, costUsdEquivalent: 3.84 });
  // The children and the workflow started in turn 3.
  for (const row of ctx.delegationAgents.get(thread.id) ?? []) {
    const child = ctx.threads.get(row.threadId);
    if (child) row.task = child.title;
  }
}

/** The thread whose question waits in the dock. */
function questionThread(ctx: FakeContext, now: number): void {
  const thread = ctx.threads.get('t-scheduler');
  const pending = ctx.pendingQuestions.get('qst-seed-1');
  if (!thread || !pending) return;
  Object.assign(thread, { title: 'Retry failed syncs when the network drops', titleSource: 'user', branch: 'orbit/sync-retry', providerId: 'codex', accountId: 'a-codex', model: 'gpt-6.1-sol', effort: 'high' });
  const text = 'How should a failed sync retry?';
  const options = [
    { id: 'backoff', label: 'Exponential backoff', description: '1 s, 2 s, 4 s up to 30 s, five tries, then show the error' },
    { id: 'fixed', label: 'Fixed interval', description: 'every 10 s, three tries' },
    { id: 'manual', label: 'Ask the user', description: 'show a Retry button and never retry alone' },
  ];
  pending.request.text = text;
  pending.request.options = options;
  const [ask, answer] = thread.messages;
  if (ask) ask.parts = [{ type: 'text', text: 'Make sync retry when the network drops. Ask me before you pick a policy.' }];
  if (answer) answer.parts = [
    { type: 'text', text: 'Sync calls go through `src/lib/sync/queue.ts`. A failed push is dropped today, so nothing retries. Two places need the policy: the queue and the status chip in the header.' },
    tool(ctx, now - 4 * MINUTE, { name: 'Read', input: { file_path: 'src/lib/sync/queue.ts' }, output: 'export async function flush(queue: Change[]) {\n  for (const change of queue) await push(change);\n}' }),
    { type: 'question', questionId: pending.request.id, text, options, allowText: true, multiple: false, answer: null },
  ];
}

/** The second "needs you" thread: a file write waiting on approval. */
function permissionThread(ctx: FakeContext): void {
  const thread = ctx.threads.get('t-bench');
  const pending = ctx.pendingPermissions.get('req-seed-1');
  if (!thread || !pending) return;
  Object.assign(thread, { title: 'Benchmark the import on 50k rows', titleSource: 'user', providerId: 'claude', accountId: 'a-claude-main', model: 'claude-sonnet-5-5', effort: 'medium' });
  pending.request.input = { path: `${ORBIT}\\bench\\import.bench.ts`, contents: 'Import 50,000 generated rows and report rows per second.' };
  pending.request.description = 'Write the import benchmark inside the project';
  const [ask, answer] = thread.messages;
  if (ask) ask.parts = [{ type: 'text', text: 'Benchmark the import on 50k rows: time to preview, time to import, peak memory.' }];
  if (answer?.parts[0]?.type === 'text') answer.parts[0].text = 'Writing the benchmark script before generating the rows.';
}

// ---------------------------------------------------------------------------
// More threads, one of every state, spread over the projects
// ---------------------------------------------------------------------------

interface Spec {
  id: string; project: string; title: string; ago: number; prompt: string; answer: string;
  state?: 'idle' | 'done' | 'running' | 'error' | 'unread';
  agent?: number; branch?: string; pinned?: boolean; archived?: boolean;
  pr?: { number: number; state: 'OPEN' | 'CLOSED' | 'MERGED' }; steps?: Step[]; error?: string;
}

const REPOS: Record<string, string> = { 'p-boite': 'orbit', 'p-notes': 'field-notes', 'p-atlas': 'atlas-api', 'p-courier': 'courier-mobile', 'p-lumen': 'lumen-docs', 'p-garden': 'pixel-garden', 'p-sandbox': 'sandbox', 'p-render': 'render-farm' };

const SPECS: Spec[] = [
  // orbit
  { id: 't-sc-charts', project: 'p-boite', title: 'Try a canvas renderer for the charts', ago: 9 * DAY, archived: true, agent: 1, branch: 'orbit/canvas-charts', prompt: 'Try rendering the dashboard charts on a canvas instead of SVG.', answer: 'Canvas is 3x faster past 20k points but loses text selection and the screen reader labels. I would keep SVG and sample the data instead.' },
  { id: 't-sc-a11y', project: 'p-boite', title: 'Fix focus order in the filters panel', ago: 26 * HOUR, state: 'done', agent: 1, branch: 'orbit/filters-focus', pr: { number: 121, state: 'MERGED' }, prompt: 'Tab skips the date filter in the filters panel. Fix the focus order.', answer: 'The date picker was rendered in a portal before the panel. It now mounts inside the panel, and Tab follows the visual order.' },
  // field-notes
  { id: 't-sc-tags', project: 'p-notes', title: "Tag last week's entries", ago: 5 * HOUR, state: 'idle', agent: 3, prompt: "Tag last week's journal entries by theme.", answer: 'Tagged 23 entries: 9 onboarding, 7 pricing, 5 performance, 2 other. The tags are in `tags.yaml`.' },
  { id: 't-sc-export', project: 'p-notes', title: 'Export the journal to Markdown', ago: 50 * MINUTE, state: 'error', agent: 0, error: 'The agent exited with code 1: ModuleNotFoundError: No module named "markdownify"', prompt: 'Export the whole journal to one Markdown file per month.', answer: 'Running the export script.', steps: [{ name: 'Bash', input: { command: 'python scripts/export.py --format md', description: 'Export the journal' }, output: 'Traceback (most recent call last):\n  File "scripts/export.py", line 4, in <module>\n    from markdownify import markdownify\nModuleNotFoundError: No module named "markdownify"', status: 'error', exitCode: 1 }] },
  { id: 't-sc-isoweek', project: 'p-notes', title: 'Fix the ISO week parser', ago: 3 * DAY, state: 'idle', agent: 2, pinned: true, branch: 'notes/iso-week', pr: { number: 37, state: 'MERGED' }, prompt: 'Entries dated 2026-W01 land in the wrong year.', answer: 'Week 1 belongs to the year of its Thursday. The parser now follows ISO 8601, with tests for the 2020, 2026 and 2027 edges.' },
  { id: 't-sc-oldapp', project: 'p-notes', title: 'Import from the old notes app', ago: 14 * DAY, archived: true, agent: 1, prompt: 'Import the notes exported from the old app.', answer: 'Imported 412 notes; 6 attachments were missing from the export and are listed in `missing.txt`.' },
  // atlas-api
  { id: 't-sc-ratelimit', project: 'p-atlas', title: 'Add rate limiting to the public API', ago: 25 * MINUTE, state: 'running', agent: 2, branch: 'atlas/rate-limit', pr: { number: 412, state: 'OPEN' }, prompt: 'Add per-key rate limiting to the public API: 600 requests a minute, with headers.', answer: 'The token bucket is in. Running the load test against the staging config.', steps: [{ name: 'Bash', input: { command: 'go test ./internal/ratelimit/...', description: 'Run the limiter tests' }, output: 'ok  \tatlas/internal/ratelimit\t0.412s' }, { name: 'Bash', input: { command: 'k6 run load/public-api.js', description: 'Load test' }, output: null, status: 'running' }] },
  { id: 't-sc-paginate', project: 'p-atlas', title: 'Paginate the search endpoint', ago: 2 * DAY, state: 'idle', agent: 0, branch: 'atlas/search-cursor', pr: { number: 405, state: 'MERGED' }, prompt: 'Search returns every match at once. Add cursor pagination.', answer: 'Search now returns 50 results and a `next` cursor. Old clients that send no cursor get the first page.' },
  { id: 't-sc-502', project: 'p-atlas', title: 'Investigate the 502s on /v2/export', ago: 3 * HOUR, state: 'error', agent: 1, error: 'Usage limit reached for this account. It resets at 18:00.', prompt: 'Some /v2/export calls return 502 since this morning. Find out why.', answer: 'The 502s line up with exports over 30 s: the proxy closes the connection first.' },
  { id: 't-sc-openapi', project: 'p-atlas', title: 'Write the OpenAPI spec for v2', ago: 6 * HOUR, state: 'done', agent: 3, branch: 'atlas/openapi-v2', pr: { number: 409, state: 'OPEN' }, prompt: 'Write the OpenAPI 3.1 spec for every v2 route.', answer: 'The spec covers 34 routes. `make spec-check` compares it with the router on every build.' },
  { id: 't-sc-grpc', project: 'p-atlas', title: 'Spike: gRPC gateway', ago: 21 * DAY, archived: true, agent: 2, branch: 'atlas/grpc-spike', pr: { number: 377, state: 'CLOSED' }, prompt: 'Spike a gRPC gateway in front of the REST routes.', answer: 'It works, but doubles the deploy surface for a gain only two clients would use. Closing the spike.' },
  // courier-mobile
  { id: 't-sc-offline', project: 'p-courier', title: 'Offline queue for delivery scans', ago: 12 * MINUTE, state: 'running', agent: 0, branch: 'courier/offline-queue', prompt: 'Drivers lose scans in tunnels. Queue them offline and sync later.', answer: 'Scans now go to a local queue first. Writing the sync worker.', steps: [{ name: 'Edit', input: { file_path: 'lib/scan/queue.dart', old_string: 'await api.send(scan);', new_string: 'await queue.add(scan);\nunawaited(sync.flush());' }, output: 'The file lib/scan/queue.dart has been updated.' }] },
  { id: 't-sc-push', project: 'p-courier', title: 'Push notification opt-in screen', ago: 70 * MINUTE, state: 'unread', agent: 1, branch: 'courier/push-optin', pr: { number: 88, state: 'OPEN' }, prompt: 'Add a screen that explains notifications before the system prompt.', answer: 'The screen shows once after the first delivery, with Allow and Not now. Captures for both platforms are in the PR.' },
  { id: 't-sc-camera', project: 'p-courier', title: 'Crash when the camera opens on Android 15', ago: 4 * HOUR, state: 'error', agent: 2, error: 'Stopped: the device emulator did not answer for 120 s.', prompt: 'The app crashes on Android 15 when the scanner opens the camera.', answer: 'Reproducing on an Android 15 emulator.', steps: [{ name: 'Bash', input: { command: 'flutter run -d emulator-5554', description: 'Run on the emulator' }, output: 'Launching lib/main.dart on sdk gphone64 x86 64 in debug mode...\nError: the emulator did not answer', status: 'error', exitCode: 1 }] },
  // lumen-docs: only finished threads
  { id: 't-sc-guide', project: 'p-lumen', title: 'Rewrite the getting-started guide', ago: 2 * DAY, state: 'done', agent: 1, pr: { number: 64, state: 'MERGED' }, prompt: 'Rewrite the getting-started guide for the new CLI.', answer: 'The guide is down from 14 steps to 6, each with a copyable command.' },
  { id: 't-sc-links', project: 'p-lumen', title: 'Fix broken links in the API reference', ago: 3 * DAY, state: 'done', agent: 3, pr: { number: 62, state: 'MERGED' }, prompt: 'Find and fix the broken links in the API reference.', answer: 'Fixed 31 links; a link check now runs in CI.' },
  { id: 't-sc-webhooks', project: 'p-lumen', title: 'Add a page on webhooks', ago: 5 * DAY, state: 'done', agent: 0, pr: { number: 59, state: 'MERGED' }, prompt: 'Add a page explaining webhooks with a signed payload example.', answer: 'The page shows how to verify the signature in Go, Python and Node.' },
  { id: 't-sc-style', project: 'p-lumen', title: 'Draft the old style guide', ago: 30 * DAY, archived: true, agent: 1, prompt: 'Draft a style guide for the docs.', answer: 'Replaced by the shared writing guide.' },
  // pixel-garden: collapsed in the sidebar
  { id: 't-sc-growth', project: 'p-garden', title: 'Tune the plant growth curve', ago: 8 * HOUR, state: 'idle', agent: 3, branch: 'garden/growth-curve', prompt: 'Plants grow too fast after day 10. Tune the curve.', answer: 'Growth now follows a logistic curve that flattens after day 12. A full garden takes 18 in-game days instead of 11.' },
  { id: 't-sc-saves', project: 'p-garden', title: 'Add a save slot picker', ago: 30 * HOUR, state: 'idle', agent: 2, branch: 'garden/save-slots', pr: { number: 19, state: 'OPEN' }, prompt: 'Let the player pick one of three save slots.', answer: 'Three slots with a thumbnail and the in-game day. Saves from the old single slot move into slot 1.' },
  // sandbox: quiet
  { id: 't-sc-sandbox', project: 'p-sandbox', title: 'Try the new chart library', ago: 12 * DAY, state: 'idle', agent: 1, prompt: 'Try the new chart library on a sample dataset.', answer: 'It renders 100k points smoothly; the bundle grows by 48 kB.' },
];

function thread(ctx: FakeContext, now: number, spec: Spec): Thread {
  const at = now - spec.ago;
  const agent = AGENTS[spec.agent ?? 0]!;
  const repo = REPOS[spec.project] ?? 'project';
  const root = spec.project === 'p-render' ? '/srv/render-farm' : `${ROOT}\\${repo}`;
  const cwd = spec.branch && spec.project !== 'p-render' ? `${root}\\.boite\\worktrees\\${spec.branch.split('/').pop()}` : root;
  const running = spec.state === 'running';
  const failed = spec.state === 'error';
  const id = spec.id;
  const turnId = `turn-${id}`;
  const length = running ? 0 : 12;
  const thread: Thread = {
    id, projectId: spec.project, title: spec.title, titleSource: 'user', cwd, ...agent,
    permissionMode: 'default', archived: spec.archived === true, pinned: spec.pinned === true, branch: spec.branch ?? null,
    messagesBefore: null, commands: [], status: running ? 'running' : failed ? 'error' : 'idle' as ThreadStatus,
    unread: spec.state === 'unread', sessionId: `sess-${id}`, load: running ? { processes: 2, cpuPercent: 9, memoryBytes: 280 * 1024 * 1024 } : null,
    context: { tokens: 40_000 + (spec.ago % 90_000), window: 200_000, at }, createdAt: at - 20 * MINUTE, updatedAt: at, lastUserMessageAt: at - 20 * MINUTE,
    ...(running ? { runningSince: at - 5 * MINUTE, progress: { turnId, phase: 'tool' as const, detail: spec.steps?.at(-1)?.name === 'Bash' ? String((spec.steps.at(-1)!.input as { command: string }).command) : 'Writing', at, since: at } } : {}),
    ...(spec.state === 'done' ? { doneAt: at + MINUTE } : {}),
    ...(spec.archived ? { archivedAt: at + HOUR } : {}),
    ...(spec.pr ? { pullRequest: { ...spec.pr, url: `https://github.com/example/${repo}/pull/${spec.pr.number}` } } : {}),
    turns: [{ ...turn({ id } as Thread, turnId, at - 20 * MINUTE, length, running ? 'running' : failed ? 'error' : 'done'), error: failed ? spec.error ?? 'The turn failed' : null }],
    messages: [],
  };
  thread.messages.push(message(thread, turnId, 'user', at - 20 * MINUTE, [{ type: 'text', text: spec.prompt }]));
  const steps = (spec.steps ?? []).map((step, index) => tool(ctx, at - 15 * MINUTE + index * MINUTE, step));
  const parts: MessagePart[] = running || failed ? [{ type: 'text', text: spec.answer }, ...steps] : [...steps, { type: 'text', text: spec.answer }];
  if (failed) parts.push({ type: 'error', message: spec.error ?? 'The turn failed' });
  thread.messages.push(message(thread, turnId, 'assistant', at - 19 * MINUTE, parts, running ? 'streaming' : 'complete'));
  ctx.threads.set(id, thread);
  if (spec.branch && spec.project !== 'p-render') ctx.worktrees.push({ projectId: spec.project, path: cwd, branch: spec.branch, dirty: running, unmerged: spec.pr?.state !== 'MERGED', missing: false, branchMerged: spec.pr?.state === 'MERGED' });
  return thread;
}

function extraThreads(ctx: FakeContext, now: number): void {
  for (const spec of SPECS) thread(ctx, now, spec);
  ctx.usage.set('t-sc-ratelimit', { inputTokens: 64_000, outputTokens: 8_200, cacheReadTokens: 410_000, cacheWriteTokens: 12_000, costUsdEquivalent: 1.12 });
  ctx.todos = [
    { id: 'seed-todo-1', projectId: 'p-boite', text: 'Ship CSV import', status: 'claimed', threadId: 't-trace', createdAt: now - 2 * HOUR, updatedAt: now - 10 * MINUTE },
    { id: 'seed-todo-2', projectId: 'p-boite', text: 'Add an import history page', status: 'open', threadId: null, createdAt: now - 5 * HOUR, updatedAt: now - 5 * HOUR },
    { id: 'seed-todo-3', projectId: 'p-boite', text: 'Fix focus order in the filters panel', status: 'done', threadId: 't-sc-a11y', createdAt: now - 2 * DAY, updatedAt: now - 26 * HOUR },
    { id: 'seed-todo-4', projectId: 'p-notes', text: 'Sort last week into the journal', status: 'open', threadId: null, createdAt: now - DAY, updatedAt: now - DAY },
  ];
}

/** About thirty more threads over every project, mostly at rest, a few at work or failed, for `?dense=1`. */
const DENSE: [project: string, title: string, state: Spec['state']][] = [
  ['p-boite', 'Cache the dashboard queries', 'idle'], ['p-boite', 'Drop the legacy chart theme', 'idle'], ['p-boite', 'Lazy-load the report builder', 'running'],
  ['p-boite', 'Unify the date formats', 'idle'], ['p-boite', 'Audit the bundle size', 'done'], ['p-boite', 'Keyboard shortcuts for filters', 'idle'],
  ['p-notes', 'Merge duplicate tags', 'idle'], ['p-notes', 'Search inside attachments', 'running'], ['p-notes', 'Weekly digest email', 'idle'],
  ['p-notes', 'Encrypt the local backup', 'unread'], ['p-notes', 'Spellcheck the French entries', 'idle'],
  ['p-atlas', 'Rotate the signing keys', 'idle'], ['p-atlas', 'Trace slow queries', 'running'], ['p-atlas', 'Retry webhooks with backoff', 'idle'],
  ['p-atlas', 'Health check for the worker pool', 'error'], ['p-atlas', 'Split the billing service', 'idle'], ['p-atlas', 'Deprecate v1 tokens', 'done'],
  ['p-courier', 'Dark mode for the driver app', 'idle'], ['p-courier', 'Route preview on the map', 'running'], ['p-courier', 'Signature capture at delivery', 'idle'],
  ['p-courier', 'Reduce cold start time', 'idle'], ['p-courier', 'Localize the app in Portuguese', 'unread'],
  ['p-lumen', 'Versioned docs sidebar', 'done'], ['p-lumen', 'Search with typo tolerance', 'idle'], ['p-lumen', 'Changelog page from releases', 'idle'],
  ['p-garden', 'Seasons and weather', 'idle'], ['p-garden', 'Pixel shader for water', 'running'], ['p-garden', 'Save cloud sync', 'idle'],
  ['p-sandbox', 'Benchmark three JSON parsers', 'idle'], ['p-sandbox', 'Try the new test runner', 'idle'], ['p-sandbox', 'Sketch a plugin API', 'idle'],
];

function denseThreads(ctx: FakeContext, now: number): void {
  DENSE.forEach(([project, title, state], index) => {
    const ago = state === 'running' ? (8 + index) * MINUTE : (2 + index * 3) * HOUR;
    thread(ctx, now, { id: `t-dense-${index}`, project, title, ago, state, agent: index % AGENTS.length, prompt: title, answer: state === 'error' ? 'Stopped.' : 'Done.', ...(state === 'error' ? { error: 'The agent exited with code 1.' } : {}) });
  });
}

// ---------------------------------------------------------------------------
// `?calm=1`: a believable workspace, where the default seed is a stress load
// ---------------------------------------------------------------------------

/** The projects a calm workspace keeps on this machine. */
const CALM_PROJECTS = new Set(['p-boite', 'p-atlas', 'p-courier']);
/** The rows those projects keep in view, with their children; every other row of theirs is archived. */
const CALM_ROWS = new Set([
  't-trace', 't-scheduler', 't-debate', 't-board-dark', 't-sc-a11y',
  't-sc-ratelimit', 't-sc-paginate', 't-sc-openapi',
  't-sc-offline', 't-sc-push', 't-sc-camera',
]);
/** The one desk thread of Nova left in view: the agents demo numbers its ids, so it is found by title. */
const CALM_DESK = 'Fix login redirect loop';
/** The two asks left: the flagship's push and the sync policy question. Every other ask is answered. */
const CALM_ASKS = new Set(['req-showcase-push', 'qst-seed-1']);
/** What may still run: the flagship with the children it started, and one more row at work. */
const CALM_RUNNING = new Set(['t-trace', 't-scheduler', 't-sc-ratelimit']);

function calm(ctx: FakeContext, now: number): void {
  // Other projects leave with everything that names them or one of their threads.
  const dropped = new Set(ctx.projects.filter(p => !CALM_PROJECTS.has(p.id)).map(p => p.id));
  const gone = new Set([...ctx.threads.values()].filter(t => t.projectId !== null && dropped.has(t.projectId)).map(t => t.id));
  ctx.projects = ctx.projects.filter(p => !dropped.has(p.id));
  // Only ids of this machine's dropped projects: a contact's or another machine's project keeps its rows.
  const dangles = (entry: unknown): boolean => {
    if (entry === null || typeof entry !== 'object') return false;
    const { projectId, threadId } = entry as { projectId?: unknown; threadId?: unknown };
    return (typeof projectId === 'string' && dropped.has(projectId)) || (typeof threadId === 'string' && gone.has(threadId));
  };
  // Every list and map of the fake core (todos, worktrees, processes, usage, logos), in place: other modules hold the same references.
  for (const value of Object.values(ctx as unknown as Record<string, unknown>)) {
    if (Array.isArray(value)) { const kept = value.filter(entry => !dangles(entry)); value.splice(0, value.length, ...kept); }
    else if (value instanceof Map) for (const id of [...gone, ...dropped]) value.delete(id);
  }
  ctx.scheduler = { ...ctx.scheduler, running: ctx.scheduler.running.filter(e => !dangles(e)), queued: ctx.scheduler.queued.filter(e => !dangles(e)) };

  // The asks other than the two kept ones read as answered, as if the user had seen them earlier.
  const settle = (threadId: string, match: (part: MessagePart) => boolean, answer: (part: MessagePart) => void) => {
    for (const message of ctx.threads.get(threadId)?.messages ?? []) for (const part of message.parts) if (match(part)) answer(part);
  };
  for (const [id, pending] of [...ctx.pendingPermissions]) {
    if (CALM_ASKS.has(id)) continue;
    ctx.pendingPermissions.delete(id);
    settle(pending.request.threadId, part => part.type === 'permission' && part.requestId === id, part => { if (part.type === 'permission') part.decision = 'allow'; });
  }
  for (const [id, pending] of [...ctx.pendingQuestions]) {
    if (CALM_ASKS.has(id)) continue;
    ctx.pendingQuestions.delete(id);
    const first = pending.request.options[0]?.id;
    settle(pending.request.threadId, part => part.type === 'question' && part.questionId === id, part => { if (part.type === 'question') part.answer = first ? { optionIds: [first] } : { optionIds: [], text: 'Done.' }; });
  }

  const root = (thread: Thread): Thread => {
    let top = thread;
    for (let depth = 0; top.parentThreadId && depth < 8; depth++) top = ctx.threads.get(top.parentThreadId) ?? top;
    return top;
  };
  const rested = new Set<string>();
  for (const thread of ctx.threads.values()) {
    thread.openQuestions = [...ctx.pendingQuestions.values()].filter(q => q.request.threadId === thread.id && q.request.async === true).length;
    if (thread.subagentQuestions?.length) thread.subagentQuestions = [];
    // Bots keep their own state: the Bots page shows one at work.
    if (thread.projectId === null) continue;
    const top = root(thread);
    const shown = CALM_ROWS.has(top.id) || (top.id.startsWith('t-agents-desk-') && top.title === CALM_DESK);
    if (!shown && !thread.archived) Object.assign(thread, { archived: true, archivedAt: Math.min(now, thread.updatedAt + HOUR) });
    if ((thread.status === 'running' || thread.status === 'waiting') && !CALM_RUNNING.has(top.id)) { rest(thread); rested.add(thread.id); }
  }
  for (const record of ctx.processes) if (rested.has(record.threadId) && record.exitedAt === null) Object.assign(record, { exitedAt: now, exitCode: 0 });
  ctx.scheduler = { ...ctx.scheduler, running: ctx.scheduler.running.filter(e => !rested.has(e.threadId)), queued: ctx.scheduler.queued.filter(e => !rested.has(e.threadId)) };
}

/** A thread at work or waiting, brought to rest: its turn finished, its tools and messages complete. */
function rest(thread: Thread): void {
  Object.assign(thread, { status: 'idle', runningSince: null, requestSince: null, progress: null, load: null });
  for (const turn of thread.turns) {
    if (turn.status !== 'running' && turn.status !== 'queued') continue;
    turn.status = 'done';
    turn.startedAt ??= turn.queuedAt;
    turn.finishedAt = (turn.startedAt ?? turn.queuedAt) + 12 * MINUTE;
  }
  for (const message of thread.messages) {
    if (message.state === 'streaming') message.state = 'complete';
    for (const part of message.parts) if (part.type === 'tool' && part.status === 'running') Object.assign(part, { status: 'done', finishedAt: (part.startedAt ?? 0) + 4_000 });
  }
}

// ---------------------------------------------------------------------------
// The second machine of the group
// ---------------------------------------------------------------------------

function seedBuilder(ctx: FakeContext): void {
  const now = Date.now();
  ctx.projects = [{ id: 'p-render', name: 'render-farm', path: '/srv/render-farm', createdAt: now - 50 * DAY, repository: true, icon: { kind: 'tech', id: 'cpp' } }];
  ctx.projectImages.clear();
  ctx.threads.clear();
  ctx.pendingPermissions.clear();
  ctx.pendingQuestions.clear();
  ctx.processes = []; ctx.todos = []; ctx.worktrees = []; ctx.importable = []; ctx.usage.clear();
  ctx.scheduler = { ...ctx.scheduler, running: [], queued: [] };
  const specs: Spec[] = [
    { id: 't-rf-trailer', project: 'p-render', title: 'Render the launch trailer frames', ago: 8 * MINUTE, state: 'running', agent: 1, prompt: 'Render frames 1 to 2400 of the trailer at 1440p.', answer: 'Frames 1 to 1312 are done. About 40 minutes left.', steps: [{ name: 'Bash', input: { command: 'render --scene trailer --frames 1-2400 --out /data/trailer', description: 'Render the trailer' }, output: null, status: 'running' }] },
    { id: 't-rf-cache', project: 'p-render', title: 'Clean the shader cache volume', ago: 5 * HOUR, state: 'done', agent: 2, prompt: 'The cache volume is at 91%. Clean what is safe to remove.', answer: 'Removed 212 GB of shader caches older than 30 days. The volume is at 54%.' },
    { id: 't-rf-driver', project: 'p-render', title: 'Write the GPU driver upgrade notes', ago: 2 * DAY, state: 'idle', agent: 0, prompt: 'Write down how to upgrade the GPU driver without losing the render queue.', answer: 'The notes are in `docs/driver-upgrade.md`: drain, snapshot, upgrade, verify with the test scene.' },
  ];
  for (const spec of specs) thread(ctx, now, spec);
}

/** The third machine, mounted by `&machines=2` for the density checks of a group of three: one project, a run at work, one done, one at rest. */
function seedLab(ctx: FakeContext): void {
  const now = Date.now();
  ctx.projects = [{ id: 'p-lab', name: 'device-lab', path: '/srv/device-lab', createdAt: now - 30 * DAY, repository: true, icon: { kind: 'tech', id: 'python' } }];
  ctx.projectImages.clear();
  ctx.threads.clear();
  ctx.pendingPermissions.clear();
  ctx.pendingQuestions.clear();
  ctx.processes = []; ctx.todos = []; ctx.worktrees = []; ctx.importable = []; ctx.usage.clear();
  ctx.scheduler = { ...ctx.scheduler, running: [], queued: [] };
  const specs: Spec[] = [
    { id: 't-lab-matrix', project: 'p-lab', title: 'Run the test matrix on the Pixel and iPad', ago: 14 * MINUTE, state: 'running', agent: 0, prompt: 'Run the app test matrix on every phone and tablet on the rack.', answer: 'Pixel 8 and Pixel 6a pass. The iPad run is on test 41 of 88.', steps: [{ name: 'Bash', input: { command: 'lab run --matrix all', description: 'Run the matrix' }, output: null, status: 'running' }] },
    { id: 't-lab-flaky', project: 'p-lab', title: 'Find why the camera test flakes', ago: 3 * HOUR, state: 'done', agent: 1, prompt: 'The camera permission test fails one run in five. Find out why.', answer: 'The test taps before the permission sheet finishes its animation. It now waits for the sheet; 50 runs pass.' },
    { id: 't-lab-usb', project: 'p-lab', title: 'Label the USB hubs on the rack', ago: 3 * DAY, state: 'idle', agent: 2, prompt: 'Write which hub port each device uses.', answer: 'The map is in `docs/rack.md`.' },
  ];
  for (const spec of specs) thread(ctx, now, spec);
}

// ---------------------------------------------------------------------------
// The Changes panel
// ---------------------------------------------------------------------------

function changes(ctx: FakeContext): void {
  FAKE_CHANGES.splice(0, FAKE_CHANGES.length,
    { path: 'src/lib/csv/parse.ts', status: 'added', oldPath: null, staged: false, additions: 64, deletions: 0 },
    { path: 'src/lib/csv/validate.ts', status: 'added', oldPath: null, staged: false, additions: 41, deletions: 0 },
    { path: 'src/lib/api/contacts.ts', status: 'modified', oldPath: null, staged: false, additions: 8, deletions: 0 },
    { path: 'src/routes/contacts/+page.svelte', status: 'modified', oldPath: null, staged: false, additions: 1, deletions: 0 },
    { path: 'src/routes/contacts/import/+page.svelte', status: 'added', oldPath: null, staged: false, additions: 96, deletions: 0 },
    { path: 'src/lib/upload.ts', status: 'modified', oldPath: null, staged: true, additions: 4, deletions: 3 },
  );
  const parse = 'export interface ReaderState { open: boolean; line: number }\n\nexport class CsvError extends Error {\n  constructor(readonly line: number, readonly column: number, reason: string) {\n    super(`${reason} at ${line}:${column}`);\n  }\n}\n\nexport function parseLine(line: string, state: ReaderState): string[] {\n  const cells: string[] = [];\n  let cell = \'\', quoted = false;\n  for (let i = 0; i < line.length; i++) {\n    const char = line[i];\n    if (quoted && char === \'"\' && line[i + 1] === \'"\') { cell += \'"\'; i++; }\n    else if (char === \'"\' && (cell === \'\' || quoted)) quoted = !quoted;\n    else if (char === \'"\') throw new CsvError(state.line, i + 1, \'stray quote\');\n    else if (char === \',\' && !quoted) { cells.push(cell); cell = \'\'; }\n    else cell += char;\n  }\n  if (quoted) state.open = true;\n  return [...cells, cell];\n}\n';
  const validate = 'const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/;\n\nexport interface RowProblem { row: number; field: string; reason: string }\n\nexport function validate(rows: Record<string, string>[]): RowProblem[] {\n  const problems: RowProblem[] = [];\n  rows.forEach((row, index) => {\n    if (!EMAIL.test(row.email ?? \'\')) problems.push({ row: index + 2, field: \'email\', reason: \'not an email address\' });\n    if (row.plan && ![\'Free\', \'Team\', \'Pro\'].includes(row.plan)) problems.push({ row: index + 2, field: \'plan\', reason: `unknown plan ${row.plan}` });\n  });\n  return problems;\n}\n';
  const apiBefore = 'import { get, post, withRetry } from "./http";\n\nexport const contacts = {\n  list: (query: string) => get(`/contacts?${query}`),\n  bulk: (rows: ContactInput[]) => withRetry(() => post("/contacts/bulk", rows)),\n};\n';
  const apiAfter = apiBefore.replace('rows)),\n', 'rows)),\n  /** Sends rows in batches of 500 and reports progress after each one. */\n  importAll: async (rows: ContactInput[], progress: (done: number) => void) => {\n    for (let i = 0; i < rows.length; i += 500) {\n      await contacts.bulk(rows.slice(i, i + 500));\n      progress(Math.min(i + 500, rows.length));\n    }\n  },\n');
  const pageBefore = '<script lang="ts">\n  import { Toolbar, Button } from "$lib/ui";\n  let { data } = $props();\n</script>\n\n<Toolbar>\n  <Button href="/contacts/export">Export</Button>\n</Toolbar>\n\n<ContactsTable rows={data.contacts} />\n';
  const pageAfter = pageBefore.replace('  <Button href="/contacts/export">', '  <Button href="/contacts/import" icon="upload">Import</Button>\n  <Button href="/contacts/export">');
  const importPage = '<script lang="ts">\n  import { parseFile } from "$lib/csv/parse";\n  import { validate } from "$lib/csv/validate";\n  import { contacts } from "$lib/api/contacts";\n\n  let rows = $state<Record<string, string>[]>([]);\n  let problems = $derived(validate(rows));\n  let done = $state(0);\n\n  async function pick(file: File) {\n    rows = await parseFile(file, { preview: 200 });\n  }\n</script>\n\n<h1>Import contacts</h1>\n<DropZone accept=".csv" onfile={pick} />\n{#if rows.length}\n  <PreviewTable {rows} />\n  {#if problems.length}<p class="warn">{problems.length} rows will be skipped</p>{/if}\n  <Button onclick={() => contacts.importAll(rows, (n) => (done = n))}>Import {rows.length} rows</Button>\n  <Progress value={done} max={rows.length} />\n{/if}\n';
  const uploadBefore = 'export async function upload(file: File) {\n  const body = new FormData();\n  body.append("file", file);\n  return fetch("/upload", { method: "POST", body });\n}\n';
  const uploadAfter = 'export async function upload(file: File, signal?: AbortSignal) {\n  const body = new FormData();\n  body.append("file", file, file.name);\n  return fetch("/upload", { method: "POST", body, signal });\n}\n';
  const diff = (oldText: string, newText: string) => ({ oldText, newText, binary: false, truncated: false });
  for (const key of Object.keys(FAKE_DIFFS)) delete FAKE_DIFFS[key];
  FAKE_DIFFS['src/lib/csv/parse.ts'] = diff('', parse);
  FAKE_DIFFS['src/lib/csv/validate.ts'] = diff('', validate);
  FAKE_DIFFS['src/lib/api/contacts.ts'] = diff(apiBefore, apiAfter);
  FAKE_DIFFS['src/routes/contacts/+page.svelte'] = diff(pageBefore, pageAfter);
  FAKE_DIFFS['src/routes/contacts/import/+page.svelte'] = diff('', importPage);
  FAKE_DIFFS['src/lib/upload.ts'] = diff(uploadBefore, uploadAfter);
  // The same files in the tree, so the Files panel and the editor open them.
  for (const [path, text] of Object.entries(FAKE_DIFFS)) ctx.files.set(path, text.newText ?? '');
}
