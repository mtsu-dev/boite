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
      `Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`,
    );
    await page.evaluate("document.fonts.ready");
  }
  try {
    await page.click("[data-testid=nav-settings]");
    // Settings opens on its first page: the nav lists every page, no tile grid repeats it.
    await page.waitFor('document.querySelector("[data-testid=settings-tab-general][aria-current=page]") && document.querySelector("nav [data-testid=settings-search]")');
    await settled();
    await page.screenshot("tests/e2e/.artifacts/settings-after.png");
    await page.click("[data-testid=settings-tab-resources]");
    await page.waitFor(
      'document.querySelector("[data-testid=setting-focus-guard]")',
    );
    await settled();
    // Only pages several screens long list their sections: Protection and General fit without them.
    expect(
      await page.evaluate(
        'document.querySelector("[data-testid=settings-tab-resources]").getAttribute("aria-expanded")',
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
    ).toBe("false");
    await page.screenshot("tests/e2e/.artifacts/protection-desktop.png");
    await page.click("[data-testid=setting-mute-agents]");
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-mute-agents]").checked',
    );
    await page.click("[data-testid=setting-reap-orphans]");
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-reap-orphans]").checked',
    );
    await page.click("[data-testid=settings-tab-general]");
    await page.click("[data-testid=settings-tab-resources]");
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-mute-agents]").checked',
    );
    await page.waitFor(
      '!document.querySelector("[data-testid=setting-reap-orphans]").checked',
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

// French names run long ("Machines et mises à jour"): a label once spilled out
// of its box, and the page hugged the left of a wide window.
test("the settings nav keeps every French label inside it, its search opens a setting, and the page centres its column", async () => {
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
    await page.waitFor('document.querySelector("[data-testid=settings-tab-machines]")');
    await page.evaluate("document.fonts.ready");
    for (const width of [1920, 1440, 1100, 900]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const spills = JSON.parse(String(await page.evaluate(`(() => {
        const nav = document.querySelector('.settings nav').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.settings nav [data-testid^=settings-tab-], .settings nav h2')];
        return JSON.stringify(rows.filter(row => {
          const box = row.getBoundingClientRect();
          return row.scrollWidth > row.clientWidth + 1 || box.right > nav.right + 0.5;
        }).map(row => row.dataset.testid ?? row.textContent));
      })()`)));
      expect({ width, spills }).toEqual({ width, spills: [] });
    }
    // Eight entries, a grouped one keeping its pages as tabs; the search finds a single setting by its own word and opens its page.
    expect(await page.evaluate(`[...document.querySelectorAll('.settings nav [data-testid^=settings-tab-]')].map(tab => tab.dataset.testid.slice('settings-tab-'.length)).join('|')`)).toBe("general|appearance|accounts|brain|usage|machines|resources|advanced");
    await page.evaluate(`(() => { const field = document.querySelector('[data-testid=settings-search]'); field.focus(); field.value = 'accent'; field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.waitFor('document.querySelector("[data-testid=settings-search-result]") && !document.querySelector("[data-testid=settings-tab-general]")');
    await page.evaluate(`document.querySelector('[data-testid=settings-search]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await page.waitFor('document.querySelector("[data-testid=settings-tab-appearance][aria-current=page]")');
    expect(await page.evaluate(`document.querySelector('[data-testid=settings-search]').value`)).toBe("");
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
    // A page under the machine bar centres too, and the bar starts where the page does.
    await page.click("[data-testid=settings-tab-resources]");
    await page.waitFor('document.querySelector("[data-testid=settings-machine-bar] [data-testid=settings-machine]") && document.querySelector("[data-testid=resources-page] > *")');
    await centred("[data-testid=resources-page] > *");
    const edges = JSON.parse(String(await page.evaluate(`JSON.stringify([document.querySelector('[data-testid=settings-machine]').getBoundingClientRect().left, document.querySelector('[data-testid=resources-page] > *').getBoundingClientRect().left])`)));
    expect(Math.abs(edges[0] - edges[1])).toBeLessThanOrEqual(2);
  } finally {
    await page.close();
    await server.close();
  }
}, 60_000);
