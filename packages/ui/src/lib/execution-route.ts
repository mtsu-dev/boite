import { effortName, levelName, providerName } from './format';
import { modelLogoId, modelMakerName } from './provider-logos';
import type { Choice, Store } from './store.svelte';
import { strings } from './strings';

type Route = Pick<Choice, 'providerId' | 'model' | 'effort'> & { accountId?: string };

export function executionRoute(store: Store, route: Route) {
  const { providerId, model: id, accountId = '', effort: level } = route;
  const model = store.modelOf({ providerId, accountId, model: id, effort: level, permissionMode: 'default' });
  const provider = providerName(store, providerId);
  const name = model?.name ?? id ?? strings.thread.defaultModel;
  const effort = level ? levelName({ id: level, label: effortName(model, level) }) : null;
  const logo = modelLogoId(providerId, id ?? model?.id);
  return { maker: modelMakerName(logo, providerId) ?? provider, name, effort, logo, label: [provider, name, effort].filter(Boolean).join(' · ') };
}

/** Present a locally known request without probing or treating it as an admitted route. */
export function requestedExecutionRoute(store: Store, model: string, effort: string | null): Route | null {
  const wanted = model.trim().toLowerCase();
  const parent = store.openThread;
  const candidates = store.providers.map(provider => ({
    providerId: provider.id,
    accountId: store.usableAccountOf(provider.id, parent?.providerId === provider.id ? parent.accountId : null)?.id,
  }));
  const qualified = candidates.find(({ providerId }) => wanted.startsWith(`${providerId.toLowerCase()}/`));
  if (qualified) return { ...qualified, model: model.trim().slice(qualified.providerId.length + 1), effort };
  const models = candidates.flatMap(route => store.modelsOf(route.providerId, route.accountId ?? null).map(entry => ({ ...route, entry })));
  const exact = models.filter(({ entry }) => entry.id.toLowerCase() === wanted);
  const matches = exact.length ? exact : models.filter(({ entry }) => entry.id.toLowerCase().includes(wanted) || entry.name.toLowerCase().includes(wanted));
  const match = matches.length === 1 ? matches[0] : exact.find(({ providerId }) => providerId === parent?.providerId);
  return match ? { providerId: match.providerId, accountId: match.accountId, model: match.entry.id, effort } : null;
}
