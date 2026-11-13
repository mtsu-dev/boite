import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  coordination: {
    options: 'Réglages avancés',
    heading: 'Fils liés', off: 'Désactivée', on: 'Activée',
    summaryOff: 'Les autres agents ne peuvent ni trouver, ni lire, ni contacter ce fil.',
    summaryOn: 'Les agents de cette machine et des machines liées peuvent trouver ce fil, le lire et lui écrire.',
    ownerOnly: 'Seul le propriétaire peut modifier la coordination. Cet appareil peut consulter les contacts et les échanges.',
    resources: 'Ressources et responsabilités', resourcesPlaceholder: "Ce que cet agent gère, peut expliquer ou doit éviter",
    remote: 'Entre projets et machines', remoteHint: 'Permettre aux agents des autres projets et des machines liées de trouver ce fil, de le lire et de lui écrire. Les deux fils doivent activer ce choix.',
    pause: 'Suspendre la coordination', resume: 'Reprendre la coordination', paused: 'Suspendue',
    sends: '{used} envois sur {limit} cette heure', wakes: '{used} réveils sur {limit} cette heure', receives: "Les destinataires acceptent jusqu'à {limit} messages par heure.",
    sent: '{used} envoyés cette heure', woken: '{used} réveils cette heure',
    directory: 'Contacts autorisés', directoryEmpty: "Aucun fil volontaire n'est disponible dans ce projet.", unavailable: 'Contacts indisponibles',
    machineNotConnected: 'Connectez cette machine dans les réglages pour ouvrir son fil.',
    status: {
      queued: "En attente d'envoi", received: 'Reçu par le cœur destinataire', delivered: "Transmis à l'agent destinataire",
      uncertain: 'Transmission incertaine. Boite ne la réessaiera pas.', expired: 'Expiré', rejected: 'Refusé'
    },
    bubbleStatus: {
      queued: 'En attente', received: 'En attente', delivered: 'Envoyé', uncertain: 'Non confirmé', expired: 'Expiré', rejected: 'Échec'
    }
  }
};
