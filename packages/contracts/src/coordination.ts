import type { ProjectId, RequestId, ThreadId, Timestamp } from './ids';
import type { PermissionRequest } from './permissions';
import type { QuestionRequest } from './questions';
import type { ThreadStatus, ThreadSummary } from './threads';
import type { ContactCapabilities, SharedProjectRef, SharedThreadRef } from './shared-projects';

export type CoordinationMode = 'off' | 'brief' | 'team';
export interface CoordinationConfig {
  mode: CoordinationMode;
  resources: string;
  remote: boolean;
  paused: boolean;
}
/** Default communication for ordinary threads; explicit owner settings take precedence. */
export function defaultCoordinationConfig(): CoordinationConfig {
  return { mode: 'brief', resources: '', remote: true, paused: false };
}
export interface AgentAddress { coreId: string; threadId: ThreadId }
/** An idle contact that completed work within this window can be followed up without a stale-work warning. */
export const COORDINATION_RECENT_COMPLETION_MS = 15 * 60_000;
export interface AgentContact extends AgentAddress {
  title: string;
  machine: string;
  resources: string;
  status: ThreadStatus;
  mode: CoordinationMode;
  /** The project's name. Missing on older cores. */
  project?: string;
  /** Provider and model, as `claude claude-opus-5-5`. Missing on older cores. */
  agent?: string;
  /** The worktree branch the thread works on, when it has one. Missing on older cores. */
  branch?: string | null;
  /** Last activity: a message, a turn or a change of state. Missing on older cores. */
  activeAt?: Timestamp;
  /** Last successfully completed turn, independent of title/settings edits; null when none. Missing on older cores. */
  lastCompletedAt?: Timestamp | null;
  /** Its project is put away; delivering work restores the project. Missing on older cores. */
  projectArchived?: boolean;
  /** Automatic delivery is paused, even when the thread remains discoverable. Missing on older cores. */
  paused?: boolean;
  /** Only for an explicitly associated project, attested by its owning contact link. */
  sharedThread?: SharedThreadRef;
}
/** A contact whose title, project, branch, model, resources or chat matched a search. */
export interface AgentMatch extends AgentContact {
  /** Which fields matched, best first. */
  matched: ('title' | 'project' | 'branch' | 'agent' | 'resources' | 'chat')[];
  /** Up to three short excerpts of the chat around a match. */
  excerpts: string[];
}
/** One entry of another agent's conversation as `collaboration.read` returns it. */
export interface AgentTranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  at: Timestamp;
  /** Text only, cut at 4,000 characters. */
  text: string;
  /** The tools the agent called in this message, by name, in order. */
  tools: string[];
}
export interface AgentTranscript {
  contact: AgentContact;
  entries: AgentTranscriptEntry[];
  /** Older entries exist before the first one returned; pass its `at` as `before`. */
  more: boolean;
}
export interface AgentLetter {
  /**
   * Who the core says wrote it. Missing on older coordination mail: another
   * agent. `user` and `result` are delegation mail. `resident` comes from the
   * persistent agent the owner entrusted the recipient's project to. None of
   * them is a message the user typed. `question` is written by the core when
   * a delegated agent asks something (a question card or a permission request)
   * and tells its parent; it is withdrawn when the card closes before delivery.
   * `contact` is a contact's answer to a request this thread made
   * (`collaboration.ask`), written by this core.
   * `contact-human` is an authenticated human on the contact's core, attested
   * by it and checked by the receiver. It is never this owner's instruction
   * or a tool approval. Requires negotiated humanLetters support.
   */
  origin?: 'user' | 'agent' | 'result' | 'resident' | 'question' | 'contact' | 'contact-human';
  /**
   * A `result` written when a delegated agent ended its turn to wait on its
   * own background work: what it said so far, not its final result, which
   * follows when that work wakes it. Missing otherwise and on older cores.
   */
  checkpoint?: boolean;
  id: string;
  from: AgentContact;
  to: AgentAddress;
  toTitle: string;
  toProject?: string;
  toMachine?: string;
  text: string;
  replyTo: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  status: 'queued' | 'received' | 'delivered' | 'uncertain' | 'expired' | 'rejected';
  error: string | null;
  /**
   * The question of the recipient this message answered instead of being
   * delivered as a message: a parent's `delegation.send` to a child waiting on
   * a question card. Missing otherwise and on older cores.
   */
  answered?: RequestId;
  /**
   * Set on a letter that crossed a contact link: the contact's local name on
   * this core. Set by the receiving core from its own contact list, never from
   * the sender's word. Missing on letters between one owner's machines.
   */
  contact?: { coreId: string; name: string };
  /** Association scope for external shared work, checked by the receiving core. Never owner approval. */
  sharedProjectId?: string;
  /**
   * How the other end relates to the thread whose view lists this letter.
   * The core sets it when it reads the letter out, never stores it; missing on
   * older cores and on another machine's word.
   */
  relation?: AgentRelation;
}
/**
 * The other end of a letter, from one thread's side. `starter` started this
 * thread with `boite thread new` and `started` is a thread this one started;
 * `parent` delegated this thread and `child` is one of its subagents;
 * `resident` is the persistent agent the owner entrusted this thread's
 * project to. The rest say only where it is.
 */
