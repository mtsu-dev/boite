import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  /** Finished features, each switched from the Settings page it belongs to. */
  features: {
    chatArtifacts: { title: 'Fichiers et aperçus dans le chat', hint: 'Ouvrir les liens de fichiers et afficher les fichiers envoyés par un agent dans le fil' },
    openChatLinks: { title: 'Ouvrir les liens du chat dans leurs applications', hint: 'Sur ce bureau, un clic sur un document ou un dossier du dossier de la conversation l\'ouvre dans son application. Les programmes, scripts et raccourcis ne sont jamais ouverts : ils s\'affichent dans l\'aperçu. Seuls les liens de cet ordinateur sont ouverts.' },
    previewComments: { title: 'Commentaires sur les aperçus', hint: 'Sélectionner un élément dans le navigateur intégré et l’ajouter au brouillon du fil' },
    edgeScrollbars: {
      title: 'Masquer les barres de défilement loin du pointeur',
      hint: 'Elles ne prennent pas de place et restent déplaçables. Souris et stylet uniquement'
    },
    whip: {
      title: 'Fouet',
      hint: 'Un bouton Fouet à côté des autres commandes : un fouet animé suit le pointeur ou le doigt. Un geste vif le fait claquer, un clic ou un appui le lâche',
      action: 'Sortir le fouet',
      drop: 'Lâcher le fouet',
      off: "Le fouet a besoin des animations, désactivées dans les réglages du système (Windows : Accessibilité > Effets visuels > Effets d'animation)"
    },
  }
};
