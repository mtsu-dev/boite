<script lang="ts">
  import BrowserProfilesCard from './BrowserProfilesCard.svelte';
  import { strings } from '../lib/strings';

  /**
   * The built-in browser's own entry (round 19): its profiles and the
   * sign-ins it hands to a machine's agent browser, once a card under
   * Providers, where nobody looked for a browser.
   */
</script>

<div class="page" data-testid="browser-page">
  <header>
    <h1>{strings.settings.tabs.browser}</h1>
  </header>
  <BrowserProfilesCard />
</div>
