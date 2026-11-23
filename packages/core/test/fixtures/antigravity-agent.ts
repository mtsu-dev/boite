/**
 * A fake of Antigravity's ACP server, cut to the half Boite's login drives: it
 * offers one `oauth-personal` auth method, prints its sign-in link on stdout as
 * a line that is not JSON (the real server does exactly that, which is why the
 * driver filters the stream), then waits on a loopback listener until something
 * fetches the redirect URL before `authenticate` answers.
 *
 * Run as `bun <this file>`. `AGY_FAKE_LOG` names a file it appends to:
 * `initialize`, `client:<name>` for the client it was told it serves, `env <NAME>=<value>` for the variables the account is supposed
 * to carry, `callback:<url>` with the redirect URL a test is meant to paste,
 * `fetched:<path>` when that URL is hit, `authenticated`, `new:<cwd>` then
 * `meta:<json>` for each session it opens with its model list, `set:<id>=<value>`
 * for each config change, and `prompt:<sessionId>` for a
 * prompt, answered with one word, then `block:<type>` for each block after
 * its text. The session token lands under `GEMINI_HOME`, which is how the
 * account is rechecked.
 *
 * A prompt that names a scenario plays it: `scenario:subagents` launches a
 * batch with `start_subagent`, fails a second launch, runs an MCP tool of
 * the same title and launches a third batch with 1.4.1's `invoke_subagent`; `scenario:command` answers while a shell command it started
 * still runs, and `scenario:short-command` finishes that command a moment
 * after its answer.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { agent, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk/unstable';

/** The variables a test asserts on: the isolation, the harness, the browser suppression and where it unpacks. */
const WATCHED = ['GEMINI_HOME', 'AGY_LLM_GATEWAY_URL', 'AGY_ACP_FORCE_FILE_STORAGE', 'ANTIGRAVITY_HARNESS_PATH', 'BROWSER', 'GEMINI_API_KEY', 'TEMP', 'TMP', 'TMPDIR', 'SSL_CERT_FILE'];

/**
 * The models 1.4.5 answers `session/new` with (2026-11-04): Gemini for any
 * client, Claude and GPT only for a client named `zed`. The `model` option
 * lists each family once; Gemini's thinking is a `thought_level` option, which
 * the other models do not have. The protocol's `models` list carries the
 * pre-1.4 ids, the level in the id, and the agent still takes them as a model.
 */
