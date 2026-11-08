import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  permissionModeLine: {
    default: 'Demande avant de modifier un fichier ou de lancer une commande',
    acceptEdits: 'Modifie les fichiers seul, demande avant les commandes',
    bypassPermissions: 'Lance tout sans demander',
    yolo: 'Lance tout et ignore vos hooks',
    plan: 'Planifie seulement, ne change rien',
    dontAsk: 'Refuse tout ce qui demanderait une autorisation'
  }
};
