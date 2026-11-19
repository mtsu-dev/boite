<script lang="ts">
  import { resolveContext, type DelegationProfile, type WorkflowInstance, type WorkflowNode, type WorkflowStepPlan } from '@boite/contracts';
  import type { Snippet } from 'svelte';
  import { executionRoute } from '../lib/execution-route';
  import { workflowTone } from '../lib/status-tone';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';
  import { nodeTiming, routeOf, stepTitle, workflowTokenLabel } from '../lib/workflow-view';
  import { workspace } from '../lib/workspace.svelte';
  import AgentExecutionRow from './AgentExecutionRow.svelte';

  let { store, node, profiles, step, instance, compact = false, showOutcome = false, titleAside }: {
    store: Store; node: WorkflowNode; profiles: DelegationProfile[]; step?: WorkflowStepPlan;
    instance?: WorkflowInstance; compact?: boolean; showOutcome?: boolean; titleAside?: Snippet;
  } = $props();

  const execution = $derived(instance ?? node.instances.find(entry => entry.providerId != null) ?? node.instances[0]);
  const remote = $derived(execution?.machine?.coreId ?? execution?.compute?.host.coreId);
  const executionStore = $derived(remote ? workspace.machineOf(remote)?.store ?? store : store);
  const route = $derived(routeOf(node, profiles, step, execution));
  const requested = $derived(execution?.contextMode === undefined);
  const context = $derived(requested ? resolveContext(step?.context) : execution?.contextMode);
  const timing = $derived(instance ? { startedAt: instance.startedAt, finishedAt: instance.finishedAt, active: instance.status === 'running' } : nodeTiming(node));
  const status = $derived(instance?.status ?? node.status);
  const measured = $derived(instance ? [instance] : node.instances);
  const tokens = $derived(measured.some(entry => entry.startedAt !== null || entry.usage != null) ? workflowTokenLabel(measured) : null);
</script>

<AgentExecutionRow title={instance ? instance.label || instance.key : stepTitle(node)} subtitle={step?.model}
  route={route ? executionRoute(executionStore, route) : null} {context} {requested}
  mark={workflowTone(status)} outcome={showOutcome || status === 'skipped' ? strings.workflow.stepStatus[status] : null}
  {status} {...timing} {tokens} {compact} {titleAside}
  effortTestId="workflow-effort" contextTestId="workflow-context" tokensTestId="workflow-node-tokens" />
