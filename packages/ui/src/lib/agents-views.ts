import { LazyComponent } from './lazy-component.svelte';

export const agentsPage = new LazyComponent(() => import('../components/agents/AgentsPage.svelte'));
