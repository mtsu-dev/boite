/**
 * The Android app's build (`vite build --mode mobile`). It runs inside Tauri
 * too, but as a remote client like the phone web app: no local core, no
 * desktop windows.
 */
export const MOBILE_BUILD: boolean = import.meta.env.MODE === 'mobile';

/** Whether this page runs inside any Tauri app, the desktop shell or the Android app. */
export function tauriApp(): boolean {
  // Cast rather than the app's Window type: the end to end tests compile this file without it.
  return typeof window !== 'undefined' && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

/** Whether this page runs in the desktop shell, the one that starts and owns a core. */
export function desktopShell(): boolean {
  return !MOBILE_BUILD && tauriApp();
}

/** Whether this page runs in the Android app. */
export function mobileApp(): boolean {
  return MOBILE_BUILD && tauriApp();
}

/**
 * Whether this page runs in the Linux desktop shell, whose WebKitGTK webview
 * lacks two things the Windows and macOS shells have. A child webview is packed
 * into the window's vertical GTK box, where it cannot be moved or sized, so the
 * browser panel took the lower half of the window whatever the slot measured.
 * And media capture is off, so dictation cannot reach the microphone.
 */
export function linuxShell(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return desktopShell()
    && /\bLinux\b/.test(userAgent) && !/\bAndroid\b/.test(userAgent);
}

/** Whether this page runs in the Windows desktop shell, the one whose browser is WebView2. */
export function windowsShell(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return desktopShell() && /\bWindows\b/.test(userAgent);
}
