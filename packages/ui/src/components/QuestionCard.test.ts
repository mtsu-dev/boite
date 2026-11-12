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

test('Answer with nothing picked waits as an outline whose tooltip says what enables it, sends nothing, moves to the first option; 1 to 9 still pick there, and what was picked goes out once', () => {
  const sent: string[][] = [];
  running = mount(QuestionCard, {
    target: document.body,
    props: {
      text: 'Which shape should the echo take?',
      options: OPTIONS,
      allowText: false,
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
  // Nothing picked: Answer waits as the outline secondary, never a faint primary; its tooltip says what enables it,
  // with no line of its own under the choices. A press still answers.
  expect(submit().disabled).toBe(false);
  expect(submit().getAttribute('aria-disabled')).toBe('true');
  expect(submit().classList.contains('secondary')).toBe(true);
  expect(submit().classList.contains('primary')).toBe(false);
  expect(submit().title).toBe('Pick an option first');
  expect(document.querySelector('[data-testid=question-pick-first]')).toBeNull();
  // The card has no field of its own: the composer is the free answer.
  expect(document.querySelector('input, textarea')).toBeNull();

  // Nothing picked and nothing in the composer: the press sends nothing and points at the choices.
  submit().click();
  flushSync();
  expect(sent).toEqual([]);
  expect(document.activeElement).toBe(options()[0]);

  // The composer's numbers still pick with the focus on the choices.
  options()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  flushSync();
  expect(options()[0]?.getAttribute('aria-checked')).toBe('true');
  // A pick lights Answer as the primary.
  expect(submit().hasAttribute('aria-disabled')).toBe(false);
  expect(submit().classList.contains('primary')).toBe(true);
  expect(submit().title).toBe('');

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

test('a waiting Answer reads: the muted ink on its outline, its tooltip saying a pick enables it', async () => {
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which shape?', options: OPTIONS, allowText: true, multiple: false, answer: null, pending: true, docked: true, submit: () => true }
  });
  flushSync();
  expect(submit().title).toBe('Pick an option first');
  // The ink is the muted text tier, which lib/contrast.test.ts holds over 14:1 on every ground: not the faint tier of a disabled mark.
  const { compile } = await import('svelte/compiler');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(`${import.meta.dirname}/QuestionCard.svelte`, 'utf8').replace(/<script lang="ts">[\s\S]*?<\/script>/, '<script></script>');
  const css = compile(source, { filename: 'QuestionCard.svelte', cssHash: () => 'c' }).css?.code ?? '';
  expect(css.match(/\.waiting\.c \{([^}]*)\}/)?.[1]).toContain('color: var(--color-muted-foreground)');
  expect(readFileSync(`${import.meta.dirname}/../app.css`, 'utf8')).not.toContain("button.primary[aria-disabled='true']");
  options()[1]!.click();
  flushSync();
  expect(submit().classList.contains('primary')).toBe(true);
});

test('a docked question speaks the decision pair: Skip outlined then Answer, on one right-aligned line, Answer an outline but pressable before a pick, the filled primary at the pick, faded once on its way', async () => {
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which shape?', options: OPTIONS, allowText: false, multiple: false, answer: null, pending: true, docked: true, submit: () => true, skip: () => true }
  });
  flushSync();
  const pair = query('.decision-actions');
  const buttons = [...pair.querySelectorAll<HTMLButtonElement>(':scope > button')];
  expect(buttons.map((entry) => [entry.dataset.testid, entry.className.split(' ').find((name) => name === 'secondary' || name === 'primary')]))
    .toEqual([['question-skip', 'secondary'], ['question-submit', 'secondary']]);
  // Skip leaves the head: the pair is the only place a decision is made.
  expect(document.querySelector('.decision-head [data-testid=question-skip]')).toBeNull();
  expect(submit().disabled).toBe(false);
  // jsdom gets no component CSS from Vite: compile the pair's own, under the scope class it renders with.
  // app.css draws a disabled primary as an outline; the pair keeps its Answer filled, only faded, while it goes out.
  const { compile } = await import('svelte/compiler');
  const { readFileSync } = await import('node:fs');
  const scope = [...pair.classList].find((name) => name !== 'decision-actions')!;
  const source = readFileSync(`${import.meta.dirname}/DecisionActions.svelte`, 'utf8').replace(/<script lang="ts">[\s\S]*?<\/script>/, '<script></script>');
  const style = document.createElement('style');
  style.textContent = compile(source, { filename: 'DecisionActions.svelte', cssHash: () => scope }).css?.code ?? '';
  document.head.append(style);
  try {
    // jsdom resolves no var(): read the pair's rule that holds the disabled Answer and check it fills it.
    const rule = [...style.sheet!.cssRules].find((entry): entry is CSSStyleRule => entry instanceof CSSStyleRule && entry.selectorText.includes('primary:disabled'))!;
    // Before any pick it is the outline secondary, not the pair's faded fill.
    expect(submit().classList.contains('secondary')).toBe(true);
    expect(buttons.at(-1)).toBe(submit());
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(submit().matches(rule.selectorText)).toBe(false);
    options()[0]!.click();
    flushSync();
    expect(submit().hasAttribute('aria-disabled')).toBe(false);
    expect(submit().classList.contains('primary')).toBe(true);
    submit().click();
    flushSync();
    expect(submit().disabled).toBe(true);
    expect(submit().matches(rule.selectorText)).toBe(true);
    expect(rule.style.getPropertyValue('background')).toBe('var(--primary-fill)');
    expect(rule.style.getPropertyValue('color')).toBe('var(--primary-ink)');
    expect(getComputedStyle(submit()).opacity).toBe('0.45');
  } finally { style.remove(); }
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

test('a docked question the composer answers has no Answer of its own; one it does not answer keeps it, and a pick shows at once', () => {
  const sent: string[][] = [];
  const card = (replying: boolean) => {
    if (running) unmount(running, { outro: false });
    running = mount(QuestionCard, {
      target: document.body,
      props: {
        text: 'Which shape?', options: OPTIONS, allowText: true, multiple: false,
        answer: null, pending: true, docked: true, replying, drafted: false, skip: () => true, submit: (ids: string[]) => sent.push(ids)
      }
    });
    flushSync();
  };
  // The composer is its field: its Send reads Answer and is the one commit, the card keeps Skip and its options.
  card(true);
  expect(document.querySelector('[data-testid=question-submit]')).toBeNull();
  expect(query('[data-testid=question-skip]').textContent?.trim()).toBe('Skip question');
  options()[1]?.click();
  flushSync();
  // One choice too: its row fills and its ring turns to a solid check.
  expect(options()[1]?.classList.contains('picked')).toBe(true);
  expect(options()[1]?.querySelector('.box.round svg')).not.toBeNull();
  expect(options()[0]?.querySelector('.box.round svg')).toBeNull();

  // A subagent's question docked in its parent: the composer is not its field, so the card answers its picks.
  card(false);
  expect(submit().textContent?.trim()).toBe('Answer');
  expect(document.querySelector('[data-testid=question-how]')).toBeNull();
  options()[1]?.click();
  flushSync();
  submit().click();
  flushSync();
  expect(sent).toEqual([['long']]);
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
  expect(submit().disabled).toBe(false);
  query<HTMLButtonElement>('[data-testid=question-write]').click();
  expect(onwrite).toHaveBeenCalledTimes(1);
  // Answer with nothing written hands the composer over too: there is no option to point at.
  submit().click();
  expect(onwrite).toHaveBeenCalledTimes(2);

  // Once it has the composer, the question is written once and nothing repeats the send.
  card(true);
  expect(document.querySelector('[data-testid=question-write]')).toBeNull();
  expect(document.querySelector('[data-testid=question-submit]')).toBeNull();
  expect(document.querySelector('[data-testid=question-reply-hint]')).toBeNull();
  expect(document.querySelectorAll('[data-testid=question-text]')).toHaveLength(1);
});

test('in its message a waiting question is one line that points down to the decision card', () => {
  const onwrite = vi.fn();
  running = mount(QuestionCard, {
    target: document.body,
    props: { text: 'Which shape?', options: OPTIONS, allowText: true, multiple: false, answer: null, pending: true, onwrite, submit: () => undefined }
  });
  flushSync();
  expect(options()).toHaveLength(0);
  expect(document.querySelector('[data-testid=question-submit]')).toBeNull();
  const row = query<HTMLButtonElement>('[data-testid=question-waiting]');
  // The question is written once, in the decision card: the line only says one asks.
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
  // The card says what a pick does: it marks rows, the card's Answer sends them.
  expect(document.querySelector('[data-testid=question-how]')).toBeNull();
  // Docked, each row leads with an empty square, a choice before any pick, and a check once picked;
  // its key stays a quiet hint right after the label it picks, never the mark of the choice.
  expect(options().every(option => option.firstElementChild?.classList.contains('box') && !option.querySelector('.box')?.classList.contains('round'))).toBe(true);
  expect(document.querySelector('.box svg')).toBeNull();
  expect(options().map(option => option.querySelector('.label > kbd:last-child')?.textContent ?? null)).toEqual(['1', '2']);
  options()[0]?.click();
  options()[1]?.click();
  flushSync();
  expect(document.querySelectorAll('[aria-checked=true] .box svg')).toHaveLength(2);
  expect(document.querySelector('kbd svg')).toBeNull();
  options()[0]?.click();
  flushSync();
  expect(options()[0]?.getAttribute('aria-checked')).toBe('false');
  expect(options()[0]?.querySelector('.box svg')).toBeNull();
  expect(options()[1]?.querySelector('.box svg')).not.toBeNull();
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
  // One sentence, one space: the label and the answer used to be two flex items with a gap on top of the colon's space.
  expect(query('[data-testid=question-verdict]').textContent).toBe('You answered: Short: one line please');
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
  // A receipt, one line naming the question, never the card with its choices again.
  expect(query('[data-testid=question-cancelled]').textContent).toBe('Not answered: Which shape should the echo take?');
  expect(options()).toHaveLength(0);
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

/**
 * jsdom has no layout: rows are 40 px each, the room is the list's CSS
 * max-height (`room`), and the list's own box is whatever an ancestor leaves
 * it (`squeezed`, the arrival's animated height) until `fit` sets its height.
 */
function layout(room: string, squeezed: number) {
  const box = (list: HTMLElement) => list.style.maxHeight ? parseFloat(list.style.maxHeight) : squeezed;
  const computed = window.getComputedStyle;
  return [
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => element.classList.contains('options') ? ({ maxHeight: element instanceof HTMLElement && element.style.maxHeight ? element.style.maxHeight : room } as CSSStyleDeclaration) : computed(element)),
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('options') ? this.children.length * 40 : 0; }),
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('options') ? box(this) : 0; }),
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      const bottom = this.classList.contains('options') ? box(this as HTMLElement) : (at + 1) * 40;
      const top = this.classList.contains('options') ? 0 : bottom - 40;
      return { top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON() {} } as DOMRect;
    })
  ];
}

