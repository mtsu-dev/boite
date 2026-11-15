import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureBridge } from '../../tests/e2e/lib/ui';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION } from '../../packages/ui/src/lib/onboarding';

// Recorder dependencies stay outside the application's lockfile.
const arg = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : Bun.argv[index + 1] ?? fallback;
};
const root = resolve(import.meta.dir, '../..');
const ui = join(root, 'packages/ui');
const output = resolve(arg('output', join(root, 'docs/media')));
const scratch = resolve(arg('scratch', join(root, 'tests/e2e/.artifacts/readme')));
const ffmpegArg = arg('ffmpeg', 'ffmpeg');
// ANGLE backend: gl-egl by default, vulkan where the browser has no EGL.
const angle = arg('angle', 'gl-egl');
const ffmpeg = Bun.which(ffmpegArg) ?? resolve(ffmpegArg);
const inspect = Bun.argv.includes('--inspect');
const encodeOnly = Bun.argv.includes('--encode-only');
const width = 1280, height = 800, seconds = 9;
const themes = ['light', 'dark'] as const;
type Theme = typeof themes[number];
if (inspect && encodeOnly) throw new Error('Choose either --inspect or --encode-only');
mkdirSync(output, { recursive: true });
mkdirSync(scratch, { recursive: true });

if (!encodeOnly) await capture();
if (!inspect) await encodeFilm();

