import { expect, test } from 'bun:test';
import { cliStartupViolations, eagerClosure } from './cli-startup.ts';

const MAIN = 'packages/core/src/main.ts';
const CLI = 'packages/core/src/cli.ts';

function tree(cli: string): Map<string, string> {
  return new Map([
    [MAIN, "import { CORE_VERSION } from './version.ts'; export const main = () => import('./cli.ts');"],
    ['packages/core/src/version.ts', 'export const CORE_VERSION = "1";'],
    [CLI, cli],
    ['packages/core/src/cli-args.ts', 'export class Usage extends Error {}'],
    ['packages/core/src/browser-cli.ts', "import { RPC_PATH } from '@boite/contracts'; export const browserCommand = () => RPC_PATH;"],
    ['packages/contracts/src/index.ts', 'export const RPC_PATH = "/rpc";'],
  ]);
}

test('an eager import of a command module fails with the chain that reaches it', () => {
  const errors = cliStartupViolations(tree("import { Usage } from './cli-args.ts'; import { browserCommand } from './browser-cli.ts';"));
  expect(errors).toHaveLength(2);
  expect(errors[0]).toStartWith('packages/core/src/cli.ts -> packages/core/src/browser-cli.ts: every boite call would evaluate');
  expect(errors[1]).toStartWith('packages/core/src/cli.ts -> packages/core/src/browser-cli.ts -> packages/contracts/src/index.ts:');
});

test('a module the command imports when it runs, or only for its types, stays off the path', () => {
  const lazy = tree("import type { CoreClient } from './client.ts'; import { Usage } from './cli-args.ts'; export const run = async () => (await import('./browser-cli.ts')).browserCommand();");
  expect([...eagerClosure(lazy, [MAIN, CLI]).keys()]).toEqual([MAIN, 'packages/core/src/version.ts', CLI, 'packages/core/src/cli-args.ts']);
  expect(cliStartupViolations(lazy)).toEqual([]);
});

test('a costly builtin imported eagerly fails, a light one does not', () => {
  expect(cliStartupViolations(tree("import { createHash } from 'node:crypto'; import { join } from 'node:path';"))).toEqual([
    expect.stringContaining('packages/core/src/cli.ts -> node:crypto: every boite call would evaluate node:crypto'),
  ]);
});
