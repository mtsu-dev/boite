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
    tasks: 'Objectif et tâches',
    device: 'Appareil',
    window: 'Fenêtre',
    ownerOnly: "Seulement dans l'application du propriétaire",
    launcher: 'Ouvrir une surface dans ce panneau',
    untitled: 'Navigateur',
    closePanel: 'Fermer le panneau',
    roles: {
      board: 'Les tâches de tout le projet, en colonnes', tasks: 'Objectif, boucle, tâches et suivis de cette conversation',
      trace: 'Les programmes que lance cette conversation', messages: 'Ce que cet agent et les autres agents se sont écrit',
      coordination: "Laisser d'autres agents trouver cette conversation et lui écrire"
    },
    groups: { recent: 'Récents', work: 'Travail', agents: 'Agents', tools: 'Outils' },
    formerly: {
      trace: 'Anciennement Trace', tasks: 'Anciennement Gestionnaire de tâches', messages: 'Anciennement Discussions',
      coordination: 'Anciennement Liens entre conversations', customize: 'Anciennement Choisir les boutons'
    }
  }
};
