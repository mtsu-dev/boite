import { afterEach, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settingAnswerText, type AgentContact, type CoordinationPeer, type AgentCreateAsked, type AgentCreated, type MessagePart, type Settings } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { connect } from '../src/client.ts';
import { contactsBotOf } from './contacts-fixture.ts';
import { echoThread, removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';

const cores: TestCore[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
  for (const dir of dirs.splice(0)) await removeDir(dir);
});

/** The message a call was refused with. */
async function thrown(promise: PromiseLike<unknown>): Promise<{ message: string }> {
  try { await promise; } catch (error) { return { message: error instanceof Error ? error.message : String(error) }; }
  return { message: '' };
}

/** A core as an install starts it: the harness leaves the two agent settings as the core stored them. */
async function boot(dataDir?: string): Promise<TestCore> {
  const core = await startTestCore({ agentDefaults: 'boot', ...(dataDir === undefined ? {} : { dataDir }) });
  cores.push(core);
  return core;
}

async function twoProjects(h: TestCore) {
  const owner = await h.connect();
  const { threadId: here, accountId } = await echoThread(h, owner, 'Here');
  const sibling = await owner.call('threads.create', { projectId: h.core.threads.require(here).projectId!, providerId: 'echo', accountId, title: 'Sibling' });
  const path = join(h.dataDir, 'elsewhere'); mkdirSync(path, { recursive: true });
  const project = await owner.call('projects.add', { path, name: 'Elsewhere' });
  const far = await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId, title: 'Far' });
  // A card is drawn under a turn.
  await owner.call('turns.start', { threadId: here, prompt: 'Start.' });
  await waitFor(() => h.core.threads.require(here).status === 'idle' && h.core.journal.listMessages(here).length > 0);
  const address = (threadId: string) => ({ coreId: h.core.coordination.identity().coreId, threadId });
  return { owner, here, sibling: sibling.id, far: far.id, address };
}

test('a new data directory starts closed: mochis are asked for on a card and threads reach their own project', async () => {
  const h = await boot();
  const stored = h.core.journal.getSetting('settings') as Settings;
  expect([stored.agentBotCreation, stored.coordinationReach]).toEqual(['ask', 'project']);
  const { owner, here, sibling, far, address } = await twoProjects(h);
  const coordination = h.core.coordination;

  // Listing, searching, reading and writing stop at the project.
  expect((await coordination.directory(here)).agents.map(agent => agent.threadId)).toEqual([sibling]);
  expect((await coordination.search(here, 'Far')).matches).toEqual([]);
  const read = await thrown(coordination.read(here, address(far)));
  expect(read.message).toContain('coordinationReach is "project"');
  expect(read.message).toContain('boite settings request coordinationReach machine --why');
  const send = await thrown(coordination.send({ threadId: here, to: address(far), text: 'hello', requestId: 'r1' }));
  expect(send.message).toContain('boite settings request coordinationReach machine --why');
  expect((await coordination.send({ threadId: here, to: address(sibling), text: 'hello', requestId: 'r2' })).status).not.toBe('rejected');

  // The key is one an agent may ask about, and the owner's change opens the machine.
  const card = await owner.call('settings.request', { threadId: here, key: 'coordinationReach', value: 'machine', reason: 'Read the release thread' });
  expect(card.setting).toMatchObject({ kind: 'change', key: 'coordinationReach', value: 'machine', previous: 'project', sensitive: false });
  await owner.call('settings.set', { coordinationReach: 'machine' });
  expect((await coordination.directory(here)).agents.map(agent => agent.threadId).sort()).toEqual([sibling, far].sort());
  expect((await coordination.read(here, address(far))).contact.threadId).toBe(far);
  expect((await coordination.send({ threadId: here, to: address(far), text: 'hello', requestId: 'r3' })).to.threadId).toBe(far);
  // A thread's own setting still narrows inside the reach.
  coordination.configure(here, { ...coordination.config(here), remote: false });
  expect((await coordination.directory(here)).agents.map(agent => agent.threadId)).toEqual([sibling]);
  expect((await thrown(coordination.send({ threadId: here, to: address(far), text: 'again', requestId: 'r4' }))).message).toBe('both threads must enable coordination across projects');
});

