import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { connect } from '../../packages/core/src/client.ts';
import { BrowserPage } from './lib/cdp.ts';
import { mintPairing, pairingUrlOf, startCore } from './lib/core.ts';
import { mobileAction } from './lib/mobile.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

test('a text file link opens in the panel at its line at both widths', async () => {
  ensureProductionUi();
  const core = await startCore();
  const client = await connect(core.url, core.token);
  let page: BrowserPage | undefined;
  try {
    await client.call('brain.configure', { path: null, enabled: false, boiteGuide: false });
    const project = await client.call('projects.add', { path: core.dataDir, name: 'Text preview' });
    const account = (await client.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Read the text' });
    writeFileSync(join(core.dataDir, 'notes.txt'), Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: ${i === 10 ? 'a long line '.repeat(80) : 'text to read'}`).join('\n'));
    await client.call('threads.subscribe', { threadId: thread.id });
    const done = client.next('turn.finished');
    await client.call('turns.start', { threadId: thread.id, prompt: 'A paragraph around the preview.\n\n'.repeat(25) + '[Read the notes](notes.txt#L110)' });
    await done;
    page = await BrowserPage.launch({ url: pairingUrlOf(core), windowSize: { width: 1280, height: 900 } });
    await page.waitFor('document.querySelector("[data-testid=status-connection]")?.dataset.state === "ready"');
    await page.click(`[data-thread-id="${thread.id}"]`);
    await page.waitFor(`document.querySelector('a[data-file-path="notes.txt"]')`);
    await page.click('[data-role=assistant] a[data-file-path="notes.txt"]');
    // A file of the project opens in the panel's Files tab at its line, never as a card in the answer.
    await page.waitFor(`document.querySelector('[data-testid=file-text]')?.value.includes('Line 120')`);
    await page.waitFor(`document.querySelector('[data-testid=file-highlight]') !== null`);
    expect(await page.evaluate('document.querySelector("[data-testid=chat-file]")')).toBeNull();
    for (const narrow of [false, true]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: narrow ? 390 : 1280, height: narrow ? 844 : 900, deviceScaleFactor: 1, mobile: narrow });
      await page.settleAnimations();
      expect(await page.evaluate('document.querySelector("[data-testid=file-panel]") !== null')).toBe(true);
      await page.screenshot(join(import.meta.dir, '.artifacts', `text-link-panel-${narrow ? 'phone' : 'desktop'}.png`));
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    }
    expect(page.errors()).toEqual([]);
  } finally { await page?.close(); client.close(); await core.stop(); }
}, 90_000);

test('live output after published files stays at the bottom on desktop and paired phone', async () => {
  ensureProductionUi();
  const core = await startCore();
  const client = await connect(core.url, core.token);
  let page: BrowserPage | undefined;
  try {
    await client.call('brain.configure', { path: null, enabled: false, boiteGuide: false });
    const project = await client.call('projects.add', { path: core.dataDir, name: 'Deliverables' });
    const account = (await client.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
    writeFileSync(join(core.dataDir, 'report.txt'), 'Report ready');
    for (const mobile of [false, true]) {
      const thread = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, permissionMode: 'default', title: 'Continue after the report' });
      page = await BrowserPage.launch({ url: mobile ? await mintPairing(core) : pairingUrlOf(core), windowSize: { width: 1280, height: 900 } });
      if (mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.waitFor('document.querySelector("[data-testid=status-connection]")?.dataset.state === "ready"');
      if (mobile) await mobileAction(page, 'mobile-conversations');
      await page.click(mobile ? `[data-testid="mobile-thread-${thread.id}"]` : `[data-thread-id="${thread.id}"]`);
      await client.call('turns.start', { threadId: thread.id, prompt: 'Report prepared.\n\n'.repeat(12) + '[permission][tool]Checking the next change.\n\n[permission]' });
      await page.waitFor('document.querySelector("[data-testid=permission-card]")');
      await client.call('artifacts.publish', { threadId: thread.id, path: 'report.txt' });
      const file = await client.call('artifacts.publish', { threadId: thread.id, path: 'report.txt' });
      await page.waitFor('document.querySelectorAll("[data-testid=chat-file]").length === 2');
      // The reader follows the delivered files, rather than holding the initial prompt at the top.
      await page.evaluate(`(() => {
        const box = document.querySelector('[data-testid=timeline]');
        box.dispatchEvent(new WheelEvent('wheel', { deltaY: -250, bubbles: true }));
        box.scrollTop -= 250;
      })()`);
      await page.waitFor('document.querySelector("[data-testid=jump-to-latest]")');
      await page.click('[data-testid=jump-to-latest]');
      await page.waitFor(`(() => { const box = document.querySelector('[data-testid=timeline]'); return !document.querySelector('[data-testid=jump-to-latest]') && box.scrollHeight - box.scrollTop - box.clientHeight <= 1; })()`);
      const [permission] = await client.call('permissions.list', { threadId: thread.id });
      await client.call('permissions.answer', { requestId: permission!.id, decision: 'allow' });
      await page.waitFor('Array.from(document.querySelectorAll("[data-testid=message] [data-testid=text-part]")).some(part => part.textContent.includes("Checking the next change."))');
      const snapshot = await client.call('threads.get', { threadId: thread.id });
      const continued = snapshot.messages.at(-1)!;
      expect(continued.id).not.toBe(file.id);
      expect(snapshot.messages.at(-2)?.id).toBe(file.id);
      expect(snapshot.turns).toHaveLength(1);
      expect(snapshot.turns[0]?.status).toBe('running');
      expect(snapshot.messages.filter(message => message.role === 'user')).toHaveLength(1);
      const visibility = `(() => {
        const messages = Array.from(document.querySelectorAll('[data-testid=message]'));
        const last = messages.at(-1);
        const previous = messages.at(-2);
        const paragraph = Array.from(last.querySelectorAll('[data-testid=paragraph]')).find(part => part.textContent.includes('Checking the next change.'));
        if (!previous.querySelector('[data-testid=chat-file]') || !paragraph) return false;
        const rect = paragraph.getBoundingClientRect();
        const viewport = document.querySelector('[data-testid=timeline]').getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      })()`;
      await page.waitFor(visibility).catch(async error => {
        console.error(await page!.evaluate(`(() => { const box = document.querySelector('[data-testid=timeline]'); return JSON.stringify({ top: box.scrollTop, height: box.clientHeight, total: box.scrollHeight, state: box.dataset }); })()`));
        throw error;
      });
      expect(await page.evaluate<boolean>(visibility)).toBe(true);
      await page.waitFor('!document.querySelector("[data-testid=jump-to-latest]")').catch(async error => {
        console.error(await page!.evaluate(`(() => { const box = document.querySelector('[data-testid=timeline]'); return JSON.stringify({ top: box.scrollTop, height: box.clientHeight, total: box.scrollHeight, state: box.dataset }); })()`));
        await page!.screenshot(join(import.meta.dir, '.artifacts', `artifacts-continued-failure-${mobile ? 'phone' : 'desktop'}.png`));
        throw error;
      });
      await page.settleAnimations();
      await page.screenshot(join(import.meta.dir, '.artifacts', `artifacts-continued-${mobile ? 'phone' : 'desktop'}.png`));
      await page.send('Page.reload', {});
      await page.waitFor('document.querySelector("[data-testid=status-connection]")?.dataset.state === "ready"');
      if (mobile) await mobileAction(page, 'mobile-conversations');
      await page.click(mobile ? `[data-testid="mobile-thread-${thread.id}"]` : `[data-thread-id="${thread.id}"]`);
      await page.waitFor('Array.from(document.querySelectorAll("[data-testid=message]")).at(-1)?.textContent.includes("Checking the next change.")');
      expect(page.errors()).toEqual([]);
      await client.call('turns.stop', { threadId: thread.id });
      await page.close(); page = undefined;
    }
  } finally { await page?.close(); client.close(); await core.stop(); }
}, 90_000);

test('remote file previews load under the shell content security policy', async () => {
  ensureProductionUi();
  const core = await startCore();
  const client = await connect(core.url, core.token);
  let page: BrowserPage | undefined;
  try {
    await client.call('brain.configure', { path: null, enabled: false, boiteGuide: false });
    const project = await client.call('projects.add', { path: core.dataDir, name: 'Remote previews' });
    const account = (await client.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Review the remote capture' });
    const picture = readFileSync(join(import.meta.dir, '../../packages/ui/public/icons/icon-192.png'));
    writeFileSync(join(core.dataDir, 'capture.png'), picture);
    writeFileSync(join(core.dataDir, 'large-picture.png'), Buffer.concat([picture, Buffer.alloc(6 * 1024 * 1024)]));
    const audio = Buffer.alloc(44 + 8000);
    audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
    audio.write('data', 36); audio.writeUInt32LE(8000, 40);
    writeFileSync(join(core.dataDir, 'preview.wav'), audio);
    await client.call('threads.subscribe', { threadId: thread.id });
    const done = client.next('turn.finished');
    await client.call('turns.start', { threadId: thread.id, prompt: 'Open [the capture](capture.png) or [the audio](preview.wav) from this machine.' });
    await done;
    await client.call('artifacts.publish', { threadId: thread.id, path: 'large-picture.png' });
    page = await BrowserPage.launch({ url: pairingUrlOf(core), windowSize: { width: 1280, height: 900 } });
    await page.waitFor('document.querySelector("[data-testid=status-connection]")?.dataset.state === "ready"');
    // A different hostname gives the real core a remote origin without leaving loopback.
    const remote = core.url.replace('127.0.0.1', 'localhost');
    await page.evaluate(`localStorage.removeItem('boite.envs'); localStorage.setItem('boite.theme', 'dark'); localStorage.setItem('boite.core', ${JSON.stringify(JSON.stringify({ url: remote, token: core.token }))})`);
    await page.navigate(core.url);
    await page.waitFor('document.querySelector("[data-testid=status-connection]")?.dataset.state === "ready"');
    const config = JSON.parse(readFileSync(join(import.meta.dir, '../../apps/shell/src-tauri/tauri.conf.json'), 'utf8'));
    await page.evaluate(`(() => {
      window.__policyViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.__policyViolations.push(event.effectiveDirective));
      const policy = document.createElement('meta');
      policy.httpEquiv = 'Content-Security-Policy';
      policy.content = ${JSON.stringify(config.app.security.csp)};
      document.head.append(policy);
    })()`);
    await page.click(`[data-thread-id="${thread.id}"]`);
    await page.click('a[data-file-path="capture.png"]');
    // A picture of the project opens in the viewer, read through the core's ticket route.
    const linked = '[data-testid=image-viewer] img';
    await page.waitFor(`document.querySelector('${linked}')?.naturalWidth > 0`);
    expect(await page.evaluate('window.__policyViolations')).toEqual([]);
    expect(await page.evaluate<number>(`document.querySelector('${linked}').naturalWidth`)).toBe(192);
    const linkedUrl = await page.evaluate<string>(`document.querySelector('${linked}').src`);
    expect(new URL(linkedUrl).origin).toBe(remote);
    expect(Buffer.from(await (await fetch(linkedUrl)).arrayBuffer())).toEqual(picture);
    for (const phone of [false, true]) {
      if (phone) await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.settleAnimations();
      await page.screenshot(join(import.meta.dir, '.artifacts', `remote-preview-${phone ? 'phone' : 'desktop'}.png`));
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    }
    await page.click('[data-testid=image-viewer-close]');
    await page.waitFor('document.querySelector("[data-testid=image-viewer]") === null');
    // A streamed attachment uses the same remote ticket route, including its full-size viewer.
    const large = 'Array.from(document.querySelectorAll("[data-testid=chat-file]")).find(card => card.textContent.includes("large-picture.png"))';
    await page.evaluate(`${large}.scrollIntoView({ block: 'center' })`);
    await page.waitFor(`${large}.querySelector('[data-testid=artifact-copy]')?.naturalWidth === 192`);
    const copyUrl = await page.evaluate<string>(`${large}.querySelector('[data-testid=artifact-copy]').src`);
    expect(copyUrl).toStartWith(`${remote}/file/`);
    await page.evaluate(`${large}.querySelector('[data-testid=artifact-open-original]').click()`);
    const viewerImage = '[data-testid=image-viewer] img';
    await page.waitFor(`document.querySelector('${viewerImage}')?.naturalWidth === 192`);
    const originalUrl = await page.evaluate<string>(`document.querySelector('${viewerImage}').src`);
    expect(originalUrl).toStartWith(`${remote}/file/`);
    expect(originalUrl).not.toBe(copyUrl);
    expect((await (await fetch(originalUrl)).arrayBuffer()).byteLength).toBe(picture.length + 6 * 1024 * 1024);
    await page.click('[data-testid=image-viewer-close]');
    await page.click('a[data-file-path="preview.wav"]');
    await page.waitFor('document.querySelector("[data-testid=file-audio]")?.readyState >= 1');
    expect(await page.evaluate('window.__policyViolations')).toEqual([]);
    expect(page.errors()).toEqual([]);
    // An ordinary remote image still cannot bypass the ticket route.
    const blocked = await page.evaluate<boolean>(`new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(false);
      img.onerror = () => setTimeout(() => resolve(window.__policyViolations.includes('img-src')), 100);
      img.src = ${JSON.stringify(`${remote}/icons/icon-192.png`)};
    })`);
    expect(blocked).toBe(true);
  } finally { await page?.close(); client.close(); await core.stop(); }
}, 90_000);

test('agent deliverables and file links open in chat on desktop and paired phone', async () => {
  const core = await startCore();
  const client = await connect(core.url, core.token);
  let page: BrowserPage | undefined;
  try {
    const projectDir = join(core.dataDir, '.boite', 'worktrees', 'handoff');
    mkdirSync(projectDir, { recursive: true });
    const project = await client.call('projects.add', { path: projectDir, name: 'Deliverables' });
    const account = (await client.call('accounts.list', {})).find(a => a.providerId === 'echo')!;
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Project handoff' });
    writeFileSync(join(projectDir, 'notes.txt'), 'Ready for review.\nTwo proposals and annotated previews.');
    const picturePath = join(projectDir, 'tests', 'e2e', '.artifacts', 'preview.png').replaceAll('\\', '/');
    mkdirSync(join(projectDir, 'tests', 'e2e', '.artifacts'), { recursive: true });
    writeFileSync(picturePath, readFileSync(join(import.meta.dir, '../../packages/ui/public/icons/icon-192.png')));
    const largePicturePath = join(projectDir, 'large-picture.png');
    writeFileSync(largePicturePath, Buffer.concat([readFileSync(picturePath), Buffer.alloc(6 * 1024 * 1024)]));
    const objects = [
      '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 300]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
      '<</Length 44>>\nstream\nBT /F1 24 Tf 40 230 Td (Project handoff) Tj ET\nendstream',
      '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
    ];
    let document = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) { offsets.push(document.length); document += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
    const xref = document.length;
    document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(at => `${String(at).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
    const pdf = Buffer.from(document);
    writeFileSync(join(projectDir, 'handoff.pdf'), pdf);
    await client.call('threads.subscribe', { threadId: thread.id });
    const done = client.next('turn.finished');
    const notesPath = join(projectDir, 'notes.txt').replaceAll('\\', '/');
    const notesLink = process.platform === 'win32' ? `/${notesPath}` : notesPath;
    const pictureLink = process.platform === 'win32' ? `/${picturePath}` : picturePath;
    await client.call('turns.start', { threadId: thread.id, prompt: `Your deliverable is attached below. Read [project notes](<${notesLink}:2>), [the capture](<${pictureLink}>), [the PDF](handoff.pdf), or https://example.com/review.` });
    await done;
    await client.call('artifacts.publish', { threadId: thread.id, path: 'handoff.pdf' });
    await client.call('artifacts.publish', { threadId: thread.id, path: 'tests/e2e/.artifacts/preview.png' });
    await client.call('artifacts.publish', { threadId: thread.id, path: 'large-picture.png' });
    for (const mobile of [false, true]) {
      page = await BrowserPage.launch({ url: mobile ? await mintPairing(core) : pairingUrlOf(core) });
      await page.waitFor('document.querySelector("[data-testid=status-connection]")?.dataset.state === "ready"');
      await page.click(`[data-thread-id="${thread.id}"]`);
      await page.waitFor('document.querySelector("[data-testid=artifact-download]")');
      if (mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      expect(await page.evaluate('document.querySelector("[data-testid=artifact-download]").download')).toBe('handoff.pdf');
      const downloaded = await page.evaluate<string>('fetch(document.querySelector("[data-testid=artifact-download]").href).then(r => r.text())');
      expect(downloaded).toBe(pdf.toString());
      expect(await page.evaluate(`document.querySelector('[data-testid=text-part] a[href="https://example.com/review"]') !== null`)).toBe(true);
      // Published images are already visible; their preview needs no extra click.
      await page.waitFor('document.querySelector("[data-testid=artifact-copy]")?.naturalWidth === 192');
      const largeCard = 'Array.from(document.querySelectorAll("[data-testid=chat-file]")).find(card => card.textContent.includes("large-picture.png"))';
      await page.waitFor(`${largeCard}?.querySelector('[data-testid=artifact-copy]')?.naturalWidth === 192`);
      // An attached picture opens full size from its name, over the whole window.
      await page.evaluate('Array.from(document.querySelectorAll("[data-testid=artifact-launch]")).find(b => b.textContent.includes("preview.png")).click()');
      await page.waitFor('document.querySelector("[data-testid=image-viewer] img")?.naturalWidth === 192');
      await page.settleAnimations();
      await page.screenshot(join(import.meta.dir, '.artifacts', `artifacts-viewer-${mobile ? 'phone' : 'desktop'}.png`));
      await page.click('[data-testid=image-viewer-close]');
      await page.waitFor('document.querySelector("[data-testid=image-viewer]") === null');
      // Read the link above the attachments before opening its lazy preview.
      await page.evaluate(`(() => {
        const box = document.querySelector('[data-testid=timeline]');
        box.dispatchEvent(new WheelEvent('wheel', { deltaY: -250, bubbles: true }));
        document.querySelector('a[data-file-path=' + ${JSON.stringify(JSON.stringify(notesPath))} + ']').scrollIntoView({ block: 'center' });
      })()`);
      await page.click(`a[data-file-path=${JSON.stringify(notesPath)}]`);
      // The project's notes open in the panel, on a paired phone too: reading a project file is a device's right.
      const notesShown = mobile ? 'document.querySelector("[data-testid=file-lines]")?.textContent.includes("Ready for review.")' : 'document.querySelector("[data-testid=file-text]")?.value.includes("Ready for review.")';
      await page.waitFor(notesShown);
      await page.settleAnimations();
      await page.screenshot(join(import.meta.dir, '.artifacts', `artifacts-${mobile ? 'phone' : 'desktop'}.png`));
      if (!mobile) {
        await page.click('[data-testid=surface-close], [data-testid=panel-close]').catch(() => {});
        await page.click(`a[data-file-path=${JSON.stringify(picturePath)}]`);
        // The linked picture opens in the viewer, at its own size.
        await page.waitFor('document.querySelector("[data-testid=image-viewer] img")?.naturalWidth === 192');
        await page.settleAnimations();
        await page.screenshot(join(import.meta.dir, '.artifacts', 'artifacts-image-desktop.png'));
        await page.click('[data-testid=image-viewer-close]');
        await page.waitFor('document.querySelector("[data-testid=image-viewer]") === null');
        await page.evaluate('Array.from(document.querySelectorAll("[data-testid=chat-file]")).find(card => card.textContent.includes("handoff.pdf")).querySelector("[data-testid=artifact-preview]").click()');
        await page.waitFor('document.querySelector("[data-testid=artifact-content] iframe")');
        // Chromium's PDF viewer paints asynchronously after the frame has loaded.
        await Bun.sleep(1500);
        await page.screenshot(join(import.meta.dir, '.artifacts', 'artifacts-pdf-desktop.png'));
      }
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      await page.close(); page = undefined;
    }
  } finally { await page?.close(); client.close(); await core.stop(); }
}, 90_000);
