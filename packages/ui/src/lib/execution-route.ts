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
