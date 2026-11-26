import type { BrowserDiagnostic, BrowserPageHealth } from '@boite/contracts';
import { evaluate, type AgentPage } from './automation.ts';

const DIALOGS_MAX = 20;
const DIAGNOSTICS_MAX = 200;

type DocumentHealth = BrowserPageHealth & { frameId: string };

/** What of a tab its page's events write to. */
export interface WatchedPage {
  /** An agent command is running: the dialogs it raises follow `page.dialogPolicy`. */
  acting: boolean;
  page: AgentPage;
  title: string;
  diagnostics: BrowserDiagnostic[];
  dropped: number;
  requests: Map<string, string>;
  /** The page's own calls still loading, by request id: when each began. */
  loading: Map<string, number>;
}

/** The calls an action waits for: what a page fetches or navigates to, not images, scripts or a stream it keeps open. */
const AWAITED = new Set(['Document', 'Fetch', 'XHR']);
/** A call still loading after this long is a long poll or a stuck server: an action no longer waits for it. */
const FRESH_MS = 1500;
const LOADING_MAX = 200;

/** How many of `loading` began within `FRESH_MS` of `now`; older ones are forgotten. */
export function freshCalls(loading: Map<string, number>, now = Date.now()): number {
  let count = 0;
  for (const [id, began] of loading) {
    if (now - began < FRESH_MS) count++;
    else loading.delete(id);
  }
  return count;
}

/** Credentials, query and fragment never enter diagnostics: they can carry tokens. */
export function bareUrl(raw: string): string {
  try { const url = new URL(raw); return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 2000); } catch { return raw.slice(0, 200); }
}

/**
 * Listens to one tab's page: its top frame's navigations, its dialogs, its
 * console, exceptions and failed requests, the diagnostics an agent reads.
 * Returns a snapshot reader for the current document's loading and failures.
 * `on` subscribes to an event of this tab's session only.
 */
