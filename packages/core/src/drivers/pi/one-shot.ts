import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOL_FREE_CONTEXT } from '@boite/contracts';
import { abortable } from '../../abortable.ts';
import { unavailable } from '../../errors.ts';
import { profileFor, resolveLaunch } from '../../providers/resolve.ts';
import { titleRequest } from '../../titles.ts';
import { NativeForkUnsupported } from '../native-fork.ts';
import { releaseChild } from '../session-close.ts';
import type { SideQuestionContext, TitleContext } from '../types.ts';
import { agentEnv, contextArgs, imagesOf, sessionDirOf, textOf } from './mapping.ts';
import { AGENT_OWN_MODEL, STDERR_MAX } from './protocol.ts';
import { PiPeer } from './rpc.ts';
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

async function ask(ctx: TitleContext | SideQuestionContext, prompt: string, model: string | null, signal: AbortSignal, sessionFile?: string): Promise<string> {
  signal.throwIfAborted();
  const profile = profileFor(ctx.provider);
  const launch = resolveLaunch(profile);
  if (!launch) throw unavailable(`no ${ctx.provider.id} executable on this machine`, { providerId: ctx.provider.id });
  const declared = profile?.launch?.args ?? [];
  const args = [...launch.prefix];
  const own = model !== null && model !== AGENT_OWN_MODEL;
  for (let i = 0; i < declared.length; i++) {
    const arg = declared[i]!;
    // Left to pi, the model is the profile's, as in the conversation: its `--api-key` needs it.
    if (!own && (arg === '--model' || arg === '--provider') && i + 1 < declared.length) args.push(arg, declared[++i]!);
    else if (VALUE_FLAGS.has(arg)) i++;
    else if (!OWNED_SWITCHES.has(arg)) args.push(arg);
  }
  const context = contextArgs(TOOL_FREE_CONTEXT);
  args.push('--mode', 'rpc', ...(sessionFile ? context.flatMap(arg => arg === '--no-tools' ? ['--tools', READ_ONLY_TOOLS] : [arg]) : context), '--no-mcp');
  args.push(...(sessionFile ? ['--session', sessionFile] : ['--no-session']));
  if (own) args.push('--model', model);
  const effort = 'signal' in ctx ? ctx.thread.effort : 'low';
  if (effort !== null) args.push('--thinking', effort);

  const child = ctx.spawnChild(launch.executable, args, { cwd: ctx.thread.cwd, env: agentEnv(ctx.accountEnv) });
  let stderr = '', text = '', error = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_MAX); });
  const done = Promise.withResolvers<string | null>();
  const fault = (reason: string) => done.resolve(stderr.trim() || reason);
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
    await peer.command('prompt', { message: prompt, ...(images.length ? { images } : {}) }, { signal });
    const failure = await abortable(done.promise, signal);
    if (failure) throw new Error(failure);
    return text.trim();
  } finally {
    peer.fail('the pi one-shot request is over');
    releaseChild(child);
  }
}

export async function title(ctx: TitleContext): Promise<string | null> {
  const model = ctx.model ?? ctx.thread.model;
  return await ask(ctx, titleRequest(ctx.prompt, ctx.answer, ctx.initial, ctx.nameBranch), model, AbortSignal.timeout(30_000)) || null;
}

export async function sideQuestion(ctx: SideQuestionContext): Promise<string> {
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
    const answer = await ask(ctx, prompt, ctx.thread.model, ctx.signal, sessionFile);
    if (!answer) throw new Error('pi wrote no side answer');
    return answer;
  } finally {
    // A copy left behind in the temp folder must not cost the answer.
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
