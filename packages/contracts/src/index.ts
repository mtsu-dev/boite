import type { AgentsRpcMethods, AgentsRpcEvents } from './agents';
import type { ComposerRpcMethods, ComposerRpcEvents } from './composer';
export * from './composer';
import type { WorkflowsRpcMethods, WorkflowsRpcEvents } from './workflows';
import type { BrowserRpcMethods, BrowserRpcEvents } from './browser';
import type { PullRequestsRpcMethods, PullRequestsRpcEvents } from './pull-requests';
import type { MobileDevicesRpcMethods, MobileDevicesRpcEvents } from './mobile-devices';
import type { WindowsRpcMethods, WindowsRpcEvents } from './windows';
import type { DesktopRpcMethods } from './desktop';
import type { DiagnosticsRpcMethods } from './diagnostics';
export * from './diagnostics';
export * from './pull-requests';
export * from './browser';
export * from './browser-remote';
export * from './mobile-devices';
export * from './windows';
export * from './desktop';
export * from './agents';
export { nextAgentOccurrence } from './agent-schedule';
export * from './agent-memory';
export * from './workflows';
export * from './workflow-plan';
export * from './workflow-loop';
export * from './thread-focus';
export * from './context-mode';
export * from './delegation-input';
import type { AccountsRpcEvents, AccountsRpcMethods } from './accounts';
import type { AgentDoorRpcMethods } from './agent-door';
import type { StateRpcMethods } from './state';
import type { BrainRpcEvents, BrainRpcMethods } from './brain';
import type { CoordinationRpcEvents, CoordinationRpcMethods } from './coordination';
import type { CoreRpcEvents, CoreRpcMethods } from './core';
import type { DelegationRpcEvents, DelegationRpcMethods } from './delegation';
import type { FilesRpcMethods } from './files';
import type { GitRpcMethods } from './git';
import type { GroupRpcEvents, GroupRpcMethods } from './group';
import type { HooksRpcEvents, HooksRpcMethods } from './hooks';
import type { ImportsRpcEvents, ImportsRpcMethods } from './imports';
import type { KeybindingsRpcEvents, KeybindingsRpcMethods } from './keybindings';
import type { TranscriptsRpcEvents, TranscriptsRpcMethods } from './transcripts';
import type { MessagesRpcEvents, MessagesRpcMethods } from './messages';
import type { PairingRpcMethods } from './pairing';
import type { PanelRpcEvents, PanelRpcMethods } from './panel';
import type { PermissionsRpcEvents, PermissionsRpcMethods } from './permissions';
import type { McpRpcEvents, McpRpcMethods } from './mcp';
import type { PluginsRpcEvents, PluginsRpcMethods } from './plugins';
import type { ProjectsRpcEvents, ProjectsRpcMethods } from './projects';
import type { ProvidersRpcEvents, ProvidersRpcMethods } from './providers';
import type { QuestionsRpcEvents, QuestionsRpcMethods } from './questions';
import type { SchedulerRpcEvents, SchedulerRpcMethods } from './scheduler';
import type { SecretsRpcEvents, SecretsRpcMethods } from './secrets';
import type { SettingsRpcEvents, SettingsRpcMethods } from './settings';
import type { SpeechRpcMethods } from './speech';
import type { SubscriptionProxyRpcEvents, SubscriptionProxyRpcMethods } from './subscription-proxy';
import type { TerminalsRpcEvents, TerminalsRpcMethods } from './terminals';
import type { SharedProjectsRpcEvents, SharedProjectsRpcMethods } from './shared-projects';
import type { ThreadsRpcEvents, ThreadsRpcMethods } from './threads';
import type { PromptSuggestionsRpcEvents } from './prompt-suggestions';
import type { TodosRpcEvents, TodosRpcMethods } from './todos';
import type { TraceRpcEvents, TraceRpcMethods } from './trace';
import type { TurnsRpcEvents, TurnsRpcMethods } from './turns';
import type { UsageRpcMethods } from './usage';
import type { PolicyRpcEvents, PolicyRpcMethods } from './policy';
import type { TeamsRpcEvents, TeamsRpcMethods } from './teams';
import type { CouncilRpcEvents, CouncilRpcMethods } from './council';
import type { PresenceRpcEvents, PresenceRpcMethods } from './presence';
export * from './ids';
export * from './providers';
export * from './local-acp';
export * from './accounts';
export * from './plugins';
export * from './mcp';
export * from './mcp-presets';
export * from './mcp-input';
export * from './plugin-source';
export * from './projects';
export * from './threads';
export * from './owner-thread';
export * from './agent-tasks';
export * from './prompt-suggestions';
export * from './usage';
export * from './turns';
export * from './messages';
export * from './message-search';
export * from './permissions';
export * from './questions';
export * from './secrets';
export * from './trace';
export * from './scheduler';
export * from './settings';
export { defaultSettings } from './settings-defaults';
export * from './subscription-proxy';
export * from './keybindings';
export * from './imports';
export * from './transcripts';
export * from './core';
export * from './agent-door';
export * from './state';
export * from './activity';
export * from './harness-updates';
export * from './setting-help';
export * from './panel';
export * from './todos';
export * from './git';
export * from './files';
export * from './pairing';
export * from './speech';
export * from './coordination';
export * from './group';
export * from './delegation';
export * from './brain';
export * from './settings-sync';
export * from './hooks';
export * from './terminals';
export * from './shared-projects';
export * from './wire';
export * from './policy';
export * from './teams';
export * from './council';
export * from './presence';

