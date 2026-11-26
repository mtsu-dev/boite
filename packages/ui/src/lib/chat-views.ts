import { LazyComponent } from './lazy-component.svelte';
import { teamsParts } from './teams-entry';
import { loadCouncilSalon } from './council-entry';

export const teamChat = new LazyComponent(teamsParts.TeamChat);
export const councilSalon = new LazyComponent(loadCouncilSalon);
export const findBar = new LazyComponent(() => import('../components/FindBar.svelte'));