export type AgentRelation = 'starter' | 'started' | 'parent' | 'child' | 'resident' | 'project' | 'other-project' | 'machine';
/**
 * One thread of a project, as the persistent agent the owner entrusted that
 * project to reads it, and as the owner's `boite threads` prints it.
 */
export interface ProjectThreadRow {
  id: ThreadId;
  title: string;
  projectId: ProjectId | null;
  project: string | null;
  status: ThreadStatus;
  archived: boolean;
  /** Archived as done: it sits in the Done list. */
  done?: true;
  branch: string | null;
  /** Unanswered questions and permission requests. */
  questions: number;
  permissions: number;
  pullRequest: ThreadSummary['pullRequest'] | null;
  updatedAt: Timestamp;
  lastCompletedAt: Timestamp | null;
  /**
   * The machine of the group the thread is on, as `--machine` names it, when
   * it is not this one: a bot reaches it as `<machine>/<id>`.
   */
  machine?: string;
}
export interface ProjectThreadDetail {
  thread: ProjectThreadRow;
  questions: QuestionRequest[];
  permissions: PermissionRequest[];
  /** The last assistant text, cut at 4,000 characters. */
  lastAnswer: string | null;
}
/**
 * What a persistent agent does to a thread of a project entrusted to it.
 * Deleting threads and deciding tool permissions stay the owner's.
 */
export type ResidentThreadAction = 'archive' | 'done' | 'unarchive' | 'stop' | 'rename' | 'move';
/**
 * The calling agent and the projects the owner entrusted to it. Empty when
 * this thread is not such an agent's. A project of another machine of the
 * group has `machine` set, an id of `<core-id>/<project-id>`, a name of
 * `<machine>/<name>` and no path.
 */
export interface ResidentView {
  agentId: string | null;
  name: string | null;
  projects: { id: ProjectId; name: string; path: string; machine?: string }[];
}
/** Public contact card. No owner token or private signing key crosses a core. */
export interface CoordinationPeer {
  coreId: string;
  name: string;
  url: string;
  publicKey: string;
  /** Local owner permission for agents on this peer to read this core's threads. Missing means denied. */
  readThreads?: boolean;
  /** Route through an owner app connected to both cores; never dial its loopback address on another host. */
  viaClient?: boolean;
}
/** Signed coordination response carried unchanged through the owner's app. */
export interface CoordinationBridgeResponse { status: number; body: string; signature: string }

/**
 * How capable a model is, for contact traffic: 1 frontier (Opus, Fable, GPT-6
 * class), 2 mid (Sonnet, high Flash), 3 small (Haiku, Lite, OSS). Unknown models
 * read as 2. `modelTier` in the core decides from the provider and model id.
 */
export type ModelTier = 1 | 2 | 3;
/**
 * A project this core opened to a contact: the contact's agents reach its
 * threads. The project may live on another machine of this core's group,
 * which this core answers for: the contact never sees that machine.
 */
