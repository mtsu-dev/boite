/**
 * The Android app's Back, answered by the page itself (`docs/internals/android-native.md#back`).
 *
 * Without a listener, Tauri turns Back into the WebView's own history
 * navigation, a round trip through the browser's navigation before the page
 * hears of it. With one, the page closes its top overlay in the same task
 * (`answerBack`). Wider than a phone, where nothing is an overlay, Back walks
 * the views this window showed (`view-history.svelte.ts`). With nothing left
 * to close, the app goes to the background as Android's own Back does, and
 * stays loaded.
 */
import { answerBack } from './mobile-history';
import { go } from './view-history.svelte';

type Bridge = { leave?(): void };

const leave = (): void => (window as { BoiteAndroid?: Bridge }).BoiteAndroid?.leave?.();

export function answerAndroidBack(): void {
  if (answerBack()) return;
  // The views behind may all be gone: only the walk itself knows whether one is left.
  if (!matchMedia('(max-width: 720px)').matches) void go(-1).then((moved) => { if (!moved) leave(); });
  else leave();
}

export function startAndroidBack(): void {
  void import('@tauri-apps/api/app')
    .then(({ onBackButtonPress }) => onBackButtonPress(answerAndroidBack))
    // No listener: Tauri keeps its history navigation, slower but whole.
    .catch(() => {});
}