/**
 * Boite 2 wire contract: the JSON-RPC methods and events between the core
 * (the host process that runs the agents) and its clients (the desktop shell,
 * the phone PWA, tests, benches).
 *
 * The core is the only side that executes anything. Clients drive it over an
 * authenticated WebSocket. This file is the whole vocabulary; a method or an
 * event that is not here does not exist.
 */

export const PROTOCOL_VERSION = 2 as const;

export { IMAGE_MIME_TYPES, IMAGE_MAX_EDGE, ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_TURN, ATTACHMENTS_TOTAL_MAX_BYTES, RPC_MAX_FRAME_BYTES } from './attachment-limits.ts';
export type { ImageMimeType } from './attachment-limits.ts';

export { PREVIEW_REFERENCES_PER_TURN, previewReferencesError, previewPrompt } from './preview';
export { extractToolPatches, previewToolOutputs, previewToolPart, projectToolDiffs, toolFamily, toolInputDiff, TOOL_OUTPUT_INLINE_CHARS, TOOL_OUTPUT_PREVIEW_CHARS, type ToolFamily } from './message-preview';
export { BINARY_PATCH_VERIFY_BUDGET, checkGitBinaryHunk, isGitBase85Line, type BinaryHunkStatus } from './git-binary';
export { forTransport, projectLiveMessage, projectLivePart, projectMessage, MESSAGE_SENT_MAX_BYTES, type TransportOptions } from './transport.ts';
export { boundedMessageWindow } from './message-window.ts';
export { FOLDED_CHANNELS, StreamGate, partChannel, type StreamChannel } from './stream-channels.ts';
export { lastAgentText, notificationExcerpt, requestExcerpt, requestKind } from './notification-text';
export { nativeAgentsOfTool, collectNativeAgents } from './native-agents.ts';
export { collectProcessAgents, processAgentCommand } from './process-agents.ts';

export interface RpcMethods extends
  ComposerRpcMethods,
  AgentsRpcMethods,
  WorkflowsRpcMethods,
  BrowserRpcMethods,
  PullRequestsRpcMethods,
  MobileDevicesRpcMethods,
  WindowsRpcMethods,
  DesktopRpcMethods,
  DiagnosticsRpcMethods,
  ProvidersRpcMethods,
  AccountsRpcMethods,
  PluginsRpcMethods,
  McpRpcMethods,
  ProjectsRpcMethods,
  ThreadsRpcMethods,
  UsageRpcMethods,
  TurnsRpcMethods,
  MessagesRpcMethods,
  PermissionsRpcMethods,
  QuestionsRpcMethods,
  SecretsRpcMethods,
  TraceRpcMethods,
  SchedulerRpcMethods,
  SettingsRpcMethods,
  SubscriptionProxyRpcMethods,
  KeybindingsRpcMethods,
  ImportsRpcMethods,
  TranscriptsRpcMethods,
  CoreRpcMethods,
  AgentDoorRpcMethods,
  StateRpcMethods,
  PanelRpcMethods,
  TodosRpcMethods,
  GitRpcMethods,
  FilesRpcMethods,
  PairingRpcMethods,
  SpeechRpcMethods,
  CoordinationRpcMethods,
  GroupRpcMethods,
  DelegationRpcMethods,
  BrainRpcMethods,
  HooksRpcMethods,
  SharedProjectsRpcMethods,
  TerminalsRpcMethods,
  TeamsRpcMethods,
  CouncilRpcMethods,
  PresenceRpcMethods,
  PolicyRpcMethods {}

