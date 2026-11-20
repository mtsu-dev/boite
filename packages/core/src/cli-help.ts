import { AGENT_PICTURE_MAX_BYTES, AGENT_SETTING_KEYS } from '../../contracts/src/agent-setting-requests.ts';
import { SETTINGS_PAGES } from '../../contracts/src/setting-requests.ts';
import { ShortUsage, Usage } from './cli-args.ts';
import { BUILTIN_COMMANDS, BOT_HELP, CONTROL_HELP, PLUGIN_HELP } from './cli-commands.ts';
import type { CliIo } from './cli.ts';

const families = () => import('./cli-families.ts');

export const USAGE = `usage: boite <command> [args] [--json]

  mcp                            serve bounded thread-scoped tools over MCP stdio
  where                          this thread, project, cwd, branch
  thread move <project>          move this thread to another project (name,
                                 id or folder) when this turn ends
  thread new <project> <brief>   start a thread and receive its first answer
                                 (--worktree, --title <title>, --core <url>
                                 from a terminal). Agents can use --machine
                                 <name> with that owner's permission. Mochis
                                 use <machine>/<project> for entrusted projects.
                                 Get --model <provider/model>, --effort <level>
                                 and --speed <tier> from boite delegate models
                                 with the same --machine. Unsupported routes fail.
  projects                       the projects added to Boite
  projects add <folder>          add an existing folder (--name <name>).
                                 Agents can use --machine <name> and an absolute
                                 path there with that owner's permission. Mochis
                                 with addProjects can add and hold a local folder.
  projects archive|unarchive|remove <p>
                                 the owner's; removing leaves the folder on disk
  projects recoveries            list files kept after worktree removal, owner only
${CONTROL_HELP}
  attach <file>                  publish a file in chat, up to 512 MB
  proof <message-id> <output-line> <unchecked> [capture]
                                 publish verification from a recorded command
  show <file>[:line]             open a file in the panel, at a line
  diff [file]                    open the changes, or one file's diff
  browse <url>                   open a url in a new tab of this conversation's browser
  browser help                   inspect, test and capture the built-in browser
  device help                    open an iOS Simulator or Android emulator in the
                                 user's Device panel, capture and drive it
  window help                    capture a desktop window (Unity, a game) as a PNG
                                 or a contact sheet, or show it in the Window panel
  desktop help                   a private virtual desktop (Linux) to run GUI apps
                                 and drive them through agent-desktop
  pr list|refresh                this conversation's linked pull requests
  pr link|unlink <url>           attach or remove a PR link; does not change GitHub
  pr watch [<url|number>]        wake on checks, reviews, comments, conflicts
                                 or queue removal without merge. End the turn.
  pr unwatch [<url|number>]      stop one watch, or all of this thread's
  view <file.html>               draw an HTML page in your answer, where a
                                 line ![title](file.html) places it
                                 (--title <text>); view help has the rules
                                 and the app's look, view example a full page
  view check <file.html>         check at desktop and phone widths without
                                 publishing; save PNGs in the cwd
                                 (--script <checks.js>, --scheme dark|light)
  preview <file.html>             open a local HTML artifact with its assets
  preview-close <file.html>       stop serving a local HTML preview
  open trace|tasks|changes|files|workflow [dir|run-id]
  status                         git status of the working directory
  server check|update|cancel      check or update this server, or cancel the
                                 pending update; no thread needed as owner
  journal-check [table rowid]     bounded read-only journal diagnostics, owner only
  logs [--min-level warn] [--since 2h]
                                 Boite diagnostics. Use logs help for filters,
                                 logs problems for groups, logs export for a
                                 sanitized report.
  issue draft|submit --title <t> --description <text>
                                 report a Boite bug on GitHub with that export;
                                 show the user the draft before submit
  ask <question> [option ...]    ask while you work (--multiple). The answer
                                 arrives as a message. --open <url> adds a
                                 button for sign-in in your browser.
  ask list                      read this thread's pending questions
  secret list                    keys kept for this project, by name only
  secret ask <NAME> --why <text> ask the user for a key on a card; prints
                                 saved secret:<ref>, declined, cancelled or timed_out
  secret write|run|pipe <ref>    use it without seeing it; boite secret help
  state [settings [page|key]|limits|machines|updates|inbox|tasks|version|route]
                                 what the user sees in Boite, read-only: settings
                                 with what each does, limits, machines, updates,
                                 the Activity inbox, the task manager
  settings [key|page]            Boite settings you may ask about: value, page,
                                 the name the user's app shows; first, the
                                 language the app speaks; experiments last
  settings request <key> <value> --why <text>
                                 a card with the switch or value itself, for
                                 the user to change in the chat; value is JSON
                                 or a bare word (experiment.<id> true|false);
                                 the outcome arrives as a message (applied,
                                 changed or refused); --machine <name> asks
                                 about another machine of the group
                                 (groupThreads, groupBots)
  settings open <page>[#<card>] --why <text>
                                 a card with a button to that Settings page,
                                 for what is not one value: a provider login,
                                 a pairing (pages: ${SETTINGS_PAGES.join(', ')})
  settings mochi [key]           a mochi's settings a card may change:
                                 ${AGENT_SETTING_KEYS.slice(0, 5).join(', ')},
                                 ${AGENT_SETTING_KEYS.slice(5, 9).join(', ')},
                                 ${AGENT_SETTING_KEYS.slice(9).join(', ')}
                                 (--mochi <name>; yours in your own conversation)
  settings mochi request <key> <value> --why <text>
                                 a card asking the user to change one, for you
                                 or --mochi <name>: name Ada, status paused,
                                 model codex/gpt-6.1-sol (<provider>/<model>,
                                 any provider), projects +boite -old
                                 (+<machine>/<name> for a project of another
                                 machine of the group), instructions with
                                 --instructions-file <path>, avatar with
                                 --picture <image>; the outcome
                                 arrives as a message (applied, changed, refused)
  settings mochi picture <image>
                                 give a mochi a face at once, no card: yours, or
                                 --mochi <name>; a PNG, JPEG, WebP or GIF of at
                                 most ${AGENT_PICTURE_MAX_BYTES / 1024} KB, or a robot code, one or two
                                 characters, "" for the robot its id draws
  settings mochi create <name>   ask for the mochi the user asked for, on your
                                 own route or --model <provider/model>
                                 (--effort, --project a,b, --domain <text>,
                                 --instructions-file <path>): the owner reads
                                 a card, or the mochi is created at once where
                                 the setting agentBotCreation is free
${PLUGIN_HELP}
  task list                      the agent's task list
  task add <text>                add a task (id t1, t2, ...)
  task start|done|remove <id>    move or drop one task
  task clear                     drop every task
  todo list                      the project's todo list
  todo add <text>                add a card for the user
  todo claim <id>                mark a card finished, awaiting the user
  goal track                     a reviewed goal and checklist on the user's
                                 last prompt, unless automatic goals are off
  threads find <words>           locate threads by words of their chat, title,
                                 project, branch or model
  threads read <thread>          its conversation (--last <n>, --before <ms>; --entry <id> --offset <n>: the rest of a cut entry; --entry <id> --tool <id> [--offset <n>]: your own thread's tool output)
  threads send <thread> <text>   message it; --wait blocks for its answer
  threads reply <message-id> <text>
  threads log <thread>           what you and that thread said to each other
  threads wait [thread]          the next message (--timeout <s>, default 90)
  threads inbox                  every exchange and its delivery state
                                 <thread>: <thread-id>, <machine>/<thread-id>
  threads contacts               other owners' Boites linked as contacts
  threads ask <text>             ask the Contacts mochi for a contact's thread
                                 (--contact <c>, --to <c>/<thread>, --new, --share);
                                 the answer names the thread to write to
  contacts [help]                the Contacts mochi's own commands
${BOT_HELP}
  team <command>                 a mochi's teams: post, read, propose (boite team help)
  --request-id <id>              reuse to retry threads send|reply or delegate spawn|send
  delegate models                models, reasoning levels and speeds a subagent can use
                                 (--refresh: read again; --machine <name>: another
                                 machine's, for thread new or spawn --machine --model)
  delegate spawn <brief>         give a subagent a bounded job and get its result
                                 (--model <provider/model>, --effort <level>,
                                 --speed <tier>, --title <title>, --profile <id>,
                                 --worktree from your HEAD or the mochi's project).
                                 Context options include --context light|neutral,
                                 --keep|--drop <parts>, --tools <Tool,...>,
                                 --rules <text>|--rules-file <path>. Use --drop
                                 guides for self-contained briefs. Mochis use
                                 --project <p> for entrusted projects. --machine
                                 <name> runs on a group machine in the matching
                                 project or the one named by --project.
  delegate list [--details]      every subagent, workflow and council: state, model, time
  delegate council <request>     independent read-only answers with scores /10
                                 in one message.
                                 --models <model>[:<effort>],... from delegate
                                 models, --effort <level> (xhigh) for other
                                 members, --request-file <path>, repeat
                                 --role <member>=<text>, --timeout <minutes>
                                 per round (30).
  delegate council again <id> [<what changed>]
                                 one more round: the same members, efforts and roles,
                                 from zero (--send-changes sends them what changed,
                                 --request-file <path> replaces the request)
  delegate council table <id>    the "Council review" section with every round's scores
  delegate send <thread-id> <text>
                                 steer or reuse a subagent, or ask the parent;
                                 to a subagent that asks something, the answer
  delegate stop [thread-id]      stop one subagent or council (cnl_...), or all of them
  delegate resume [thread-id]    continue stopped subagents, or one, and the
                                 workflows a pause or a restart held
  delegate wait [thread-id]      block until children finish or one asks something
                                 (--timeout <s>, default 600, max 3600); only with
                                 nothing else to do
  delegate result <child> <turn> [offset] [--limit <characters>]
                                 read a bounded page of full assistant text
  delegate profiles              the owner's named routes
  workflow help                  the plan format, with an example
  workflow check|run <plan>      validate, or start, a JSON plan (file or inline)
  workflow list                  runs of this thread
  workflow show <run-id> [<step-or-execution>|--details]
                                 status by default, a selected result or the full run on request
  workflow extend <run-id> <steps>
  workflow pause|resume|stop <run-id>
  workflow retry <run-id> [step]
  workflow output <json>         a step's structured result, checked on the spot
  workflow templates             plans kept for this project
  workflow save <name> <plan|run-id>
  workflow start <template>      run a kept plan by name or id

  Outside a thread, threads, thread, questions, answer, permissions, allow,
  deny and projects need no --thread: the owner drives every thread, and a
  message it sends is its own prompt. Inside a mochi's conversation they reach
  the threads of the projects entrusted to it, and its messages reach them as
  that mochi's.

  --core <url>                   another core, with its token in BOITE_TOKEN
                                 (an owner token, or a paired device's session)
  --thread <id> --data-dir <dir> --channel <stable|dev>
                                 drive a thread from outside it, as the owner
  --                             ends Boite's flags: the words after it are the command's`;

