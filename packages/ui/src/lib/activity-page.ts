import { LazyComponent } from './lazy-component.svelte';

/** Desktop Activity's page, warmed beside the initial layout and loaded on demand if needed. */
export const activityPage = new LazyComponent(() => import('../components/ActivityList.svelte'));