const GEMINI = { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' };
const ALLOWLISTED = [
  { value: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
  { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
];
/** A model only a gateway serves, so a test tells the gateway's list from the agent's own sign-in. */
const GATEWAY_ONLY = { value: 'gemini-4-neon', name: 'Gemini 4 Neon' };
const LEVELS = ['low', 'medium', 'high'];
let clientName = '';
const [catalogMode, loadMode] = (process.env['AGY_FAKE_CATALOG'] ?? '').split(':');
const BAKED = [
  { value: 'gemini-4-neon-low', name: 'Gemini 4 Neon (Low)' },
  ...(['base', 'last-variant'].includes(loadMode ?? '') ? [{ value: 'gemini-4-neon', name: 'Gemini 4 Neon Preview' }] : []),
  { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
  { value: 'gemini-4-neon-xhigh', name: 'Gemini 4 Neon', ...(loadMode === 'base' ? { _meta: { default: true } } : {}) },
  { value: 'gemini-4-neon-medium', name: 'Gemini 4 Neon (Medium)' },
  { value: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash (Low)' },
  { value: 'gemini-3.5-flash-extra-low', name: 'Gemini 3.5 Flash (Extra Low)' },
].filter(row => {
  if (loadMode === 'removed') return row.value !== 'gemini-4-neon-xhigh';
  if (loadMode === 'last-variant' || loadMode === 'only-variant') return !['gemini-4-neon-low', 'gemini-4-neon-medium'].includes(row.value);
  return true;
});

const families = (): { value: string; name: string }[] => [
  GEMINI,
  ...(clientName === 'zed' ? ALLOWLISTED : []),
  ...(catalogMode === 'family-history' || process.env['AGY_LLM_GATEWAY_URL'] ? [GATEWAY_ONLY] : []),
];

const neonLevels = ['low', 'xhigh'];

/** One session's model and level, as `configOptions` and as the `models` list. */
function controls(state: { model: string; level: string }): Record<string, unknown> {
  if (catalogMode === 'missing') return {};
  if (catalogMode === 'list') return { models: { currentModelId: state.model, availableModels: BAKED.map(row => ({ modelId: row.value, name: row.name })) } };
  if (catalogMode === 'option') return { configOptions: [{ type: 'select', id: 'model', category: 'model', name: 'Model', currentValue: state.model, options: BAKED }] };
  const configOptions: Record<string, unknown>[] = [
    { type: 'select', id: 'model', category: 'model', name: 'Model', currentValue: state.model, options: families() },
  ];
  const levels = state.model === GEMINI.value ? LEVELS : catalogMode === 'family-history' && state.model === GATEWAY_ONLY.value ? neonLevels : [];
  if (levels.length) {
    configOptions.push({
      type: 'select', id: 'thinking_level', category: 'thought_level', name: 'Thinking', currentValue: state.level,
      options: levels.map((level) => ({ value: level, name: level[0]!.toUpperCase() + level.slice(1) })),
    });
  }
  const legacy = ['high', 'medium', 'low'].map((level) => ({ modelId: `${GEMINI.value}-${level}`, name: `Gemini 3.8 Flash (${level})` }));
  const others = families().slice(1).flatMap(entry => catalogMode === 'family-history' && entry === GATEWAY_ONLY
    ? neonLevels.map(level => ({ modelId: `${entry.value}-${level}`, name: `${entry.name} (${level})` }))
    : [{ modelId: entry.value, name: entry.name }]);
  return { configOptions, models: { availableModels: [...legacy, ...others], currentModelId: `${GEMINI.value}-high` } };
}

const sessions = new Map<string, { model: string; level: string }>();
const sessionFile = (id: string) => join(process.env['GEMINI_HOME'] ?? '', 'antigravity-acp', `${id}.json`);

/** The scopes of the real sign-in link: the third is the one a cut link loses. */
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function log(line: string): void {
  const file = process.env['AGY_FAKE_LOG'];
  if (file === undefined || file.length === 0) return;
  appendFileSync(file, `${line}\n`, 'utf8');
}

/** The token the real server writes once Google came back, under its own home. */
function writeToken(): void {
  const home = process.env['GEMINI_HOME'];
  if (home === undefined || home.length === 0) return;
  const file = join(home, 'antigravity-acp', 'acp_token.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ access_token: 'fake', expiry: 0 }), 'utf8');
}

/**
 * The listener the sign-in comes back to. One hit is enough, whatever the path:
 * the point is that the core delivered the URL it was handed.
 */
function waitForCallback(): { url: string; hit: Promise<void>; stop(): void } {
  let resolve = (): void => undefined;
  const hit = new Promise<void>((done) => {
    resolve = done;
  });
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      log(`fetched:${new URL(request.url).pathname}`);
      resolve();
      return new Response('signed in');
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/oauth2callback?code=fake-code`,
    hit,
    stop: () => {
      server.stop(true);
    },
  };
}

const app = agent({ name: 'agy-fake' })
  .onRequest('initialize', ({ params }) => {
    log('initialize');
    clientName = params.clientInfo?.name ?? '';
    log(`client:${clientName}`);
    for (const name of WATCHED) log(`env ${name}=${process.env[name] ?? ''}`);
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      agentInfo: { name: 'agy-fake', version: '1.4.5' },
      authMethods: [{ id: 'oauth-personal', name: 'Sign in with Google', description: null }],
    };
  })
  .onRequest('authenticate', async ({ params }) => {
    log(`authenticate ${params.methodId}`);
    const callback = waitForCallback();
    log(`callback:${callback.url}`);
    // As long as the real one: three scopes, a state and a PKCE challenge put
    // it well past 400 characters.
    const link = `https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=${'1'.repeat(12)}-${'a'.repeat(32)}.apps.googleusercontent.com`
      + `&redirect_uri=${encodeURIComponent(callback.url)}`
      + `&scope=${encodeURIComponent(SCOPES.join(' '))}&state=fake-state&code_challenge=${'c'.repeat(43)}&code_challenge_method=S256&access_type=offline`;
    // The real server writes it to stderr first, then, not JSON, on stdout: the
    // line the driver keeps out of the protocol stream for the Accounts page.
    process.stderr.write(`Open the following link to authenticate the ACP server: ${link}\n`);
    await Bun.sleep(50);
    process.stdout.write(`Open the following link to authenticate the ACP server: ${link}\n`);
    await callback.hit;
    callback.stop();
    writeToken();
    log('authenticated');
    return {};
  })
  .onRequest('session/new', ({ params }) => {
    log(`new:${params.cwd}`);
    log(`meta:${JSON.stringify(params._meta ?? null)}`);
    const sessionId = `agy-fake-${crypto.randomUUID().slice(0, 8)}`;
    const state = { model: catalogMode && catalogMode !== 'family-history' ? BAKED[0]!.value : GEMINI.value, level: 'high' };
    sessions.set(sessionId, state);
    return { sessionId, ...controls(state) };
  })
  .onRequest('session/load', ({ params }) => {
    const state = JSON.parse(readFileSync(sessionFile(params.sessionId), 'utf8')) as { model: string; level: string };
    sessions.set(params.sessionId, state);
    log(`load:${state.model}`);
    return loadMode === 'no-controls' ? {} : controls(state);
  })
  .onRequest('session/set_config_option', ({ params }) => {
    const state = sessions.get(params.sessionId);
    const value = String(params.value);
    log(`set:${params.configId}=${value}`);
    if (state === undefined) throw new Error(`no session ${params.sessionId}`);
    const legacy = LEVELS.find((level) => value === `${GEMINI.value}-${level}`);
    if (catalogMode === 'option' && params.configId === 'model' && BAKED.some(row => row.value === value)) state.model = value;
    else if (params.configId === 'model' && legacy !== undefined) Object.assign(state, { model: GEMINI.value, level: legacy });
    else if (params.configId === 'model' && families().some((entry) => entry.value === value)) {
      state.model = value;
      if (catalogMode === 'family-history' && value === GATEWAY_ONLY.value) state.level = 'low';
    }
    else if (params.configId === 'thinking_level' && state.model === GEMINI.value && LEVELS.includes(value)) state.level = value;
    else if (params.configId === 'thinking_level' && catalogMode === 'family-history' && state.model === GATEWAY_ONLY.value && neonLevels.includes(value)) state.level = value;
    else throw new Error(`invalid ${params.configId} ${value}`);
    return { configOptions: controls(state)['configOptions'] as never };
  })
  .onRequest('session/set_model', (params: unknown) => params as { sessionId: string; modelId: string }, ({ params }) => {
    const state = sessions.get(params.sessionId);
    if (!state || catalogMode !== 'list' || !BAKED.some(row => row.value === params.modelId)) throw new Error('model unavailable');
    state.model = params.modelId;
    log(`listed-model:${params.modelId}`);
    return {};
  })
  .onRequest('session/prompt', async ({ params, client }) => {
    log(`prompt:${params.sessionId}`);
    const state = sessions.get(params.sessionId);
    if (state) writeFileSync(sessionFile(params.sessionId), JSON.stringify(state));
    const [first, ...rest] = params.prompt;
    for (const block of rest) log(`block:${block.type}${block.type === 'image' ? `:${block.mimeType}` : ''}`);
    const text = first?.type === 'text' ? first.text : '';
    if (text.includes('Attached files available on this machine')) log('prompt names a saved file');
    const update = (body: Record<string, unknown>): Promise<void> =>
      client.notify('session/update', { sessionId: params.sessionId, update: body as never });
    if (text.includes('scenario:subagents')) {
      // Captured from 1.1.1: the launch returns its description before any child finished.
      await update({ sessionUpdate: 'tool_call', toolCallId: `${params.sessionId}:2`, title: 'Running start_subagent', kind: 'other', status: 'in_progress', rawInput: {} });
      await update({ sessionUpdate: 'tool_call_update', toolCallId: `${params.sessionId}:2`, status: 'completed', rawOutput: 'Launch readers' });
      await update({ sessionUpdate: 'tool_call', toolCallId: `${params.sessionId}:3`, title: 'Running start_subagent', kind: 'other', status: 'failed', rawInput: {}, rawOutput: 'Subagent exceeded its limit.' });
      await update({ sessionUpdate: 'tool_call', toolCallId: `${params.sessionId}:4`, title: 'Running start_subagent', kind: 'other', status: 'completed', rawInput: {}, rawOutput: 'mcp', _meta: { is_mcp_tool_call: true } });
      // 1.4.1 renamed the tool `invoke_subagent`; it asks under `Run invoke_subagent?` and runs under the same title.
      await update({ sessionUpdate: 'tool_call', toolCallId: `${params.sessionId}:5`, title: 'Run invoke_subagent?', kind: 'other', status: 'pending', rawInput: {} });
      await update({ sessionUpdate: 'tool_call_update', toolCallId: `${params.sessionId}:5`, title: 'Running invoke_subagent', kind: 'other', status: 'in_progress', rawInput: {} });
      await update({ sessionUpdate: 'tool_call_update', toolCallId: `${params.sessionId}:5`, status: 'completed', rawOutput: 'Launch reviewers' });
    }
    if (text.includes('scenario:command') || text.includes('scenario:short-command')) {
      const id = `${params.sessionId}:cmd`;
      await update({ sessionUpdate: 'tool_call', toolCallId: id, title: 'Running command', kind: 'execute', status: 'in_progress', rawInput: { CommandLine: 'sleep 600' } });
      if (text.includes('scenario:short-command')) {
        setTimeout(() => {
          void update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { combinedOutput: 'done', exitCode: 0 } });
        }, 300);
      }
    }
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'pong' } });
    return { stopReason: 'end_turn' as const };
  });

app.connect(
  ndJsonStream(
    Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ),
);
