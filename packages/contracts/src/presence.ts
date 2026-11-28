/**
 * Rich presence: what the desktop app shows of its work in a chat app's
 * profile, "Playing Boite" in Discord (docs/internals/presence.md). The core
 * speaks Discord's local IPC protocol to every chat app listening on its
 * socket on this machine: Discord itself, Vesktop, Legcord and the other
 * clients built on arRPC, and the bridges that copy it to Fluxer or another
 * app. The app decides the words, in its language; the core adds Boite's
 * application, logo and link and paces the updates.
 */

/** The Discord application whose name ("Boite") and icon a chat app shows above the lines. */
export const PRESENCE_APPLICATION_ID = '1575628367301058630';
/** The logo shown beside the lines: the art asset of that name uploaded to the application (Rich Presence > Art Assets). */
export const PRESENCE_LOGO_ASSET = 'boite';
/** Where the button leads. */
export const PRESENCE_LINK = 'https://mtsu.dev/projects/boite';
/** Discord refuses a line shorter or longer. */
export const PRESENCE_TEXT = { min: 2, max: 128 } as const;
/** Discord refuses a longer button label. */
export const PRESENCE_BUTTON_MAX = 32;

/** What the desktop app asks the chat apps to show. */
export interface PresenceActivity {
  /** The first line under the app's name: "Working on boite". */
  details: string;
  /** The second line: "3 agents · Opus 5.5". */
  state?: string;
  /** When the work began, in milliseconds: the chat app counts up from it. */
  startedAt?: number;
  /** The label of the button to Boite's page, which others see on the profile. Absent: no button. */
  button?: string;
}

/** A chat app that took the presence. */
export interface PresenceTarget {
  /** The socket or pipe it listens on: `discord-ipc-0`, `app/com.discordapp.Discord/discord-ipc-0`. */
  socket: string;
  /** The account it answered with, its display name, or null when it gave none (arRPC gives a placeholder). */
  user: string | null;
}

export interface PresenceStatus {
  /** An activity is set; false once cleared. */
  active: boolean;
  /** The chat apps showing it now. Empty while none listens: the core looks again every 15 seconds. */
  targets: PresenceTarget[];
}

export interface PresenceRpcMethods {
  /**
   * Shows `activity` in every chat app listening on this machine, or clears
   * it (`null`). Owner only, from this machine's loopback: a chat app's socket
   * is on the machine that runs the core. Cleared too when the socket that set
   * it closes. Refused in a build without the `discord-presence` experiment.
   */
  'presence.set': { params: { activity: PresenceActivity | null }; result: PresenceStatus };
}

export interface PresenceRpcEvents {
  /** To the socket that set the presence, when a chat app takes it or goes. */
  'presence.status': PresenceStatus;
}

/** The one problem with `presence.set` params, or null. */
export function presenceParamsProblem(params: unknown): { field: string; message: string } | null {
  if (typeof params !== 'object' || params === null || !('activity' in params)) return { field: 'activity', message: 'activity must be an object or null' };
  const activity = (params as { activity: unknown }).activity;
  if (activity === null) return null;
  if (typeof activity !== 'object' || Array.isArray(activity)) return { field: 'activity', message: 'activity must be an object or null' };
  const { details, state, startedAt, button, ...rest } = activity as Record<string, unknown>;
  const extra = Object.keys(rest)[0];
  if (extra !== undefined) return { field: `activity.${extra}`, message: `activity.${extra} is not a presence field: details, state, startedAt or button` };
  const line = (value: unknown) => typeof value === 'string' && [...value.trim()].length >= PRESENCE_TEXT.min && [...value].length <= PRESENCE_TEXT.max;
  if (!line(details)) return { field: 'activity.details', message: `activity.details must be text of ${PRESENCE_TEXT.min} to ${PRESENCE_TEXT.max} characters` };
  if (state !== undefined && !line(state)) return { field: 'activity.state', message: `activity.state must be text of ${PRESENCE_TEXT.min} to ${PRESENCE_TEXT.max} characters` };
  if (startedAt !== undefined && !(Number.isSafeInteger(startedAt) && (startedAt as number) > 0)) return { field: 'activity.startedAt', message: 'activity.startedAt must be a time in milliseconds' };
  if (button !== undefined && !(typeof button === 'string' && button.trim().length > 0 && [...button].length <= PRESENCE_BUTTON_MAX)) return { field: 'activity.button', message: `activity.button must be text of 1 to ${PRESENCE_BUTTON_MAX} characters` };
  return null;
}
