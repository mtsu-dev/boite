import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AndroidServerUpdatePlatform } from '../server-update/types.ts';

/** A capability in the installed, trusted controller, checked without invoking new options on old releases. */
const CAPABILITY = 'export const MANAGED_UPDATE_PROTOCOL = 1;';
export function androidServerUpdates(env: NodeJS.ProcessEnv = process.env): AndroidServerUpdatePlatform {
  return {
    async inspect(dataDir) {
      const marked = env.BOITE_ANDROID_SERVER_ROOT;
      if (!marked && (!env.BOITE_CLI_DIR || !existsSync(join(dirname(env.BOITE_CLI_DIR), 'boite-server.ts')))) return null;
      const root = resolve(marked || dirname(env.BOITE_CLI_DIR!));
      const fail = (field: string, expected: string): never => { throw new Error(`Android server ${field} must be ${expected}`); };
      if (resolve(dataDir) !== join(root, 'data') || resolve(env.BOITE_DATA_DIR || '') !== join(root, 'data')) fail('BOITE_DATA_DIR', join(root, 'data'));
      if (resolve(env.BOITE_CLI_DIR || '') !== join(root, 'cli')) fail('BOITE_CLI_DIR', join(root, 'cli'));
      const release = dirname(realpathSync(env.BOITE_UI_DIR || fail('BOITE_UI_DIR', 'the running release/ui')));
      if (dirname(release) !== realpathSync(join(root, 'releases')) || realpathSync(join(root, 'current')) !== release) fail('BOITE_UI_DIR', `${root}/current/ui`);
      const executable = join(root, 'bin', 'bun');
      if (!existsSync(executable)) fail('runtime', executable);
      const controllers = [join(release, 'boite-server.ts'), join(root, 'boite-server.ts')];
      if (!existsSync(join(release, 'managed-update.ts'))) throw new Error('Android server release is missing managed-update.ts; run boite-server update in Termux once');
      const controller = controllers.find(file => existsSync(file) && readFileSync(file, 'utf8').includes(CAPABILITY));
      if (!controller) throw new Error('Android server controller does not support managed updates; run boite-server update in Termux once');
      const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as { channel?: unknown };
      const channel = config.channel;
      if (channel !== 'stable' && channel !== 'nightly') throw new Error('Android server config.json.channel must be stable or nightly');
      return { root, executable, controller, channel };
    },
    async check(run, installation, current) {
      const result = JSON.parse(await run(installation.executable, [installation.controller, 'update', '--check', '--json'])) as { ok?: unknown; version?: unknown; available?: unknown; channel?: unknown; managedUpdate?: unknown };
      if (result.ok !== true || result.managedUpdate !== 1) throw new Error('Android server controller must support managed update protocol 1');
      if (result.version !== current) throw new Error(`Android server controller version must match running core ${current}`);
      if (result.channel !== 'stable' && result.channel !== 'nightly') throw new Error('Android server controller channel must be stable or nightly');
      installation.channel = result.channel;
      if (result.available === null || result.available === current) return null;
      if (typeof result.available !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(result.available)) throw new Error('Android server available version must be a release version');
      return { version: result.available, channel: result.channel };
    },
    async launch(run, installation, plan) {
      const result = JSON.parse(await run(installation.executable, [installation.controller, 'managed-update-launch', plan])) as { ok?: unknown };
      if (result.ok !== true) throw new Error('Android server update worker launch must acknowledge ok');
    },
  };
}
