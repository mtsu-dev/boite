import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { QuestionAnswer } from '@boite/contracts';
import QuestionCard from './QuestionCard.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
});

const OPTIONS = [
  { id: 'short', label: 'Short', description: 'one line back' },
  { id: 'long', label: 'Long' }
];

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

function options(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid=question-option]'));
}

function submit(): HTMLButtonElement {
  return query<HTMLButtonElement>('[data-testid=question-submit]');
}

test('an option turns Answer on, and what was picked goes out once', () => {
  const sent: string[][] = [];
  running = mount(QuestionCard, {
    target: document.body,
    props: {
      text: 'Which shape should the echo take?',
      options: OPTIONS,
      allowText: true,
      multiple: false,
      answer: null,
      pending: true,
      docked: true,
      submit: (optionIds: string[]) => sent.push(optionIds)
    }
  });
  flushSync();

  expect(query('[data-testid=question-card]').getAttribute('data-state')).toBe('pending');
  expect(options()).toHaveLength(2);
  // Nothing picked and nothing in the composer: there is nothing to send yet.
  expect(submit().disabled).toBe(true);
  // The card has no field of its own: the composer is the free answer.
  expect(document.querySelector('input, textarea')).toBeNull();

  options()[0]?.click();
  flushSync();
  expect(submit().disabled).toBe(false);
  expect(options()[0]?.getAttribute('aria-checked')).toBe('true');

  // One choice only: the second option replaces the first.
  options()[1]?.click();
  flushSync();
  expect(options()[0]?.getAttribute('aria-checked')).toBe('false');
  expect(options()[1]?.getAttribute('aria-checked')).toBe('true');

  submit().click();
  flushSync();
  expect(sent).toEqual([['long']]);

  // A second press changes nothing: the card is already answered.
  submit().click();
  flushSync();
  expect(sent).toHaveLength(1);
});

test('Skip sends no answer, prevents duplicate presses and allows retry after failure', async () => {
  const submit = vi.fn();
  let settle!: (accepted: boolean) => void;
  const skip = vi.fn(() => new Promise<boolean>(resolve => { settle = resolve; }));
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which shape?', options: OPTIONS, allowText: true, multiple: false, answer: null, pending: true, docked: true, submit, skip }
  });
  flushSync();
  const button = query<HTMLButtonElement>('[data-testid=question-skip]');
  expect(button.disabled).toBe(false);
  options()[0]!.click();
  flushSync();
  button.click();
  button.click();
  flushSync();
  expect(skip).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);
  settle(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(button.disabled).toBe(false);
  expect(options()[0]!.getAttribute('aria-checked')).toBe('true');
  button.click();
  flushSync();
  expect(skip).toHaveBeenCalledTimes(2);
  settle(true);
});

test('the docked card offers the composer, whose send arrow is then the only submit', () => {
  const onwrite = vi.fn();
  const card = (replying: boolean) => {
    if (running) unmount(running, { outro: false });
    running = mount(QuestionCard, {
      target: document.body,
      props: {
        text: 'What should the branch be called?', options: [], allowText: true, multiple: false,
        answer: null, pending: true, docked: true, replying, drafted: false, onwrite, submit: () => undefined
      }
    });
    flushSync();
  };

  // Another question or an ordinary message has the composer: the card offers to take it.
  card(false);
  expect(submit().disabled).toBe(true);
  query<HTMLButtonElement>('[data-testid=question-write]').click();
  expect(onwrite).toHaveBeenCalledTimes(1);

  // Once it has the composer, the question is written once and nothing repeats the send.
  card(true);
  expect(document.querySelector('[data-testid=question-write]')).toBeNull();
  expect(document.querySelector('[data-testid=question-submit]')).toBeNull();
  expect(document.querySelector('[data-testid=question-reply-hint]')).toBeNull();
  expect(document.querySelectorAll('[data-testid=question-text]')).toHaveLength(1);
});

test('in the timeline a waiting question is one line that points down to the dock', () => {
  const onwrite = vi.fn();
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which shape?', options: OPTIONS, allowText: true, multiple: false, answer: null, pending: true, onwrite, submit: () => undefined }
  });
  flushSync();
  expect(options()).toHaveLength(0);
  expect(document.querySelector('[data-testid=question-submit]')).toBeNull();
  const row = query<HTMLButtonElement>('[data-testid=question-waiting]');
  // The question is written once, in the dock: the line only says one asks.
  expect(row.textContent).not.toContain('Which shape?');
  expect(row.title).toBe('Answer below');
  row.click();
  expect(onwrite).toHaveBeenCalledTimes(1);
});