export interface ContactGrant {
  projectId: ProjectId;
  /** Agents of the contact may read this project's conversations, text and tool names. Off by default. */
  readThreads: boolean;
  grantedAt: Timestamp;
  /** The core id of the group member that holds the project. Missing: this core's own project. */
  machine?: string;
  /** The project's name on that member when it was opened: this core cannot read the member's projects. Set with `machine`. */
  name?: string;
}
/** A project the contact opened to this core, as the contact's core announced it. */
export interface ContactOffer {
  projectId: ProjectId;
  name: string;
  /** Selected endpoint identity for shared-project version 1; absence cannot be guessed from a bare ID. */
  sharedProject?: SharedProjectRef;
}
/**
 * Another owner's Boite, linked for agent work on the projects each side opens
 * to the other. A contact never sees this core's other projects, its group or
 * its other contacts.
 */
export interface Contact {
  coreId: string;
  /** The name this owner gives the contact; letters and requests show it. Starts as the machine name it announced. */
  name: string;
  /** The machine name the contact's core announced. */
  machine: string;
  /** Eight words derived from both public keys; both owners see the same eight. */
  fingerprint: string;
  /**
   * `host`: this core shared its machine and the contact dials it, keeping a
   * link open that carries this core's requests too. `guest`: this core dials.
   */
  role: 'host' | 'guest';
  /** What a guest dials: the host's tailnet name URL. Missing on the host side. */
  url?: string;
  /**
   * Its requests go to this core's Contacts bot, which settles them alone
   * (opening a project still takes the owner). Not trusted: the bot asks the
   * owner before it acts on any of them.
   */
  trusted: boolean;
  /** Projects this core opened to the contact. */
  grants: ContactGrant[];
  /** Projects the contact opened to this core. */
  offers: ContactOffer[];
  link: 'connected' | 'connecting' | 'offline';
  lastSeenAt: Timestamp | null;
  addedAt: Timestamp;
  /** Negotiated on the sealed contact sync, never inferred from a version string. Missing: legacy contact traffic only. */
  capabilities?: ContactCapabilities;
  /** The contact's own Contacts bot, as its core announced it on the sync: the one thread of theirs this core's bot may always write to. */
  bot?: { threadId: ThreadId; title: string };
}
/** An invitation a contact joins with. One use; whoever holds it can join, so it travels like a password. */
export interface ContactInvite {
  /** `boite://contact#...`: this core's identity, its tailnet URL and the Tailscale share link. */
  link: string;
  expiresAt: Timestamp;
  /**
   * The Tailscale share of this machine, made through the owner's API key, or
   * the reason it was not. `none`: the invitee already reaches this machine on
   * Tailscale (same tailnet, or shared before), so nothing was shared.
   */
  share: { status: 'created'; url: string } | { status: 'manual'; reason: string } | { status: 'none' };
  /**
   * How the invitee reaches this machine: `tailnet` by its tailnet name, or
   * `internet` by its contact routes on Tailscale Funnel. Absent from older
   * cores, which only make `tailnet` links.
   */
  via?: 'tailnet' | 'internet';
}
/**
 * A contact asks for an agent on a project of this core ("a project like X"),
 * or this core asked one of its contacts. Accepting opens one project to it.
 */
export interface ContactRequest {
  id: string;
  direction: 'in' | 'out';
  /** Empty while an outgoing request waits for this core's Contacts bot to pick the contact. */
  coreId: string;
  /** The contact's local name; empty like `coreId`. */
  contact: string;
  /**
   * What the asking agent wants: `talk` with a thread of the contact (the
   * one `target` names, or one the contact's bot finds), `thread` a new
   * thread started on one of the contact's projects, `share` a project
   * opened to it. Missing on older cores: `share`.
   */
  want?: ContactRequestWant;
  /** The thread the asking agent named exactly, on the side that receives the request. */
  target?: { threadId: ThreadId; title?: string };
  /**
   * Who the request waits on while pending: `bot`, this core's Contacts bot;
   * `owner`, this owner's answer on a card the bot raised (a contact not
   * trusted, or a project to open). Missing: the contact.
   */
  stage?: 'bot' | 'owner';
  /** The owner said yes on the bot's card: the bot may now act on it. */
  approved?: boolean;
  /** The thread the two Contacts bots put the asking thread in relation with, once accepted. */
  relation?: ContactRelation;
  /** The agent that asked; on an incoming request, as the contact's core attests it. */
  from: AgentContact;
  text: string;
  /** The git remote the asking agent works on, when it has one: the first thing a request is matched by. */
  gitRemote?: string;
  createdAt: Timestamp;
  status: 'pending' | 'accepted' | 'refused';
  /** The project opened, once accepted. Its name on the side that opened it. */
  project?: { id: ProjectId; name: string };
  /** Why it was refused, written by the owner, or by the concierge on an older core. */
  reason?: string;
  /** `bot`: the Contacts bot. `match` and `concierge` come from older cores. */
  decidedBy?: 'owner' | 'bot' | 'match' | 'concierge';
  decidedAt?: Timestamp;
}
export const CONTACT_REQUEST_WANTS = ['talk', 'thread', 'share'] as const;
export type ContactRequestWant = typeof CONTACT_REQUEST_WANTS[number];
/**
 * Two threads, one on each side, the Contacts bots put in touch: each may
 * write to the other with `boite threads send` for as long as it lasts,
 * whatever projects are opened. A relation lets letters through, never files,
 * reads or commands: the local thread does the work in its own checkout.
 * Either side ends it (`contacts.bot.cut`, `contacts.cutRelation`).
 */
