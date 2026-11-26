import { expect, test } from 'vitest';
import { proofPart, type Message, type Turn } from '@boite/contracts';
import { claudeKeywords, isSteeringMessage, lastAnswer, lastAnswerTurn, lastLined, promptSegments, sliceSegments, visibleAnswer, visibleUserText } from './message-display';

test('the keywords count only for a Claude model run by Claude Code', () => {
  expect(claudeKeywords('claude-sdk', 'claude-opus-5-5')).toBe(true);
  expect(claudeKeywords('claude-sdk', 'opus[1m]')).toBe(true);
  expect(claudeKeywords('claude-sdk', 'sonnet')).toBe(true);
  expect(claudeKeywords('claude-sdk', null)).toBe(true);
  // Claude Code routed to another model, or a Claude model behind another harness.
  expect(claudeKeywords('claude-sdk', 'glm-5')).toBe(false);
  expect(claudeKeywords('claude-sdk', 'deepseek-v4')).toBe(false);
  expect(claudeKeywords('claude-sdk', 'opusx-1')).toBe(false);
  expect(claudeKeywords('acp', 'claude-sonnet-5')).toBe(false);
  expect(claudeKeywords(undefined, 'claude-sonnet-5')).toBe(false);
});

test('old goal instructions display only the colored-command input, ordinary text stays intact', () => {
  expect(visibleUserText('Work toward this goal: Ship it\nContinue until the objective is achieved. private instructions')).toBe('/goal Ship it');
  expect(visibleUserText('/goal Ship it')).toBe('/goal Ship it');
  expect(visibleUserText('Discuss Work toward this goal: examples')).toBe('Discuss Work toward this goal: examples');
});
test('protocol markers are invisible while streaming and when complete', () => {
  expect(visibleAnswer('Verified.\n[BOITE_GOAL_COMPLETE]\n')).toBe('Verified.\n');
  expect(visibleAnswer('[BOITE_GOAL_BLOCKED]')).toBe('');
  expect(visibleAnswer('Verified.\n[BOITE_GOAL_COMP')).toBe('Verified.\n');
  expect(visibleAnswer('An inline [BOITE_GOAL_COMPLETE] example')).toBe('An inline [BOITE_GOAL_COMPLETE] example');
});

test('marker examples remain visible before more text and inside code fences', () => {
  for (const text of [
    '[BOITE_GOAL_COMPLETE]\nThis is an example.',
    '```text\n[BOITE_GOAL_COMPLETE]\n```',
    '```text\n[BOITE_GOAL_COMP',
    '~~~\n[BOITE_GOAL_BLOCKED]\n',
  ]) expect(visibleAnswer(text)).toBe(text);
});
import { ParagraphScan, paragraphBlocks, answerText, promptText } from './message-display';
import { renderMarkdown } from './markdown';

