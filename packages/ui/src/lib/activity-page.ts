import { LazyComponent } from './lazy-component.svelte';

/** Desktop Activity's page, loaded the first time the rail opens it. Apart from `inbox.svelte.ts`, which the page itself reads. */
export const activityPage = new LazyComponent(() => import('../components/ActivityList.svelte'));
