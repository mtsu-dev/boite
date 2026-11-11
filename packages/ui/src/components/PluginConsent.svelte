<script lang="ts" module>
  /**
   * What the consent dialog asks about one plugin. `requested` is null for a
   * schema 1 plugin, which gets the owner's own access and no list.
   */
  export interface ConsentRequest {
    name: string;
    mode: 'install' | 'edit';
    source: { url: string; commit: string } | null;
    requested: readonly string[] | null;
    /** Ticked when the dialog opens; the owner may untick any. */
    ticked: readonly string[];
    /** Asked for by the new version and not by the installed one: marked New. */
    added: readonly string[];
    runsProgram: boolean;
  }
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { Component } from 'svelte';
  import { PLUGIN_PERMISSION_NAMES, PLUGIN_PERMISSIONS, type PluginPermissionGrant } from '@boite/contracts';
  import {
    AppWindow, Bot, BotMessageSquare, FileCode, Folder, FolderPlus, Gauge, KeyRound, ListTodo, MessageCircleQuestionMark,
    MessageSquarePlus, MessagesSquare, Monitor, MousePointerClick, Paintbrush, ShieldCheck, SquareCheck, TriangleAlert
  } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { focusInitial, focusedElement, restoreFocus } from '../lib/focus';
  import { mobileOverlay } from '../lib/mobile-history';
  import { fill, strings } from '../lib/strings';

  /**
   * Asks the owner what a plugin may reach, before an install or an update and
   * later from its row: one line per permission, ticked unless the owner
   * unticks it. A danger permission is drawn in red; a program the plugin runs
   * is a line with no box, since the plugin does not work without it.
   * `onanswer` gets the ticked permissions, or null on Cancel.
   */
  let { request, onanswer }: { request: ConsentRequest | null; onanswer: (grants: string[] | null) => void } = $props();
  const t = strings.plugins;
  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled)';

  const ICONS: Record<string, Component<{ size?: number; strokeWidth?: number }>> = {
    'threads.read': MessagesSquare, 'threads.write': MessageSquarePlus, 'projects.read': Folder, 'projects.write': FolderPlus,
    'todos.read': ListTodo, 'todos.write': SquareCheck, 'agents.read': Bot, 'agents.write': BotMessageSquare, 'files.read': FileCode,
    'questions.write': MessageCircleQuestionMark, 'screens.read': Monitor, 'screens.write': MousePointerClick, 'status.read': Gauge,
    'ui.reveal': AppWindow, ui: Paintbrush,
  };
  const grants = PLUGIN_PERMISSIONS as Readonly<Record<string, PluginPermissionGrant | undefined>>;
  /** `ui` runs code inside the app itself: red even before its table entry says so. */
  const danger = (permission: string) => grants[permission]?.danger === true || permission === 'ui';
  const known = PLUGIN_PERMISSION_NAMES as readonly string[];
  /** The table's order, a name it does not know yet after, the red ones last. */
  const rank = (permission: string) => (danger(permission) ? 100 : 0) + (known.includes(permission) ? known.indexOf(permission) : 50);
  const label = (permission: string) => (t.permission as Record<string, { title: string; line: string } | undefined>)[permission] ?? { title: permission, line: '' };

  const overlay = new Closing();
  let held = $state<ConsentRequest | null>(null);
  let card = $state<HTMLDivElement | undefined>(undefined);
  const chosen = new SvelteSet<string>();
  let previous: HTMLElement | null = null;

  const rows = $derived([...(held?.requested ?? [])].sort((a, b) => rank(a) - rank(b)));
  const unchanged = $derived(held !== null && held.mode === 'edit' && chosen.size === held.ticked.length && held.ticked.every((name) => chosen.has(name)));

  $effect(() => {
    const current = request;
    if (!current) {
      overlay.hide();
      if (held) untrack(giveBack);
      return;
    }
    untrack(() => {
      if (!overlay.open) previous = focusedElement();
      held = current;
      chosen.clear();
      for (const name of current.ticked) if (current.requested?.includes(name)) chosen.add(name);
      overlay.show();
    });
    void tick().then(() => focusInitial(card?.querySelector<HTMLElement>('[data-confirm]'), card));
  });
  $effect(() => { if (overlay.open) return mobileOverlay(() => onanswer(null)); });

  function giveBack() {
    const active = document.activeElement;
    if (!active || active === document.body || card?.contains(active)) restoreFocus(previous);
    previous = null;
  }

  function toggle(permission: string, on: boolean) {
    if (on) chosen.add(permission);
    else chosen.delete(permission);
  }

  /** In the order the plugin asked, which is what the core stores. */
  const answer = () => onanswer((held?.requested ?? []).filter((name) => chosen.has(name)));

  function onkeydown(event: KeyboardEvent) {
    if (!request) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onanswer(null);
    } else if (event.key === 'Tab') trap(event);
  }

  /** While the dialog is up the keyboard cannot leave it. */
  function trap(event: KeyboardEvent) {
    const stops = Array.from(card?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!card || !first || !last) return;
    const active = document.activeElement;
    const inside = active instanceof Node && card.contains(active);
    if (active !== card && (event.shiftKey ? inside && active !== first : inside && active !== last)) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if overlay.shown && held}
  {@const asked = held}
  <div class="scrim" class:closing={overlay.closing} role="presentation" use:overlay.attach onanimationend={overlay.end}
    onclick={(event) => { if (event.target === event.currentTarget) onanswer(null); }}>
    <div class="dialog" class:closing={overlay.closing} role="dialog" aria-modal="true" aria-labelledby="consent-title" tabindex="-1" bind:this={card} data-testid="plugin-consent" data-mode={asked.mode}>
      <header>
        <span class="badge" aria-hidden="true"><ShieldCheck size={18} strokeWidth={1.75} /></span>
        <div>
          <h2 id="consent-title">{fill(asked.mode === 'edit' ? t.consent.editTitle : t.consent.title, { name: asked.name })}</h2>
          {#if asked.source}<p class="source">{fill(t.consent.source, { url: asked.source.url.replace(/^https:\/\//, ''), commit: asked.source.commit.slice(0, 7) })}</p>{/if}
        </div>
      </header>
      <div class="perms">
        {#if asked.requested === null}
          <div class="perm danger" data-testid="plugin-consent-owner">
            <span class="icon"><KeyRound size={16} strokeWidth={1.75} /></span>
            <span class="text"><b>{t.consent.ownerAccess}</b><span>{t.consent.ownerAccessLine}</span></span>
          </div>
        {:else if rows.length === 0 && !asked.runsProgram}
          <p class="nothing">{t.consent.nothing}</p>
        {/if}
        {#each rows as permission (permission)}
          {@const Icon = ICONS[permission] ?? ShieldCheck}
          {@const text = label(permission)}
          <label class="perm" class:danger={danger(permission)} data-testid="plugin-consent-row" data-permission={permission} data-danger={danger(permission)}>
            <span class="icon"><Icon size={16} strokeWidth={1.75} /></span>
            <span class="text">
              <b>{text.title}{#if asked.added.includes(permission)}<span class="new" data-testid="plugin-consent-new">{t.consent.added}</span>{/if}</b>
              {#if text.line}<span>{text.line}</span>{/if}
            </span>
            <input type="checkbox" checked={chosen.has(permission)} title={permission} aria-label={text.title}
              onchange={(event) => toggle(permission, event.currentTarget.checked)} />
          </label>
        {/each}
        {#if asked.runsProgram}
          <div class="perm danger info" data-testid="plugin-consent-program">
            <span class="icon"><TriangleAlert size={16} strokeWidth={1.75} /></span>
            <span class="text"><b>{t.consent.program}</b><span>{t.consent.programLine}</span></span>
          </div>
        {/if}
      </div>
      <div class="actions">
        <button type="button" class="ghost" data-testid="plugin-consent-cancel" onclick={() => onanswer(null)}><span class="ui-label">{strings.common.cancel}</span></button>
        <button type="button" class="primary" data-confirm data-testid="plugin-consent-allow" disabled={unchanged} onclick={answer}>
          <span class="ui-label">{asked.mode === 'edit' ? t.consent.save : t.consent.allow}</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
    background: var(--color-scrim); animation: fade var(--dur-2) var(--ease-out-quint);
  }
  .scrim.closing { animation-name: fade-out; pointer-events: none; }
  .dialog {
    display: grid; gap: 14px; width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow-y: auto;
    padding: 18px 18px 14px; background: var(--color-surface); border: 1px solid var(--color-edge);
    border-radius: var(--radius-xl); box-shadow: var(--shadow-e3); animation: pop var(--dur-2) var(--ease-out-quint);
  }
  .dialog.closing { animation-name: pop-out; }
  header { display: flex; align-items: flex-start; gap: 12px; }
  .badge {
    flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--radius-lg);
    background: var(--color-accent-soft); color: var(--color-accent);
  }
  h2 { margin: 0; font-size: var(--text-md); overflow-wrap: anywhere; }
  .source { margin: 2px 0 0; font-size: var(--text-sm); color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  .perms { display: grid; border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
  .perm { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; transition: background var(--dur-1) var(--ease-out-quint); }
  .perm + .perm { border-top: 1px solid var(--color-border); }
  label.perm:hover { background: var(--color-surface-2); }
  .perm.info { cursor: default; }
  .icon {
    flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-md);
    background: var(--color-surface-2); color: var(--color-muted-foreground);
  }
  .text { flex: 1; min-width: 0; display: grid; gap: 1px; font-size: var(--text-sm); color: var(--color-muted-foreground); line-height: 1.4; }
  .text b { display: flex; align-items: center; gap: 6px; color: var(--color-foreground); font-weight: 600; }
  .perm.danger b, .perm.danger .icon { color: var(--color-danger); }
  .perm.danger .icon { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
  .perm input { flex: none; }
  .new {
    padding: 0 5px; border-radius: var(--radius-sm); background: var(--color-accent-soft); color: var(--color-accent);
    font-size: var(--text-xs); font-weight: 500;
  }
  .nothing { margin: 0; padding: 10px 12px; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .actions { display: flex; justify-content: flex-end; gap: 6px; }
</style>