export interface ContactRelation {
  id: string;
  coreId: string;
  /** The contact's local name. */
  contact: string;
  /** This core's thread. */
  local: { threadId: ThreadId; title: string };
  /** The contact's thread, as its core announced it. */
  remote: AgentContact;
  /** The request that made it, by this core's id. */
  requestId: string;
  createdAt: Timestamp;
}
export const CONTACT_FLAG_KINDS = ['secret', 'destructive', 'injection', 'boundary', 'review'] as const;
/**
 * Something a contact's agent did that this core's Contacts bot must look
 * at: a letter asking for a secret, a destructive command or words written to
 * steer an agent (`secret`, `destructive`, `injection`), a refusal at a shared
 * project's boundary (`boundary`), or the activity reviewer's doubt
 * (`review`). A flagged letter waits, undelivered, for the bot's verdict.
 */
export interface ContactFlag {
  id: string;
  coreId: string;
  contact: string;
  kind: typeof CONTACT_FLAG_KINDS[number];
  /** One sentence the core wrote: what matched and where, never a secret's bytes. */
  reason: string;
  /** The held letter, when a letter raised it. */
  letterId?: string;
  /** The local thread it concerns, when one does. */
  threadId?: ThreadId;
  relationId?: string;
  at: Timestamp;
  /** `open` until the bot decides: the letter delivered, refused, or the contact's access cut. */
  status: 'open' | 'delivered' | 'refused' | 'cut';
}
export interface ContactSettings {
  /** The least capable model an agent may run on to write to a contact, or to be heard from one. Default 1. */
  minTier: ModelTier;
}
/** The Tailscale side of contacts on this machine. */
export interface ContactTailscale {
  /** This machine's tailnet name, `<machine>.<tailnet>.ts.net`, or null without a tailnet. */
  fqdn: string | null;
  /** An API key is stored: invitations create the share themselves. The key itself never leaves the core. */
  apiKey: boolean;
  /**
   * Whether the tailnet policy limits shared users to Boite's port: `restricted`,
   * `open` (a shared user may reach other ports of this machine) or `unknown`
   * (no API key, or the policy could not be read).
   */
  policy: 'restricted' | 'open' | 'unknown';
  /** The policy lines to add when it is `open`, ready to paste. */
  policyFix?: string;
}
/**
 * Where the internet stands with the contact routes on Tailscale Funnel:
 * `checking` before the first answer, `ready` once a request from the
 * internet reached this core, `unpublished` while public DNS does not know
 * the name yet, `unreachable` when the name resolves but the request does not
 * arrive, `unknown` when no public resolver answered.
 */
