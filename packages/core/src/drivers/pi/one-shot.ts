import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOL_FREE_CONTEXT } from '@boite/contracts';
import type { ModelInfo } from '@boite/contracts';
import { abortable } from '../../abortable.ts';
import { unavailable } from '../../errors.ts';
import { profileFor, resolveLaunch } from '../../providers/resolve.ts';
import { titleRequest } from '../../titles.ts';
import { NativeForkUnsupported } from '../native-fork.ts';
import { releaseChild } from '../session-close.ts';
import type { SideQuestionContext, TitleContext } from '../types.ts';
import { agentEnv, contextArgs, imagesOf, sessionDirOf, textOf } from './mapping.ts';
import { alignLaunchedPair, LaunchPairMissing, launchLevel } from './launch-pair.ts';
import { piCatalogPair, piModelArgs, piProfilePins, piProviderOf } from './models.ts';
import { AGENT_OWN_MODEL, STDERR_MAX } from './protocol.ts';
import { dataOf, PiPeer } from './rpc.ts';
import { copySession } from './session-files.ts';

// Explicit resources still load with discovery disabled. Keep launcher arguments
// (such as a script path), and own the one-shot model, session, tools and resources.
const VALUE_FLAGS = new Set([
  '--extension', '-e', '--skill', '--prompt-template', '--mode', '--model', '--provider',
  '--session', '--session-id', '--session-dir', '--fork', '--thinking',
  '--system-prompt', '--append-system-prompt', '--tools', '-t', '--exclude-tools', '-xt',
]);
const OWNED_SWITCHES = new Set([
  '--no-session', '--continue', '-c', '--resume', '-r', '--print', '-p', '--no-tools', '-nt', '--no-builtin-tools', '-nbt',
]);
/**
 * A side question on a session copy keeps pi's read-only tools: its history
 * holds tool calls, and Anthropic's Messages API refuses `tool_use` blocks in a
 * request that defines no tools, which `--no-tools` would send (pi 1.6.1).
 */
const READ_ONLY_TOOLS = 'read,grep,find,ls';

async function ask(ctx: TitleContext | SideQuestionContext, prompt: string, model: string | null, catalog: readonly ModelInfo[] | null, signal: AbortSignal, sessionFile?: string): Promise<string> {
  signal.throwIfAborted();
  const profile = profileFor(ctx.provider);
  const launch = resolveLaunch(profile);
  if (!launch) throw unavailable(`no ${ctx.provider.id} executable on this machine`, { providerId: ctx.provider.id });
  const own = model !== null && model !== AGENT_OWN_MODEL;
  const declared = profile?.launch?.args ?? [];
  const args = [...launch.prefix];
  for (let i = 0; i < declared.length; i++) {
    const arg = declared[i]!;
    // Left to pi, the model is the profile's, as in the conversation.
    if (!own && (arg === '--model' || arg === '--provider') && i + 1 < declared.length) args.push(arg, declared[++i]!);
    else if (VALUE_FLAGS.has(arg)) i++;
    else if (!OWNED_SWITCHES.has(arg)) args.push(arg);
  }
  const context = contextArgs(TOOL_FREE_CONTEXT);
  args.push('--mode', 'rpc', ...(sessionFile ? context.flatMap(arg => arg === '--no-tools' ? ['--tools', READ_ONLY_TOOLS] : [arg]) : context), '--no-mcp');
  args.push(...(sessionFile ? ['--session', sessionFile] : ['--no-session']));
  const effort = 'signal' in ctx ? ctx.thread.effort : 'low';
  args.push(...(own ? piModelArgs(model, effort, catalog) : effort === null ? [] : ['--thinking', effort]));

  const child = ctx.spawnChild(launch.executable, args, { cwd: ctx.thread.cwd, env: agentEnv(ctx.accountEnv) });
  let stderr = '', text = '', error = '', broken = false;
  const closed = Promise.withResolvers<void>();
  child.once('close', () => closed.resolve());
  child.once('error', () => closed.resolve());
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_MAX); });
  const done = Promise.withResolvers<string | null>();
  const fault = (reason: string) => { broken = true; done.resolve(stderr.trim() || reason); };
  child.once('error', error => fault(error.message));
  const peer = new PiPeer(child, {
    log: ctx.log,
    fault,
    event(message) {
      switch (message['type']) {
        case 'message_end': {
          const result = message['message'] as { role?: string; stopReason?: string; errorMessage?: unknown; content?: { type?: string; text?: unknown }[] } | undefined;
          if (result?.role !== 'assistant') break;
          error = result.stopReason === 'error' ? textOf(result.errorMessage) || 'pi inference failed' : '';
          text = result.content?.filter(part => part.type === 'text').map(part => textOf(part.text)).join('\n') ?? '';
          break;
        }
        case 'agent_settled': done.resolve(error || null); break;
      }
    },
  });
  try {
    const images = 'attachments' in ctx ? imagesOf(ctx.attachments ?? []) : [];
    try {
      // As a conversation's start: pi may have matched another case of the id, and the prompt goes to the catalog's
      // pair. One pi does not list without extensions goes to pi's own model, as one it refuses at startup.
      const pair = own ? piCatalogPair(model, catalog) : undefined;
      if (pair !== undefined) {
        await alignLaunchedPair(peer, dataOf(await peer.command('get_state', {}, { signal })), pair, launchLevel(args), { signal })
          .catch((missing: unknown) => { throw missing instanceof LaunchPairMissing ? new ModelRefused(missing.message, true) : missing; });
      }
      await peer.command('prompt', { message: prompt, ...(images.length ? { images } : {}) }, { signal });
    } catch (failure) {
      // pi refuses a model it does not hold on stderr and exits before it reads a request: say why, once it has. A
      // prompt a live pi refused says why itself.
      if (signal.aborted || !broken) throw failure;
      let timer: Timer | undefined;
      await Promise.race([closed.promise, abortable(new Promise(resolve => { timer = setTimeout(resolve, 1_000); }), signal)]).catch(() => undefined);
      clearTimeout(timer);
      signal.throwIfAborted();
      const said = stderr.trim();
      if (STARTUP_REFUSAL.test(said)) throw new ModelRefused(said);
      throw said ? new Error(said) : failure;
    }
    const failure = await abortable(done.promise, signal);
    if (failure) throw new Error(failure);
    return text.trim();
  } finally {
    peer.fail('the pi one-shot request is over');
    releaseChild(child);
  }
}

