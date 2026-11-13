<script lang="ts">
  import CardScope from './CardScope.svelte';
  import NotificationKinds from './NotificationKinds.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /** What reaches the person at this device: the alerts of a thread they are not looking at, and which kinds. */
  let { store }: { store: Store } = $props();
  const uid = $props.id();
</script>

<section class="card" id="settings-notifications" data-testid="settings-card-notifications">
  <h2><span class="ui-label">{strings.settings.notificationsHeading}</span><CardScope /></h2>
  <label for="{uid}-notifications" class="switch-row">
    <span class="text">
      <span class="ui-label" id="{uid}-notifications-name">{strings.settings.notifications}</span>
      <span class="hint" id="{uid}-notifications-effect">{strings.settings.effects.notifications}</span>
    </span>
    <input id="{uid}-notifications" aria-labelledby="{uid}-notifications-name" aria-describedby="{uid}-notifications-effect" type="checkbox" role="switch" data-testid="setting-notifications"
      checked={store.notifications} onchange={(event) => void store.setNotifications(event.currentTarget.checked)} />
  </label>
  <NotificationKinds {store} />
</section>
