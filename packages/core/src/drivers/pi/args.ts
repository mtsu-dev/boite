/** pi 1.6.1's options that take the next argument whatever it is (cli/args.js `parseArgs`). */
export const PI_VALUED = new Set(['--provider', '--model', '--api-key', '--system-prompt', '--append-system-prompt', '--name', '-n', '--session',
  '--session-id', '--fork', '--session-dir', '--models', '--tools', '-t', '--exclude-tools', '-xt', '--thinking', '--export',
  '--extension', '-e', '--skill', '--prompt-template', '--theme']);
/**
 * Its options that pick or drop the session, which Boite gives every launch itself. `--session-dir` is not one: pi
 * keeps its last value, and Boite's comes after the profile's.
 */
export const PI_SESSION_OPTIONS = new Set(['--continue', '-c', '--resume', '-r', '--session', '--session-id', '--fork', '--no-session']);
/** Its options that take the next argument only when it does not start with `-`. */
const OPTIONAL = new Set(['--mode', '--use-theme', '--tui-mode']);
/** Its flags that take nothing; any other `--name` takes the next argument when it starts with neither `-` nor `@`. */
const FLAGS = new Set(['--help', '-h', '--version', '-v', '--continue', '-c', '--resume', '-r', '--no-session', '--no-tools', '-nt',
  '--no-builtin-tools', '-nbt', '--no-extensions', '-ne', '--no-mcp', '--no-skills', '-ns', '--no-prompt-templates', '-np', '--no-themes',
  '--no-context-files', '-nc', '--verbose', '--approve', '-a', '--no-approve', '-na', '--offline']);

/** One option as pi reads it: its index in the arguments and the words it takes, its value included. */
export interface PiArg { at: number; words: string[] }

/**
 * Arguments grouped as pi 1.6.1's `parseArgs` walks them, each option with the value it consumes, so a value that
 * spells an option (`--append-system-prompt --model`) is never read as one. `--` and what follows stay one group.
 */
export function piArgs(args: readonly string[]): PiArg[] {
  const groups: PiArg[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    const at = i;
    if (arg === '--') {
      groups.push({ at, words: args.slice(i) });
      break;
    }
    let takes = false;
    if (PI_VALUED.has(arg)) takes = next !== undefined;
    else if (OPTIONAL.has(arg) || arg === '--list-models') takes = next !== undefined && !next.startsWith('-') && !(arg === '--list-models' && next.startsWith('@'));
    else if (arg === '--print' || arg === '-p') takes = next !== undefined && !next.startsWith('@') && (!next.startsWith('-') || next.startsWith('---'));
    else if (arg.startsWith('--') && !FLAGS.has(arg) && !arg.includes('=')) takes = next !== undefined && !next.startsWith('-') && !next.startsWith('@');
    groups.push({ at, words: takes ? [arg, args[++i]!] : [arg] });
  }
  return groups;
}

/** The value pi keeps for `flag`, its last one, or null. */
export function piArgValue(args: readonly string[], flag: string): string | null {
  let value: string | null = null;
  for (const { words } of piArgs(args)) if (words[0] === flag && words.length === 2) value = words[1]!;
  return value;
}
