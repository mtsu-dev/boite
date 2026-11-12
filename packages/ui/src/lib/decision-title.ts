import { fill, strings } from './strings';
import { describeTool, fileName, permissionSentence } from './tool-summary';

/**
 * A decision's title by what it does: "Push orbit/csv-import" for a push,
 * "Edit src/lib/upload.ts" for an edit. A person answers the title, so it names
 * the act and its object; the raw command stays under it for whoever reads
 * shell. A command nothing here knows is named by its program, and only an
 * empty one falls back to the generic sentence. The composer's decision, its
 * subagent waits and the Activity view all call this one function.
 */
export function decisionTitle(name: string, input: unknown): string {
  const { family, subject } = describeTool(name, input);
  const titles = strings.chat.decisionTitle;
  if (family === 'command') return commandTitle(subject) ?? strings.chat.permissionAsk.command;
  if (family === 'edit' && subject && !hasGrantRoot(input)) return fill(titles.edit, { path: shortPath(subject) });
  if (family === 'write' && subject) return fill(titles.write, { path: shortPath(subject) });
  return permissionSentence(name, input);
}

function hasGrantRoot(input: unknown): boolean {
  return typeof input === 'object' && input !== null && 'grantRoot' in input;
}

/** Folders a project's own paths start under: a path reads from there, not from the disk's root. */
const ROOTS = new Set(['src', 'lib', 'app', 'apps', 'packages', 'test', 'tests', 'docs', 'scripts', 'crates', 'assets', 'public']);

/** A path as its project names it: from a known source folder when one is in it, its last three parts otherwise. */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const from = parts.findIndex((part) => ROOTS.has(part));
  const kept = from >= 0 && parts.length - from <= 4 ? parts.slice(from) : parts.slice(-3);
  return kept.join('/') || path;
}

/** Words that only set up the command around the act: a `cd`, a variable, a guard. */
const SETUP = new Set(['cd', 'pushd', 'export', 'set', 'source', '.', 'true', 'echo', 'unset']);
/** Words that run the next word as the command. */
const WRAPPERS = new Set(['sudo', 'time', 'nice', 'env', 'command', 'exec', 'nohup', 'npx', 'bunx']);
/** Git verbs that only prepare a later step in the same line: the later one names it. */
const GIT_PREPARES = new Set(['add', 'status', 'diff', 'log', 'fetch', 'show']);
const PACKAGE_MANAGERS = new Set(['npm', 'bun', 'pnpm', 'yarn']);

/** One shell line split into commands, each its words; quotes keep their spaces and lose their marks. */
function commands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote = '';
  let started = false;
  const end = () => { if (started) words.push(word); word = ''; started = false; };
  const cut = () => { end(); if (words.length) out.push(words); words = []; };
  for (let at = 0; at < line.length; at++) {
    const char = line[at]!;
    if (quote) {
      if (char === quote) quote = '';
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '\n' || char === ';' || char === '|' || char === '&') { cut(); continue; }
    if (char === ' ' || char === '\t') { end(); continue; }
    word += char;
    started = true;
  }
  cut();
  return out;
}

/** The words of the act itself: past variables and wrappers, the program by its own name. */
function act(words: string[]): string[] {
  let at = 0;
  while (at < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at]!) || WRAPPERS.has(words[at]!))) at++;
  const rest = words.slice(at);
  if (rest.length) rest[0] = fileName(rest[0]!);
  return rest;
}

function plain(words: string[]): string[] {
  // Flags and redirections say how, not what: `rm -rf dist 2> /dev/null` deletes dist.
  return words.filter((word, index) => !word.startsWith('-') && !/^\d*[<>]/.test(word) && !/^\d*[<>]+$/.test(words[index - 1] ?? ''));
}

function commandTitle(command: string): string | null {
  const acts = commands(command).map(act).filter((words) => words.length > 0 && !SETUP.has(words[0]!));
  if (acts.length === 0) return null;
  const isGit = (words: string[]) => words[0] === 'git';
  // `git add . && git commit` is a commit: a preparing verb gives way to what follows it.
  const chosen = acts.find((words, index) => !(isGit(words) && GIT_PREPARES.has(gitVerb(words)[0] ?? '') && index < acts.length - 1)) ?? acts[0]!;
  return titleOf(chosen);
}

