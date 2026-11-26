import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  experiments: {
    'draft-backdrop': {
      title: 'Fond des nouvelles conversations',
      hint: 'Une scène animée à la manière d’une console du début des années 2000 derrière l’écran vide d’une nouvelle conversation. À choisir dans Apparence. Respecte la réduction des animations'
    },
    'discord-presence': {
      title: 'Statut Discord',
      hint: 'Affiche « Joue à Boite » dans votre profil Discord, avec ce que font vos agents : leur nombre, leurs modèles et depuis combien de temps ils travaillent. Marche avec Discord, Vesktop, Legcord et les autres clients qui lisent ce statut, et avec toute application qui lit le même canal, comme les passerelles vers Fluxer. Application de bureau seulement'
    }
  }
};