export type ContactFunnelStatus = 'checking' | 'ready' | 'unpublished' | 'unreachable' | 'unknown';
/** The contact routes on Tailscale Funnel, checked from the internet while they are up. */
export interface ContactFunnelState {
  /** Their public origin, `https://<machine>.<tailnet>.ts.net:<port>`. */
  url: string;
  status: ContactFunnelStatus;
  checkedAt: Timestamp | null;
  /** Still unpublished long after it was turned on, Funnel was turned off and on again: Tailscale publishes the name then. */
  repaired: boolean;
}
export interface ContactsState {
  self: { coreId: string; machine: string };
  contacts: Contact[];
  /** Pending requests first, then the last 50 decided. */
  requests: ContactRequest[];
  settings: ContactSettings;
  tailscale: ContactTailscale;
  /** Invitations neither used nor expired. Absent from older cores. */
  invitations?: number;
  /**
   * This core makes invitations for another network (`contacts.invite` with
   * `internet`). Absent from older cores, which read only `share` and would
   * share the machine instead.
   */
  internet?: boolean;
  /** The contact routes on Tailscale Funnel while they are up, null otherwise. Absent from older cores. */
  funnel?: ContactFunnelState | null;
  /** Contact mail waiting for this owner, oldest first, at most 50. Absent from older cores. */
  mail?: HeldContactLetter[];
  /** The Contacts bot of this core, null before the Contacts switch made it. Absent from older cores. */
  bot?: { agentId: string; threadId: string } | null;
  /** Threads in relation with a contact's, newest first. Absent from older cores. */
  relations?: ContactRelation[];
  /** Flags still open, then the last 50 decided. Absent from older cores. */
  flags?: ContactFlag[];
}
/** What the Contacts bot reads before it acts (`boite contacts`). */
export interface ContactsBotView {
  requests: ContactRequest[];
  relations: ContactRelation[];
  flags: ContactFlag[];
  contacts: { name: string; coreId: string; trusted: boolean; link: Contact['link']; offers: string[]; granted: string[]; bot: boolean }[];
  /** This core's projects the bot may start a thread on or propose to open, with their git remote. */
  projects: { id: ProjectId; name: string; gitRemote?: string }[];
}
/**
 * A letter a contact not marked trusted wrote outside a shared project, to a
 * thread whose agent has tools: no agent reads it until the owner delivers it
 * (`contacts.decideMail`). It still expires when its sender said.
 */
export interface HeldContactLetter {
  id: string;
  coreId: string;
  /** The contact's local name. */
  contact: string;
  /** The sending thread's title as the contact's core gave it. */
  from: string;
  threadId: ThreadId;
  /** The title of the thread it was written to. */
  thread: string;
  text: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}
export interface CoordinationView {
  self: AgentAddress;
  config: CoordinationConfig;
  messages: AgentLetter[];
  sent: number;
  /** Null: no limit. Older cores send a number. */
  sendLimit: number | null;
  wakes: number;
  /** Null: no limit. Older cores send a number. */
  wakeLimit: number | null;
}

