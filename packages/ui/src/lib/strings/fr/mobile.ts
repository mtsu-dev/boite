import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  mobile: {
    clearSearch: 'Effacer la recherche',
    atWork: '{count} en cours', atWorkFilter: 'Afficher seulement les fils en cours',
    draftTitle: 'Que voulez-vous faire ?', draftHint: 'Lancez une tâche, posez une question ou reprenez votre travail.',
    pairTitle: 'Votre Boite, sur votre téléphone',
    pairBody: 'Sur l’une de vos machines, ouvrez Réglages, Machines, Ajouter un appareil, puis scannez son QR code ici.',
    pairInstalled: 'Vous venez d’installer Boite ? Ajoutez-la ici aussi : sur iPhone, l’application garde sa connexion séparément du navigateur.',
    pairPrivacy: 'Le QR code ne sert qu’une fois et expire en quelques minutes. Ce téléphone atteint ensuite toutes les machines du groupe.',
    scanInApp: "Utilisez le bouton Scanner ici plutôt que l'app Appareil photo : celle-ci ouvre le lien dans Safari, qui garde sa propre connexion.",
    pairingRequired: 'Ajouter cette application à votre groupe',
    offlineTitle: 'En attente de votre ordinateur',
    offlineBody: 'Gardez Boite ouverte sur votre ordinateur et vérifiez votre connexion. Si vous utilisez Tailscale, gardez-le connecté sur les deux appareils.',
    troubleshoot: 'Dépanner', troubleshootSteps: 'Vérifications de la connexion',
    checkNearby: 'Appareils à proximité',
    checkNearbyHint: 'Dans les paramètres Android : Applications, puis votre navigateur ou l’app Boite, celle qui ouvre Boite, Autorisations, Appareils à proximité si la ligne existe, Autoriser.',
    checkReach: 'Joindre {host}', checkOpen: 'Ouvrir',
    checkReachHint: 'Ouvrez-la dans un onglet du navigateur. Si la page ne charge pas, ce téléphone ne joint pas la machine : vérifiez Tailscale, le VPN ou le Wi-Fi.',
    emptyTitle: 'Commencez un fil',
    emptyBody: 'Confiez une tâche à un agent. Vos fils apparaîtront ici.',
    emptyActivity: 'Tout est à jour',
    nothingNeedsYou: 'Rien ne vous attend',
    computer: 'Ordinateur connecté',
    pairAgain: 'Rajouter',
    settingsPhone: 'Notifications',
    settingsLeave: 'Retour',
    settingsBack: 'Retour aux réglages',
    /** Activity's second line: why the thread is listed. */
    feed: { run: 'Veut lancer :', helperAsks: '{title} vous attend', updates: 'Nouvelles', markAllRead: 'Tout marquer comme lu', markAllReadHint: 'Retire les échecs, les arrêts et le travail fini. Les questions et les permissions restent.', verb: { answer: 'Répondre', review: 'Examiner', deny: 'Refuser', skip: 'Passer' } },
    navigation: 'Navigation', activity: 'Activité',
    waitingElsewhere: '{count} en attente de vous',
    search: 'Trouver un fil', noThreads: 'Aucun fil ne correspond.'
  }
};
