import { strings } from './strings';

/**
 * Sends the tray menu its words. The menu is native: it speaks the UI's
 * language only when told, so the shell calls this at start and, from an
 * effect that tracks the strings read here, whenever the language changes.
 */
export function sendTrayLabels(): void {
  const labels = { show: strings.quotas.trayShow, quit: strings.quotas.trayQuit };
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('tray_labels', labels))
    .catch(() => {
      // An older shell without the command keeps its English menu.
    });
}
