/**
 * Measures every visible line of text against the pixels really drawn behind
 * it. On glass the ground under a word is the wallpaper seen through the
 * frame and a tile, which no single token holds, so `lib/contrast.test.ts`
 * cannot vouch for it. The page is shot twice, as it is and with all text
 * and icons made transparent: inside each text run's rectangle, the pixels
 * that differ between the two shots are its glyphs, and the second shot holds
 * the ground under each of them. The run's colour, blended with its opacity,
 * is held against that ground, so a line box taller than a badge's pill never
 * samples the wallpaper round the pill's corners.
 *
 * Disabled controls are left out, as WCAG leaves them. A run passes when 95 percent of its glyph pixels clear WCAG AA: 4.5:1, or
 * 3:1 for large text (24 px, or 18.66 px bold). The other 5 percent leave room
 * for a stray antialiased edge of a neighbouring box.
 */

export interface ContrastFinding {
  text: string;
  ratio: number;
  needed: number;
  color: string;
  ground: string;
  x: number;
  y: number;
}

interface Run { text: string; rgb: [number, number, number]; alpha: number; large: boolean; rect: [number, number, number, number] }

const HIDE_TEXT = `*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important; }`;

export async function auditContrast(page: any): Promise<ContrastFinding[]> {
  const runs: Run[] = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Any CSS colour (oklch, color-mix) to sRGB bytes, as the browser paints it.
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const opacity = (el: Element | null): number => {
      let value = 1;
      for (let node = el; node; node = node.parentElement) value *= parseFloat(getComputedStyle(node).opacity || '1');
      return value;
    };
    const out: Run[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const el = node.parentElement;
      if (!text || !el) continue;
      // WCAG leaves inactive controls out.
      if (el.closest(':disabled, [aria-disabled="true"]')) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible' || style.display === 'none') continue;
      const alpha = opacity(el);
      if (alpha < 0.05) continue;
      const [r, g, b, a] = rgba(style.color);
      if (a === 0) continue;
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = el.getBoundingClientRect();
      for (const rect of Array.from(range.getClientRects())) {
        // Clipped by the element (an ellipsis) and by the window.
        const left = Math.max(rect.left, box.left, 0), right = Math.min(rect.right, box.right, innerWidth);
        const top = Math.max(rect.top, box.top, 0), bottom = Math.min(rect.bottom, box.bottom, innerHeight);
        if (right - left < 4 || bottom - top < 4) continue;
        // Scrolled out of its list or covered by a menu: what is at its centre is something else.
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue;
        out.push({ text: text.slice(0, 48), rgb: [r, g, b], alpha: a * alpha, large, rect: [left, top, right, bottom] });
      }
    }
    return out;
  });
  const shown: Buffer = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const style = await page.addStyleTag({ content: HIDE_TEXT });
  await page.waitForTimeout(80);
  const hidden: Buffer = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await style.evaluate((node: Element) => node.remove());
  return page.evaluate(async ({ shown, hidden, runs }: { shown: string; hidden: string; runs: Run[] }) => {
    const read = async (png: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      return { ctx, width: bitmap.width };
    };
    const ink = await read(shown);
    const { ctx, width } = await read(hidden);
    const scale = width / innerWidth;
    const linear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const luminance = (r: number, g: number, b: number) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const findings: ContrastFinding[] = [];
    for (const run of runs) {
      const [l, t, r, b] = run.rect.map(v => Math.round(v * scale));
      const w = Math.max(1, r - l), h = Math.max(1, b - t);
      const data = ctx.getImageData(l, t, w, h).data;
      const glyphs = ink.ctx.getImageData(l, t, w, h).data;
      const ratios: { ratio: number; ground: string; fg: string }[] = [];
      for (let i = 0; i < data.length; i += 4) {
        // Only where a glyph is drawn: the two shots differ there.
        if (Math.abs(glyphs[i] - data[i]) + Math.abs(glyphs[i + 1] - data[i + 1]) + Math.abs(glyphs[i + 2] - data[i + 2]) < 24) continue;
        const gr = data[i], gg = data[i + 1], gb = data[i + 2];
        // The text's own colour, laid over this pixel at its alpha.
        const fr = run.rgb[0] * run.alpha + gr * (1 - run.alpha);
        const fg = run.rgb[1] * run.alpha + gg * (1 - run.alpha);
        const fb = run.rgb[2] * run.alpha + gb * (1 - run.alpha);
        const a = luminance(fr, fg, fb), z = luminance(gr, gg, gb);
        ratios.push({ ratio: (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05), ground: hex(gr, gg, gb), fg: hex(fr, fg, fb) });
      }
      if (ratios.length === 0) continue;
      ratios.sort((x, y) => x.ratio - y.ratio);
      const worst = ratios[Math.floor(ratios.length * 0.05)];
      const needed = run.large ? 3 : 4.5;
      if (worst.ratio < needed) findings.push({ text: run.text, ratio: Math.round(worst.ratio * 100) / 100, needed, color: worst.fg, ground: worst.ground, x: Math.round(run.rect[0]), y: Math.round(run.rect[1]) });
    }
    return findings.sort((x, y) => x.ratio - y.ratio);
  }, { shown: shown.toString('base64'), hidden: hidden.toString('base64'), runs });
}

export function formatContrast(findings: ContrastFinding[]): string {
  if (findings.length === 0) return 'every visible text run clears WCAG AA on the pixels behind it\n';
  return findings.map(f => `${f.ratio.toFixed(2)} < ${f.needed} at ${f.x},${f.y}  ${f.color} on ${f.ground}  ${JSON.stringify(f.text)}`).join('\n') + '\n';
}
