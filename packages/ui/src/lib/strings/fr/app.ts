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
      bots: 'Bots',
      add: 'Nouveau bot ou équipe',
      botWaiting: '{name} a besoin de vous',
      botFailed: '{name} a échoué',
      botWorking: '{name} travaille',
      botPaused: '{name} est en pause',
      unread: 'nouvelles réponses',
      /** The list foot's limits line, in its tooltip (QuotaLine.svelte): the least left, the window and the account it is on. */
      limitsLeft: '{percent} % restant : {window}, {account}',
    }
  }
};
