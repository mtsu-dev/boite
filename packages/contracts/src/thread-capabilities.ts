import type { AccountId, Protocol, ProviderCapabilities, ProviderDescriptor, ProviderId, ProviderSummary, ThreadCapabilities, ThreadCapability, ThreadCapabilityReason, ThreadId } from './index.ts';
import { supportsSideQuestions } from './providers.ts';

export interface ThreadControlsRpcMethods {
  /** Supported operations and their current availability for this thread. */
  'threads.capabilities': { params: { threadId: ThreadId }; result: ThreadCapabilities };
  /** Forecasts the native session after an account switch, without starting an agent or changing the thread. */
  'threads.previewAccountSwitch': { params: { threadId: ThreadId; accountId: AccountId }; result: { session: 'unchanged' | 'resume' | 'fresh' } };
}

/** Known protocol support; a live handle still decides whether a turn can accept input. */
export function providerSupportsSteering(provider: Pick<ProviderSummary, 'protocol' | 'acpSteering'> | undefined): boolean {
  return provider !== undefined && (provider.protocol === 'acp' ? provider.acpSteering === true : ['echo', 'claude-sdk', 'codex-appserver', 'pi', 'muse'].includes(provider.protocol));
}

export function acpSteeringKind(provider: Pick<ProviderDescriptor, 'id' | 'quirks' | 'protocol'>): 'opencode' | 'grok' | null {
  if (provider.protocol !== 'acp') return null;
  if (provider.id === 'opencode-v2') return 'opencode';
  return provider.quirks?.includes('grok') ? 'grok' : null;
}

/** Observed facts only. Gathering them must neither load a driver nor start a process. */
export interface ThreadCapabilitySnapshot {
  threadId: ThreadId;
  providerId: ProviderId;
  protocol: Protocol | null;
  selectionVersion: number;
  providerCapabilities: ProviderCapabilities | null;
  modelImages?: false;
  runtimeReason: ThreadCapabilityReason | null;
  conversationReason: ThreadCapabilityReason | null;
  busy: boolean;
  steeringSupported: boolean;
  steeringReason: ThreadCapabilityReason | null;
  compactionReason: ThreadCapabilityReason | null;
  preparationSupported: boolean;
  pendingApprovals: boolean;
  pendingQuestions: boolean;
  hasForkHistory: boolean;
  hasRewindHistory: boolean;
  nativeForkSupported: boolean;
  nativeForkAvailable: boolean;
  nativeRewindSupported: boolean;
  nativeRewindAvailable: boolean;
  backgroundSupported: boolean;
}

export function deriveThreadCapabilities(s: ThreadCapabilitySnapshot): ThreadCapabilities {
  const capability = (supported: boolean, reason: ThreadCapabilityReason | null): ThreadCapability => ({
    supported, available: supported && reason === null, reason: supported ? reason : 'unsupported',
  });
  const idle = s.runtimeReason ?? s.conversationReason ?? (s.busy ? 'busy' : null);
  const fork = s.conversationReason === 'archived' ? s.runtimeReason : s.runtimeReason ?? s.conversationReason;
  const forkReason = fork ?? (s.hasForkHistory ? null : 'no-history');
  const rewindReason = s.conversationReason ?? (s.busy ? 'busy' : null) ?? (s.hasRewindHistory ? null : 'no-history');
  const known = s.protocol !== null;
  return {
    threadId: s.threadId, providerId: s.providerId, protocol: s.protocol, selectionVersion: s.selectionVersion,
    steering: capability(s.steeringSupported, s.runtimeReason ?? s.conversationReason ?? s.steeringReason),
    compaction: capability(known, idle ?? s.compactionReason),
    images: capability(s.providerCapabilities?.images === true && s.modelImages !== false, s.steeringReason === null ? s.runtimeReason ?? s.conversationReason : idle),
    plan: capability(s.providerCapabilities?.planMode === true, idle),
    approvals: capability(s.providerCapabilities?.approvals === true, s.pendingApprovals ? null : 'no-request'),
    // Boite also accepts asynchronous question cards through its scoped CLI, independently of native questions.
    questions: capability(known, s.pendingQuestions ? null : 'no-request'),
    btw: capability(s.protocol !== null && supportsSideQuestions(s.protocol), s.runtimeReason ?? s.conversationReason),
    fork: { seeded: capability(known, forkReason), native: capability(s.nativeForkSupported, forkReason ?? (s.nativeForkAvailable ? null : 'no-checkpoint')) },
    rewind: { seeded: capability(known, rewindReason), native: capability(s.nativeRewindSupported, rewindReason ?? (s.nativeRewindAvailable ? null : 'no-checkpoint')) },
    sessionPreparation: capability(s.preparationSupported, idle),
    backgroundObservations: capability(s.backgroundSupported, null),
  };
}