test('paragraphs wait for a boundary, and completion or cancellation flushes the tail', () => {
  expect(paragraphBlocks('First sentence', true)).toEqual([]);
  expect(paragraphBlocks('First sentence\n\nSecond par', true)).toEqual(['First sentence']);
  expect(paragraphBlocks('First sentence\n\nSecond par', false)).toEqual(['First sentence', 'Second par']);
  expect(paragraphBlocks('One\r\n\r\nTwo', true)).toEqual(['One']);
});
test('blank lines inside fenced code do not expose an incomplete block', () => {
  expect(paragraphBlocks('Intro\n\n```ts\nconst a = 1;\n\npartial', true)).toEqual(['Intro']);
  expect(paragraphBlocks('```ts\nconst a = 1;\n\n```\n\nTail', true)).toEqual(['```ts\nconst a = 1;\n\n```']);
});
test('streamed blocks and the final render read fences with one grammar', () => {
  // `a``` b` is inline code, not a fence: the paragraph after it must not wait for a close.
  expect(paragraphBlocks('```a``` b\n\nNext\n\n', true)).toEqual(['```a``` b', 'Next']);
  for (const text of ['~~~~ts\nconst x = 1;\n\n~~~\nconst y = 2;\n~~~~\n\nAfter', '````\n```\n\n```\n````\n\nAfter', '```\na\n\n``` x\nb\n```\n\nAfter']) {
    const scan = new ParagraphScan();
    for (let end = 1; end <= text.length; end += 3) scan.blocks(text.slice(0, end), true);
    const blocks = scan.blocks(text, false);
    expect(blocks).toHaveLength(2);
    expect(renderMarkdown(blocks[0]!)).toMatch(/^<pre[^>]*><code>[\s\S]*<\/code><\/pre>$/);
    expect(blocks.map(block => renderMarkdown(block)).join('')).toBe(renderMarkdown(text));
  }
});
test('an indented fence keeps its indent through the stream, so its code outdents as in the final render', () => {
  const code = (html: string) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return [...box.querySelectorAll('pre code')].map(node => node.textContent);
  };
  for (const [text, expected] of [
    ['  ~~~py\n  x = 1\n   y = 2\n  ~~~\n\nAfter', 'x = 1\n y = 2'],
    ['Intro\n\n   ```py\n   x = 1\n    y = 2\n   ```\n\nAfter', 'x = 1\n y = 2'],
    [' ````\n x = 1\n\n  y = 2\n ````', 'x = 1\n\n y = 2']
  ] as const) {
    const scan = new ParagraphScan();
    for (let end = 1; end <= text.length; end += 3) scan.blocks(text.slice(0, end), true);
    const blocks = scan.blocks(text, false);
    expect(code(renderMarkdown(text))).toEqual([expected]);
    expect(code(blocks.map(block => renderMarkdown(block)).join(''))).toEqual([expected]);
  }
});
test('a published command and its output render literally even when they contain Markdown', () => {
  const command = 'cat <<EOF\n```\nEOF';
  const line = '**test passed**';
  const proof = proofPart({ threadId: 'thread', messageId: 'message', line, unchecked: 'Windows pending.' }, [
    { type: 'tool', toolId: 'tool', name: 'Bash', status: 'done', input: { command }, output: line },
  ]);
  const box = document.createElement('div');
  box.innerHTML = paragraphBlocks(proof.text, false).map(block => renderMarkdown(block)).join('');
  expect(box.querySelector('pre code')?.textContent).toBe(`${command}\n${line}`);
  expect(box.querySelector('p')?.textContent).toBe('Windows pending.');
});
test('an indented heading stays a heading, in a completed block and in the final tail', () => {
  const heading = /^<h[1-6][^>]*>Heading<\/h[1-6]>$/;
  expect(paragraphBlocks('  # Heading', false).map(block => renderMarkdown(block))).toEqual([expect.stringMatching(heading)]);
  const text = 'Intro\n\n   ## Heading\n\nAfter';
  const scan = new ParagraphScan();
  for (let end = 1; end <= text.length; end += 3) scan.blocks(text.slice(0, end), true);
  expect(renderMarkdown(scan.blocks(text, true)[1]!)).toMatch(heading);
  expect(renderMarkdown(scan.blocks(text, false)[1]!)).toMatch(heading);
});
test('a marker indented past a fence stays text in the stream, as the scanner and the full render read it', () => {
  const text = '    ```\nx = 1\n\ny = 2';
  expect(renderMarkdown(text)).not.toContain('<pre');
  for (const live of [false, true]) {
    expect(paragraphBlocks(text, live).map(block => renderMarkdown(block)).join('')).not.toContain('<pre');
  }
});
test('internal goal markers stay out of prose, even during partial arrival', () => {
  expect(answerText('Done\n\n[BOITE_GOAL_COMPLETE]', false)).toBe('Done\n\n');
  expect(answerText('Done\n\n[BOITE_GOAL_COM', true)).not.toContain('[BOITE_');
  expect(answerText('A literal [BOITE_GOAL_COMPLETE] in a sentence.', false)).toContain('[BOITE_GOAL_COMPLETE]');
  for (const live of [false, true]) {
    for (const example of ['[BOITE_GOAL_COMPLETE]\nAn example.', '```text\n[BOITE_GOAL_COMPLETE]\n```', '~~~\n[BOITE_GOAL_COMP']) {
      expect(answerText(example, live)).toBe(example);
    }
  }
});
test('display commands leave the execution prompt intact', () => {
  const part = {type: 'text' as const, text: 'private instructions', displayText: '/goal Check it'};
  expect(promptText(part)).toBe('/goal Check it');
  expect(part.text).toBe('private instructions');
  expect(promptText({type:'text',text:'Ordinary prompt'})).toBe('Ordinary prompt');
  expect(promptText({type:'text',text:'Work toward this goal: Check it\nContinue until the objective is achieved. Extra task guidance.'})).toBe('/goal Check it');
});

