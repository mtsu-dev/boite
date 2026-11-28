import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  experiments: {
    'draft-backdrop': {
      title: 'Fond des nouvelles conversations',
      hint: 'Une scène animée à la manière d’une console du début des années 2000 derrière l’écran vide d’une nouvelle conversation. À choisir dans Apparence. Respecte la réduction des animations'
    },
    contacts: {
      title: 'Contacts',
      hint: 'Une page Accueil à côté des fils, où vous reliez votre Boite à celle d’un autre propriétaire via Tailscale. Un mochi intégré, la Standardiste, porte chaque demande entre vos agents et les siens. S’applique à cette machine. Pas encore prêt pour un usage quotidien'
    },
    teams: {
      title: 'Équipes',
      hint: 'Des mochis qui travaillent ensemble dans un salon commun, affiché au-dessus d’eux sur la page Mochis : un message réveille les mochis qu’il nomme, et chacun répond au groupe ou en privé. Vos mochis y écrivent avec boite team. Pas encore prêt pour un usage quotidien'
    },
    'auto-goal': {
      title: 'Objectifs automatiques',
      hint: 'Un long message lance un objectif relu sur lui-même, avec sa checklist et une carte sur le tableau du projet. Retirez l’objectif depuis la barre d’objectif pour l’abandonner. S’applique à cette machine. Pas encore prêt pour un usage quotidien'
    },
    'session-import': {
      title: 'Import de sessions',
      hint: 'Ouvrez comme un fil une session Claude Code ou Codex lancée hors de Boite, depuis la palette de commandes. Pas encore prêt pour un usage quotidien'
    },
    'background-compaction': {
      title: 'Compaction en arrière-plan',
      hint: 'Les compactions automatiques tournent sur une copie de la conversation pendant que l’agent continue, et le fil passe dessus quand elle est prête. S’applique à cette machine. Pas encore prêt pour un usage quotidien'
    },
    'device-stream': {
      title: 'Flux en direct de l’appareil',
      hint: 'Le panneau Appareil affiche en vidéo un téléphone Android branché à cette machine via scrcpy, et lui envoie les touchers, les touches, le texte et le presse-papiers. S’applique à cette machine. Pas encore prêt pour un usage quotidien'
    }
  }
};
