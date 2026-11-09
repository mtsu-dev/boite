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
    findPanel: 'Chercher un panneau',
    noPanelMatch: 'Aucun panneau ne correspond',
    roles: {
      board: 'Les tâches de tout le projet, en colonnes', tasks: 'Objectif, boucle, tâches et suivis de cette conversation',
      trace: 'Les programmes que lance cette conversation', messages: 'Ce que cet agent et les autres agents se sont écrit',
      coordination: "Laisser d'autres agents trouver cette conversation et lui écrire",
      changes: 'Ce que cette conversation a changé dans le code, fichier par fichier', files: 'Parcourir et lire les fichiers du projet',
      browser: 'La page web que regardent cette conversation et son agent', device: "Un écran de téléphone ou d'émulateur que l'agent pilote",
      desk: 'Le travail en cours de ce bot, ses routines et sa mémoire', agents: "Les agents d'aide que cette conversation a lancés",
      terminal: 'Une ligne de commande dans le dossier du projet', customize: 'Choisir les panneaux que cette liste propose'
    },
    groups: { used: 'Utilisés dans cette conversation', work: 'Travail', agents: 'Agents', tools: 'Outils' },
    formerly: {
      trace: 'Anciennement Trace', tasks: 'Anciennement Gestionnaire de tâches', messages: 'Anciennement Discussions',
      coordination: 'Anciennement Liens entre conversations', customize: 'Anciennement Choisir les boutons'
    }
  }
};