/**
 * pi 1.6.1's words when it exits at startup on a `--provider` or `--model` it does not hold (`model-resolver.js`),
 * not its warning for a custom model id, after which it runs.
 */
const STARTUP_REFUSAL = /Unknown provider "[^"]*"\. Use --list-models|Model "[^"]*" not found\. Use --list-models/;

/**
 * pi exited before the prompt on the model it was launched with, or started without listing it (`unlisted`): then its
 * provider is one pi holds, and pi's own model may be another of it.
 */
class ModelRefused extends Error {
  constructor(message: string, readonly unlisted = false) { super(message); }
}

/**
 * A one-shot runs without extensions, so a provider one of them registers is unknown there: the request goes to pi's
 * own model instead, with the same restrictions, unless the profile's own `--model` or `--provider` started pi on that
 * provider (`piProfilePins`), where its own model is refused alike. A pair pi started without listing falls back even
 * then: pi holds its provider, and pi's own model may be another one of it.
 */
async function askOn(ctx: TitleContext | SideQuestionContext, prompt: string, model: string | null, catalog: readonly ModelInfo[] | null, signal: AbortSignal, sessionFile?: string): Promise<string> {
  try {
    return await ask(ctx, prompt, model, catalog, signal, sessionFile);
  } catch (error) {
    if (!(error instanceof ModelRefused) || model === null || model === AGENT_OWN_MODEL || signal.aborted) throw error;
    if (!error.unlisted && (piProviderOf(model, catalog) === '' || piProfilePins(profileFor(ctx.provider)?.launch?.args ?? [], model, catalog))) throw error;
    ctx.log('info', `pi one-shot: ${model} is not known without extensions, pi's own model answers`);
    return await ask(ctx, prompt, null, catalog, signal, sessionFile);
  }
}

export async function title(ctx: TitleContext, catalog: readonly ModelInfo[] | null = null): Promise<string | null> {
  const model = ctx.model ?? ctx.thread.model;
  return await askOn(ctx, titleRequest(ctx.prompt, ctx.answer, ctx.initial, ctx.nameBranch), model, catalog, AbortSignal.timeout(30_000)) || null;
}

export async function sideQuestion(ctx: SideQuestionContext, catalog: readonly ModelInfo[] | null = null): Promise<string> {
  let directory: string | undefined;
  try {
    let sessionFile: string | undefined;
    if (ctx.checkpoint) {
      directory = await mkdtemp(join(tmpdir(), 'boite-pi-side-'));
      try {
        sessionFile = (await copySession(sessionDirOf(ctx), ctx.checkpoint, directory, ctx.thread.cwd)).path;
      } catch (error) {
        if (!(error instanceof NativeForkUnsupported)) throw error;
      }
    }
    const prompt = sessionFile === undefined ? ctx.prompt : [
      'Answer this side question briefly in the user\'s language using the conversation above as context.',
      'Do not change anything, resume the main task or ask follow-up questions. Say when the context does not contain the answer.',
      '<side-question>', ctx.question, '</side-question>',
    ].join('\n');
    const answer = await askOn(ctx, prompt, ctx.thread.model, catalog, ctx.signal, sessionFile);
    if (!answer) throw new Error('pi wrote no side answer');
    return answer;
  } finally {
    // A copy left behind in the temp folder must not cost the answer.
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
