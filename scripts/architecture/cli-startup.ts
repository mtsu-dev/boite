import { resolveImport, type Sources } from './graph.ts';

/**
 * Every `boite` call an agent makes is `boite-core cli`: main.ts, then cli.ts,
 * evaluate their static imports before the command runs, in the compiled core
 * and in the bundle the Windows runtime loads. The commands' modules, the
 * client and the contracts barrel load inside the command, through one
 * `await import` of cli-families.ts: one import per family split the core
 * bundle into 33 more chunks, 15.7 KB of chunk headers (2026-11-14).
 * Measured on Linux on 2026-11-14 with Bun 1.4.4: importing the contracts
 * barrel, `node:crypto` or `node:zlib` each costs a fresh Bun process 6 to 8 ms
 * of CPU, and `boite cli help` evaluated 104 modules before it printed, 11 once
 * the commands loaded lazily.
 */
export const CLI_ENTRIES = ['packages/core/src/main.ts', 'packages/core/src/cli.ts'] as const;

/** The modules a `boite` call may evaluate before its command runs: small, and needed by every call. */
export const CLI_STARTUP: ReadonlySet<string> = new Set([
  ...CLI_ENTRIES,
  'packages/core/src/cli-args.ts',
  'packages/core/src/cli-commands.ts',
  'packages/core/src/ids.ts',
  'packages/core/src/paths.ts',
  'packages/core/src/version.ts',
  // USAGE prints the settings pages and the bot keys; AGENT_ENV finds the thread.
  'packages/contracts/src/agent-door.ts',
  'packages/contracts/src/agent-setting-requests.ts',
  'packages/contracts/src/setting-requests.ts',
  'packages/contracts/src/plugin-source.ts',
  'packages/contracts/src/experiments.ts',
]);

/** Builtins Bun evaluates in JavaScript at their first import, at a cost a `boite` call notices. */
export const COSTLY_BUILTINS: ReadonlySet<string> = new Set(['node:crypto', 'crypto', 'node:zlib', 'zlib']);

const scanner = new Bun.Transpiler({ loader: 'ts' });

/** The imports evaluated with the file itself: `import` statements and re-exports, not `import()` and not types. */
function eagerImports(source: string): string[] {
  return scanner.scan(source).imports.filter(entry => entry.kind === 'import-statement').map(entry => entry.path);
}

/** Each module the entries evaluate before their first line runs, with the chain that reaches it. */
export function eagerClosure(sources: Sources, entries: readonly string[]): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  const visit = (file: string, chain: string[]): void => {
    if (reached.has(file)) return;
    const path = [...chain, file];
    reached.set(file, path);
    const source = sources.get(file);
    if (source === undefined) return;
    for (const specifier of eagerImports(source)) {
      if (COSTLY_BUILTINS.has(specifier)) { reached.set(specifier, [...path, specifier]); continue; }
      const resolved = resolveImport(file, specifier, sources);
      if (resolved) visit(resolved, path);
      // A package outside the sources is still evaluated on every call: it must be listed to pass.
      else if (!/^(?:\.|\/|node:|bun:)/.test(specifier)) reached.set(specifier, [...path, specifier]);
    }
  };
  // A tree without the core has no CLI; a core without an entry renamed it, and the gate must follow.
  const core = [...sources.keys()].some(file => file.startsWith('packages/core/src/'));
  for (const entry of entries) {
    if (!sources.has(entry) && core) throw new Error(`${entry}: the CLI entry is missing from the sources; update CLI_ENTRIES in scripts/architecture/cli-startup.ts`);
    if (sources.has(entry)) visit(entry, []);
  }
  return reached;
}

/** A module the CLI path would evaluate on every call that is not in `CLI_STARTUP`, with how it got there. */
export function cliStartupViolations(sources: Sources): string[] {
  const errors: string[] = [];
  for (const [module, chain] of eagerClosure(sources, CLI_ENTRIES)) {
    if (CLI_STARTUP.has(module)) continue;
    errors.push(`${chain.join(' -> ')}: every boite call would evaluate ${module} before its command runs; `
      + 'import it inside the command that needs it (await import), or add it to CLI_STARTUP in scripts/architecture/cli-startup.ts if it is small and every call needs it');
  }
  return errors;
}
