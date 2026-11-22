import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

type Edit = { append: string } | { find: string; replace: string };
type Fixture = (id: string) => Edit[] | undefined;

/** Build the real UI with its in-memory transport and a benchmark-only bridge. */
export async function buildUiFixture(ui: string, outDir: string, fixture?: Fixture): Promise<void> {
  const fromUi = createRequire(join(ui, 'package.json'));
  const { build } = await import(fromUi.resolve('vite'));
  const fromSvelte = createRequire(fromUi.resolve('svelte'));
  const { default: MagicString } = await import(fromSvelte.resolve('magic-string'));
  const main = join(ui, 'src/main.ts').replaceAll('\\', '/');
  const androidBack = existsSync(join(ui, 'src/lib/android-back.ts'));
  const backImport = androidBack ? "\nimport { answerAndroidBack as __back } from './lib/android-back.ts';" : '';
  const bridge = `\nimport { store as __store } from './lib/store.svelte.ts';\nimport { rightPanel as __panel } from './lib/right-panel.svelte.ts';${backImport}\nglobalThis.__bench = { store: __store, panel: __panel${androidBack ? ', back: __back' : ''} };\n`;
  mkdirSync(outDir, { recursive: true });
  await build({
    root: ui,
    plugins: [{
      name: 'bench-ui-fixture',
      enforce: 'pre',
      transform(code: string, id: string) {
        const path = id.replaceAll('\\', '/');
        const edits = fixture?.(path) ?? [];
        if (path === main) edits.push({ append: bridge });
        if (edits.length === 0) return;
        const source = new MagicString(code);
        for (const edit of edits) {
          if ('append' in edit) source.append(edit.append);
          else {
            const at = code.indexOf(edit.find);
            if (at === -1) throw new Error(`In ${path}, expected ${edit.find}`);
            source.overwrite(at, at + edit.find.length, edit.replace);
          }
        }
        return { code: source.toString(), map: source.generateMap({ hires: true }) };
      },
    }],
    define: { 'import.meta.env.DEV': 'true' },
    build: {
      outDir, emptyOutDir: true,
      ...(fixture ? { sourcemap: 'hidden' } : {}),
      ...(process.env.BENCH_MINIFY === '0' ? { minify: false } : {}),
    },
    logLevel: 'warn',
  });
}
