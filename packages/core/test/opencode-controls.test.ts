import { expect, test } from 'bun:test';
import { OpenCodeControls } from '../src/drivers/acp/opencode-controls.ts';

test('an agent list OpenCode answers empty while the location still loads is read again, so plan is offered', async () => {
  // OpenCode 2.3 lists no agent for about 0.4 s after a session opens in a fresh location.
  let agentReads = 0;
  const controls = new OpenCodeControls(async (path) => {
    if (path.startsWith('/api/agent')) {
      agentReads += 1;
      return { data: agentReads === 1 ? [] : [
        { id: 'build', name: 'Build', mode: 'primary' },
        { id: 'general', name: 'General', mode: 'subagent' },
        { id: 'title', name: 'Title', mode: 'primary', hidden: true },
        { id: 'plan', name: 'Plan', mode: 'primary' },
      ] };
    }
    if (path.startsWith('/api/model/default')) return { data: { providerID: 'opencode', id: 'big-pickle' } };
    if (path.startsWith('/api/model')) return { data: [{ providerID: 'opencode', id: 'big-pickle', name: 'Big Pickle' }] };
    return { data: [] };
  }, 'D:\\project');

  await controls.read({ id: 'ses_1' });

  const mode = controls.options().find((option) => option.id === 'mode');
  expect(mode?.type === 'select' ? mode.options.map((option) => 'value' in option ? option.value : null) : null).toEqual(['build', 'plan']);
  expect(agentReads).toBe(2);
});
