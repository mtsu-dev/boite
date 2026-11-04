/**
 * Every first word the `boite` CLI answers itself. Any other first word is a
 * plugin's agent command (`plugins.command`), so the CLI hands it every word
 * after it untouched, and the manifest reader refuses a plugin command that
 * takes one of these names: the built-in would always win.
 *
 * cli.test.ts checks this list against the CLI's own command table and help.
 */
export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  'help', 'mcp',
  // cli.ts
  'ask', 'attach', 'bot', 'browse', 'browser', 'contacts', 'delegate', 'desktop', 'device', 'diff', 'goal', 'issue',
  'journal-check', 'logs', 'open', 'pr', 'preview', 'preview-close', 'projects', 'secret', 'server', 'settings', 'show',
  'status', 'task', 'team', 'thread', 'threads', 'todo', 'view', 'where', 'window', 'workflow', 'plugin',
  // control-cli.ts
  'questions', 'answer', 'permissions', 'allow', 'deny',
  // The old spellings `canonicalCommand` rewrites.
  'agent', 'agents',
]);

/** How long a plugin's agent command may run (`plugins.command`); the CLI waits a minute longer for the answer. */
export const PLUGIN_COMMAND_TIMEOUT_MS = 10 * 60_000;

/** Whether `boite <word> ...` is a plugin's command rather than Boite's. */
export function isPluginCommandWord(word: string | undefined): boolean {
  return word !== undefined && word.length > 0 && !word.startsWith('-') && !BUILTIN_COMMANDS.has(word);
}
