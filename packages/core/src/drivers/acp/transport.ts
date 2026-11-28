import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import { unavailable } from '../../errors.ts';
import type { SpawnedChild } from '../../procs.ts';
import type { McpRegistration } from '../../mcp/lazy.ts';
import { OPENCODE_V2, openCodeServerReachable, withOpenCodeCompactionBuffer, withOpenCodeMcp } from '../../providers/opencode.ts';
import { agentEnv, profileFor, resolveLaunch } from '../../providers/resolve.ts';
import { grokLaunchArgs } from '../grok.ts';
import { launchTemp } from '../launch-temp.ts';
import type { SessionContext } from '../types.ts';
import { OpenCodeConnection } from './opencode-connection.ts';
import { wantedCompactionBuffer, type CompactionCaches } from './opencode-compaction.ts';
import { protectedAcp } from './protected.ts';
import { acpClientInfo, acpSessionMeta, canDeleteSessions, CLIENT_NAME, isGrok, STDERR_MAX, type AcpDeps } from './protocol.ts';
import { jsonLinesOnly } from './stdout.ts';
import type { AcpTurn } from './turn.ts';
import { answerPermission, sessionNotificationOf } from './updates.ts';

export function spawnTransport(
  ctx: SessionContext, deps: AcpDeps, memory: CompactionCaches, current: () => AcpTurn | null, mcp: McpRegistration | null = null,
) {
  const profile = profileFor(ctx.provider);
  const launch = resolveLaunch(profile);
  if (launch === null) {
    throw unavailable(`no ${ctx.provider.id} executable on this machine`, { providerId: ctx.provider.id });
  }

  const protection = protectedAcp(ctx, current, profile?.launch?.args ?? []);
  const temp = launchTemp(ctx.provider, ctx.account.isolationDir);
  let child: SpawnedChild;
  // OpenCode 2 runs its own server, unless the core cannot reach its port:
  // then it speaks ACP like version 1, without mid-turn steering.
  const native = ctx.provider.id === OPENCODE_V2 && openCodeServerReachable(launch.executable, deps.agentShim);
  if (ctx.provider.id === OPENCODE_V2 && !native) ctx.log('info', `acp: ${launch.executable} runs OpenCode 2 in a sandbox the core cannot connect to; it speaks ACP on its stdio`);
  const password = native ? randomBytes(32).toString('base64url') : null;
  const declared = profile?.launch?.args ?? [];
  const args = [...launch.prefix, ...(isGrok(ctx.provider) ? grokLaunchArgs(declared, ctx.thread.permissionMode) : declared)];
  // Preserve executable wrappers and fixture prefixes, replace only the ACP
  // subcommand. The native server's stdin is its ownership lease.
  const nativeArgs = [...launch.prefix, ...declared.filter(arg => arg !== 'acp'), 'serve', '--stdio', '--port', '0'];
  // OpenCode 2 compacts at the thread's limit once a process has read the
  // model's window; until then it keeps its own ceiling.
  const buffer = native ? wantedCompactionBuffer(memory, ctx) : null;
  const accountEnv = withOpenCodeCompactionBuffer(native ? withOpenCodeMcp(ctx.accountEnv, mcp) : ctx.accountEnv, buffer);
  const env: Record<string, string | undefined> = { ...agentEnv(ctx.provider, temp === null ? accountEnv : { ...accountEnv, ...temp.env }), ...protection?.env, ...(password === null ? {} : { OPENCODE_PASSWORD: password }) };
  try {
    child = ctx.spawnChild(launch.executable, native ? nativeArgs : args, { cwd: protection?.cwd ?? ctx.thread.cwd, env });
  } catch (error) {
    void temp?.dispose();
    try { protection?.close(Promise.resolve()); } catch { /* preserve spawn error */ }
    throw error;
  }
  // The directory the agent unpacked into goes with its last process.
  if (temp !== null) {
    const dispose = (): void => void temp.dispose((message) => ctx.log('warn', `acp session: ${message}`));
    child.once('close', dispose);
    child.once('error', dispose);
  }
  return { child, buffer, native, password, protection, env };
}

type Transport = ReturnType<typeof spawnTransport>;
type Sdk = Awaited<ReturnType<AcpDeps['loadSdk']>>;

export async function connectTransport(
  ctx: SessionContext, sdk: Sdk, transport: Transport,
  onUpdate: (params: SessionNotification) => void, current: () => AcpTurn | null,
) {
  const { child, password, native, protection } = transport;
  const stream = native ? null : sdk.ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    jsonLinesOnly(Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>, (line) => {
      ctx.log('warn', `acp agent: ${line.slice(0, STDERR_MAX)}`, { kind: 'provider-output', event: 'provider.output' });
    }),
  );
  const connection = native
    ? await OpenCodeConnection.open(child, password!, ctx.thread.cwd, onUpdate, current)
    : sdk
    .client({ name: CLIENT_NAME })
    // Checked by hand rather than by the SDK's schema, which also parses
    // every update once more on its own (see `sessionNotificationOf`).
    .onNotification('session/update', sessionNotificationOf, ({ params }) => {
      if (params !== null) onUpdate(params);
    })
    .onRequest('session/request_permission', ({ params }) => protection ? Promise.resolve({outcome: {outcome: 'cancelled' as const}}) : answerPermission(current(), params))
    .connect(stream!);
  return connection;
}

export async function initializeTransport(ctx: SessionContext, sdk: Sdk, connection: Awaited<ReturnType<typeof connectTransport>>, protection: Transport['protection']) {
  // No fs, no terminal: an agent that calls one anyway gets a
  // method-not-found from the SDK, which is the loud refusal we want.
  const init = await connection.agent.request('initialize', {
    protocolVersion: sdk.PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: acpClientInfo(ctx.provider),
  });
  const canLoad = !protection && init.agentCapabilities?.loadSession === true;
  if (protection && (init.agentInfo?.name !== 'OpenCode' || init.agentInfo?.version !== '1.19.3')) throw new Error(`execution.acp.agentInfo: expected verified OpenCode 1.19.3, received ${init.agentInfo?.name} ${init.agentInfo?.version}`);
  // The agent binary fills these: only text and numbers reach the log.
  const scalar = (value: unknown): string | null => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
  const agentName = scalar(init.agentInfo?.name), agentVersion = scalar(init.agentInfo?.version), protocol = scalar(init.protocolVersion);
  ctx.diagnostic?.('info', `${ctx.provider.id} answered initialize as ${agentName ?? 'an unnamed agent'} ${agentVersion ?? ''}, ACP protocol ${protocol ?? 'unknown'}`.replace(/ {2,}/g, ' '), {
    event: 'driver.initialized', data: { agent: agentName, version: agentVersion, protocol, loadSession: canLoad },
  });

  return { meta: acpSessionMeta(ctx.provider, init), canLoad, canDelete: canDeleteSessions(init), canMcpHttp: init.agentCapabilities?.mcpCapabilities?.http === true,
    imagesSupported: init.agentCapabilities?.promptCapabilities?.image === true };
}
