import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  /** Finished features, each switched from the Settings page it belongs to. */
  features: {
    chatArtifacts: { title: 'Fichiers et aperçus dans le chat', hint: 'Ouvrir les liens de fichiers et afficher les fichiers envoyés par un agent dans la conversation' },
    openChatLinks: { title: 'Ouvrir les liens du chat dans leurs applications', hint: 'Sur ce bureau, un clic sur un fichier ou dossier local ouvre son application, y compris les raccourcis et les fichiers hors du projet. Seuls les liens de cet ordinateur sont ouverts.' },
    previewComments: { title: 'Commentaires sur les aperçus', hint: 'Sélectionner un élément dans le navigateur intégré et l’ajouter au brouillon de la conversation' },
    edgeScrollbars: {
      title: 'Masquer les barres de défilement loin du pointeur',
      hint: 'Elles ne prennent pas de place et restent déplaçables. Souris et stylet uniquement'
    },
  }
};
