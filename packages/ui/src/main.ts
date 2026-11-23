import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { registerServiceWorker } from './lib/sw';
import { startLocale } from './lib/i18n.svelte';
import { showBootFailure } from './lib/boot-failure';
import { applyChatWidth, readChatWidth } from './lib/chat-width';
import { startZoom } from './lib/zoom';
import { desktopShell, mobileApp } from './lib/shell-platform';

// Every import above parsed and ran: index.html's too-old-browser notice stands down.
(window as { __boiteBooted?: boolean }).__boiteBooted = true;

const found = document.getElementById('app');
if (!found) throw new Error('index.html is missing the #app element');
const target: HTMLElement = found;

registerServiceWorker();
// The Android app hears its Back before the WebView's history does.
if (mobileApp()) void import('./lib/android-back').then(({ startAndroidBack }) => startAndroidBack());
// The stored column width, before the first frame lays the chat out.
applyChatWidth(readChatWidth());

const quotas = new URLSearchParams(location.search).get('view') === 'quotas';

// The stored interface zoom, asked of the shell beside the language: the
// window stays hidden until both have landed, so it never shows at 100 % and
// jumps. The quota popup is its own webview and keeps its size.
const zoomed = quotas ? Promise.resolve() : startZoom();

// The page shows its own startup status while the files are arriving. The app
// mounts in the chosen language and with its styles already applied. Every
// language, English included, is its own chunk, which index.html preloaded.
// A promise chain rather than a top-level await: with one, Rolldown split the
// entry into twice as many startup files. The quota window is a chunk of its own.
function boot(): Promise<void> {
  return Promise.all([startLocale(), loadBootStyles()]).then(async () => {
    mount(quotas ? (await import('./QuotaApp.svelte')).default : App, { target });
    document.getElementById('boot-status')?.remove();
    // Edge scrollbars and load on press follow their switches for the page's life.
    if (!quotas) void import('./lib/interactions').then(({ startInteractions }) => startInteractions());
    revealShell();
  });
}

function loadBootStyles(): Promise<unknown> {
  return Promise.all([...document.querySelectorAll<HTMLLinkElement>('link[data-boot-style]')].map((preload) => {
    const loaded = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some((link) => link.href === preload.href && link.sheet !== null);
    if (loaded) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = preload.href;
    if (preload.crossOrigin !== null) style.crossOrigin = preload.crossOrigin;
    return new Promise<void>((resolve, reject) => {
      style.onload = () => resolve();
      style.onerror = () => {
        style.remove();
        reject(new Error(`Could not load ${style.href}`));
      };
      preload.after(style);
    });
  }));
}
boot().catch(() => {
  // No catalogue at all: no app, which would have no sentence to draw, but a
  // notice that retries (`lib/boot-failure.ts`), in a window the shell shows.
  showBootFailure(target, boot);
  revealShell();
});

/**
 * The shell builds its window hidden and shows it once this page has painted,
 * so a slow core start shows the page's own "Starting" instead of nothing and
 * a fast one never flashes an empty frame. Two frames: the first is when the
 * mount is laid out, the second when it has reached the screen.
 */
function revealShell(): void {
  // The Android app reports its first frame as fully drawn (apps/mobile MainActivity).
  const android = (window as { BoiteAndroid?: { ready(): void } }).BoiteAndroid;
  if (android) requestAnimationFrame(() => requestAnimationFrame(() => android.ready()));
  if (quotas || !desktopShell()) return;
  void zoomed.then(() => {
    let sent = false;
    const ready = () => {
      if (sent) return;
      sent = true;
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('shell_ready')).catch(() => {
        // An older shell without the command shows its window on its own.
      });
    };
    // WebView2 keeps painting in a hidden window. WebKit, on macOS and Linux,
    // runs no frame callback for a window that is not on screen, so waiting on
    // one held the window back until the shell's ten-second fallback.
    if (document.visibilityState === 'hidden') ready();
    else if (!navigator.userAgent.includes('Windows')) setTimeout(ready, 100);
    requestAnimationFrame(() => requestAnimationFrame(ready));
  });
}
