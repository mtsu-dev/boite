import { LazyComponent } from './lazy-component.svelte';

/**
 * Parts drawn inside another lazy part: the quota popup's table (inside the
 * limits glance) and the model picker's popover (inside the shared project
 * dialog). They live apart from `deferred-parts.ts` so a part's chunk never
 * imports the registry that loads it; the registry lists them for prefetch.
 */
export const parts = {
  QuotaOverview: new LazyComponent(() => import('../components/QuotaOverview.svelte')),
  ModelPickerMenu: new LazyComponent(() => import('../components/ModelPickerMenu.svelte'))
};
