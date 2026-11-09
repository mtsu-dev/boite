<script lang="ts">
  import { ChevronRight, TriangleAlert } from '@lucide/svelte';
  import type { PolicyProblem } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import Notice from './Notice.svelte';

  /**
   * A strip above every settings page while the machine's admin policy has
   * problems: how many, and whether the file failed closed, which is said
   * outright. The lines the core logs, field and what was expected there under
   * the file they come from, open below it. The core applies what it could read
   * and fails closed on the rest.
   */
  let { store }: { store: Store } = $props();
  const policy = $derived(store.policy);
  let open = $state(false);
  const id = `policy-problems-${Math.random().toString(36).slice(2, 10)}`;

  /** The first twenty problems under their file, each file named once, in the order the core read them. */
  const files = $derived.by(() => {
    const byFile = new Map<string, PolicyProblem[]>();
    for (const problem of policy?.problems.slice(0, 20) ?? []) byFile.set(problem.file, [...byFile.get(problem.file) ?? [], problem]);
    return [...byFile].map(([file, problems]) => ({ file, problems }));
  });

  function title(count: number, closed: boolean): string {
    if (closed) return strings.policy.closedTitle;
    return count === 1 ? strings.policy.problemsOne : fill(strings.policy.problemsMany, { count: String(count) });
  }
</script>

{#if policy?.present && policy.problems.length > 0}
  {@const closed = policy.failedClosed}
  <section class="policy-banner" data-testid="policy-banner" data-state={closed ? 'closed' : 'partial'}>
    <!-- The one notice form: what the policy file breaks, Details beside it, the fields folded under it. -->
    <Notice icon={TriangleAlert} tone={closed ? 'danger' : 'caution'} role="alert" title={title(policy.problems.length, closed)} info={strings.policy.problemsInfo} ids={{ title: 'policy-banner-title' }}>
      {#if closed}<span class="note" data-testid="policy-banner-closed">{strings.policy.failedClosed}</span>{/if}
      <div class="disclosure-fold" class:open {id} inert={!open} data-testid="policy-banner-details">
        <div>
          <div class="details">
            {#each files as group (group.file)}
              <p class="file"><span>{strings.policy.file}</span><code data-testid="policy-banner-file">{group.file}</code></p>
              <ul>
                {#each group.problems as problem, index (index)}
                  <li data-testid="policy-problem" data-field={problem.field}>
                    <code>{problem.field}</code>
                    <span>{fill(strings.policy.expected, { expected: problem.expected })}</span>
                  </li>
                {/each}
              </ul>
            {/each}
          </div>
        </div>
      </div>
      {#snippet actions()}
        <button type="button" class="ghost small toggle" aria-expanded={open} aria-controls={id} data-testid="policy-banner-toggle" onclick={() => (open = !open)}>
          <span class="ui-label">{strings.policy.details}</span>
          <ChevronRight size={14} class={open ? 'fold-caret open' : 'fold-caret'} aria-hidden="true" />
        </button>
      {/snippet}
    </Notice>
  </section>
{/if}

<style>
  .policy-banner { max-width: var(--settings-width); margin-bottom: var(--space-6); }
  .note { display: block; color: var(--color-foreground); }
  .details { display: grid; gap: 6px; margin-top: 8px; }
  .file { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 0; color: var(--color-subtle); font-size: var(--text-sm); }
  .file code { min-width: 0; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  .file:not(:first-child) { margin-top: 6px; }
  /* Fields in one column and what each expected in the next, so the eye runs down the fields; one column on a phone. */
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: fit-content(45%) minmax(0, 1fr); gap: 4px 12px; }
  li { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: baseline; }
  li code { font-family: var(--font-mono); font-size: var(--text-sm); line-height: 1.5; color: var(--color-foreground); overflow-wrap: anywhere; }
  li span { min-width: 0; font-size: var(--text-sm); line-height: 1.5; color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  @media (max-width: 720px) {
    ul { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  }
</style>
