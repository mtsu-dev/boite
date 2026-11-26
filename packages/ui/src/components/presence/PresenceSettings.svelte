<script lang="ts">
  import { markFeature } from '@boite/contracts';
  import { onDestroy } from 'svelte';
  import { presence } from '../../lib/presence/publisher.svelte';
  import { desktopShell } from '../../lib/shell-platform';
  import { fill, strings } from '../../lib/strings';
  import InfoTip from '../InfoTip.svelte';

  markFeature('boite-feature:discord-presence');

  /**
   * Under the experiment's switch: the choice to name the projects, the card a
   * friend sees on the profile, drawn from the same words the chat apps get,
   * and which chat apps show it now.
   */
  const uid = $props.id();
  let activity = $derived(presence.activity());
  let now = $state(Date.now());
  const tick = setInterval(() => { now = Date.now(); }, 1000);
  onDestroy(() => clearInterval(tick));

  /** Discord's own count: `04:41`, `1:02:09`. */
  function clock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const rest = `${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    return hours > 0 ? `${hours}:${rest}` : rest;
  }

  let targets = $derived(presence.status?.targets ?? []);
</script>

<div class="presence" data-testid="presence-settings">
  <label for="{uid}-projects" class="switch-row">
    <span class="text"><span class="ui-label-box"><span class="ui-label" id="{uid}-projects-name">{strings.presence.showProjects}</span><InfoTip topic={strings.presence.showProjects} text={strings.presence.showProjectsHint} /></span></span>
    <input id="{uid}-projects" aria-labelledby="{uid}-projects-name" type="checkbox" role="switch" data-testid="presence-projects"
      checked={presence.showProjects} onchange={(event) => presence.setShowProjects(event.currentTarget.checked)} />
  </label>

  <figure class="card-preview" aria-label={strings.presence.preview}>
    <figcaption>{strings.presence.preview}</figcaption>
    <div class="profile">
      <span class="playing">{strings.presence.playing}</span>
      <div class="activity">
        <img class="logo" src="./icons/icon.svg" alt="" width="60" height="60" />
        <div class="lines">
          <strong>Boite</strong>
          <span data-testid="presence-details">{activity.details}</span>
          {#if activity.state}<span data-testid="presence-state">{activity.state}</span>{/if}
          {#if activity.startedAt}<span class="timer" data-testid="presence-timer">{fill(strings.presence.elapsed, { time: clock(now - activity.startedAt) })}</span>{/if}
        </div>
      </div>
      {#if activity.button}<span class="button" aria-hidden="true">{activity.button}</span>{/if}
    </div>
  </figure>

  <p class="status" data-testid="presence-status">
    {#if !desktopShell()}
      {strings.presence.elsewhere}
    {:else if targets.length === 0}
      {strings.presence.none}
    {:else}
      <span class="dot" aria-hidden="true"></span>
      {fill(strings.presence.shownIn, { apps: targets.map(target => target.user ?? strings.presence.unnamed).join(', ') })}
      <span class="sockets">{targets.map(target => target.socket).join(' · ')}</span>
    {/if}
  </p>
</div>

<style>
  .presence { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-2) 0 var(--space-3); }
  figure { margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  figcaption { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .profile {
    display: flex; flex-direction: column; gap: var(--space-3);
    max-width: 22rem; padding: var(--space-3);
    border: 1px solid var(--color-edge); border-radius: var(--radius-lg);
    background: var(--color-surface-2);
  }
  .playing { color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .activity { display: flex; gap: var(--space-3); align-items: center; min-width: 0; }
  .logo { flex: none; width: 60px; height: 60px; border-radius: var(--radius-md); }
  .lines { display: flex; flex-direction: column; min-width: 0; font-size: var(--text-sm); color: var(--color-foreground); line-height: 1.35; }
  .lines > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lines strong { font-weight: 650; }
  .timer { color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .button {
    display: flex; align-items: center; justify-content: center; min-height: var(--control-sm);
    border-radius: var(--radius-sm); background: var(--color-surface-3); color: var(--color-foreground);
    font-size: var(--text-sm); font-weight: 550;
  }
  .status { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-xs); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
  .dot { width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-success); }
  .sockets { font-family: var(--font-mono); opacity: 0.8; }
  @media (max-width: 720px) {
    .profile { max-width: none; }
  }
</style>
