/**
 * The way to the Teams' screens: the team chat with its composer, the dialog
 * that creates or edits a team and the header of a team's conversation. The
 * card of a team's request is a deferred part (`lib/deferred-parts.ts`) and
 * carries the same flag there. The flag is written in full because a bundler
 * folds nothing less direct (`packages/contracts/src/experiments.ts`): in a
 * build below the Teams' tag it is `false`, the imports are dropped and no
 * chunk holds these screens. From source and in tests it is not defined.
 *
 * `lib/teams.svelte.ts`, the list of a machine's teams the rails read, stays
 * in every build: it is empty where the core has no team.
 */

/** Whether this bundle holds the Teams. */
export function teamsBuilt(): boolean {
  return typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__;
}

export const teamsParts = typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__
  ? {
      TeamChat: () => import('../components/teams/TeamChat.svelte'),
      TeamDialog: () => import('../components/teams/TeamDialog.svelte'),
      TeamHeader: () => import('../components/teams/TeamHeader.svelte')
    }
  : null;
