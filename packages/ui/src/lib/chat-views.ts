import { LazyComponent } from './lazy-component.svelte';
import { teamsParts } from './teams-entry';
import { loadCouncilSalon } from './council-entry';

export const teamChat = teamsParts ? new LazyComponent(teamsParts.TeamChat) : null;
export const councilSalon = new LazyComponent(loadCouncilSalon);
export const findBar = new LazyComponent(() => import('../components/FindBar.svelte'));
