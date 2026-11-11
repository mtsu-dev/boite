import { describe, expect, it, vi } from 'vitest';
import { rowCut, watchRowCut } from './row-cut';

const rows = (...edges: [number, number][]) => edges.map(([top, bottom]) => ({ top, bottom }));

describe('rowCut', () => {
  it('fades out a row the foot would slice, from its top', () => {
    // Rows of 32 px; the box's foot at 600 slices the row from 580 to 612.
    expect(rowCut(600, 500, rows([516, 548], [548, 580], [580, 612], [612, 644]), 10)).toBe(10);
  });

  it('leaves the plain fade when the foot falls between rows or through a bottom padding', () => {
    expect(rowCut(600, 500, rows([548, 580], [580, 600], [600, 632]), 10)).toBe(0);
    expect(rowCut(600, 500, rows([570, 603], [603, 635]), 10)).toBe(0);
  });

  it('leaves the plain fade over a row whose top already sits in it', () => {
    expect(rowCut(600, 500, rows([560, 594], [594, 626]), 10)).toBe(0);
  });

  it('keeps a card whose title ends above the fade, and takes one away whole, with no strip of its ground, short of that', () => {
    // A card from 560 whose title ends at 584: it reads as a card, the fade over its foot.
    expect(rowCut(600, 500, [{ top: 520, bottom: 560 }, { top: 560, bottom: 680, title: 584 }], 10)).toBe(0);
    // Its title would end at 596, in the fade: the card goes from its top.
    expect(rowCut(600, 500, [{ top: 520, bottom: 560 }, { top: 560, bottom: 680, title: 596 }], 10)).toBe(40);
    // A card head the foot slices goes with its card, from the card's top; a whole head leaves its rows to the rule.
    expect(rowCut(600, 500, [{ top: 548, bottom: 580 }, { top: 580, bottom: 624, title: 624 }], 10)).toBe(20);
    expect(rowCut(600, 500, [{ top: 500, bottom: 544, title: 544 }, { top: 544, bottom: 576 }, { top: 576, bottom: 608 }], 10)).toBe(14);
  });

  it('never cuts a hole taller than a third of the box', () => {
    expect(rowCut(600, 120, rows([520, 680]), 10)).toBe(0);
  });

  it('is zero when every row fits', () => {
    expect(rowCut(600, 500, rows([100, 140], [140, 180]), 10)).toBe(0);
  });
});

describe('watchRowCut', () => {
  it('cuts at rest, never while the list scrolls, and stops when asked', () => {
    vi.useFakeTimers();
    try {
      const box = document.createElement('div');
      box.style.setProperty('--fade', '10px');
      box.getBoundingClientRect = () => ({ top: 100, bottom: 600, height: 500 }) as DOMRect;
      for (const [top, bottom] of [[548, 580], [580, 612]]) {
        const row = document.createElement('button');
        row.dataset['testid'] = 'thread-row';
        row.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
        box.append(row);
      }
      document.body.append(box);
      const set = vi.fn();
      const stop = watchRowCut(box, set);
      vi.advanceTimersByTime(0);
      expect(set).toHaveBeenLastCalledWith(10);
      box.dispatchEvent(new Event('scroll'));
      expect(set).toHaveBeenLastCalledWith(0);
      vi.advanceTimersByTime(139);
      expect(set).toHaveBeenLastCalledWith(0);
      vi.advanceTimersByTime(1);
      expect(set).toHaveBeenLastCalledWith(10);
      stop();
      set.mockClear();
      box.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(200);
      expect(set).not.toHaveBeenCalled();
      box.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures the phone list\'s rows and project headings above its tabs', () => {
    vi.useFakeTimers();
    try {
      const box = document.createElement('section');
      box.style.setProperty('--fade', '10px');
      box.getBoundingClientRect = () => ({ top: 61, bottom: 735, height: 674 }) as DOMRect;
      // A row ending above the tabs, then a project heading they slice, then its first row out of sight: the card goes
      // from its top, its heading's.
      for (const [top, bottom, mark] of [[640, 700, 'row'], [700, 744, 'heading'], [744, 830, 'row']] as const) {
        const edge = document.createElement('div');
        edge.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
        if (mark === 'row') { edge.dataset['testid'] = 'mobile-row'; box.append(edge); continue; }
        edge.dataset['rowEdge'] = '';
        const card = document.createElement('section');
        card.dataset['testid'] = 'mobile-project-group';
        card.getBoundingClientRect = () => ({ top, bottom: 900 }) as DOMRect;
        card.append(edge);
        box.append(card);
      }
      document.body.append(box);
      const set = vi.fn();
      const stop = watchRowCut(box, set);
      vi.advanceTimersByTime(0);
      expect(set).toHaveBeenLastCalledWith(35);
      stop();
      box.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
