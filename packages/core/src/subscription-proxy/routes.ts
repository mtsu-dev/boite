import { MODEL_ROUTE_FAMILIES, type ModelFamily } from '@boite/contracts';

export const ANTIGRAVITY = 'antigravity';

/** Open-weight families: offered to every harness, whatever routing prefix the gateway gives them. */
const OPEN_MODEL = /gpt-oss|kimi|qwen|llama|deepseek|mistral|mixtral|glm/i;

/**
 * The vendor whose harness a proprietary model belongs to, or null for an open
 * or unknown model. The name is read after the gateway's routing prefix, so
 * `antigravity/claude-opus-5-5` is a Claude model; an unknown name falls back
 * to a vendor prefix, so `codex/computer-use-preview` is an OpenAI model.
 */
export function proprietaryFamily(id: string): ModelFamily | null {
  const slash = id.lastIndexOf('/');
  const name = id.slice(slash + 1);
  if (OPEN_MODEL.test(name)) return null;
  if (/claude|opus|sonnet|haiku|fable/i.test(name)) return 'anthropic';
  if (/^(?:chatgpt|gpt|codex)(?:[-_.\d]|$)|^openai(?:[-_]|$)|^o\d+(?:-|$)/i.test(name)) return 'openai';
  if (/gemini/i.test(name)) return 'google';
  if (/grok/i.test(name)) return 'xai';
  if (/muse/i.test(name)) return 'meta';
  const route = slash > 0 ? id.slice(0, slash).split('/').pop()!.toLowerCase() : '';
  return Object.hasOwn(MODEL_ROUTE_FAMILIES, route) ? MODEL_ROUTE_FAMILIES[route]! : null;
}

/**
 * A model only the Antigravity harness is offered: one the gateway routes
 * through Antigravity (`antigravity/claude-opus-5-5`, `antigravity/gpt-oss-120b`),
 * whatever its family, and any Gemini model. Google bans an account used
 * outside Antigravity, so these run there alone, through the gateway's Gemini
 * API or the native sign-in, as Claude's models run in Claude Code.
 */
export function antigravityOnly(id: string): boolean {
  const slash = id.lastIndexOf('/');
  const routes = slash > 0 ? id.slice(0, slash).toLowerCase().split('/') : [];
  return routes.includes(ANTIGRAVITY) || proprietaryFamily(id) === 'google';
}

