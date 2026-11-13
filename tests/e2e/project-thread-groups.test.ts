import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { openProjectFilter, showThreadView } from './lib/views.ts';
import { mobileAction } from './lib/mobile.ts';
import { startUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let port: number;
const id = (value: string) => `[data-testid="${value}"]`;
/** Page-side: the key the project filter gives a project of the second machine, Builder (lib/project-view.svelte.ts projectKey). */
const builderKey = (projectId: string) => `(() => { const machine = globalThis.__boiteTest.workspace.machines[1], core = machine.store.core;
  return JSON.stringify([core?.hostname ? [core.hostname, core.dataDir, core.channel] : machine.id, ${JSON.stringify(projectId)}]); })()`;
/** Page-side helper prepended to a setup script: answers a fixture thread's pending question by skipping it. */
const skipQuestion = `async function skipQuestion(store, threadId) {
  const [question] = await store.client.call('questions.list', {threadId});
  if (question) await store.client.call('questions.skip', {threadId, questionId: question.id});
  while (store.pendingQuestions.some(q => q.threadId === threadId)) await new Promise(r => setTimeout(r, 20));
};
`;
beforeAll(async () => { port = await freePort(); server = await startUi(port); }, 60_000);
afterAll(async () => { await server?.close(); }, 30_000);

for (const width of [1280, 390]) {
  test(`visibility options work in both views and preserve manual archives at ${width}px`, async () => {
    const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1`, windowSize: { width, height: width < 720 ? 844 : 900 } });
    try {
      await page.waitFor('globalThis.__boiteTest?.workspace.machines.length === 2');
      const { main, empty, merged } = await page.evaluate<{ main: string; empty: string; merged: string }>(`${skipQuestion}(async () => {
        const machine = globalThis.__boiteTest.workspace.machines[0], store = machine.store;
        await store.open('t-trace');
        // The fixture's question would make t-scheduler need the user: a row that asks is never folded as work.
        await skipQuestion(store, 't-scheduler');
        store.threads = store.threads.map(t => t.id === 't-scheduler' ? {...t, status:'running', pinned:false, unread:false} : t);
        const empty = await store.client.call('projects.add', {path:'/workspace/quiet', name:'quiet'});
        const thread = await store.client.call('threads.create', {projectId:'p-boite', providerId:'echo', accountId:'a-echo', title:'Merged visibility fixture', worktree:{branch:'boite/visibility-options'}});
        store.client.setMergedPrFixture(thread.id, {repository:'github.com/example/repo', branch:thread.branch, tip:'a'.repeat(40), clean:true, candidates:[{repository:'github.com/example/repo', branch:thread.branch, sha:'a'.repeat(40), number:407, url:'https://github.com/example/repo/pull/407', mergedAt:'2026-10-02T12:00:00Z', fork:false}]});
        await store.client.sweepMergedPrArchives();
        return {main:machine.id, empty:empty.id, merged:thread.id};
      })()`);
      if (width < 720) await mobileAction(page, 'mobile-conversations');
      const root = width < 720 ? id('mobile-list') : id('sidebar'), prefix = width < 720 ? 'mobile-' : '';
      const menu = id(`${prefix}grouping-options-menu`);
      const row = (thread: string) => `${root} ${width < 720 ? '.row' : id('thread-row')}[data-machine-id="${main}"][data-thread-id="${thread}"]`;
      const revealProject = (thread: string) => page.waitFor(`(() => {
        document.querySelector('${root} ${id(width < 720 ? 'mobile-project-group' : 'project')}[data-machine-id="${main}"][data-project-id="p-boite"]')?.scrollIntoView({block:'center'});
        return !!document.querySelector('${row(thread)}');
      })()`);
      const option = async (key: string) => {
        if (await page.evaluate(`document.querySelector('${id(`${prefix}grouping-options`)}').getAttribute('aria-expanded') !== 'true'`)) await page.click(id(`${prefix}grouping-options`));
        const selector = `${menu} [data-value=${key}]`;
        await page.waitFor(`document.querySelector('${selector}')`);
        const checked = await page.evaluate(`document.querySelector('${selector}').getAttribute('aria-checked')`);
        await page.click(selector);
        await page.waitFor(`document.querySelector('${selector}')?.getAttribute('aria-checked') === '${checked === 'true' ? 'false' : 'true'}'`);
        expect(await page.evaluate(`document.querySelector('${id(`${prefix}grouping-options`)}').getAttribute('aria-expanded')`)).toBe('true');
      };
      const shot = async (state: string) => {
        await page.settleAnimations();
        await page.screenshot(join(import.meta.dir, '.artifacts', `visibility-${state}-${width}.png`));
      };
      await showThreadView(page, 'projects', prefix);
      await revealProject('t-scheduler');
      await option('working');
      await page.waitFor(`!document.querySelector('${row('t-scheduler')}')`);
      await showThreadView(page, 'recent', prefix);
      await page.waitFor(`document.querySelector('${root} ${id('recent-working-toggle')}')`);
      expect(await page.evaluate(`!!document.querySelector('${row('t-scheduler')}')`)).toBe(false);
      await option('working');
      await page.waitFor(`document.querySelector('${row('t-scheduler')}')`);
      await showThreadView(page, 'projects', prefix);
      await revealProject('t-scheduler');
      await option('other');
      await page.waitFor(`!document.querySelector('${root} ${id('project-shelf-toggle')}') && document.querySelector('${root} [data-project-id="${empty}"]')`);
      if (width < 720) {
        // A project's own switches stay on the desktop: the phone's panel holds the view and the groups.
        expect(await page.evaluate(`document.querySelector('${menu} [data-value=merged], ${menu} [data-value="order:manual"]') === null`)).toBe(true);
        await shot('projects-visible');
      } else {
        await option('merged');
        await revealProject(merged);
        expect(await page.evaluate(`globalThis.__boiteTest.workspace.machines[0].store.client.call('threads.get', {threadId:'t-parser'}).then(t=>t.archived)`)).toBe(true);
        await shot('projects-visible');
        await showThreadView(page, 'recent', prefix);
        await page.waitFor(`document.querySelector('${row(merged)}')`);
        await option('merged');
        // A finished turn keeps the agent's prompt cache warm; then a badge detects the merge before the fallback sweep runs.
        await page.evaluate(`(async () => {
          const client = globalThis.__boiteTest.workspace.machines[0].store.client, threadId = ${JSON.stringify(merged)};
          const turn = await client.call('turns.start', {threadId, prompt:'Finish the visibility options.'});
          while ((await client.call('threads.get', {threadId})).turns.find(r => r.id === turn.id)?.status !== 'done') await new Promise(r => setTimeout(r, 20));
          await client.call('threads.pullRequest', {threadId});
        })()`);
        expect(await page.evaluate('globalThis.__boiteTest.workspace.machines[0].store.client.sweepMergedPrArchives()')).toBe(0);
        // The agent was asked once, nothing was put away: the row stays.
        expect(await page.evaluate(`globalThis.__boiteTest.workspace.machines[0].store.client.call('threads.get', {threadId:${JSON.stringify(merged)}}).then(t => ({archived:t.archived, reason:t.archiveReason?.type ?? null, asked:t.turns.filter(turn => turn.execution?.operation === 'pull-request').length}))`)).toEqual({archived:false, reason:null, asked:1});
        await page.waitFor(`document.querySelector('${row(merged)}')`);
        await openProjectFilter(page, prefix);
        await page.evaluate(`Array.from(document.querySelectorAll('${id(`${prefix}project-filter-menu`)} [data-value]')).find(e => e.dataset.value === ${builderKey('p-boite')}).click()`);
        await option('merged');
        expect(await page.evaluate('globalThis.__boiteTest.workspace.machines.map(m => m.store.projects.find(p => p.id === "p-boite").autoArchiveMergedPr)')).toEqual([true, false]);
      }
      await page.waitFor(`document.querySelector('${menu} [role=switch]')`);
      await shot('recent-options');
      // Each switch row draws one knob, the shared \`.switch\` from app.css, not a second of its own.
      expect(await page.evaluate(`[...document.querySelectorAll('${menu} [role=switch]')].every(sw => { const knobs = sw.querySelectorAll('.switch'); return knobs.length === 1 && knobs[0].childElementCount === 0 && getComputedStyle(knobs[0], '::after').content !== 'none'; })`)).toBe(true);
      expect(await page.evaluate(`(() => { const r=document.querySelector('${menu}').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`)).toBe(true);
      await page.reload();
      await page.waitFor('globalThis.__boiteTest?.workspace.machines.length === 2');
      expect(await page.evaluate(`JSON.parse(localStorage.getItem('boite.recent.v1'))`)).toEqual({groupWorking:false, groupOtherProjects:false});
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      expect(page.errors()).toEqual([]);
      console.log(`VISIBILITY_OPTIONS_OK width=${width} projects=ok recent=ok manual-archives=preserved owning-machine=ok persistence=ok`);
    } catch (error) {
      await page.screenshot(join(import.meta.dir, '.artifacts', `visibility-failure-${width}.png`)).catch(() => {});
      throw error;
    } finally { await page.close(); }
  }, 60_000);

  test(`project counters fold work and completed history on the owning machine at ${width}px`, async () => {
    const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1`, windowSize: { width, height: width < 720 ? 844 : 900 } });
    try {
      await page.waitFor('globalThis.__boiteTest?.workspace.machines.length === 2');
      const [main, remote, empty, busy] = await page.evaluate<[string, string, string, string]>(`${skipQuestion}(async () => {
        const [first, second] = globalThis.__boiteTest.workspace.machines;
        // Archive in the background so the finished project has no active draft.
        await first.store.open('t-trace');
        await first.store.archive('t-descriptors', true);
        // The fixture's question would make t-scheduler need the user: a row that asks is never folded as work.
        await skipQuestion(first.store, 't-scheduler');
        const empty = await first.store.client.call('projects.add', {path:'/workspace/quiet', name:'quiet'});
        const busy = await first.store.client.call('projects.add', {path:'/workspace/building', name:'building'});
        first.store.threads = first.store.threads.map(t => t.id === 't-scheduler' ? {...t, status:'running', pinned:false, unread:false} : t);
        first.store.threads = [...first.store.threads, {...first.store.threads.find(t => t.id === 't-scheduler'), id:'t-building', projectId:busy.id}];
        return [first.id, second.id, empty.id, busy.id];
      })()`);
      if (width < 720) await mobileAction(page, 'mobile-conversations');
      await showThreadView(page, 'projects', width < 720 ? 'mobile-' : '');
      await page.click(id(width < 720 ? 'mobile-grouping-options' : 'grouping-options'));
      await page.click(`${id(width < 720 ? 'mobile-grouping-options-menu' : 'grouping-options-menu')} [data-value=working]`);
      await page.click(id(width < 720 ? 'mobile-grouping-options' : 'grouping-options'));
      const root = width < 720 ? id('mobile-list') : id('sidebar');
      const project = (machine: string, projectId: string) => `${root} ${id(width < 720 ? 'mobile-project-group' : 'project')}[data-machine-id="${machine}"][data-project-id="${projectId}"]`;
      const first = project(main, 'p-boite'), second = project(remote, 'p-boite');
      const row = (project: string, thread: string) => `${project} ${width < 720 ? '.row' : id('thread-row')}[data-thread-id="${thread}"]`;
      // The scroll lands before the press: its `scroll` event fires on the next frame and a menu that opened first
      // closes on it (ContextMenu.svelte), and a phone list may still snap. The press waits until two frames leave the target in place.
      const click = async (selector: string) => {
        await page.evaluate(`(async () => {
          const target = document.querySelector(${JSON.stringify(selector)});
          target.scrollIntoView({ block: 'center' });
          const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
          let last = NaN;
          for (let frames = 0; frames < 60; frames++) {
            await frame();
            const top = target.getBoundingClientRect().top;
            if (top === last) return;
            last = top;
          }
        })()`);
        await page.click(selector);
      };
      const optionsName = width < 720 ? 'mobile-grouping-options' : 'grouping-options';
      const options = id(optionsName), optionsMenu = id(`${optionsName}-menu`);
      /** The display menu's Done filter, the one place a card lists its done threads. */
      const showDone = async (on: boolean) => {
        await page.click(options);
        const done = `${optionsMenu} [role=switch][data-value=done]`;
        await page.waitFor(`document.querySelector('${done}')`);
        if (await page.evaluate(`document.querySelector('${done}').getAttribute('aria-checked') !== '${on}'`)) await page.click(done);
        await page.waitFor(`document.querySelector('${done}')?.getAttribute('aria-checked') === '${on}'`);
        await page.click(options);
        await page.waitFor(`!document.querySelector('${optionsMenu}')`);
      };
      /** The count beside Archived in a card's menu, where a card's archived threads live (lib/project-menu.ts); null without one. */
      const archivedHint = async (card: string) => {
        await click(`${card} ${id(width < 720 ? 'mobile-project-menu' : 'project-menu')}`);
        const entry = `${id('context-menu')} ${id('project-archived-toggle')}`;
        await page.waitFor(`document.querySelector('${entry}')`);
        const hint = await page.evaluate<string | null>(`document.querySelector('${entry} .hint')?.textContent ?? null`);
        await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
        await page.waitFor(`!document.querySelector('${id('context-menu')}')`);
        return hint;
      };
      /** A card's head, where its counters stand when the card is folded. */
      const head = (card: string) => `${card} ${width < 720 ? '.project-heading' : '.head'}`;
      /** Folds the card of a project whose only rows work, unfolds it from its head's working counter onto that list, then closes the list again. */
      const counterUnfolds = async (card: string, projectId: string) => {
        const toggle = `${head(card)} ${id('project-working-toggle')}`;
        const expanded = `document.querySelector('${card} ${id(width < 720 ? 'mobile-project-toggle' : 'project-row')}').getAttribute('aria-expanded')`;
        await page.evaluate(`globalThis.__boiteTest.workspace.machines[0].store.toggleProject(${JSON.stringify(projectId)})`);
        await page.waitFor(`${expanded} === 'false' && document.querySelector('${toggle}')?.dataset.count === '1'`);
        await click(toggle);
        await page.waitFor(`${expanded} === 'true'`);
        expect(await page.evaluate(`document.querySelector('${toggle}').getAttribute('aria-expanded')`)).toBe('true');
        await page.waitFor(`document.querySelector('${card} ${width < 720 ? '.row' : id('thread-row')}[data-thread-id="t-building"]')`);
        await click(toggle);
        await page.waitFor(`document.querySelector('${toggle}').getAttribute('aria-expanded') === 'false'`);
      };
      const shot = async (name: string) => {
        await page.settleAnimations();
        await page.screenshot(join(import.meta.dir, '.artifacts', `project-groups-${name}-${width}.png`));
      };
      await page.waitFor(`document.querySelector('${first}')`);
      expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(project(main, busy))})`)).toBe(true);
      await page.waitFor(`document.querySelectorAll('${root} ${id(width < 720 ? 'mobile-project-group' : 'project')}').length === 4`);
      expect(await page.evaluate(`document.querySelector(${JSON.stringify(project(main, 'p-notes'))}) === null && document.querySelector(${JSON.stringify(project(main, empty))}) === null`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('${root} ${id('project-shelf-toggle')}').getAttribute('aria-expanded')`)).toBe('false');
      expect(await page.evaluate(`document.querySelector('${first} ${id('project-working-toggle')}').dataset.count`)).toBe('1');
      // t-parser was archived by hand: it waits under Archived in the card's menu, not Done, and an empty Done draws no list even with the filter on.
      await showDone(true);
      expect(await page.evaluate(`document.querySelector('${first} ${id('project-done')}').hidden`)).toBe(true);
      await showDone(false);
      expect(await archivedHint(first)).toBe('1');
      expect(await page.evaluate(`!!document.querySelector('${row(first, 't-bench')}') && !document.querySelector('${row(first, 't-scheduler')}')`)).toBe(true);
      await page.evaluate(`document.querySelector(${JSON.stringify(project(main, busy))}).scrollIntoView({block:'center'})`);
      await shot('folded');

      // A project stays visible while its only conversation starts or finishes work.
      const building = project(main, busy);
      await page.evaluate(`(() => { const store = globalThis.__boiteTest.workspace.machines[0].store; store.threads = store.threads.map(t => t.id === 't-building' ? {...t, status:'idle', unread:true} : t); })()`);
      await page.waitFor(`document.querySelector('${building}:not(.inactive)')`);
      await page.waitFor(`(() => { document.querySelector('${building}')?.scrollIntoView({block:'center'}); return !!document.querySelector('${row(building, 't-building')}'); })()`);
      expect(await page.evaluate(`!!document.querySelector('${row(building, 't-building')}')`)).toBe(true);
      await page.evaluate(`(() => { const store = globalThis.__boiteTest.workspace.machines[0].store; store.threads = store.threads.map(t => t.id === 't-building' ? {...t, status:'running', unread:false} : t); })()`);
      await page.waitFor(`document.querySelector('${building}:not(.inactive)')`);
      expect(await page.evaluate(`document.querySelector('${building} ${id('project-working-toggle')}').dataset.count`)).toBe('1');
      if (width >= 720) {
        // Unfolding a project whose only conversation is working opens its working list with it.
        await click(`${building} ${id('project-row')}`);
        await page.waitFor(`document.querySelector('${building} ${id('project-row')}').getAttribute('aria-expanded') === 'false'`);
        await click(`${building} ${id('project-row')}`);
        await page.waitFor(`document.querySelector('${row(building, 't-building')}')`);
        expect(await page.evaluate(`document.querySelector('${building} ${id('project-working-toggle')}').getAttribute('aria-expanded')`)).toBe('true');
        await click(`${building} ${id('project-working-toggle')}`);
        await page.waitFor(`!document.querySelector('${row(building, 't-building')}')`);
      }

      await click(`${first} ${id('project-working-toggle')}`);
      await page.waitFor(`document.querySelector('${row(first, 't-scheduler')}')`);
      expect(await page.evaluate(`document.querySelector('${first} ${id('project-done')}').hidden`)).toBe(true);
      // The archived thread stays in the menu, off the card; the other machine's card counts its own archive.
      expect(await archivedHint(first)).toBe('1');
      expect(await page.evaluate(`document.querySelector('${first} ${id('project-archived')}').hidden && !document.querySelector('${first} ${id('project-done')} ${id('done-thread')}')`)).toBe(true);
      expect(await archivedHint(second)).toBe(await page.evaluate<string | null>(`(() => { const p = globalThis.__boiteTest.workspace.machines[1].store.projects.find(p => p.id === 'p-boite'), n = (p?.archivedThreads ?? 0) - (p?.doneThreads ?? 0); return n > 0 ? String(n) : null; })()`));
      expect(await page.evaluate(`!!document.querySelector('${row(first, 't-scheduler')}')`)).toBe(true);
      await shot('expanded');
      if (width < 720) {
        // The phone shares the desktop's fold: folded there, it is folded here, and its header unfolds it onto the lists it had open.
        await page.evaluate(`globalThis.__boiteTest.workspace.machines[0].store.toggleProject('p-boite')`);
        await page.waitFor(`document.querySelector('${first} ${id('mobile-project-toggle')}').getAttribute('aria-expanded') === 'false'`);
        // Folded, the card says what it holds: a thread needs the user, so its count stands in the head and the working fold's toggle stays in the card.
        expect(await page.evaluate(`!!document.querySelector('${head(first)} ${id('project-waiting-count')}') && !document.querySelector('${head(first)} ${id('project-working-toggle')}')`)).toBe(true);
        await click(`${first} ${id('mobile-project-toggle')}`);
        await page.waitFor(`document.querySelector('${first} ${id('mobile-project-toggle')}').getAttribute('aria-expanded') === 'true'`);
        expect(await page.evaluate(`globalThis.__boiteTest.workspace.machines[0].store.isCollapsed('p-boite')`)).toBe(false);
        expect(await page.evaluate(`document.querySelector('${first} ${id('project-working-toggle')}').getAttribute('aria-expanded')`)).toBe('true');
        expect(await page.evaluate(`document.querySelector('${first} ${id('project-archived')}').hidden`)).toBe(true);
        // The unfold grows the card below its header: its working list can land under the screen, where the list draws no row.
        await page.waitFor(`(() => { document.querySelector('${first} ${id('project-working')}')?.scrollIntoView({block:'center'}); return !!document.querySelector('${row(first, 't-scheduler')}'); })()`);
        // A folded card whose only rows work counts them in its head, and that counter unfolds it onto its list, as the sidebar's does.
        await counterUnfolds(project(main, busy), busy);
      }
      const trace = row(first, 't-trace');
      if (width < 720) {
        await click(`${trace} ${id('mobile-thread-menu-t-trace')}`);
        await page.click(`${id('mobile-thread-menu-t-trace-menu')} [data-value=archive]`);
      } else await click(`${trace} ~ ${id('thread-done')}`);
      // Mark done lands in Done; a plain archive lands in Archived.
      await page.waitFor(`!document.querySelector('${trace}')`);
      if (width < 720) expect(await archivedHint(first)).toBe('2');
      else {
        // Done was empty, so its list appears only now, under the Done filter.
        await showDone(true);
        await page.waitFor(`document.querySelector('${first} ${id('project-done')} ${id('done-thread')}[data-thread-id="t-trace"]')`);
        expect(await archivedHint(first)).toBe('1');
      }
      expect(await page.evaluate(`!!document.querySelector('${row(project(remote, 'p-boite'), 't-trace')}')`)).toBe(true);
      await click(`${first} ${id('project-working-toggle')}`);
      expect(await page.evaluate(`!document.querySelector('${row(first, 't-scheduler')}') && ${width < 720} === !document.querySelector('${first} ${id('done-thread')}')`)).toBe(true);
      if (width >= 720) {
        await showDone(false);
        // With the Done switch off, the card's head still counts its done thread and opens its done list, then folds it.
        await page.waitFor(`document.querySelector('${first} ${id('project-done-toggle')}')?.dataset.count === '1' && document.querySelector('${first} ${id('project-done')}').hidden`);
        await click(`${first} ${id('project-done-toggle')}`);
        await page.waitFor(`!!document.querySelector('${first} ${id('project-done')} ${id('done-thread')}[data-thread-id="t-trace"]')`);
        await click(`${first} ${id('project-done-toggle')}`);
        await page.waitFor(`document.querySelector('${first} ${id('project-done')}').hidden`);
      }
      await page.evaluate(`(() => { const store = globalThis.__boiteTest.workspace.machines[0].store; store.threads = store.threads.map(t => t.id === 't-scheduler' ? {...t, pinned:true} : t); })()`);
      await page.waitFor(`document.querySelector('${row(first, 't-scheduler')}')`);
      await click(`${first} ${id('project-working-toggle')}`);
      expect(await page.evaluate(`document.querySelectorAll('${row(first, 't-scheduler')}').length`)).toBe(1);
      await click(`${first} ${id('project-working-toggle')}`);
      expect(await page.evaluate(`!!document.querySelector('${row(first, 't-scheduler')}')`)).toBe(true);
      await page.evaluate(`(() => { const store = globalThis.__boiteTest.workspace.machines[0].store; store.threads = store.threads.map(t => t.id === 't-scheduler' ? {...t, pinned:false} : t); })()`);
      await page.waitFor(`!document.querySelector('${row(first, 't-scheduler')}')`);

      if (width < 720) {
        // The magnifier opens the search field in the title's place.
        await page.click(id('mobile-search-open'));
        await page.type(id('mobile-search'), 'scheduler');
        await page.waitFor(`document.querySelector('${row(first, 't-scheduler')}')`);
        expect(await page.evaluate(`document.querySelector('${row(first, 't-bench')}') === null`)).toBe(true);
        await page.type(id('mobile-search'), '');
        await page.waitFor(`document.querySelector('${root} ${id('project-shelf-toggle')}')`);
      } else {
        // A folded card's counter unfolds it onto its list.
        await counterUnfolds(project(main, busy), busy);
      }

      await click(`${root} ${id('project-shelf-toggle')}`);
      // The fold lists idle projects as compact rows, never as project sections.
      const idleRow = (projectId: string) => `${root} ${id('project-shelf')} ${id('idle-project')}[data-machine-id="${main}"][data-project-id="${projectId}"]`;
      // Its rows load on their own, at the latest when it opens.
      await page.waitFor(`document.querySelector('${idleRow(empty)}')`);
      expect(await page.evaluate(`!!document.querySelector('${building}:not(.inactive)') && !document.querySelector('${idleRow(busy)}') && !!document.querySelector('${idleRow(empty)}')`)).toBe(true);
      expect(await page.evaluate(`!document.querySelector('${root} ${id('project-shelf')} ${id(width < 720 ? 'mobile-project-group' : 'project')}')`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('${building} ${id('project-working-toggle')}').dataset.count`)).toBe('1');
      await click(`${building} ${id('project-working-toggle')}`);
      // The opened fold may still be scrolling to its header: bring the project at work on top back into view.
      await page.waitFor(`(() => { document.querySelector('${building}')?.scrollIntoView({block:'center'}); return !!document.querySelector('${row(building, 't-building')}'); })()`);
      expect(await page.evaluate(`document.querySelector('${building} ${id('project-done')}').hidden`)).toBe(true);
      // Queued and background work also keep the project at work on top, out of the fold of idle projects.
      for (const [index, renderedState] of ['queued', 'monitoring', 'background', 'working'].entries()) {
        await page.evaluate(`(() => {
          const states = [
            { status: 'queued', backgroundWork: null },
            { status: 'idle', backgroundWork: { kinds: ['monitor'], since: 1 } },
            { status: 'idle', backgroundWork: { kinds: ['shell'], since: 1 } },
            { status: 'running', backgroundWork: null }
          ];
          const store = globalThis.__boiteTest.workspace.machines[0].store;
          store.threads = store.threads.map(t => t.id === 't-building' ? {...t, ...states[${index}]} : t);
        })()`);
        // The section sits above the fold the test opened: its rows draw once it scrolls back into view.
        await page.waitFor(`(() => {
          document.querySelector('${building}')?.scrollIntoView({block:'center'});
          return !!document.querySelector('${row(building, 't-building')} ${id('thread-state')}[data-state="${renderedState}"]');
        })()`);
        expect(await page.evaluate(`!document.querySelector('${idleRow(busy)}') && !!document.querySelector('${root} ${id('working-projects')}')?.contains(document.querySelector('${building}'))`)).toBe(true);
      }
      // An idle project keeps its done history one click away, under its row.
      const finished = idleRow('p-notes');
      await page.waitFor(`document.querySelector('${finished}')`);
      await click(`${finished} ${id('project-done-toggle')}`);
      // Open, the row's done pill keeps its fill inside the touch target: no opaque edge bars above and below it on a phone.
      if (width < 720) expect(await page.evaluate(`getComputedStyle(document.querySelector('${finished} ${id('project-done-toggle')}')).borderTopColor`)).toBe('rgba(0, 0, 0, 0)');
      const done = `${root} ${id('done-thread')}[data-machine-id="${main}"][data-thread-id="t-descriptors"]`;
      const revealDone = () => page.waitFor(`(() => {
        document.querySelector('${finished} ${id('project-done')}')?.scrollIntoView({block:'center'});
        return !!document.querySelector('${done}');
      })()`);
      await revealDone();
      await click(`${done} ${id('done-thread-open')}`);
      await page.waitFor('globalThis.__boiteTest.workspace.active.openThread?.id === "t-descriptors" && globalThis.__boiteTest.workspace.active.openThread.archived === true');
      expect(await page.evaluate(`!document.querySelector('${id('composer-input')}')`)).toBe(true);
      if (width < 720) {
        await page.click(id('mobile-back'));
        await page.waitFor(`document.querySelector('${finished} ${id('project-done')}')`);
        await revealDone();
      }
      await click(`${done} ${id('done-thread-restore')}`);
      await page.waitFor(`document.querySelector('${project(main, 'p-notes')}:not(.inactive)') && !document.querySelector('${finished}')`);
      expect(await page.evaluate(`globalThis.__boiteTest.workspace.machines[0].store.client.call('threads.get', {threadId:'t-descriptors'}).then(t=>t.archived)`)).toBe(false);
      expect(await page.evaluate(`globalThis.__boiteTest.workspace.machines[1].store.client.call('threads.get', {threadId:'t-descriptors'}).then(t=>t.archived)`)).toBe(false);

      // Choosing an idle project starts a draft there, which returns it to the list immediately.
      await click(`${idleRow(empty)} ${id('idle-project-open')}`);
      await page.waitFor(`globalThis.__boiteTest.workspace.machines[0].store.draft?.projectId === ${JSON.stringify(empty)}`);
      if (width < 720) await page.click(id('mobile-back'));
      await page.waitFor(`document.querySelector('${project(main, empty)}:not(.inactive)') && !document.querySelector('${idleRow(empty)}')`);
      expect(await page.evaluate(`document.querySelector('${project(main, empty)} ${id('project-done')}').hidden && document.querySelector('${project(main, empty)} ${id('project-working-toggle')}') === null`)).toBe(true);
      if (width < 720) await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
      else await page.evaluate('globalThis.__boiteTest.workspace.active.setSidebarWidth(208)');
      await shot('narrow');
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      // A name keeps 50 px, or its whole width when shorter: the row's counters and buttons never crush it.
      expect(await page.evaluate(`Array.from(document.querySelectorAll('${root} ${width < 720 ? '.project-heading h2' : '.head .name'}')).every(name => name.getBoundingClientRect().width >= Math.min(50, name.scrollWidth - 1))`)).toBe(true);
      expect(page.errors()).toEqual([]);
    } catch (error) {
      await page.screenshot(join(import.meta.dir, '.artifacts', `project-groups-failure-${width}.png`)).catch(() => {});
      throw error;
    } finally { await page.close(); }
  }, 60_000);
}
