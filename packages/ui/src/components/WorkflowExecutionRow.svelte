<script lang="ts">
  import { resolveContext, type DelegationProfile, type WorkflowInstance, type WorkflowNode, type WorkflowStepPlan } from '@boite/contracts';
  import type { Snippet } from 'svelte';
  import { totalTokens } from '../lib/usage';
  import { executionRoute, requestedExecutionRoute } from '../lib/execution-route';
  import { workflowTone } from '../lib/status-tone';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';
  import { executionTokenLabel, nodeTiming, routeOf, stepTitle, workflowTokenLabel } from '../lib/workflow-view';
  import { workspace } from '../lib/workspace.svelte';
  import AgentExecutionRow from './AgentExecutionRow.svelte';

  let { store, node, profiles, step, instance, compact = false, showOutcome = false, titleAside }: {
    store: Store; node: WorkflowNode; profiles: DelegationProfile[]; step?: WorkflowStepPlan;
    instance?: WorkflowInstance; compact?: boolean; showOutcome?: boolean; titleAside?: Snippet;
  } = $props();

  const execution = $derived(instance ?? node.instances.find(entry => entry.providerId != null) ?? node.instances[0]);
  const remote = $derived(execution?.machine?.coreId ?? execution?.compute?.host.coreId);
  const executionStore = $derived(remote ? workspace.machineOf(remote)?.store ?? store : store);
  const admitted = $derived(routeOf(node, profiles, step, execution));
  const pendingRoute = $derived(!execution?.providerId && (step?.model !== undefined || step?.effort !== undefined));
  const route = $derived(admitted ?? (step?.model && !step.machine && !step.compute ? requestedExecutionRoute(store, step.model, step.effort ?? null) : null));
  const requested = $derived(execution?.contextMode === undefined);
  const context = $derived(requested ? resolveContext(step?.context) : execution?.contextMode);
  const timing = $derived(instance ? { startedAt: instance.startedAt, finishedAt: instance.finishedAt, active: instance.status === 'running' } : nodeTiming(node));
  const status = $derived(instance?.status ?? node.status);
  const measured = $derived(instance ? [instance] : node.instances);
  const prior = $derived(instance ? undefined : node.usage);
  const tokens = $derived(measured.some(entry => entry.startedAt !== null || entry.usage != null)
    ? workflowTokenLabel(measured, prior, !!prior)
    : prior ? executionTokenLabel(totalTokens(prior)) : null);
</script>

<AgentExecutionRow title={instance ? instance.label || instance.key : stepTitle(node)} subtitle={step?.model}
  route={route ? executionRoute(executionStore, route) : null} {context} {requested}
  mark={workflowTone(status)} outcome={showOutcome || status === 'skipped' ? strings.workflow.stepStatus[status] : null}
  {status} {...timing} {tokens} {compact} {titleAside}
  effortTestId="workflow-effort" contextTestId="workflow-context" tokensTestId="workflow-node-tokens">
  {#snippet chips()}{#if pendingRoute}<span class="ui-label">{strings.workflow.routeRequested}</span>{/if}{/snippet}
</AgentExecutionRow>