export function watchPage(
  tab: WatchedPage,
  on: (method: string, listener: (params: Record<string, unknown>) => void) => void,
  answerDialog: (accept: boolean, promptText?: string) => void,
  navigated: (url: string) => void,
  changed: () => void,
): () => BrowserPageHealth | undefined {
  const note = (entry: Omit<BrowserDiagnostic, 'at'>) => {
    tab.diagnostics.push({ at: Date.now(), ...entry, text: entry.text.slice(0, 2000) });
    if (tab.diagnostics.length > DIAGNOSTICS_MAX) { tab.diagnostics.shift(); tab.dropped++; }
  };
  // Keep health by loader so a late failure cannot be attributed to the next page.
  const documents = new Map<string, DocumentHealth>();
  const scripts = new Map<unknown, DocumentHealth>();
  let health: DocumentHealth | undefined;
  function healthForDocument(loaderId: unknown, frameId: unknown): DocumentHealth | undefined {
    if (typeof loaderId !== 'string' || !loaderId || typeof frameId !== 'string') return;
    let state = documents.get(loaderId);
    if (!state) {
      if (documents.size >= 32) documents.delete(documents.keys().next().value!);
      state = { frameId, loading: true, failedScripts: 0 };
      documents.set(loaderId, state);
    }
    if (state.frameId === frameId) return state;
  }
  let mainDocument: { id: string; loaderId?: string } | undefined;
  on('Page.frameNavigated', params => {
    const frame = params.frame as { id: string; loaderId?: string; parentId?: string; url: string };
    if (frame.parentId) return;
    mainDocument = frame;
    health = healthForDocument(frame.loaderId, frame.id);
    navigated(frame.url);
  });
  on('Page.lifecycleEvent', ({ name, frameId, loaderId }) => {
    if (name === 'load') {
      const state = healthForDocument(loaderId, frameId);
      if (state?.loading) {
        state.loading = false;
        if (state === health) changed();
      }
      return;
    }
    // A target can still report the URL as its title when manual navigation returns.
    const loaded = mainDocument;
    if (name !== 'DOMContentLoaded' || !loaded || loaded.id !== frameId || loaded.loaderId !== loaderId) return;
    const previous = tab.title;
    void evaluate(tab.page, 'document.title', 5000).then(title => {
      if (mainDocument !== loaded || tab.title !== previous || typeof title !== 'string' || title === previous) return;
      tab.title = title.slice(0, 200);
      changed();
    }).catch(() => {});
  });
  on('Page.javascriptDialogOpening', params => {
    // Nobody can answer a dialog in a headless page. One an agent command raised follows
    // `dialog accept|dismiss` and is reported to it; any other alert is accepted and a
    // question declined, so a person acting in the panel never confirms by accident.
    const type = String(params.type), message = String(params.message ?? '');
    note({ kind: 'console', level: 'info', text: `${type} dialog: ${message}` });
    const policy = tab.page.dialogPolicy;
    const accept = tab.acting && type !== 'beforeunload' ? policy.accept : type === 'alert' || type === 'beforeunload';
    const promptText = accept && type === 'prompt' ? policy.text ?? String(params.defaultPrompt ?? '') : undefined;
    if (tab.acting && (type === 'alert' || type === 'confirm' || type === 'prompt')) {
      tab.page.dialogs.push({ type, message: message.slice(0, 500), accepted: accept, ...(type === 'prompt' ? { value: accept ? promptText ?? '' : null } : {}) });
      if (tab.page.dialogs.length > DIALOGS_MAX) tab.page.dialogs.shift();
    }
    answerDialog(accept, promptText);
  });
  on('Runtime.consoleAPICalled', params => {
    const args = (params.args as Array<{ value?: unknown; description?: string }> | undefined) ?? [];
    note({ kind: 'console', level: String(params.type ?? 'log'), text: args.map(arg => arg.description ?? (typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value))).join(' ') });
  });
  on('Runtime.exceptionThrown', params => {
    const details = params.exceptionDetails as { text?: string; exception?: { description?: string }; url?: string };
    note({ kind: 'exception', level: 'error', text: details.exception?.description ?? details.text ?? 'exception', ...(details.url ? { url: bareUrl(details.url) } : {}) });
  });
  // The desktop app relays only these fields of the network events (`HOST_PAGE_EVENTS` in packages/ui/src/lib/browser-host.ts): read another, compact it there too.
  on('Network.requestWillBeSent', params => {
    if (params.type === 'Script') {
      const state = healthForDocument(params.loaderId, params.frameId);
      if (state) {
        if (scripts.size >= 500) scripts.delete(scripts.keys().next().value);
        scripts.set(params.requestId, state);
      }
    }
    const url = String((params.request as { url: string }).url);
    // An inline `data:` or `blob:` address can weigh megabytes, and a failure there names no server.
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    tab.requests.set(String(params.requestId), bareUrl(url));
    if (tab.requests.size > 500) tab.requests.delete(tab.requests.keys().next().value!);
    if (AWAITED.has(String(params.type))) {
      tab.loading.set(String(params.requestId), Date.now());
      if (tab.loading.size > LOADING_MAX) tab.loading.delete(tab.loading.keys().next().value!);
    }
  });
  on('Network.loadingFinished', ({ requestId }) => {
    scripts.delete(requestId);
    tab.loading.delete(String(requestId));
  });
  on('Network.responseReceived', params => {
    const { status, statusText, url } = params.response as { status: number; statusText?: string; url: string };
    if (status >= 400) note({ kind: 'network', level: 'error', text: `HTTP ${status} ${statusText ?? ''}`.trim(), url: bareUrl(url) });
    if (typeof status !== 'number' || status < 400) return;
    const state = healthForDocument(params.loaderId, params.frameId);
    if (!state) return;
    if (params.type === 'Document') state.httpError = status;
    else if (params.type === 'Script') { state.failedScripts++; scripts.delete(params.requestId); }
    else return;
    if (state === health) changed();
  });
  on('Network.loadingFailed', params => {
    const state = scripts.get(params.requestId);
    scripts.delete(params.requestId);
    tab.loading.delete(String(params.requestId));
    if (params.canceled) return;
    if (state) {
      state.failedScripts++;
      if (state === health) changed();
    }
    const url = tab.requests.get(String(params.requestId));
    note({ kind: 'network', level: 'error', text: String(params.errorText ?? 'request failed'), ...(url ? { url } : {}) });
  });
  return () => {
    if (!health) return;
    const { loading, failedScripts, httpError } = health;
    return { loading, failedScripts, ...(httpError ? { httpError } : {}) };
  };
}
