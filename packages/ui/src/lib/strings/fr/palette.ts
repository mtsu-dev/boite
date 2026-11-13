import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  palette: {
    placeholder: 'Cherchez une conversation, un projet ou une commande',
    projects: 'Projets',
    /** Extra words a project row answers to: picking one starts a thread there. */
    newThreadWords: 'nouvelle conversation démarrer brouillon new thread',
    find: 'Chercher dans cette conversation',
    terminal: 'Afficher ou masquer le terminal',
    commands: 'Commandes',
    empty: 'Rien ne correspond.',
    newThread: 'Nouvelle conversation',
    subagentOf: 'dans {parent}',
    addProject: 'Ajouter un projet',
    importSession: 'Importer une session',
    settings: 'Ouvrir les réglages',
    appearance: "Réglages de l'apparence",
    providers: 'Comptes IA',
    pair: 'Ajouter un appareil',
    sidebar: 'Afficher ou masquer la barre latérale',
    panel: 'Afficher ou masquer le panneau',
    trace: 'Afficher la trace',
    changes: 'Afficher les modifications',
    files: 'Afficher les fichiers',
    tasks: 'Afficher les tâches',
    subagents: 'Afficher les sous-agents',
    agents: 'Ouvrir les bots',
    pin: 'Épingler cette conversation',
    unpin: 'Désépingler cette conversation',
    rename: 'Renommer cette conversation',
    retitle: 'Regénérer le titre de cette conversation',
    archive: 'Archiver cette conversation',
    themeDark: 'Thème : sombre',
    themeLight: 'Thème : clair',
    themeSystem: 'Thème : système',
    oldPages: {
      settings: 'général système avancé extensions expérimentations navigateur mises à jour general system advanced plugins experiments browser updates',
      appearance: 'style langue look language',
      providers: 'fournisseurs limites consommation quotas providers limits usage',
      pair: 'machines',
      taskManager: 'diagnostic ressources mémoire processus diagnostics resources',
      archived: 'général conversations general'
    }
  }
};
