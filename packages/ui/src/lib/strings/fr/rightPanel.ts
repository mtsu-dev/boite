import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  rightPanel: {
    backToChat: 'Revenir à la discussion',
    resize: 'Redimensionner le panneau, double-clic pour réinitialiser',
    maximize: 'Agrandir le panneau',
    restore: 'Restaurer le panneau',
    scrollLeft: 'Faire défiler les onglets vers la gauche',
    scrollRight: 'Faire défiler les onglets vers la droite',
    closeTab: 'Fermer {title}',
    closeOthers: 'Fermer les autres',
    closeToRight: 'Fermer à droite',
    closeAll: 'Tout fermer',
    trace: 'Processus',
    browser: 'Navigateur',
    changes: 'Modifications',
    files: 'Fichiers',
    file: 'Fichier',
    tasks: 'Gestionnaire de tâches',
    device: 'Appareil',
    window: 'Fenêtre',
    ownerOnly: "Seulement dans l'application du propriétaire",
    launcher: 'Ouvrir une surface dans ce panneau',
    untitled: 'Navigateur',
    roles: { board: 'Les tâches du projet en colonnes', tasks: 'Objectif, liste et suivis de cette conversation' },
    groups: { recent: 'Récents', work: 'Travail', agents: 'Agents', tools: 'Outils' },
    formerly: {
      trace: 'Anciennement Trace', tasks: 'Anciennement Tâches', messages: 'Anciennement Discussions',
      coordination: 'Anciennement Liens entre conversations', customize: 'Anciennement Choisir les boutons'
    }
  }
};
