import { expect, test } from "bun:test";
import { BrowserPage, freePort } from "./lib/cdp";
import { startUi } from "./lib/ui.ts";

test("settings reveal sections and protection switches persist across navigation", async () => {
  const port = await freePort();
  const server = await startUi(port);
  const page = await BrowserPage.launch({
    url: `http://127.0.0.1:${port}/?fake=1&open=recent`,
    windowSize: { width: 1440, height: 1000 },
  });
  async function settled() {
    await page.evaluate(
      `Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`,
    );
    await page.evaluate("document.fonts.ready");
  }
  try {
    await page.click("[data-testid=nav-settings]");
    await page.waitFor('document.querySelector("[data-testid=settings-home]")');
    await settled();
    await page.screenshot("tests/e2e/.artifacts/settings-after.png");
    // Protection is the Resources section of Diagnostics now; its Quiet switches are a card of General.
    await page.click("[data-testid=settings-tab-diagnostics]");
    await page.waitFor(
      'document.querySelector("[data-testid=resources-page] [data-testid=setting-reap-orphans]")',
    );
    await settled();
    // The nav is flat: no entry unfolds a list of its page's sections, the search reaches them.
    expect(
      await page.evaluate(
        'document.querySelector("[data-testid=settings-tab-diagnostics]").getAttribute("aria-expanded")',
      ),
    ).toBeNull();
    expect(
      await page.evaluate(
        'document.querySelector("[data-testid=settings-tab-general]").getAttribute("aria-expanded")',
      ),
    ).toBeNull();
    expect(
      await page.evaluate(
        'document.querySelector("[data-testid=settings-tab-usage]").getAttribute("aria-expanded")',
      ),
    ).toBeNull();
    await page.screenshot("tests/e2e/.artifacts/protection-desktop.png");
    await page.click("[data-testid=setting-reap-orphans]");
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-reap-orphans]").checked',
    );
    // On until the owner turns it off: the machine stays awake while agents work.
    await page.waitFor(
      'document.querySelector("[data-testid=setting-keep-awake]").checked',
    );
    await page.click("[data-testid=setting-keep-awake]");
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-keep-awake]").checked',
    );
    await page.click("[data-testid=settings-tab-general]");
    await page.waitFor(
      'document.querySelector("[data-testid=setting-mute-agents]") && document.querySelector("[data-testid=setting-focus-guard]")',
    );
    await page.click("[data-testid=setting-mute-agents]");
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-mute-agents]").checked',
    );
    await page.click("[data-testid=settings-tab-diagnostics]");
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-reap-orphans]")?.checked && document.querySelector("[data-testid=setting-reap-orphans]") && document.querySelector("[data-testid=setting-keep-awake]")?.checked === false',
    );
    await page.click("[data-testid=settings-tab-general]");
    await page.waitFor(
      'document.querySelector("[data-testid=setting-mute-agents]") && !document.querySelector("[data-testid=setting-mute-agents]").checked',
    );
    await page.click("[data-testid=settings-tab-diagnostics]");
    await page.waitFor(
      'document.querySelector("[data-testid=setting-reap-orphans]")',
    );
    expect(await page.evaluate('document.fonts.check("14px Inter")')).toBe(
      true,
    );
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await settled();
    await page.screenshot("tests/e2e/.artifacts/protection-phone.png");
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await settled();
    await page.screenshot("tests/e2e/.artifacts/protection-light.png");
    expect(
      await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
    ).toBe(true);
  } finally {
    await page.close();
    await server.close();
  }
}, 60_000);

// French names run long ("Machines et mises à jour"): an entry once let its label
// spill over the next one, and the page hugged the left of a wide window. The
// desktop's home is the nav, its search over the first page's cards.
test("settings nav keeps every entry's words inside it and centres the page's column", async () => {
  const port = await freePort();
  const server = await startUi(port);
  const page = await BrowserPage.launch({
    url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1`,
    windowSize: { width: 1440, height: 900 },
  });
  try {
    await page.evaluate("localStorage.setItem('boite.locale', 'fr')");
    await page.evaluate("location.reload()");
    await page.waitFor('document.querySelector("[data-testid=nav-settings]")');
    await page.click("[data-testid=nav-settings]");
    await page.waitFor('document.querySelector("[data-testid=settings-tab-machines]") && document.querySelector("[data-testid=settings-page] > section.card")');
    await page.evaluate("document.fonts.ready");
    for (const width of [1920, 1440, 1100, 900]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const layout = JSON.parse(String(await page.evaluate(`(() => {
        const frame = document.querySelector('.settings section.framed').getBoundingClientRect();
        const column = document.querySelector('[data-testid=settings-page] > section.card').getBoundingClientRect();
        const tiles = [...document.querySelectorAll('[data-testid^=settings-tab-]')].filter(tile => tile.tagName === 'BUTTON');
        const spills = tiles.filter(tile => {
          const box = tile.getBoundingClientRect();
          return [...tile.querySelectorAll('span')].some(part => {
            const inner = part.getBoundingClientRect();
            return part.scrollWidth > part.clientWidth + 1 || inner.right > box.right + 0.5 || inner.bottom > box.bottom + 0.5;
          });
        }).map(tile => tile.dataset.testid);
        const heights = [...new Set(tiles.map(tile => Math.round(tile.getBoundingClientRect().height)))];
        return JSON.stringify({ left: column.left - frame.left, right: frame.right - column.right, spills, heights, count: tiles.length });
      })()`)));
      expect(layout.count).toBeGreaterThan(8);
      expect({ width, spills: layout.spills }).toEqual({ width, spills: [] });
      expect({ width, heights: layout.heights }).toEqual({ width, heights: [layout.heights[0]] });
      if (width >= 1440) expect(Math.abs(layout.left - layout.right)).toBeLessThanOrEqual(2);
    }
    // A page with its own root styles (Machines, Protection under its machine bar) centres the same way.
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 900, deviceScaleFactor: 1, mobile: false });
    const centred = async (selector: string) => {
      const sides = JSON.parse(String(await page.evaluate(`(() => {
        const frame = document.querySelector('.settings section.framed').getBoundingClientRect();
        const box = document.querySelector('${selector}').getBoundingClientRect();
        return JSON.stringify([box.left - frame.left, frame.right - box.right]);
      })()`)));
      expect({ selector, off: Math.abs(sides[0] - sides[1]) <= 2 }).toEqual({ selector, off: true });
    };
    await page.click("[data-testid=settings-tab-machines]");
    await page.waitFor('document.querySelector("[data-testid=machines-page] > section")');
    await centred("[data-testid=machines-page] > section");
    // A page of one machine centres too, its picker in the title's scope line, and the title starts where the page does.
    await page.click("[data-testid=settings-tab-diagnostics]");
    await page.waitFor('document.querySelector("[data-testid=settings-scope] [data-testid=settings-machine]") && document.querySelector("[data-testid=resources-page] > *")');
    await centred("[data-testid=resources-page] > *");
    const edges = JSON.parse(String(await page.evaluate(`JSON.stringify([document.querySelector('[data-testid=settings-crumb] h1').getBoundingClientRect().left, document.querySelector('[data-testid=resources-page] > *').getBoundingClientRect().left])`)));
    expect(Math.abs(edges[0] - edges[1])).toBeLessThanOrEqual(2);
  } finally {
    await page.close();
    await server.close();
  }
}, 60_000);
