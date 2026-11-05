import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  permissionModeLong: {
    default: 'Lit librement, demande avant chaque modif ou commande',
    acceptEdits: 'Modifie sans demander, demande avant chaque commande',
    bypassPermissions: 'Lance tout sur cet ordinateur, les hooks vérifient',
    yolo: 'Approuve tout, hooks Claude et Codex coupés',
    plan: 'Planifie seulement, ne change rien',
    dontAsk: 'Refuse tout ce qui demanderait une autorisation'
  }
};
