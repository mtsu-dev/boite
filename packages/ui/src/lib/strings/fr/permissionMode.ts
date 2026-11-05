import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  permissionMode: {
    default: 'Demander à chaque fois',
    acceptEdits: 'Modifs auto',
    bypassPermissions: 'Tout exécuter, garde-fous actifs',
    yolo: 'Accès total, sans garde-fous',
    plan: 'Plan',
    dontAsk: 'Tout refuser'
  },
  permissionModeWas: {
    default: 'Demander',
    acceptEdits: 'Modifier librement',
    bypassPermissions: 'Auto',
    yolo: 'YOLO',
    plan: 'Plan',
    dontAsk: 'Tout refuser',
    line: 'Anciennement {name}'
  }
};