export type RpcMethodName = keyof RpcMethods;
export type RpcParams<M extends RpcMethodName> = RpcMethods[M]['params'];
export type RpcResult<M extends RpcMethodName> = RpcMethods[M]['result'];

export interface RpcEvents extends
  ComposerRpcEvents,
  AgentsRpcEvents,
  WorkflowsRpcEvents,
  BrowserRpcEvents,
  PullRequestsRpcEvents,
  MobileDevicesRpcEvents,
  WindowsRpcEvents,
  ProvidersRpcEvents,
  AccountsRpcEvents,
  PluginsRpcEvents,
  McpRpcEvents,
  ProjectsRpcEvents,
  ThreadsRpcEvents,
  PromptSuggestionsRpcEvents,
  TurnsRpcEvents,
  MessagesRpcEvents,
  PermissionsRpcEvents,
  QuestionsRpcEvents,
  SecretsRpcEvents,
  TraceRpcEvents,
  SchedulerRpcEvents,
  SettingsRpcEvents,
  SubscriptionProxyRpcEvents,
  KeybindingsRpcEvents,
  ImportsRpcEvents,
  TranscriptsRpcEvents,
  CoreRpcEvents,
  PanelRpcEvents,
  TodosRpcEvents,
  CoordinationRpcEvents,
  GroupRpcEvents,
  DelegationRpcEvents,
  BrainRpcEvents,
  HooksRpcEvents,
  SharedProjectsRpcEvents,
  TerminalsRpcEvents,
  TeamsRpcEvents,
  CouncilRpcEvents,
  PresenceRpcEvents,
  PolicyRpcEvents {}

export type RpcEventName = keyof RpcEvents;

