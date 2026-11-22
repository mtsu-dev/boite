import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { colorsBootScript } from './src/lib/theme-colors.ts';

export function themePrepaint(): Plugin {
  const css = readFileSync(new URL('./src/styles/themes.css', import.meta.url), 'utf8');
  const colors = new Map([...css.matchAll(/--palette-([\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]));
  function color(name: string): string {
    const value = colors.get(name);
    if (!value) throw new Error(`src/styles/themes.css: expected --palette-${name} to be a six-digit hex colour`);
    return value;
  }
  const filename = 'manifest.webmanifest';
  const manifest = JSON.stringify({
    ...JSON.parse(readFileSync(new URL(`./public/${filename}`, import.meta.url), 'utf8')),
    background_color: color('light-default-background'),
    theme_color: color('light-default-background')
  });
  let outDir: string;
  return {
    name: 'boite-theme-prepaint',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      return {
        html: html.replaceAll(/__PALETTE_([\w-]+)__/g, (_match, name: string) => color(name)),
        tags: [{ tag: 'script', children: colorsBootScript(), injectTo: 'head' }]
      };
    },
    configureServer(server) {
      server.middlewares.use(`/${filename}`, (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest);
      });
    },
    writeBundle() {
      writeFileSync(resolve(outDir, filename), manifest);
    }
  };
}
