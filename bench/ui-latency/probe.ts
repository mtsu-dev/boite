export interface ClickSample {
  paintMs: number;
  stableMs: number;
}

interface AnimationFrame extends PerformanceEntry {
  blockingDuration: number;
  scripts: Array<{
    sourceURL: string;
    sourceFunctionName: string;
    sourceCharPosition: number;
    invoker: string;
    duration: number;
    forcedStyleAndLayoutDuration: number;
  }>;
}

export interface FrameSample {
  gaps: number[];
  longTasks: Array<{ atMs: number; duration: number }>;
  longFrames: Array<{ atMs: number; duration: number; blockingDuration: number; scripts: AnimationFrame['scripts'] }>;
}

/** Serialized by CDP and evaluated in the browser, before navigation. */
export function installProbe(): void {
  const inputMs: number[] = [];
  const supported = PerformanceObserver.supportedEntryTypes;

  // A task posted from rAF samples after that rendering opportunity,
  // with no extra frame or CDP round trip in the measurement.
  const channel = new MessageChannel();
  const callbacks: Array<() => void> = [];
  channel.port1.onmessage = () => callbacks.shift()?.();
  const afterPaint = () => new Promise<void>(done => requestAnimationFrame(() => {
    callbacks.push(done);
    channel.port2.postMessage(0);
  }));

  document.addEventListener('input', event => {
    if (!(event.target instanceof Element) || !event.target.matches('[data-testid=composer-input]')) return;
    const start = event.timeStamp;
    void afterPaint().then(() => inputMs.push(performance.now() - start));
  }, true);

  let clickResult: Promise<ClickSample> | undefined;
  function armClick(selector: string, view: () => Element | null, label: string): void {
    clickResult = new Promise((resolve, reject) => {
      const listener = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || !event.target.closest(selector)) return;
        document.removeEventListener('click', listener, true);
        clearTimeout(timeout);
        performance.mark(label + '/click', { startTime: event.timeStamp });
        void settleView(view, event.timeStamp, label).then(resolve, reject);
      };
      const timeout = setTimeout(() => {
        document.removeEventListener('click', listener, true);
        reject(new Error('Click did not reach ' + selector));
      }, 5000);
      document.addEventListener('click', listener, true);
    });
    void clickResult.catch(() => undefined);
  }

  async function settleView(view: () => Element | null, start: number, label: string): Promise<ClickSample> {
    let paintMs: number | undefined;
    let root: Element | null = null;
    let quietFrames = 0;
    let changed = false;
    let bounds = '';
    let animations: Animation[] = [];
    const observer = new MutationObserver(() => { changed = true; });
    try {
      while (performance.now() - start < 12_000) {
        await afterPaint();
        const next = view();
        if (root !== next) {
          observer.disconnect();
          root = next;
          if (root) observer.observe(root, {
            childList: true, subtree: true, characterData: true,
            attributeFilter: ['hidden', 'aria-busy', 'data-loading'],
          });
          changed = true;
        }
        if (!root || !root.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
          quietFrames = 0;
          continue;
        }
        if (paintMs === undefined) {
          paintMs = performance.now() - start;
          performance.mark(label + '/first-paint');
        }
        animations = root.getAnimations({ subtree: true }).filter(animation =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
          && animation.timeline === document.timeline
          && (animation.playState === 'running' || animation.pending)
          && (!(animation.effect instanceof KeyframeEffect) || animation.effect.target?.checkVisibility({ contentVisibilityAuto: true }) !== false));
        const { x, y, width, height } = root.getBoundingClientRect();
        const nextBounds = [x, y, width, height].join(',');
        quietFrames = changed || bounds !== nextBounds || animations.length > 0 || document.fonts.status !== 'loaded' ? 0 : quietFrames + 1;
        bounds = nextBounds;
        changed = false;
        if (quietFrames === 3) {
          performance.mark(label + '/stable');
          return { paintMs, stableMs: performance.now() - start };
        }
      }
      const pending = animations.map(animation => animation instanceof CSSAnimation ? animation.animationName
        : animation instanceof CSSTransition ? animation.transitionProperty : 'Web Animation');
      throw new Error('View did not become stable: ' + label
        + ` (painted=${paintMs !== undefined}, fonts=${document.fonts.status}, animations=${pending.join(',')})`);
    } finally {
      observer.disconnect();
    }
  }

  async function frames(ms: number, label: string): Promise<FrameSample> {
    const tasks: PerformanceEntry[] = [];
    const long: PerformanceEntry[] = [];
    const taskObserver = new PerformanceObserver(list => tasks.push(...list.getEntries()));
    const frameObserver = new PerformanceObserver(list => long.push(...list.getEntries()));
    if (supported.includes('longtask')) taskObserver.observe({ type: 'longtask' });
    if (supported.includes('long-animation-frame')) frameObserver.observe({ type: 'long-animation-frame' });
    const start = performance.now();
    performance.mark(label + '/begin');
    const stamps: number[] = [];
    const end = await new Promise<number>(done => {
      const frame = (time: number) => {
        stamps.push(time);
        if (time - start < ms) requestAnimationFrame(frame);
        else done(time);
      };
      requestAnimationFrame(frame);
    });
    await afterPaint();
    tasks.push(...taskObserver.takeRecords());
    long.push(...frameObserver.takeRecords());
    taskObserver.disconnect();
    frameObserver.disconnect();
    performance.mark(label + '/end');
    const within = (entry: PerformanceEntry) => entry.startTime >= start && entry.startTime < end;
    return {
      gaps: stamps.slice(1).map((stamp, index) => stamp - stamps[index]!),
      longTasks: tasks.filter(within).map(entry => ({ atMs: entry.startTime - start, duration: entry.duration })),
      longFrames: (long.filter(within) as AnimationFrame[]).map(entry => ({
        atMs: entry.startTime - start, duration: entry.duration, blockingDuration: entry.blockingDuration,
        scripts: entry.scripts.map(({ sourceURL, sourceFunctionName, sourceCharPosition, invoker, duration, forcedStyleAndLayoutDuration }) =>
          ({ sourceURL, sourceFunctionName, sourceCharPosition, invoker, duration, forcedStyleAndLayoutDuration })),
      })),
    };
  }

  Object.assign(globalThis, { __latency: {
    afterPaint, armClick, click: () => clickResult, inputMs, frames,
    supported: { longTask: supported.includes('longtask'), longFrame: supported.includes('long-animation-frame') },
  } });
}