test('reach machine keeps a thread from trusted machines and names the setting; group lets it through', async () => {
  const h = await boot();
  const { owner, here } = await twoProjects(h);
  await owner.call('settings.set', { coordinationReach: 'machine' });
  const remote = { coreId: 'f'.repeat(64), threadId: 'thr_remote' };
  const refusal = await thrown(h.core.coordination.send({ threadId: here, to: remote, text: 'hello', requestId: 'm1' }));
  expect(refusal.message).toContain('coordinationReach is "machine"');
  expect(refusal.message).toContain('boite settings request coordinationReach group --why');
  expect((await thrown(h.core.coordination.read(here, remote))).message).toContain('boite settings request coordinationReach group --why');
  await owner.call('settings.set', { coordinationReach: 'group' });
  // Past the reach, the existing rule answers: that machine is not trusted.
  expect((await thrown(h.core.coordination.send({ threadId: here, to: remote, text: 'hello', requestId: 'm2' }))).message).toBe('destination machine is not trusted for coordination');
});

test('with ask, agents.create draws a card and creates nothing until the owner approves; declining creates nothing', async () => {
  const h = await boot();
  const { owner, here } = await twoProjects(h);
  const bots = () => h.core.workforce.records.list('profile').map(agent => agent.name);
  const before = bots();
  const part = (questionId: string) => h.core.journal.listMessages(here).flatMap(m => m.parts)
    .find((p): p is Extract<MessagePart, { type: 'question' }> => p.type === 'question' && p.questionId === questionId)!;

  let out = '';
  const code = await runCli(['settings', 'bot', 'create', 'Herald', '--domain', 'News'], { out: s => { out += s; }, err: s => { out += s; }, env: { BOITE_THREAD_ID: here, BOITE_CORE_URL: h.url, BOITE_AGENT_TOKEN: h.core.agents.tokenFor(here) }, cwd: h.dataDir });
  expect(code).toBe(0);
  expect(out).toContain('boite settings request agentBotCreation free --why');
  expect(bots()).toEqual(before);
  const [card] = h.core.threads.listQuestions(here).filter(question => question.setting?.kind === 'bot');
  expect(card!.setting).toMatchObject({ kind: 'bot', bot: { name: 'Herald', domain: 'News', selection: { permissionMode: 'bypassPermissions' } } });
  // The same bot is not asked for twice.
  expect((await thrown(owner.call('agents.create', { threadId: here, name: 'herald' }))).message).toContain('already open');

  const made = await owner.call('agents.create.approve', { threadId: here, questionId: card!.id });
  expect(made.agent.name).toBe('Herald');
  expect(made.agent.selection.permissionMode).toBe('bypassPermissions');
  expect(bots()).toEqual([...before, 'Herald']);
  expect(h.core.threads.listQuestions(here).filter(question => question.setting?.kind === 'bot')).toEqual([]);
  const answer = part(card!.id).answer!;
  expect(settingAnswerText(card!.setting!, answer)).toContain(`approved: the mochi "Herald" exists (${made.agent.id})`);

  const second = await owner.call('agents.create', { threadId: here, name: 'Scout' }) as AgentCreateAsked;
  await owner.call('questions.answer', { threadId: here, questionId: second.questionId, optionIds: ['refuse'] });
  expect(bots()).toEqual([...before, 'Herald']);
  expect(settingAnswerText(second.setting, part(second.questionId).answer!)).toBe('declined: the user did not create the mochi "Scout"; nothing was created');
  expect((await thrown(owner.call('agents.create.approve', { threadId: here, questionId: second.questionId }))).message).toContain('no open mochi card');

  // Free: the bot exists at once, as before the setting.
  await owner.call('settings.set', { agentBotCreation: 'free' });
  expect((await owner.call('agents.create', { threadId: here, name: 'Scout' }) as AgentCreated).agent.name).toBe('Scout');
});

