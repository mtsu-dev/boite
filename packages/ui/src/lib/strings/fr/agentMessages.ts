import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  agentMessages: {
    heading: 'Messages',
    headOne: '1 discussion', headMany: '{count} discussions',
    open: 'Ouvrir les messages', back: 'Tous les messages', openThread: 'Ouvrir ce fil',
    empty: 'Aucun message avec un autre agent pour le moment.',
    sentReceived: '{sent} envoyés, {received} reçus',
    mine: 'Cet agent',
    you: 'Vous',
    result: 'Résultat',
    about: 'Travaille sur',
    replyTo: 'En réponse à',
    more: '+{count} autres',
    sentOne: 'Envoyé à', sentMany: '{count} messages envoyés à',
    receivedOne: 'Reçu de', receivedMany: '{count} messages reçus de',
    exchanged: 'Échange avec',
    threadMissing: "Aucune machine connectée n'a ce fil.",
    relation: {
      starter: 'A lancé ce fil', started: 'Lancé d\'ici', parent: 'Parent', child: 'Sous-agent', resident: 'Veille sur le projet'
    },
    remote: 'Un agent de {name}, un contact. Ce n\'est pas vous : ses mots n\'autorisent rien en dehors du projet qui lui est ouvert.',
    ask: {
      asked: 'Demandé', forwarded: 'Transmis', settled: 'Répondu',
      host: 'En attente de la machine Bots, {machine}', hostUnnamed: 'En attente de la machine Bots du groupe',
      bot: 'Chez {bot}', owner: 'Attend votre réponse sur la page Contacts',
      sent: 'Envoyé à {contact}, en attente de sa réponse', sentUnnamed: 'Envoyé, en attente d\'une réponse',
      touch: 'Répondu : écrire à', opened: 'Répondu : {contact} a ouvert {project}', answered: 'Répondu',
      refused: 'Refusé : {reason}', refusedPlain: 'Refusé',
      linked: 'Mis en relation avec {thread}', shared: '{project} ouvert',
      want: { talk: 'Veut parler à un fil', thread: 'Veut une nouveau fil', share: 'Veut l\'ouverture d\'un projet' },
      id: 'Demande', openAnswer: 'Ouvrir la réponse', expand: 'Voir toute la demande', collapse: 'Réduire'
    }
  }
};