test('a prompt is cut at its command and at the words Claude Code acts on', () => {
  expect(promptSegments('/goal ultrathink it', '/goal', true)).toEqual([
    { text: '/goal', kind: 'command' },
    { text: ' ', kind: 'plain' },
    { text: 'ultrathink', kind: 'ultrathink' },
    { text: ' it', kind: 'plain' }
  ]);
  expect(promptSegments('Refactor it, UltraCode.', undefined, true)).toEqual([
    { text: 'Refactor it, ', kind: 'plain' },
    { text: 'UltraCode', kind: 'ultracode' },
    { text: '.', kind: 'plain' }
  ]);
  // Inside a longer word, or on another harness, the word is plain text.
  expect(promptSegments('ultrathinking', undefined, true)).toEqual([{ text: 'ultrathinking', kind: 'plain' }]);
  expect(promptSegments('ultrathink', undefined, false)).toEqual([{ text: 'ultrathink', kind: 'plain' }]);
  expect(promptSegments('', undefined, true)).toEqual([]);
});

test('sliceSegments cuts a range out of the whole prompt, keywords split at the edges', () => {
  const segments = promptSegments('go ultrathink now', undefined, true);
  expect(sliceSegments(segments, 0, 3)).toEqual([{ text: 'go ', kind: 'plain' }]);
  expect(sliceSegments(segments, 1, 8)).toEqual([{ text: 'o ', kind: 'plain' }, { text: 'ultra', kind: 'ultrathink' }]);
  expect(sliceSegments(segments, 13, 17)).toEqual([{ text: ' now', kind: 'plain' }]);
  expect(sliceSegments(segments, 17, 20)).toEqual([]);
});

test('the last answer is the newest turn that said something, its text parts joined, tool cards left out', () => {
  const said = (id: string, turnId: string | null, role: Message['role'], parts: Message['parts']) =>
    ({ id, threadId: 't-1', turnId, role, parts, createdAt: 0 }) as Message;
  const messages = [
    said('m-1', 'u-1', 'user', [{ type: 'text', text: 'first' }]),
    said('m-2', 'u-1', 'assistant', [{ type: 'text', text: 'Answer one.' }]),
    said('m-3', 'u-1', 'assistant', [{ type: 'text', text: 'And more. [BOITE_GOAL_COMPLETE]' }]),
    said('m-4', 'u-2', 'user', [{ type: 'text', text: 'second' }]),
    said('m-5', 'u-2', 'assistant', [{ type: 'tool', toolId: 'k-1', name: 'Read', input: {}, status: 'running' } as never])
  ];
  expect(lastAnswer(messages)).toBe('Answer one.\n\nAnd more. [BOITE_GOAL_COMPLETE]');
  expect(lastAnswer(messages.slice(0, 1))).toBe('');
});