/** A git command's verb and arguments, past `-C <dir>` and `-c <key=value>`. */
function gitVerb(words: string[]): string[] {
  let at = 1;
  while (at < words.length && words[at]!.startsWith('-')) at += words[at] === '-C' || words[at] === '-c' ? 2 : 1;
  return words.slice(at);
}

function titleOf(words: string[]): string {
  const titles = strings.chat.decisionTitle;
  const [program = '', ...args] = words;
  const objects = plain(args);
  const target = (index = 0) => objects[index] ? fileName(objects[index]!) || objects[index]! : '';
  if (program === 'git') return gitTitle(gitVerb(words));
  if (program === 'gh' && args[0] === 'pr') {
    if (args[1] === 'create') return titles.openPr;
    if (args[1] === 'merge') return titles.mergePr;
  }
  if (PACKAGE_MANAGERS.has(program) || program === 'cargo') {
    const verb = objects[0] ?? '';
    if (verb === 'install' || verb === 'i' || verb === 'add') return objects[1] ? fill(titles.install, { target: objects[1] }) : titles.installAll;
    if (verb === 'test') return titles.test;
    if (verb === 'build') return titles.build;
    if (verb === 'run' && objects[1]) return /^test\b/.test(objects[1]) ? titles.test : objects[1] === 'build' ? titles.build : fill(titles.script, { target: objects[1] });
  }
  if ((program === 'pip' || program === 'pip3') && objects[0] === 'install' && objects[1]) return fill(titles.install, { target: objects[1] });
  switch (program) {
    case 'rm': case 'rmdir': case 'del': if (target()) return fill(titles.delete, { target: target() }); break;
    case 'mkdir': case 'touch': if (target()) return fill(titles.create, { target: target() }); break;
    case 'mv': if (target()) return fill(titles.move, { target: target() }); break;
    case 'cp': if (target()) return fill(titles.copy, { target: target() }); break;
    case 'curl': case 'wget': {
      const url = objects.find((word) => /^https?:\/\//.test(word));
      if (url) return fill(titles.download, { host: hostOf(url) });
      break;
    }
  }
  return fill(titles.program, { program });
}

function gitTitle(verbAndArgs: string[]): string {
  const titles = strings.chat.decisionTitle;
  const [verb = '', ...args] = verbAndArgs;
  const objects = plain(args);
  const last = objects.at(-1) ?? '';
  switch (verb) {
    case 'push': {
      // `git push origin` names a remote; the branch shows with a second word.
      const ref = objects.length >= 2 ? last.replace(/^\+/, '').replace(/^HEAD:/, '') : '';
      return ref ? fill(titles.push, { ref }) : titles.pushBranch;
    }
    case 'commit': return titles.commit;
    case 'checkout': case 'switch': return last && last !== '.' ? fill(titles.switch, { ref: last }) : fill(titles.program, { program: `git ${verb}` });
    case 'pull': return titles.pull;
    case 'merge': return last ? fill(titles.merge, { ref: last }) : fill(titles.program, { program: 'git merge' });
    case 'rebase': return last ? fill(titles.rebase, { ref: last }) : fill(titles.program, { program: 'git rebase' });
    case 'reset': return last ? fill(titles.reset, { ref: last }) : titles.resetBranch;
    case 'clone': return objects[0] ? fill(titles.clone, { target: fileName(objects[0]).replace(/\.git$/, '') }) : fill(titles.program, { program: 'git clone' });
    case 'add': return objects.length === 1 && objects[0] !== '.' ? fill(titles.stage, { target: fileName(objects[0]!) }) : titles.stageAll;
    case 'rm': return objects[0] ? fill(titles.delete, { target: fileName(objects[0]) }) : fill(titles.program, { program: 'git rm' });
    case 'tag': return last ? fill(titles.tag, { ref: last }) : fill(titles.program, { program: 'git tag' });
    case 'stash': return titles.stash;
    default: return fill(titles.program, { program: verb ? `git ${verb}` : 'git' });
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}
