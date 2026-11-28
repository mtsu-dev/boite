import { describe, expect, test } from 'vitest';
import { presenceActivity, type PresenceWork } from './activity';

const work = (status: PresenceWork['status'], project: string | null, model: string | null, at = 1): PresenceWork => ({ status, project, model, at });

describe('the words of the rich presence', () => {
  test('nothing at work reads Idle, without a timer', () => {
    expect(presenceActivity([work('idle', 'boite', 'Opus 5.5'), work('error', null, null)], { projects: true, startedAt: null })).toEqual({ details: 'Idle', button: 'Get Boite' });
  });

  test('project names stay hidden unless allowed: the count and the models show instead', () => {
    const busy = [work('running', 'boite', 'Opus 5.5', 3), work('waiting', 'boite', 'GPT-6.2 Sol', 2), work('queued', 'secret-game', 'Opus 5.5', 1)];
    expect(presenceActivity(busy, { projects: false, startedAt: 1_700_000_000_000 })).toEqual({
      details: 'Directing 3 agents', state: 'Opus 5.5, GPT-6.2 Sol · 1 waiting', startedAt: 1_700_000_000_000, button: 'Get Boite',
    });
    // Allowed: the latest project leads, the others are counted.
    expect(presenceActivity(busy, { projects: true, startedAt: null })).toMatchObject({ details: 'Working on boite +1', state: '3 agents · Opus 5.5, GPT-6.2 Sol · 1 waiting' });
  });

  test('one agent, no model known and no project: a short line and no empty state', () => {
    expect(presenceActivity([work('running', null, null)], { projects: true, startedAt: null })).toEqual({ details: 'Coding with an agent', button: 'Get Boite' });
  });

  test('a third model is counted, and a long project name is cut to what Discord takes', () => {
    const models = presenceActivity([work('running', null, 'A1'), work('running', null, 'B2'), work('running', null, 'C3')], { projects: false, startedAt: null });
    expect(models.state).toBe('A1, B2 +1');
    const long = presenceActivity([work('running', 'x'.repeat(200), null)], { projects: true, startedAt: null });
    expect([...long.details].length).toBe(128);
  });
});
