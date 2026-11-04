<script lang="ts">
  import type { AgentMail } from '../lib/agent-mail';
  import type { Store } from '../lib/store.svelte';
  import type { TimelineCard } from '../lib/timeline-cards';
  import ContactAskRow from './ContactAskRow.svelte';
  import DelegationActivity from './DelegationActivity.svelte';
  import WorkflowActivity from './WorkflowActivity.svelte';

  /** A row of its own in the timeline (`timelineCards`): a launch, a workflow run or a contact request. */
  let { store, card, mail }: { store: Store; card: TimelineCard; mail: readonly AgentMail[] } = $props();
</script>

{#if card.kind === 'launch'}
  <DelegationActivity {store} agents={card.launch.agents} />
{:else if card.kind === 'run'}
  <WorkflowActivity {store} run={card.run} />
{:else}
  <ContactAskRow {store} ask={card.ask} {mail} />
{/if}