test('a docked list taller than its room stops under its last whole row, counts the rest, and the line scrolls to the first of them', () => {
  // A 100 px room holds two 40 px rows whole: the list ends at 80 px, never on half of the third.
  const restore = layout('100px', 100);
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
    expect(query<HTMLElement>('.options').style.maxHeight).toBe('80px');
    expect(query('[data-testid=question-more]').textContent).toBe('Show 3 more options');
    expect(query('.options').classList.contains('clipped')).toBe(true);
    query<HTMLButtonElement>('[data-testid=question-more]').click();
    expect(scrolled).toEqual(['c']);
  } finally {
    for (const spy of restore) spy.mockRestore();
    Element.prototype.scrollIntoView = original;
  }
});

test('a question whose choices fit its room shows them all while its arrival still squeezes the list: no count line to reflow', () => {
  // Mid-arrival the card is 30 px tall; the three rows fit the 300 px room, so the card is laid out once, whole.
  const restore = layout('300px', 30);
  try {
    running = mount(QuestionCard, {
      target: document.body,
      props: { text: 'Which shape?', options: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() })), allowText: true, multiple: false, answer: null, pending: true, docked: true, submit: () => true }
    });
    flushSync();
    expect(document.querySelector('[data-testid=question-more]')).toBeNull();
    expect(query<HTMLElement>('.options').style.maxHeight).toBe('');
  } finally {
    for (const spy of restore) spy.mockRestore();
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
