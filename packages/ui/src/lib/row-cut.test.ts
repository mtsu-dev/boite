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
      // A row ending above the tabs, then a project heading they slice, then its first row out of sight.
      for (const [top, bottom, mark] of [[640, 700, 'row'], [700, 744, 'heading'], [744, 830, 'row']] as const) {
        const edge = document.createElement('div');
        if (mark === 'row') edge.dataset['testid'] = 'mobile-row'; else edge.dataset['rowEdge'] = '';
        edge.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
        box.append(edge);
      }
      document.body.append(box);
      const set = vi.fn();
      const stop = watchRowCut(box, set);
      vi.advanceTimersByTime(0);
      expect(set).toHaveBeenLastCalledWith(25);
      stop();
      box.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