export const DEFAULT_HELP = new Set(['bot', 'contacts', 'secret', 'team', 'view', 'window', 'workflow']);
const FAMILY_HELP = {
  browser: 'BROWSER_HELP', contacts: 'CONTACTS_HELP', device: 'DEVICE_HELP', logs: 'LOGS_HELP',
  secret: 'SECRET_HELP', view: 'VIEW_HELP', window: 'WINDOW_HELP', workflow: 'WORKFLOW_HELP',
} as const;

const commandName = (command?: string): string => command === 'bot' ? 'mochi' : command ?? '';

/** Read the same command entries as the full manual, without its other families. */
function usageEntries(command: string, action?: string): string[] {
  return USAGE.split(/\n(?= {2}\S)/).filter(entry => {
    const [first, second] = entry.trim().split(/\s+/);
    return first === command && (action === undefined || second?.split('|').includes(action));
  }).map(entry => 'boite ' + entry.trim());
}

export async function cliHelp([command, action]: string[]): Promise<string> {
  if (command === undefined) return USAGE;
  if (!BUILTIN_COMMANDS.has(command)) throw new Usage(`unknown command ${command}`);
  if (Object.hasOwn(FAMILY_HELP, command)) return (await families())[FAMILY_HELP[command as keyof typeof FAMILY_HELP]];
  if (command === 'desktop') return (await import('./desktop-cli.ts')).DESKTOP_HELP;
  if (command === 'team') return (await (await families()).teamCli()).TEAM_HELP;
  const name = commandName(command);
  const entries = usageEntries(name, commandName(action) || undefined);
  return (entries.length ? entries : usageEntries(name)).join('\n\n') || 'usage: boite <command> [args] [--json]';
}

export function cliUsageError(io: CliIo, error: Usage, command = error.command): 2 {
  const name = commandName(command);
  const entry = name && BUILTIN_COMMANDS.has(name) ? usageEntries(name)[0]?.split('\n')[0]?.split(/ {2,}/)[0] : undefined;
  const hint = entry ? `usage: ${entry}\nSee boite ${name} help.\n` : 'usage: boite <command> [args] [--json]\nSee boite help.\n';
  const message = error.message.split('\n')[0];
  io.err((message ? message + '\n' : '') + (error instanceof ShortUsage ? '' : hint));
  return 2;
}