test('a data directory older than the two settings is opened once, and stays as the owner sets it', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-older-')); dirs.push(dataDir);
  // An install of an earlier version: a journal whose settings hold neither key.
  const first = await boot(dataDir);
  first.core.journal.setSetting('settings', { warmProcessMinutes: 5 });
  await first.stop();

  const upgraded = await boot(dataDir);
  expect(upgraded.core.journal.getSetting('settings')).toMatchObject({ warmProcessMinutes: 5, agentBotCreation: 'free', coordinationReach: 'group' });
  const { owner, here, far, address } = await twoProjects(upgraded);
  expect((await upgraded.core.coordination.read(here, address(far))).contact.threadId).toBe(far);
  expect('agent' in await owner.call('agents.create', { threadId: here, name: 'Herald' })).toBe(true);
  await upgraded.stop();

  const again = await boot(dataDir);
  expect(again.core.settings.get()).toMatchObject({ agentBotCreation: 'free', coordinationReach: 'group' });
  again.core.settings.set({ agentBotCreation: 'ask' });
  await again.stop();
  const kept = await boot(dataDir);
  expect(kept.core.settings.get()).toMatchObject({ agentBotCreation: 'ask', coordinationReach: 'group' });
});

test('a new data directory stays closed after a restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-new-')); dirs.push(dataDir);
  await (await boot(dataDir)).stop();
  const second = await boot(dataDir);
  expect(second.core.settings.get()).toMatchObject({ agentBotCreation: 'ask', coordinationReach: 'project' });
});

// Review round 1: who may approve, the core's exceptions at the closed reach, and a reach closed while an answer is in flight.
test('agent cannot approve or open the settings; repeated and archived approvals fail', async () => {
 const h=await boot(), owner=await h.connect(), {threadId}=await echoThread(h,owner);
 await owner.call('turns.start',{threadId,prompt:'hello'});
 await waitFor(()=>h.core.threads.require(threadId).status==='idle');
 const asked=await owner.call('agents.create',{threadId,name:'ReviewBot'});
 if ('agent' in asked) throw Error('missing card');
 const agent=await connect(h.url,h.core.agents.tokenFor(threadId));
 try {
  expect((await thrown(agent.call('agents.create.approve',{threadId,questionId:asked.questionId}))).message).toContain('owner only');
  expect((await thrown(agent.call('settings.set',{agentBotCreation:'free',coordinationReach:'group'}))).message).toContain('owner only');
  expect((await thrown(agent.call('questions.answer',{threadId,questionId:asked.questionId,optionIds:['applied']}))).message).toContain('agent');
 } finally {agent.close();}
 const made=await owner.call('agents.create.approve',{threadId,questionId:asked.questionId});
 expect(made.agent.name).toBe('ReviewBot');
 expect((await thrown(owner.call('agents.create.approve',{threadId,questionId:asked.questionId}))).message).toContain('no open mochi card');
 const next=await owner.call('agents.create',{threadId,name:'ArchivedBot'});
 if ('agent' in next) throw Error('missing card');
 await owner.call('threads.archive',{threadId});
 expect((await thrown(owner.call('agents.create.approve',{threadId,questionId:next.questionId}))).message).toContain('no open mochi card');
});