test('a question without free text never offers the composer', () => {
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Allow?', options: OPTIONS, allowText: false, multiple: false, answer: null, pending: true, submit: () => undefined, onwrite: () => {} }
  });
  flushSync();
  expect(document.querySelector('[data-testid=question-write]')).toBeNull();
  expect(document.querySelector('[data-testid=question-reply-hint]')).toBeNull();
});

test('several options are kept at once when the question takes several', () => {
  const sent: string[][] = [];
  running = mount(QuestionCard, {
    target: document.body,
    props: {
      text: 'Which files should it read?',
      options: OPTIONS,
      allowText: false,
      multiple: true,
      answer: null,
      pending: true,
      docked: true,
      submit: (optionIds: string[]) => sent.push(optionIds)
    }
  });
  flushSync();

  expect(options().every(option => option.getAttribute('role') === 'checkbox')).toBe(true);
  // Docked, each row shows its key until it is picked, then a check.
  expect(document.querySelector('kbd svg')).toBeNull();
  expect(options().map(option => option.querySelector('kbd')?.textContent)).toEqual(['1', '2']);
  options()[0]?.click();
  options()[1]?.click();
  flushSync();
  expect(document.querySelectorAll('[aria-checked=true] kbd svg')).toHaveLength(2);
  options()[0]?.click();
  flushSync();
  expect(options()[0]?.getAttribute('aria-checked')).toBe('false');
  expect(options()[0]?.querySelector('kbd svg')).toBeNull();
  expect(options()[1]?.querySelector('kbd svg')).not.toBeNull();
  options()[0]?.click();
  flushSync();
  submit().click();
  flushSync();
  expect(sent).toEqual([['long', 'short']]);
});

test('an answered card folds to one line and asks nothing more', () => {
  const answer: QuestionAnswer = { optionIds: ['short'], text: 'one line please' };
  running = mount(QuestionCard, {
    target: document.body,
    props: {
      text: 'Which shape should the echo take?',
      options: OPTIONS,
      allowText: true,
      multiple: false,
      answer,
      pending: false,
      submit: () => undefined
    }
  });
  flushSync();

  expect(query('[data-testid=question-card]').getAttribute('data-state')).toBe('answered');
  expect(query('[data-testid=question-answer]').textContent).toBe('Short: one line please');
  expect(options()).toHaveLength(0);
  expect(document.querySelector('[data-testid=question-submit]')).toBeNull();
  const toggle = query<HTMLButtonElement>('[data-testid=question-toggle]');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('[data-testid=question-text]')).toBeNull();
  toggle.click();
  flushSync();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(query('[data-testid=question-text]').textContent).toBe('Which shape should the echo take?');
  toggle.click();
  flushSync();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(query('[data-testid=question-text]').closest<HTMLElement>('.disclosure-fold')?.inert).toBe(true);
});

test('a question whose turn ended says so instead of offering a button', () => {
  running = mount(QuestionCard, {
    target: document.body,
    props: {
      text: 'Which shape should the echo take?',
      options: OPTIONS,
      allowText: true,
      multiple: false,
      answer: null,
      pending: false,
      submit: () => undefined
    }
  });
  flushSync();

  expect(query('[data-testid=question-card]').getAttribute('data-state')).toBe('cancelled');
  expect(document.querySelector('[data-testid=question-submit]')).toBeNull();
  expect(query('[data-testid=question-cancelled]').textContent).toContain('No longer waiting');
  expect(options()[0]?.disabled).toBe(true);
});

test('a card asked without waiting says so until it is answered', () => {
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which port?', options: OPTIONS, allowText: true, multiple: false, async: true, answer: null, pending: true, submit: () => {} }
  });
  flushSync();
  const card = query('[data-testid=question-card]');
  expect(card.getAttribute('data-async')).toBe('true');
  expect(card.textContent).toContain('Needs you');
  expect(document.querySelector('[data-testid=question-async-hint]')).not.toBeNull();
});

