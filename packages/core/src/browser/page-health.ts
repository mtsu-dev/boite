import type { BrowserPageHealth } from '@boite/contracts';

type Listen = (method: string, listener: (params: Record<string, unknown>) => void) => void;
type Document = BrowserPageHealth & { frameId: unknown };

/** Keep health by loader so a late failure cannot be attributed to the next page. */
export function pageHealth(on: Listen, changed: () => void): () => BrowserPageHealth | undefined {
  const documents = new Map<unknown, Document>();
  const scripts = new Map<unknown, Document>();
  let current: Document | undefined;
  function document(loader: unknown, frameId: unknown): Document | undefined {
    if (typeof loader !== 'string' || !loader || typeof frameId !== 'string') return;
    let state = documents.get(loader);
    if (!state) {
      if (documents.size >= 32) documents.delete(documents.keys().next().value);
      documents.set(loader, state = { frameId, loading: true, failedScripts: 0 });
    }
    if (state.frameId === frameId) return state;
  }
  on('Page.frameNavigated', ({ frame }) => {
    const { id, loaderId, parentId } = frame as { id: string; loaderId?: string; parentId?: string };
    if (parentId) return;
    current = document(loaderId, id);
    changed();
  });
  on('Page.lifecycleEvent', ({ name, frameId, loaderId }) => {
    if (name !== 'load') return;
    const state = document(loaderId, frameId);
    if (!state?.loading) return;
    state.loading = false;
    if (state === current) changed();
  });
  on('Network.requestWillBeSent', ({ requestId, type, frameId, loaderId }) => {
    if (type !== 'Script') return;
    const state = document(loaderId, frameId);
    if (!state) return;
    if (scripts.size >= 500) scripts.delete(scripts.keys().next().value);
    scripts.set(requestId, state);
  });
  on('Network.responseReceived', ({ type, frameId, loaderId, requestId, response }) => {
    const { status } = response as { status?: number };
    if (typeof status !== 'number' || status < 400) return;
    const state = document(loaderId, frameId);
    if (!state) return;
    if (type === 'Document') state.httpError = status;
    else if (type === 'Script') { state.failedScripts++; scripts.delete(requestId); }
    else return;
    if (state === current) changed();
  });
  on('Network.loadingFinished', ({ requestId }) => { scripts.delete(requestId); });
  on('Network.loadingFailed', ({ requestId, canceled }) => {
    const state = scripts.get(requestId);
    scripts.delete(requestId);
    if (!state || canceled) return;
    state.failedScripts++;
    if (state === current) changed();
  });
  return () => current && { loading: current.loading, failedScripts: current.failedScripts, ...(current.httpError ? { httpError: current.httpError } : {}) };
}