async function pair() {
 const a=await boot(),b=await boot(), ac=await a.connect(),bc=await b.connect();
 const at=await echoThread(a,ac,'alpha'),bt=await echoThread(b,bc,'bravo');
 a.core.contacts.setSettings({minTier:2});b.core.contacts.setSettings({minTier:2});
 a.core.contacts.selfUrl=async()=>a.url;
 const ai=a.core.coordination.card().coreId,bi=b.core.coordination.card().coreId;
 await bc.call('contacts.join',{link:(await ac.call('contacts.invite',{})).link});
 await waitFor(()=>a.core.contacts.linked(bi));
 const ap=a.core.threads.require(at.threadId).projectId!,bp=b.core.threads.require(bt.threadId).projectId!;
 await ac.call('contacts.grant',{coreId:bi,projectId:ap,readThreads:true});
 await bc.call('contacts.grant',{coreId:ai,projectId:bp,readThreads:true});
 await waitFor(()=>a.core.contacts.find(bi)?.capabilities?.sharedProjects===1);
 const offer=await ac.call('sharedProjects.offer',{coreId:bi,projectId:ap,remote:{ownerCoreId:bi,coreId:bi,projectId:bp},requestId:'offer'});
 await bc.call('sharedProjects.decide',{sharedProjectId:offer.shared.id,accept:true,requestId:'accept'});
 return {a,b,ac,bc,at,bt,ai,bi};
}

test('project reach preserves associated contact directory, read and send',async()=>{
 const {a,at,bt,bi}=await pair();
 expect((await a.core.coordination.directory(at.threadId)).agents.some(t=>t.threadId===bt.threadId)).toBe(true);
 expect((await a.core.coordination.read(at.threadId,{coreId:bi,threadId:bt.threadId})).contact.threadId).toBe(bt.threadId);
 expect((await a.core.coordination.send({threadId:at.threadId,to:{coreId:bi,threadId:bt.threadId},text:'hello',requestId:'probe'})).status).not.toBe('rejected');
});

test('Contacts mochi keeps its group reach on a new install',async()=>{
 const h=await boot(),owner=await h.connect(),{threadId,accountId}=await echoThread(h,owner);
 const bot=await contactsBotOf(h,owner);
 expect(h.core.coordination.scope(bot.threadId).reach).toBe('group');
 expect((await h.core.coordination.directory(bot.threadId)).agents.some(t=>t.threadId===threadId)).toBe(true);
});

test.each(['directory','search','read'] as const)('reach change hides an unrelated peer from a deferred %s even while a shared contact stays reachable',async operation=>{
 const {a,at}=await pair();
 a.core.settings.set({coordinationReach:'group'});
 const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
 const peer:CoordinationPeer={coreId:createHash('sha256').update(publicKey).digest('hex'),name:'synthetic',url:'http://127.0.0.1:1',publicKey,viaClient:true};
 const contact:AgentContact={coreId:peer.coreId,threadId:'synthetic',title:'synthetic',machine:'synthetic',resources:'',status:'idle',mode:'brief'};
 a.core.coordination.trust(peer);
 const started=Promise.withResolvers<void>(),released=Promise.withResolvers<void>();
 a.core.coordination.bridge.request=async(coreId,envelope)=>{
  const req=JSON.parse(envelope.body);started.resolve();await released.promise;
  const result=req.operation==='directory'?[contact]:req.operation==='search'?[{...contact,matched:['title'],excerpts:[]}]:{contact,entries:[],more:false};
  const body=JSON.stringify({nonce:req.nonce,result});return {status:200,body,signature:sign(null,Buffer.from(body),keys.privateKey).toString('base64')};
 };
 const pending=(operation==='directory'?a.core.coordination.directory(at.threadId):operation==='search'?a.core.coordination.search(at.threadId,'synthetic'):a.core.coordination.read(at.threadId,contact)).catch(()=>null);
 await started.promise;
 a.core.settings.set({coordinationReach:'project'});
 released.resolve();
 const out=await pending;
 const seen=out&&('agents' in out?out.agents:'matches' in out?out.matches:[out.contact]);
 expect(seen?.some(t=>t.coreId===peer.coreId)??false).toBe(false);
});
