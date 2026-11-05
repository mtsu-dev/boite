import { afterEach, expect, test } from 'vitest';
import { toastSpot } from './toast-anchor';

afterEach(() => { document.body.innerHTML = ''; });

function boxed(html: string, boxes: Record<string, Partial<DOMRect>>): void {
  document.body.innerHTML = html;
  for (const [selector, box] of Object.entries(boxes)) {
    const element = document.querySelector(selector)!;
    const rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, ...box };
    element.getBoundingClientRect = () => rect as DOMRect;
  }
}

test('a toast sits 12 px above the composer and centred on it, else above the tab bar, else above the card bottom', () => {
  boxed('<div class="body"><div class="framed"><div data-testid="composer"></div></div></div><nav data-testid="mobile-tabs"></nav>', {
    '[data-testid="composer"]': { left: 300, width: 600, top: 700, height: 120 },
    '[data-testid="mobile-tabs"]': { left: 0, width: 390, top: 780, height: 64 },
    '.framed': { left: 280, width: 640, top: 40, height: 820, bottom: 860 },
  });
  expect(toastSpot(document, 1200, 900)).toEqual({ x: 600, bottom: 212 });

  // A hidden composer (the phone list) gives way to the tab bar.
  document.querySelector('[data-testid="composer"]')!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
  expect(toastSpot(document, 390, 844)).toEqual({ x: 195, bottom: 844 - 780 + 12 });

  document.querySelector('[data-testid="mobile-tabs"]')!.remove();
  expect(toastSpot(document, 1200, 900)).toEqual({ x: 600, bottom: 52 });
});

test('a toast clears the status strip and the queued chips stacked on the composer, not a hidden task band', () => {
  boxed('<div data-testid="status-strip"></div><div data-testid="composer-queued"></div><section data-testid="thread-activity" class="hidden"></section><div data-testid="composer"></div>', {
    '[data-testid="status-strip"]': { left: 300, width: 600, top: 640, height: 24 },
    '[data-testid="composer-queued"]': { left: 300, width: 300, top: 672, height: 24 },
    '[data-testid="thread-activity"]': { left: 300, width: 600, top: 400, height: 200 },
    '[data-testid="composer"]': { left: 300, width: 600, top: 700, height: 120 },
  });
  expect(toastSpot(document, 1200, 900)).toEqual({ x: 600, bottom: 900 - 640 + 12 });

  // An open band stands on the dock too.
  document.querySelector('[data-testid="thread-activity"]')!.classList.remove('hidden');
  expect(toastSpot(document, 1200, 900)).toEqual({ x: 600, bottom: 900 - 400 + 12 });
});