export { attachmentError, answerAttachmentError, decodedBytes } from './attachment-validation.ts';
export { AUTO_COMPACT_MOMENTS, AUTO_COMPACT_TOKENS, DEFAULT_AUTO_COMPACT, AUTO_GOAL_MIN_CHARS, CACHE_KEEPALIVE_HOURS, MODEL_FAVORITES_MAX, checkSettingsPatch, compareModelFavorites, keepLaterFavorites, type AutoCompact, type AutoCompactMoment, type CacheKeepalive } from './settings-validation.ts';
export { checkRpcParams } from './rpc-params.ts';
export { defaultTitleModel } from './title-models.ts';
export { ChangeLog, LIST_CHANGES_IDS, listCursorProblem, THREAD_LIST_PAGE_BYTES, ThreadListPages } from './list-changes.ts';
export { GOAL_TRACKER_DEFAULTS, GOAL_CHECKLIST_MAX_ITEMS, GOAL_CHECKLIST_SOURCE_MAX, GOAL_CHECKLIST_TEXT_MAX, defaultTrackerModel, trackerEffort } from './goal-tracker.ts';
export { DEVICE_HOME_CREDENTIAL_STORES, DEVICE_SECRET_DIRS, DEVICE_SECRET_FILE, DEVICE_METHODS, DEVICE_EVENTS, AGENT_EVENTS, AGENT_METHODS, SUBSCRIBED_EVENTS, accessRefusal, agentHearsEvent, pluginMayCall, deviceBound, eventThreadId, mayHearEvent, PLUGIN_SELF_EVENTS, type Caller } from './access.ts';
export {
  APP_LANGUAGES, MACHINE_SETTINGS, PLUGIN_ADD_SECTION, REQUESTABLE_SETTINGS, REQUESTABLE_SETTING_KEYS, SETTINGS_PAGES, botCard, checkClientPreferences, checkSettingRequest, settledExperiment, currentSetting, effectiveSetting, experimentOf, isExperimentKey, isMachineSetting, isSettingsPage, readSettings,
  sameClientPreferences, settingAnswerText, settledMachineSetting, settledSetting,
  type BotAsk, type ClientPreferences, type MachineSetting, type RequestableKey, type RequestableSetting, type SettingAsk, type SettingCardAsk,
  type SettingMachine, type SettingReading, type SettingRequestParams, type SettingsPage,
  type SettingsReading,
} from './setting-requests.ts';
export {
  BUILD_KINDS, FEATURE_CUTS, buildKindOf, featureCompiled, featureDefines, featureFlag, featureMarker, markFeature, stageRuns,
  EXPERIMENT_IDS, EXPERIMENT_STAGES, FINISHED_EXPERIMENT_IDS, withFinished, effectiveExperiments, experimentListed, experimentRefusal, experimentStartRefusal, experimentsRun,
  isReleaseVersion, listedExperiments,
  type BuildKind, type ExperimentId, type FeatureStage, type FinishedExperimentId,
} from './experiments.ts';
export {
  AGENT_DAILY_BUDGET, AGENT_PICTURE_CODE, AGENT_PICTURE_MAX_BYTES, AGENT_PICTURE_TYPES,
  AGENT_PROJECTS_MAX, AGENT_SETTING_KEYS, AGENT_STATUSES, isAgentPicture,
  agentModelRoute, agentSettingAnswerText, agentSettingProposal, agentSettingValue, builtinSettingRefusal, checkAgentSettingRequest, normalizeAgentSetting, settledAgentSetting,
  type AgentSettingApplyParams, type AgentSettingAsk, type AgentSettingChoice, type AgentSettingContext, type AgentSettingKey, type AgentSettingReading,
  type AgentSettingRequestParams, type AgentSettingsReading, type AgentSettingsReadParams,
} from './agent-setting-requests.ts';
export {
  BOT_CARD_NOTE, checkAgentCreate,
  type AgentCreateApproveParams, type AgentCreateAsked, type AgentCreateContext, type AgentCreated, type AgentCreateParams, type AgentCreateResult, type AgentCreation,
} from './agent-create.ts';
export { SPEECH_CATALOGUE, SPEECH_CUSTOM_ID, SPEECH_DEFAULT_MODEL, isSpeechModelId, speechUrlProblem, type SpeechCatalogueModel } from './speech-models.ts';

export { sideQuestionSnapshot } from './side-question-snapshot.ts';
export { acpSteeringKind, deriveThreadCapabilities, providerSupportsSteering, type ThreadCapabilitySnapshot } from './thread-capabilities.ts';
export { resumeAnchor, snapshotOptionsProblem, type MessageSync } from './thread-sync.ts';
export { IMAGE_INLINE_CHARS, previewImageData, type ImagePreviews } from './file-preview.ts';
export { imageSize } from './image-size.ts';
export {
  VIEW_ROUTE, VIEW_MAX_BYTES, VIEW_BLOCK_MAX_BYTES, VIEW_WIDTH, VIEW_NARROW_WIDTH, VIEW_BLEED, VIEW_DEFAULT_HEIGHT, VIEW_TITLE_MAX,
  VIEW_CONTENT_POLICY, VIEW_SANDBOX, VIEW_TOKENS, VIEW_HEIGHT_EXPRESSION, VIEW_GUIDE_LINE, VIEW_HELP,
  clampViewHeight, viewFrameHeight, viewThemeFragment, readViewMessage, viewDocument, viewTitleOf,
  type InlineView, type ViewCheckCapture, type ViewTheme, type ViewHostMessage, } from './view.ts';

export { effectiveCompaction, type CompactionTarget, type CompactionPolicy } from './settings';

export { composerBatch } from './composer-batch';
export { composerActivity, isComposerActivity, stableComposerValue } from './composer-activity';
export { permissionAutoDecision } from './permissions';

export * from './model-selection.ts';
