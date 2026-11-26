import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseChord } from '@boite/contracts';
import { dragScroll, edgeOpacity, FULL_DISTANCE, MIN_THUMB, REVEAL_DISTANCE, startEdgeScrollbars, thumbSpan } from './edge-scrollbars';
import { watchZoomWheel } from './zoom';

vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }) }));

describe('edgeOpacity', () => {
  it('is hidden past the reveal distance, full near the edge and rises in between', () => {
    expect(edgeOpacity(REVEAL_DISTANCE)).toBe(0);
    expect(edgeOpacity(400)).toBe(0);
    expect(edgeOpacity(FULL_DISTANCE)).toBe(1);
    expect(edgeOpacity(0)).toBe(1);
    const samples = [120, 100, 80, 60, 40].map((distance) => edgeOpacity(distance));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]!);
    expect(samples[0]).toBeGreaterThan(0);
    expect(samples.at(-1)).toBeLessThan(1);
  });
});

describe('thumbSpan', () => {
  it('sizes the thumb by the share in view and places it by the scroll position', () => {
    expect(thumbSpan(0, 2000, 500, 400)).toEqual({ length: 100, offset: 0 });
    expect(thumbSpan(1500, 2000, 500, 400)).toEqual({ length: 100, offset: 300 });
    expect(thumbSpan(750, 2000, 500, 400)).toEqual({ length: 100, offset: 150 });
  });

  it('keeps a grabbable length on a very long list and stays inside its track', () => {
    const span = thumbSpan(1e6, 1e6, 500, 400)!;
    expect(span.length).toBe(MIN_THUMB);
    expect(span.offset + span.length).toBeLessThanOrEqual(400);
  });

  it('draws nothing when there is nothing to scroll', () => {
    expect(thumbSpan(0, 500, 500, 400)).toBeNull();
  });
});

describe('dragScroll', () => {
  it('moves the content in proportion and stops at both ends', () => {
    // 300 px of track room for 1500 px of scroll: one track pixel is five content pixels.
    expect(dragScroll(0, 60, 2000, 500, 400, 100)).toBe(300);
    expect(dragScroll(0, -60, 2000, 500, 400, 100)).toBe(0);
    expect(dragScroll(1000, 500, 2000, 500, 400, 100)).toBe(1500);
  });
});

describe('startEdgeScrollbars', () => {
  type Query = EventTarget & { media: string; matches: boolean };
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; document.documentElement.className = ''; });

  function media(fine: boolean) {
    const queries = new Map<string, Query>();
    window.matchMedia = vi.fn((text: string) => {
      const query = queries.get(text) ?? Object.assign(new EventTarget(), { media: text, matches: text.includes('pointer: fine') ? fine : false });
      queries.set(text, query);
      return query as unknown as MediaQueryList;
    });
    return (text: string, matches: boolean) => {
      const query = [...queries.values()].find((entry) => entry.media.includes(text))!;
      query.matches = matches;
      query.dispatchEvent(new Event('change'));
    };
  }

  const on = () => document.documentElement.classList.contains('edge-scrollbars') && document.querySelector('.edge-scrollbar-layer') !== null;

  it('follows the pointer and forced colours, and leaves nothing behind when stopped', () => {
    const change = media(true);
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const addedOnDocument = vi.spyOn(document, 'addEventListener');
    const removedOnDocument = vi.spyOn(document, 'removeEventListener');
    const stop = startEdgeScrollbars();
    expect(on()).toBe(true);
    change('forced-colors', true);
    expect(on()).toBe(false);
    change('forced-colors', false);
    change('pointer: fine', false);
    expect(on()).toBe(false);
    change('pointer: fine', true);
    expect(on()).toBe(true);
    stop();
    expect(on()).toBe(false);
    expect(document.querySelector('.edge-scrollbar-layer')).toBeNull();
    const count = (calls: unknown[][]) => calls.map(([type, listener]) => `${String(type)}:${String(listener)}`).sort();
    expect(count(removed.mock.calls)).toEqual(count(added.mock.calls));
    // The popover watch lives on the document: it goes with the rest.
    expect(addedOnDocument.mock.calls.length).toBeGreaterThan(0);
    expect(count(removedOnDocument.mock.calls)).toEqual(count(addedOnDocument.mock.calls));
    // The display changing after stop starts nothing again.
    change('pointer: fine', false);
    change('pointer: fine', true);
    expect(on()).toBe(false);
    added.mockRestore();
    removed.mockRestore();
    addedOnDocument.mockRestore();
    removedOnDocument.mockRestore();
  });

  it('the wheel over a thumb scrolls its container, unless the zoom\'s bound chord takes that wheel', () => {
    media(true);
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
    const flush = () => { for (const callback of frames.splice(0)) callback(0); };
    const list = document.body.appendChild(document.createElement('div'));
    list.style.overflowY = 'auto';
    for (const [name, value] of Object.entries({ offsetWidth: 200, offsetHeight: 200, clientWidth: 200, clientHeight: 200, scrollHeight: 1000 })) {
      Object.defineProperty(list, name, { configurable: true, value });
    }
    list.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) });
    const scrolled = vi.fn();
    list.scrollBy = scrolled as typeof list.scrollBy;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const stop = startEdgeScrollbars();
    let unzoom = () => {};
    try {
      list.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 196, clientY: 50 }));
      flush();
      const thumb = document.querySelector<HTMLDivElement>('.edge-scrollbar-thumb')!;
      expect(thumb).not.toBeNull();
      const turn = (init: WheelEventInit) => thumb.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40, ...init }));
      // No chord, the default: Ctrl with the wheel scrolls as any wheel does.
      turn({ ctrlKey: true });
      expect(scrolled).toHaveBeenCalledTimes(1);
      const bind = (text: string) => {
        unzoom();
        const parsed = parseChord(text);
        if (!parsed.ok) throw new Error(parsed.reason);
        unzoom = watchZoomWheel(parsed.chord, () => undefined, false);
      };
      bind('mod+wheel');
      turn({ ctrlKey: true });
      expect(scrolled).toHaveBeenCalledTimes(1);
      turn({ ctrlKey: true, altKey: true });
      expect(scrolled).toHaveBeenCalledTimes(2);
      bind('alt+wheel');
      turn({ altKey: true });
      expect(scrolled).toHaveBeenCalledTimes(2);
      turn({ ctrlKey: true });
      expect(scrolled).toHaveBeenCalledTimes(3);
    } finally {
      unzoom();
      stop();
      raf.mockRestore();
      list.remove();
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it('leaves a touch-only display alone', () => {
    media(false);
    const stop = startEdgeScrollbars();
    expect(on()).toBe(false);
    stop();
  });
});
