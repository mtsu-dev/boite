<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes, HTMLInputAttributes } from 'svelte/elements';
  import InfoTip from './InfoTip.svelte';

  let { title, help, hint, error, errorTestid, actions, control, field = true, stacked = false, class: extraClass = '', ...attributes }: HTMLAttributes<HTMLDivElement> & {
    title: string;
    help?: string;
    hint?: string;
    error?: string;
    errorTestid?: string;
    actions?: Snippet;
    control: Snippet<[Pick<HTMLInputAttributes, 'id' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid'>]>;
    field?: boolean;
    stacked?: boolean;
  } = $props();
  const uid = $props.id();
  const description = $derived([hint && `${uid}-hint`, error && `${uid}-error`].filter(Boolean).join(' ') || undefined);
</script>

<div {...attributes} class="switch-row setting-field {extraClass}" class:stacked>
  <div class="text">
    <span class="ui-label-box">
      {#if field}<label class="ui-label" for={uid} id="{uid}-label">{title}</label>
      {:else}<span class="ui-label" id="{uid}-label">{title}</span>{/if}
      {#if help}<InfoTip topic={title} text={help} />{/if}
      {@render actions?.()}
    </span>
    {#if hint}<span class="hint" id="{uid}-hint">{hint}</span>{/if}
  </div>
  {@render control({ id: uid, 'aria-labelledby': `${uid}-label`, 'aria-describedby': description, 'aria-invalid': error ? true : undefined })}
  {#if error}<p class="field-error" id="{uid}-error" role="alert" data-testid={errorTestid}>{error}</p>{/if}
</div>

<style>
  .setting-field { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2) var(--space-5); min-height: 52px; padding: var(--space-2) 0; }
  .setting-field + :global(.setting-field) { border-top: 1px solid var(--color-border); }
  .text { flex: 1; min-width: 0; }
  .hint { display: block; color: var(--color-subtle); font-size: var(--text-sm); }
  .field-error { flex-basis: 100%; margin: 0; color: var(--color-danger); font-size: var(--text-sm); overflow-wrap: anywhere; }
  @media (max-width: 720px) { .stacked .text { flex-basis: 100%; } }
</style>
