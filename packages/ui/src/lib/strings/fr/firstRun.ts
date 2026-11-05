import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  firstRun: {
    heading: 'Ouvrir un projet',
    deviceBody: "Les projets s'ouvrent depuis l'application où tourne le cœur. Ceux qu'il détient apparaissent ici.",
    pathPlaceholder: 'Chemin absolu du dossier',
    welcome: 'Bienvenue dans Boite',
    welcomeBody: 'Deux étapes, et une IA peut se mettre au travail pour vous.',
    steps: 'Pour commencer',
    connect: 'Connecter une IA',
    connectHint: 'Connectez-vous avec Claude, ChatGPT ou un autre assistant auquel vous êtes déjà abonné.',
    connected: 'IA connectée',
    folder: 'Choisir un dossier',
    folderHint: "L'IA travaille sur les fichiers qu'il contient. Seulement ce dossier.",
    folderReady: 'Dossier prêt',
    skipFolder: 'Commencer sans dossier',
    doneStep: 'Fait',
    stepNumber: 'Étape {index}',
    elsewhere: "Connectez d'abord une IA et choisissez un dossier dans Boite sur votre ordinateur.",
  },
  inbox: {
    label: 'Réception',
    needsYou: 'À vous',
    threadsCount: '{count} conversations',
    botsCount: '{count} venant des bots',
    bot: 'Bot',
    workingNow: 'Au travail',
    nothing: 'Rien ne vous attend',
    more: 'Tout voir ({count})',
    fewer: 'Afficher moins',
    offline: 'Hors ligne',
    offlineHint: 'En attente sur une machine déconnectée. Non compté tant qu’elle n’est pas revenue.',
    reasons: {
      question: 'Vous pose une question',
      permission: 'Demande votre permission',
      secret: 'A besoin d\'une clé',
      'sign-in': 'Vous demande de vous connecter',
      failed: 'Échec',
      interrupted: 'Arrêté avant la fin'
    },
    reasonTags: {
      question: 'Question',
      permission: 'Permission',
      secret: 'Clé',
      'sign-in': 'Connexion',
      failed: 'Échec',
      interrupted: 'Arrêté'
    },
    waited: 'Attend depuis {time}',
    working: 'Travaille depuis {time}',
    open: 'Ouvrir {title}',
  }
};