async function capture() {
  const requireUi = createRequire(join(ui, 'package.json'));
  const { createServer } = await import(requireUi.resolve('vite'));
  const moduleName = arg('playwright', 'playwright-core');
  const { chromium } = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
  const server = await createServer({
    root: ui, plugins: [fixtureBridge, {
      name: 'readme-film',
      transform(code: string, id: string) {
        if (id.replaceAll('\\', '/') !== join(ui, 'src/lib/fake-client.ts').replaceAll('\\', '/')) return;
        const hook = 'if (options.delegationDemo) seedDelegationDemo(ctx);';
        if (!code.includes(hook)) throw new Error('Recording fixture hook changed in fake-client.ts');
        return `${code.replace(hook, hook + ' seedReadme(ctx);')}\nimport { seedReadme } from '../../../../scripts/readme/fixture';`;
      },
      configureServer(vite: any) {
        vite.middlewares.use((req: any, res: any, next: () => void) => {
          if (req.url?.startsWith('/__readme-stage')) {
            res.setHeader('Content-Type', 'text/html');
            res.end(readFileSync(join(import.meta.dir, 'stage.html')));
          } else next();
        });
      },
    }], server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn', clearScreen: false,
  });
  let browser: any;
  try {
    await server.listen();
    const base = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
    browser = await chromium.launch({
      executablePath: arg('browser', '/usr/bin/google-chrome'),
      headless: true, chromiumSandbox: true,
      args: ['--mute-audio', '--enable-gpu', '--use-gl=angle', `--use-angle=${angle}`, '--disable-software-rasterizer'],
    });
    for (const theme of themes) await captureDesktop(browser, base, theme);
    await capturePhone(browser, base);
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function prepare(context: any, theme: Theme = 'light') {
  await context.addInitScript(({ key, version, theme }: any) => {
    localStorage.setItem('boite.theme', theme);
    localStorage.setItem('boite.locale', 'en');
    localStorage.setItem('boite:right-panel-width', '540');
    localStorage.setItem(key, JSON.stringify({ version, at: 0 }));
  }, { key: ONBOARDING_STORAGE_KEY, version: ONBOARDING_VERSION, theme });
}

async function open(page: any, base: string) {
  const errors: string[] = [], badRequests: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('response', (response: any) => {
    if (response.status() >= 400) badRequests.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${base}/__readme-stage`, { waitUntil: 'load', timeout: 60000 });
  const frame = await (await page.$('#desktop')).contentFrame();
  await frame.waitForFunction(() => (globalThis as any).__boiteTest?.workspace.active.booted);
  await frame.evaluate(async () => {
    const store = (globalThis as any).__boiteTest.workspace.active;
    await store.open('t-trace');
    store.panel.closeAll();
    await document.fonts.ready;
  });
  await frame.locator('[data-testid=timeline]').waitFor();
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  });
  if (!renderer || /swiftshader|llvmpipe|softpipe/i.test(renderer)) throw new Error(`Hardware rendering unavailable: ${renderer}`);
  return { frame, renderer, errors, badRequests };
}

async function click(page: any, frame: any, selector: string) {
  const target = frame.locator(selector).first();
  await target.waitFor({ state: 'visible' });
  const box = await target.boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(({ x, y }: any) => {
    document.getElementById('cursor')!.style.transform = `translate(${x}px,${y}px)`;
    document.getElementById('cursor')!.style.opacity = '1';
  }, { x, y });
  await page.mouse.move(x, y);
  await Bun.sleep(450);
  await page.evaluate(({ x, y }: any) => {
    const pulse = document.getElementById('pulse')!;
    pulse.style.left = `${x - 22}px`; pulse.style.top = `${y - 22}px`;
    pulse.classList.remove('pressed'); void pulse.offsetWidth; pulse.classList.add('pressed');
  }, { x, y });
  await page.mouse.click(x, y);
}

function assertClean(proof: { errors: string[]; badRequests: string[] }) {
  if (proof.errors.length || proof.badRequests.length) throw new Error(JSON.stringify(proof));
}

async function captureDesktop(browser: any, base: string, theme: Theme) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, locale: 'en-US', colorScheme: theme,
    ...(inspect ? {} : { recordVideo: { dir: join(scratch, theme), size: { width, height } } }),
  });
  try {
    await prepare(context, theme);
    const recordingAt = performance.now();
    const page = await context.newPage();
    const proof = await open(page, base);
    const { frame } = proof;
    const bounds = await page.locator('#desktop').boundingBox();
    if (bounds?.x !== 0 || bounds?.y !== 0 || bounds?.width !== width || bounds?.height !== height) throw new Error('Boite does not fill the frame');
    await page.screenshot({ path: join(scratch, `conversation-${theme}.png`) });
    const lead = (performance.now() - recordingAt) / 1000;
    const filmAt = performance.now();
    const at = async (time: number) => { if (!inspect) await Bun.sleep(Math.max(0, time * 1000 - (performance.now() - filmAt))); };
    // Conversation, the panel's surfaces, the two reviewers, then the diff they checked.
    await at(1);
    await click(page, frame, '[data-testid=panel-toggle]');
    await at(2.4);
    await click(page, frame, '[data-testid=launch-agents]');
    await at(4.6);
    await click(page, frame, '[data-testid=panel-add]');
    await at(5.6);
    await click(page, frame, '[data-testid=panel-add-menu] [role=menuitem]:has-text("Changes")');
    await frame.locator('[data-testid=diff-view][data-path="src/routes/+page.svelte"]').waitFor();
    await page.evaluate(() => { document.getElementById('cursor')!.style.opacity = '0'; });
    await page.mouse.move(1, height - 1);
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    await page.screenshot({ path: join(scratch, `changes-${theme}.png`) });
    await at(seconds);
    assertClean(proof);
    const video = page.video();
    await context.close();
    if (!inspect) {
      const raw = await video.path();
      await Bun.write(join(scratch, `capture-${theme}.json`), JSON.stringify({ raw, lead, seconds }, null, 2));
    }
    await Bun.write(join(scratch, `desktop-${theme}-verification.json`), JSON.stringify({ ...proof, frame: undefined, bounds, seconds }, null, 2));
    console.log(`README_DESKTOP_OK theme=${theme} fullscreen=${width}x${height} seconds=${seconds} errors=0 hardware=${proof.renderer}`);
  } finally { await context.close(); }
}

async function capturePhone(browser: any, base: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-US', colorScheme: 'light' });
  try {
    await prepare(context);
    const page = await context.newPage();
    const proof = await open(page, base);
    for (const theme of ['light', 'dark']) {
      await proof.frame.evaluate((theme: string) => (globalThis as any).__boiteTest.setTheme(theme), theme);
      await page.screenshot({ path: join(scratch, `phone-${theme}.png`) });
    }
    assertClean(proof);
    await Bun.write(join(scratch, 'phone-verification.json'), JSON.stringify({ ...proof, frame: undefined }, null, 2));
    console.log('README_PHONE_OK viewport=390x844 errors=0');
  } finally { await context.close(); }
}

async function encodeFilm() {
  for (const theme of themes) {
    const { raw, lead } = JSON.parse(readFileSync(join(scratch, `capture-${theme}.json`), 'utf8'));
    const film = join(scratch, `boite-${theme}.mp4`), gif = join(output, `boite-${theme}.gif`);
    // Keep the real timing of every click and animation. No scene acceleration.
    await encode(['-ss', String(lead), '-i', raw, '-t', String(seconds), '-vf', 'fps=30',
      '-an', '-c:v', 'libx264', '-threads', '4', '-preset', 'slow', '-crf', '17',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', film]);
    const filters = 'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[gif]';
    await encode(['-i', film, '-filter_complex', filters, '-map', '[gif]', '-loop', '0', gif]);
    const size = statSync(gif).size;
    if (size > 5 * 1024 * 1024) throw new Error(`README GIF ${basename(gif)} is ${size} bytes, over 5 MiB`);
    console.log(`README_FILM_OK theme=${theme} gif=${size} fullscreen=${width}x${height} seconds=${seconds} continuous=true`);
  }
}

async function encode(args: string[]) {
  const proc = Bun.spawn([ffmpeg, '-y', '-threads', '4', '-filter_complex_threads', '2', ...args], { stdout: 'ignore', stderr: 'pipe' });
  const log = await new Response(proc.stderr).text();
  await Bun.write(join(scratch, `${basename(args.at(-1)!)}.encode.log`), log);
  if (await proc.exited !== 0) throw new Error(`FFmpeg failed:\n${log}`);
}
