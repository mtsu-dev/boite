import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  app: {
    name: 'Boite',
    nightlyName: 'boite (de nuit)',
    channelDev: 'Dev',
    channelDevTitle: 'Le canal dev, sur son propre répertoire de données',
    loading: 'Démarrage',
    compacting: "Libération d'espace disque dans l'historique. Cela n'arrive qu'une fois et peut prendre quelques minutes.",
    noEndpointTitle: 'Aucun cœur à joindre',
    noEndpointBody:
      "Sur l'une de vos machines, ouvrez Réglages, Machines, Ajouter un appareil, puis scannez ou tapez son code ici.",
    openSettings: 'Ouvrir les réglages',
    rail: {
      label: 'Boite',
      waitingOne: '1 a besoin de vous',
      waitingMany: '{count} ont besoin de vous',
      workingOne: '1 au travail',
      workingMany: '{count} au travail',
      subagentsOne: '1 sous-agent',
      subagentsMany: '{count} sous-agents',
      bots: 'Mochis',
      add: 'Nouveau mochi ou équipe',
      botWaiting: '{name} a besoin de vous',
      botFailed: '{name} a échoué',
      botWorking: '{name} travaille',
      botPaused: '{name} est en pause',
      state: { waiting: 'a besoin de vous', failed: 'a échoué', working: 'travaille', paused: 'en pause' },
      unread: 'nouvelles réponses',
      unreadOne: '1 nouvelle réponse',
      unreadMany: '{count} nouvelles réponses',
      /** The rail's limits button, in its name card under the sentence (LimitsButton.svelte): how long until the first account serves again. */
      limitsBack: 'retour dans {time}',
    }
  }
};
