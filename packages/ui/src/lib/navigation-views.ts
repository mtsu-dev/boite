import { LazyComponent } from './lazy-component.svelte';
import { contactsParts } from './contacts-entry';

export const settingsShell = new LazyComponent(() => import('../components/SettingsShell.svelte'));
export const agentsLayout = new LazyComponent(() => import('../components/agents/AgentsLayout.svelte'));
export const homePage = contactsParts && new LazyComponent(contactsParts.HomePage);
export const contactsRail = contactsParts && new LazyComponent(contactsParts.ContactsRail);
