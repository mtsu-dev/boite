import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '../src/client.ts';
import { startTestCore, waitFor } from './harness.ts';

test('a paired phone tags a project, the owner hears it, and a restarted core keeps the tags', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-project-tags-'));
  let harness = await startTestCore({ dataDir });
  try {
    const owner = await harness.connect();
    const project = await owner.call('projects.add', { path: dataDir, name: 'tagged' });
    const { grant } = await owner.call('pairing.grant', {});
    const phone = await connect(harness.url, '', { grant, client: { name: 'pwa', version: 'test' } });
    let heard: string[] | undefined;
    owner.on('project.updated', p => { if (p.id === project.id) heard = p.tags; });
    try {
      const tagged = await phone.call('projects.setTags', { projectId: project.id, tags: [' Client ', 'client', 'Work'] });
      expect(tagged.tags).toEqual(['Client', 'Work']);
      await waitFor(() => heard?.join() === 'Client,Work');
      const refused = await phone.call('projects.setTags', { projectId: project.id, tags: ['x'.repeat(33)] }).catch(error => error);
      expect(refused).toMatchObject({ rpc: { data: { field: 'tags', index: 0 } } });
      expect(String(refused.rpc.data.expected)).toContain('32 characters');
    } finally { phone.close(); }
    await harness.stop();
    harness = await startTestCore({ dataDir });
    const reconnected = await harness.connect();
    expect((await reconnected.call('projects.list', {})).find(p => p.id === project.id)).toMatchObject({ name: 'tagged', tags: ['Client', 'Work'] });
  } finally {
    await harness.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