test('a send that failed gives the card back, and a second press sends again', async () => {
  const sent: string[][] = [];
  let answer!: (delivered: boolean) => void;
  running = mount(QuestionCard, {
    target: document.body,
    props: {
      text: 'Which shape should the echo take?',
      options: OPTIONS,
      allowText: true,
      multiple: false,
      answer: null,
      pending: true,
      docked: true,
      submit: (optionIds: string[]) => {
        sent.push(optionIds);
        return new Promise<boolean>((resolve) => { answer = resolve; });
      }
    }
  });
  flushSync();
  options()[0]?.click();
  flushSync();
  submit().click();
  flushSync();
  // In flight: nothing can be pressed twice.
  expect(submit().disabled).toBe(true);
  expect(options()[0]?.disabled).toBe(true);

  answer(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  expect(submit().disabled).toBe(false);
  expect(options()[0]?.disabled).toBe(false);
  expect(options()[0]?.getAttribute('aria-checked')).toBe('true');

  submit().click();
  flushSync();
  expect(sent).toEqual([['short'], ['short']]);
  answer(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  expect(submit().disabled).toBe(true);
});

test('an answer given with files lists them, and a files-only answer says how many', () => {
  const answer: QuestionAnswer = {
    optionIds: [],
    attachments: [
      { kind: 'image', mimeType: 'image/jpeg', name: 'IMG_0042.jpg', bytes: 420_000 },
      { kind: 'file', mimeType: 'text/plain', name: 'trace.txt', bytes: 3 }
    ]
  };
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which layout?', options: OPTIONS, allowText: true, multiple: false, answer, pending: false, submit: () => undefined }
  });
  flushSync();
  expect(query('[data-testid=question-answer]').textContent).toBe('2 files');
  expect(query('[data-testid=question-answer-files]').getAttribute('title')).toBe('IMG_0042.jpg, trace.txt');
  query<HTMLButtonElement>('[data-testid=question-toggle]').click();
  flushSync();
  expect(query('.answer-detail').textContent).toContain('Files given: IMG_0042.jpg, trace.txt');
});

test('code an agent quotes in backticks reads as code in the question and its options, nothing else changes', () => {
  running = mount(QuestionCard, {
    target: document.body,
    props: {
      text: 'Retry `src/lib/sync/queue.ts` on *every* failure?',
      options: [{ id: 'yes', label: 'Keep `retry()`', description: 'runs `bun test` after' }, { id: 'no', label: 'No' }],
      allowText: true, multiple: false, answer: null, pending: true, docked: true, submit: () => {}
    }
  });
  flushSync();
  const prompt = query('[data-testid=question-text]');
  expect(Array.from(prompt.querySelectorAll('code')).map(code => code.textContent)).toEqual(['src/lib/sync/queue.ts']);
  expect(prompt.textContent).toBe('Retry src/lib/sync/queue.ts on *every* failure?');
  expect(Array.from(options()[0]!.querySelectorAll('code')).map(code => code.textContent)).toEqual(['retry()', 'bun test']);
});

test('a docked list cut by its height counts the choices under its edge, and the line scrolls to the first of them', () => {
  // jsdom has no layout: the list shows 100 px of five 40 px rows, so the third is cut and two more are under it.
  const restore = [
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('options') ? 200 : 0; }),
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('options') ? 100 : 0; }),
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      const bottom = this.classList.contains('options') ? 100 : (at + 1) * 40;
      return { top: bottom - 40, bottom, left: 0, right: 300, width: 300, height: 40, x: 0, y: bottom - 40, toJSON() {} } as DOMRect;
    })
  ];
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push((this as HTMLElement).dataset.option ?? ''); };
  try {
    running = mount(QuestionCard, {
      target: document.body,
      props: {
        text: 'Which retry policy?',
        options: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() })),
        allowText: true, multiple: false, answer: null, pending: true, docked: true,
        submit: () => true
      }
    });
    flushSync();
    expect(query('[data-testid=question-more]').textContent).toBe('3 more');
    expect(query('.options').classList.contains('clipped')).toBe(true);
    query<HTMLButtonElement>('[data-testid=question-more]').click();
    expect(scrolled).toEqual(['c']);
  } finally {
    for (const spy of restore) spy.mockRestore();
    Element.prototype.scrollIntoView = original;
  }
});

test('a docked list that shows every choice draws no count line', () => {
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which shape?', options: OPTIONS, allowText: true, multiple: false, answer: null, pending: true, docked: true, submit: () => true }
  });
  flushSync();
  expect(document.querySelector('[data-testid=question-more]')).toBeNull();
});
