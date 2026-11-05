import { connect, type ConnectOptions, type PluginClient } from './connect.ts';

/** What a command handler gets beside its arguments. */
export interface CommandContext {
  /** The command's name, as the agent typed it after `boite`; empty in the service. */
  name: string;
  /** The agent's working directory, where the core runs a command; the plugin's own folder in the service. */
  cwd: string;
  /** The thread whose agent ran the command, null when the owner ran it. */
  callerThreadId: string | null;
  /** The plugin's id (`BOITE_PLUGIN_ID`). */
  pluginId: string;
  /** A folder of the plugin's own that survives updates and uninstalls (`BOITE_PLUGIN_DATA`). */
  dataDir: string;
  /** Opens the core's socket on first use and returns the same client after; `runCommands` closes it. */
  connect(): Promise<PluginClient>;
}

/** Returns the exit code; nothing means 0. A thrown error prints its message and exits 1. */
export type CommandHandler = (args: string[], ctx: CommandContext) => Promise<number | void> | number | void;

export interface RunOptions {
  /** Default: `process.argv.slice(2)`, the command's name then its arguments. */
  argv?: string[];
  /** Default: `process.env`. */
  env?: Record<string, string | undefined>;
  /** Default: `process.cwd()`. */
  cwd?: string;
  /** Passed to `connect` by `ctx.connect()`. */
  connect?: Omit<ConnectOptions, 'env'>;
  /** Where usage and errors go. Default: standard error. */
  stderr?(line: string): void;
  /**
   * What runs when argv is empty: Boite starts a plugin's service and desktop
   * app with no argument. It runs as long as its promise is pending. Without
   * it an empty argv is an unknown command.
   */
  service?(ctx: CommandContext): Promise<number | void> | number | void;
}

/**
 * Runs the handler `argv[0]` names with the rest of `argv`, and answers the
 * exit code: the handler's, 1 when it threw, 2 for an unknown name. It does
 * not exit; `runCommands` does.
 */
export async function dispatch(handlers: Record<string, CommandHandler>, options: RunOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stderr = options.stderr ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const [name, ...args] = argv;
  const service = options.service;
  const handler: CommandHandler | undefined = name === undefined
    ? (service === undefined ? undefined : (_args, ctx) => service(ctx))
    : Object.hasOwn(handlers, name) ? handlers[name] : undefined;
  if (handler === undefined) {
    const known = Object.keys(handlers).sort();
    stderr(name === undefined ? 'no command named' : `unknown command: ${name}`);
    stderr(`usage: boite <command> [args...], where <command> is ${known.length ? known.join(', ') : 'none: this plugin declares no command'}`);
    return 2;
  }
  let client: Promise<PluginClient> | null = null;
  const ctx: CommandContext = {
    name: name ?? '',
    cwd: options.cwd ?? process.cwd(),
    callerThreadId: env.BOITE_CALLER_THREAD_ID || null,
    pluginId: env.BOITE_PLUGIN_ID ?? '',
    dataDir: env.BOITE_PLUGIN_DATA ?? '',
    connect: () => (client ??= connect({ ...options.connect, env })),
  };
  try {
    const code = await handler(args, ctx);
    return typeof code === 'number' ? code : 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (client !== null) await (client as Promise<PluginClient>).then(opened => opened.close(), () => {});
  }
}

/** The entry point of a plugin's executable: dispatches its argv and exits with the handler's code. */
export async function runCommands(handlers: Record<string, CommandHandler>, options: RunOptions = {}): Promise<never> {
  const code = await dispatch(handlers, options);
  process.exit(code);
}
