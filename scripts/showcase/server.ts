import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureBridge } from '../../tests/e2e/lib/ui';

export const root = resolve(import.meta.dir, '../..');
const ui = join(root, 'packages/ui');
const fakeClient = join(ui, 'src/lib/fake-client.ts').replaceAll('\\', '/');

/** The last demo seed of the fake core's constructor: the showcase seed runs right after it. */
const HOOK = 'if (options.councilDemo) seedCouncilDemo(ctx);';

/** The Vite plugin that calls `seedShowcase` inside the fake core, only on this rig's server. */
const showcaseSeed = {
  name: 'boite-showcase-seed',
  transform(code: string, id: string) {
    if (id.replaceAll('\\', '/') !== fakeClient) return;
    if (!code.includes(HOOK)) throw new Error(`Showcase seed hook "${HOOK}" is missing from packages/ui/src/lib/fake-client.ts`);
    return `${code.replace(HOOK, `${HOOK} seedShowcase(ctx, options);`)}\nimport { seedShowcase } from '../../../../scripts/showcase/fixture';`;
  },
};

export interface Rig {
  base: string;
  close(): Promise<void>;
}

/** One Vite dev server of `packages/ui` with the test bridge and the showcase seed. */
export async function startServer(): Promise<Rig> {
  const requireUi = createRequire(join(ui, 'package.json'));
  const { createServer } = await import(requireUi.resolve('vite'));
  const server = await createServer({
    root: ui, plugins: [fixtureBridge, showcaseSeed],
    // No watcher and no hot reload: an edit made while a run goes on would reload the page mid-step.
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, logLevel: 'warn', clearScreen: false,
  });
  await server.listen();
  return { base: server.resolvedUrls!.local[0]!.replace(/\/$/, ''), close: () => server.close() };
}

const PLAYWRIGHT = '/home/boite/.local/lib/browser-tools/node_modules/playwright-core/index.mjs';

/** Headless Chrome on the GPU, muted. Software rendering is refused by `assertHardware`. */
export async function launchBrowser(executable: string, playwright = PLAYWRIGHT): Promise<any> {
  const { chromium } = await import(playwright.startsWith('/') ? pathToFileURL(playwright).href : playwright);
  return chromium.launch({
    executablePath: executable, headless: true, chromiumSandbox: true,
    args: ['--mute-audio', '--enable-gpu', '--use-gl=angle', '--use-angle=gl-egl', '--disable-software-rasterizer'],
  });
}

export async function assertHardware(page: any): Promise<string> {
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  });
  if (!renderer || /swiftshader|llvmpipe|softpipe/i.test(renderer)) throw new Error(`Hardware rendering unavailable: ${renderer}`);
  return renderer;
}

/** Waits until the machine has room for one dev server and one browser. */
export async function waitForMemory(minBytes: number, timeoutMs = 15 * 60_000): Promise<void> {
  const started = Date.now();
  let warned = false;
  for (;;) {
    const line = readFileSync('/proc/meminfo', 'utf8').split('\n').find(l => l.startsWith('MemAvailable:'));
    const available = Number(line?.match(/(\d+)/)?.[1] ?? 0) * 1024;
    if (available >= minBytes) return;
    if (Date.now() - started > timeoutMs) throw new Error(`MemAvailable stayed under ${(minBytes / 2 ** 30).toFixed(1)} GiB for ${timeoutMs / 60_000} min`);
    if (!warned) console.log(`waiting for memory: ${(available / 2 ** 30).toFixed(2)} GiB available, need ${(minBytes / 2 ** 30).toFixed(1)} GiB`);
    warned = true;
    await Bun.sleep(5000);
  }
}
