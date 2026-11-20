import type { Parsed } from './cli-args.ts';

/**
 * Every first word the `boite` CLI answers itself. Any other first word is a
 * plugin's agent command (`plugins.command`), so the CLI hands it every word
 * after it untouched, and the manifest reader refuses a plugin command that
 * takes one of these names: the built-in would always win.
 *
 * plugins-v2.test.ts checks this list against the command table of cli.ts and
 * the commands control-cli.ts answers.
 */
export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  'help', 'mcp',
  // cli.ts
  'ask', 'attach', 'bot', 'browse', 'browser', 'contacts', 'delegate', 'desktop', 'device', 'diff', 'goal', 'issue',
  'journal-check', 'logs', 'open', 'pr', 'preview', 'preview-close', 'projects', 'proof', 'secret', 'server', 'settings', 'show',
  'state', 'status', 'task', 'team', 'thread', 'threads', 'todo', 'view', 'where', 'window', 'workflow', 'plugin',
  // control-cli.ts
  'questions', 'answer', 'permissions', 'allow', 'deny',
  // The spellings `canonicalCommand` rewrites: `mochi` is the one help shows, `agent` and `agents` are old.
  'mochi', 'agent', 'agents',
]);

/** How long a plugin's agent command may run (`plugins.command`); the CLI waits a minute longer for the answer. */
export const PLUGIN_COMMAND_TIMEOUT_MS = 10 * 60_000;

/** Whether `boite <word> ...` is a plugin's command rather than Boite's. */
export function isPluginCommandWord(word: string | undefined): boolean {
  return word !== undefined && word.length > 0 && !word.startsWith('-') && !BUILTIN_COMMANDS.has(word);
}

// What every `boite` call reads before it loads a command's module (cli.ts):
// which module answers the command, and the help USAGE prints. A command's
// own module (control-cli.ts, plugin-cli.ts) loads only when that command runs.

/** Commands control-cli.ts answers, with the words that follow them. */
const CONTROL_COMMANDS = ['threads', 'thread', 'questions', 'answer', 'permissions', 'allow', 'deny'] as const;
/** `thread` actions control-cli.ts answers; `new` and `move <project>` without a target stay with the agent's own commands. */
export const THREAD_ACTIONS = ['show', 'send', 'stop', 'done', 'archive', 'unarchive', 'remove', 'rename', 'deleted', 'restore'] as const;

export function isControlCommand(parsed: Parsed): boolean {
  const [command, action] = parsed.positional;
  if (command === 'thread') {
    if (THREAD_ACTIONS.includes(action as typeof THREAD_ACTIONS[number])) return true;
    // `thread move <project> <thr_id>` names another thread; `thread move <project words>` stays the caller's own move.
    return action === 'move' && parsed.positional.length === 4 && /^(?:[^/\s]+\/)?thr_[0-9a-z]+$/.test(parsed.positional[3] ?? '');
  }
  if (command === 'projects') return ['archive', 'unarchive', 'remove'].includes(action ?? '');
  // `threads find|read|send|...` talk to other threads (agents-cli.ts); only the listing is here.
  if (command === 'threads') return action === undefined || action === 'list';
  return (CONTROL_COMMANDS as readonly string[]).includes(command ?? '');
}

/** Commands an owner may run without naming a thread of its own. */
export function ownerWithoutThread(parsed: Parsed): boolean {
  const [command, action] = parsed.positional;
  if (isControlCommand(parsed)) return true;
  if (command === 'projects') return true;
  // What the user sees is the owner's own to read from a terminal: no thread is needed.
  if (command === 'state') return true;
  // An outside event names its mochi: the owner's terminal or a paired device sends it with no thread.
  if (command === 'bot' && action === 'event') return true;
  return command === 'thread' && action === 'new';
}

/** The lines of USAGE for control-cli.ts. */
export const CONTROL_HELP = `  threads [list] [--project <p>] [--archived]
                                 the threads you may see and their machine:
                                 every one here as the owner, those of your
                                 projects and your desk as a mochi, the ones that
                                 let you reach them here and on linked machines
                                 from any other thread. A mochi also lists the
                                 projects other machines of the group entrusted
                                 to it, as <machine>/<id>, and names a machine
                                 it cannot reach (--project <machine>/<name>)
  thread show <id>               state, pending questions and permissions, last answer;
                                 from a thread that is not a mochi's, any thread
                                 boite threads lists, by its address there
  thread send <id> <text> [--request-id <id>]
                                 queue the owner's prompt, or send an agent's message
  thread done <id>               put a thread that is not at work in Done
                                 (without <id>: this one, once this turn ends)
  thread stop|archive|unarchive|remove <id>   (remove: owner only)
  thread deleted                 list recoverable conversations (owner only)
  thread restore <id>            restore a deleted conversation (owner only)
  thread rename <id> <title>
  thread move <project> <id>     move another thread (without <id>: this one)
  questions [<id>]               pending questions
  answer <id> <question-id> <option|text ...> [--text <note>] (--skip)
  permissions [<id>]             pending tool permissions
  allow|deny <id> <request-id>   (owner only, threads of this machine)
  A mochi's <id> may be <machine>/<thread-id>: a thread of a project of that
  machine entrusted to it, which that machine lets mochis of the group drive`;

/** The lines of USAGE for a mochi's own commands (agents/cli.ts). */
export const BOT_HELP = `  mochi memory                   a mochi's MEMORY.md and its path
  mochi remember <fact>          add a dated line to MEMORY.md
                                 (--section <title>: under that heading, else at
                                 the end; --replace <start>: in place of the one
                                 line that starts so, refused on none or several)
  mochi routines                 its routines: schedule, next run, last outcome
  mochi schedule <json>          name, prompt, schedule; optional id (an edit keeps what it leaves out), enabled and check (a command: wake only when it prints something new)
  mochi unschedule <routine-id>  remove one routine
  mochi watch|unwatch <thread-id>
                                 put a thread of its projects on its desk, or
                                 take one off; <machine>/<thread-id> for a
                                 project another machine entrusted to it
  mochi event <mochi> <text>     wake a mochi with an event from outside Boite
                                 (--key <key>: a later event with the same key
                                 replaces it while it waits); from a terminal
                                 as the owner, or --core with a paired device
  Other mochi commands run from the mochi's own conversation.
  settings mochi request|create opens a card from a conversation;
  the owner manages existing mochis in Settings.`;

/** The lines of USAGE for plugin-cli.ts. */
export const PLUGIN_HELP = `  plugin add <url> --why <text>  a card asking the user to preview a plugin:
                                 a repository URL or page, owner/repo for
                                 GitHub, --ref <branch|tag|commit>; the user
                                 installs it in Settings, never you
  plugin dev <folder>            run a plugin from a folder, reloaded on each
                                 run; --remove <id> removes it (owner only)
  <plugin-command> [args]        a command an installed plugin provides; your
                                 guide lists them`;