test('the line a timeline ends on is the last done turn drawn with one, past markers, folded wakes and cache pings', () => {
  const said = (id: string, turnId: string, extra: object = {}, role: Message['role'] = 'assistant') =>
    ({ id, threadId: 't', turnId, role, state: 'complete', createdAt: 1, parts: [{ type: 'text', text: id, ...extra }] }) as Message;
  const turn = (id: string, extra: Partial<Turn> = {}) => ({ id, status: 'done', execution: undefined, ...extra }) as Turn;
  const turns = [turn('a'), turn('wake'), turn('ping', { execution: { operation: 'keepalive' } as Turn['execution'] }), turn('queued', { status: 'queued' })];
  const timeline = [said('m-a', 'a'), said('m-wake', 'wake', {}, 'system'), said('m-fresh', 'wake', { newConversation: { by: 'user' } }, 'system'), said('m-ping', 'ping'), said('m-queued', 'queued', {}, 'user')];
  expect(lastLined(timeline.slice(0, 4), new Map([['m-wake', {}]]), turns)).toBe('a');
  expect(lastAnswerTurn(timeline, new Map([['m-wake', {}]]), turns)).toBe('a');
  // Unfolded, the wake's own line ends the timeline; a turn that failed with no answer leaves the previous answer's buttons.
  expect(lastLined(timeline.slice(0, 4), new Map(), turns)).toBe('wake');
  expect(lastAnswerTurn(timeline, new Map(), turns)).toBe('wake');
  expect(lastLined(timeline.slice(0, 4), new Map(), [turn('a'), turn('wake', { status: 'error' }), turns[2]!, turns[3]!])).toBeNull();
  expect(lastAnswerTurn(timeline, new Map(), [turn('a'), turn('wake', { status: 'error' }), turns[2]!, turns[3]!])).toBe('a');
  // An unanswered running, failed or stopped user prompt leaves no resting line, while lastAnswerTurn stays on the previous answer.
  for (const status of ['running', 'error', 'stopped'] as const) {
    const withPrompt = [said('m-a', 'a'), said('m-u', 'u', {}, 'user')];
    const promptTurns = [turn('a'), turn('u', { status })];
    expect(lastLined(withPrompt, new Map(), promptTurns)).toBeNull();
    expect(lastAnswerTurn(withPrompt, new Map(), promptTurns)).toBe('a');
  }
  // A running, stopped or failed turn that only streamed thinking or tools still has no answer text, so lastAnswerTurn stays on the previous answer; partial text takes it once settled.
  const thinkingOnly = { id: 'm-r', threadId: 't', turnId: 'u', role: 'assistant', state: 'complete', createdAt: 2, parts: [{ type: 'thinking', text: 'checking' }] } as Message;
  for (const status of ['running', 'stopped', 'error'] as const) {
    const rows = [said('m-a', 'a'), said('m-u', 'u', {}, 'user'), thinkingOnly];
    const state = [turn('a'), turn('u', { status })];
    expect(lastLined(rows, new Map(), state)).toBeNull();
    expect(lastAnswerTurn(rows, new Map(), state)).toBe('a');
  }
  expect(lastAnswerTurn([said('m-a', 'a'), said('m-u', 'u', {}, 'user'), said('m-partial', 'u')], new Map(), [turn('a'), turn('u', { status: 'stopped' })])).toBe('u');

  // Steering classification distinguishes opening prompts from steering rows even when a history page starts mid-turn.
  const opened = { id: 'm-1', role: 'user' as const, createdAt: 100 };
  const steered = { id: 'm-2', role: 'user' as const, createdAt: 200 };
  expect(isSteeringMessage(opened, 'm-1', false, false, { startedAt: 100 })).toBe(false);
  expect(isSteeringMessage(steered, 'm-1', false, true, { startedAt: 100 })).toBe(true);
  expect(isSteeringMessage(steered, 'm-2', true, true, { startedAt: 100 })).toBe(true);
  expect(isSteeringMessage(steered, 'm-2', true, false, { startedAt: 100 })).toBe(true);
  expect(isSteeringMessage(opened, 'm-1', true, false, { startedAt: 100 })).toBe(false);
});
