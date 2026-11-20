/**
 * The way to the Teams' screens, each a chunk fetched when it is first drawn:
 * the team chat with its composer, the dialog that creates or edits a team,
 * the header of a team's conversation and the team's menu the window's rail
 * opens. The card of a team's request is a deferred part
 * (`lib/deferred-parts.ts`).
 *
 * `lib/teams.svelte.ts`, the list of a machine's teams the rails read, stays
 * in the main chunk: it is empty where the core has no team.
 */
export const teamsParts = {
  TeamChat: () => import('../components/teams/TeamChat.svelte'),
  TeamDialog: () => import('../components/teams/TeamDialog.svelte'),
  TeamHeader: () => import('../components/teams/TeamHeader.svelte'),
  teamMenu: () => import('./team-menu')
};