export interface CoordinationRpcMethods {
  'collaboration.get': { params: { threadId: ThreadId }; result: CoordinationView };
  'collaboration.configure': { params: { threadId: ThreadId; config: CoordinationConfig }; result: CoordinationView };
  'collaboration.directory': { params: { threadId: ThreadId }; result: { agents: AgentContact[]; unavailable: string[] } };
  'collaboration.send': { params: { threadId: ThreadId; to: AgentAddress; text: string; replyTo?: string; requestId: string }; result: AgentLetter };
  /** Contacts on this core and linked cores whose title, project, branch, model, resources or chat contain every word of `query`. */
  'collaboration.search': { params: { threadId: ThreadId; query: string }; result: { matches: AgentMatch[]; unavailable: string[] } };
  /** Another contact's conversation, newest `limit` entries (default 30, at most 100) before `before`. */
  'collaboration.read': { params: { threadId: ThreadId; target: AgentAddress; limit?: number; before?: Timestamp }; result: AgentTranscript };
  /**
   * Waits up to `timeoutMs` (at most 300,000) for incoming messages, from `from` only when given,
   * and hands them over as delivered: they are not injected into the turn a second time.
   */
  'collaboration.wait': { params: { threadId: ThreadId; from?: AgentAddress; timeoutMs: number }; result: { letters: AgentLetter[] } };
  /**
   * The calling persistent agent and the projects entrusted to it. The
   * `resident.*` methods name the agent's own direct conversation as
   * `threadId`; the core holds them to the projects of its profile.
   * `machine` names another machine of the group (name or core id prefix):
   * the call goes there over the group's sealed link, and that machine
   * answers only while its own `groupBots` setting is on. One that does not
   * answer fails as unavailable, never as an empty list.
   */
  'resident.view': { params: { threadId: ThreadId }; result: ResidentView };
  /** The threads of its projects, the most recently active first. `project` narrows to one (id, name or folder). */
  'resident.threads': { params: { threadId: ThreadId; project?: string; archived?: boolean; machine?: string }; result: ProjectThreadRow[] };
  /** One thread of its projects, with its pending questions, permissions and last answer. */
  'resident.thread': { params: { threadId: ThreadId; target: ThreadId; machine?: string }; result: ProjectThreadDetail };
  /**
   * Act on a thread of its projects: `rename` takes `title`, `move` takes
   * `project` (another project entrusted to it). Every action leaves a system
   * line in the target's timeline naming the agent.
   */
  'resident.act': { params: { threadId: ThreadId; target: ThreadId; action: ResidentThreadAction; title?: string; project?: string; machine?: string }; result: { thread: ProjectThreadRow } };
  /** Answer or skip a pending question of a thread of its projects, marked as the agent's in that timeline. */
  'resident.answer': { params: { threadId: ThreadId; target: ThreadId; questionId: RequestId; optionIds: string[]; text?: string; skip?: boolean; machine?: string }; result: { ok: true } };
  /**
   * A message to a thread of its projects on another machine of the group,
   * marked there as the bot's, never as the user's. A thread here takes
   * `collaboration.send`. `requestId` makes a retry deliver it once.
   */
  'resident.send': { params: { threadId: ThreadId; machine: string; target: ThreadId; text: string; requestId: string }; result: { id: string; status: 'received' } };
  'collaboration.identity': { params: Record<string, never>; result: CoordinationPeer };
  'collaboration.peers': { params: Record<string, never>; result: CoordinationPeer[] };
  'collaboration.check': { params: { coreId: string }; result: { ok: true } };
  'collaboration.trust': { params: { peer: CoordinationPeer }; result: CoordinationPeer };
  'collaboration.untrust': { params: { coreId: string }; result: { ok: true } };
  /** Owner-only route over the app's existing authenticated connections. Agents cannot register routes. */
  'collaboration.bridge.register': { params: { coreId: string; enabled: boolean }; result: { ok: true } };
  /** The destination verifies the original core's signature and its local permissions. */
  'collaboration.bridge.forward': { params: { coreId: string; body: string; signature: string }; result: CoordinationBridgeResponse };
  /** Only the owner connection that received this request can complete it. */
  'collaboration.bridge.reply': { params: { requestId: string; response: CoordinationBridgeResponse }; result: { ok: true } };
  /** Contacts, requests, settings and the Tailscale state. Owner only. */
  'contacts.get': { params: Record<string, never>; result: ContactsState };
  /**
   * A one-time invitation, valid 24 hours. Creates the Tailscale share when an
   * API key is stored, unless `share` is false: the invitee already reaches
   * this machine on Tailscale. `internet`: the invitee is on another network
   * (Headscale, none), so the link names Boite's contact routes on Tailscale
   * Funnel and shares nothing. Owner only.
   */
  'contacts.invite': { params: { share?: boolean; internet?: boolean }; result: ContactInvite };
  /**
   * Spends every open invitation unused: a link already sent, or one that
   * leaked, joins nothing any more. Contacts already joined stay. Owner only.
   */
  'contacts.cancelInvites': { params: Record<string, never>; result: { cancelled: number } };
  /**
   * Joins with an invitation: this core dials the host, checks its key and
   * keeps the link open. A host on Tailscale Funnel whose name public DNS
   * does not know yet is refused with `data.retryAfterMs`: the invitation is
   * unspent and the same call may be made again then. Owner only.
   */
  'contacts.join': { params: { link: string }; result: Contact };
  /** Rename a contact or mark it trusted. Owner only. */
  'contacts.update': { params: { coreId: string; name?: string; trusted?: boolean }; result: Contact };
  /**
   * Open a project to a contact, or change its read grant. `machine`: the core
   * id of the group member that holds the project, asked for its name; missing
   * or this core's own id for a project of this core. Owner only.
   */
  'contacts.grant': { params: { coreId: string; projectId: ProjectId; readThreads?: boolean; machine?: string }; result: Contact };
  /** Close a project to a contact: its pending letters to that project are rejected. `machine` as for `contacts.grant`. Owner only. */
  'contacts.revoke': { params: { coreId: string; projectId: ProjectId; machine?: string }; result: Contact };
  /** Forget a contact: every grant ends, pending letters are rejected and the link closes. Owner only. */
  'contacts.remove': { params: { coreId: string }; result: { ok: true } };
  /** Accept a request by opening `projectId`, or refuse it with a reason sent back to the asking agent. Owner only. */
  'contacts.decide': { params: { id: string; accept: boolean; projectId?: ProjectId; reason?: string }; result: ContactRequest };
  /** Deliver a held contact letter (`ContactsState.mail`) to its thread, or refuse it: its sender reads it was refused. Owner only. */
  'contacts.decideMail': { params: { id: string; accept: boolean }; result: { ok: true } };
  'contacts.settings': { params: { settings: ContactSettings }; result: ContactSettings };
  /** Store or clear the Tailscale API key; it never leaves the core. Owner only. */
  'contacts.tailscaleKey': { params: { key: string | null }; result: ContactTailscale };
  /** The contacts this thread's agent may write to, with the projects each opened to this core. */
  'collaboration.contacts': { params: { threadId: ThreadId }; result: { name: string; coreId: string; projects: string[]; link: Contact['link'] }[] };
  /**
   * A request to a contact, handed to this core's Contacts bot: it picks the
   * contact (`contact` when given), forwards it, and the answer comes back to
   * this thread as a message, with the thread it is put in relation with.
   * `target` names a contact's thread exactly as `<contact>/<thread-id>`.
   * Refused while this core has no Contacts bot.
   */
  'collaboration.ask': { params: { threadId: ThreadId; contact?: string; text: string; target?: string; want?: ContactRequestWant }; result: ContactRequest };
  /** What the Contacts bot reads: requests, relations, flags, contacts and projects. Its own thread only. */
  'contacts.bot.view': { params: { threadId: ThreadId }; result: ContactsBotView };
  /** The bot sends an outgoing request (`stage: 'bot'`) to `contact`, rewording `text` or naming `target` when it found better. */
  'contacts.bot.forward': { params: { threadId: ThreadId; id: string; contact: string; text?: string; target?: ThreadId; want?: ContactRequestWant }; result: ContactRequest };
  /** The bot accepts an incoming request by putting its asking thread in relation with `target`, a thread of this core. */
  'contacts.bot.connect': { params: { threadId: ThreadId; id: string; target: ThreadId }; result: ContactRequest };
  /** The bot accepts an incoming request by starting a thread on `project` with `brief`, in relation with the asking thread. */
  'contacts.bot.start': { params: { threadId: ThreadId; id: string; project: string; brief: string; model?: string; effort?: string; worktree?: boolean }; result: { request: ContactRequest; threadId: ThreadId } };
  /** A card asking the owner to open `project` to the request's contact; their Yes opens it and accepts the request. Always the owner's. */
  'contacts.bot.share': { params: { threadId: ThreadId; id: string; project: string; reason: string }; result: { questionId: RequestId } };
  /** A card asking the owner whether the bot may act on a request of a contact not trusted, with what it proposes. Their No refuses it. */
  'contacts.bot.askOwner': { params: { threadId: ThreadId; id: string; text: string }; result: { questionId: RequestId } };
  'contacts.bot.refuse': { params: { threadId: ThreadId; id: string; reason: string }; result: ContactRequest };
  /**
   * The bot cuts what a contact reaches here: one relation, one project, or
   * with neither every relation and project of that contact. The link and
   * the contact stay; the owner removes those.
   */
  'contacts.bot.cut': { params: { threadId: ThreadId; contact: string; relation?: string; project?: string; reason: string }; result: { relations: number; projects: number } };
  /** The bot's verdict on an open flag: the held letter delivered, or refused (its sender reads why). */
  'contacts.bot.flag': { params: { threadId: ThreadId; id: string; deliver: boolean; reason?: string }; result: ContactFlag };
  /** The owner ends a relation from the Contacts page. Owner only. */
  'contacts.cutRelation': { params: { id: string }; result: { ok: true } };
}

export interface CoordinationRpcEvents {
  'collaboration.changed': { threadId: ThreadId };
  /** Sent directly to the owner connection registered for the target core. */
  'collaboration.bridge.request': { requestId: string; fromCoreId: string; toCoreId: string; body: string; signature: string };
}
