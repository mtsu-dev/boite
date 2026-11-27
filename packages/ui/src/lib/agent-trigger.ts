import { parseGroupRelayUrl, type Group } from '@boite/contracts';

export function triggerPatterns(input: string): string[] {
  const paths: string[] = [];
  let braces = 0;
  let inClass = false;
  let start = 0;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '\n' || (char === ',' && braces === 0 && !inClass)) {
      paths.push(input.slice(start, index));
      start = index + 1;
      braces = 0;
      inClass = false;
    } else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (!inClass && char === '{') braces++;
    else if (!inClass && char === '}' && braces > 0) braces--;
  }
  paths.push(input.slice(start));
  return paths.map(path => path.trim()).filter(Boolean);
}

/** Webhook callers use the owning core directly, without this client's group relay. */
export function triggerWebhookUrl(path: string, endpoint: string | null, publicUrl: string | null, group: Group | null, pageOrigin: string): string | null {
  const direct = endpoint?.replace(/^ws(s?):/, 'http$1:') ?? null;
  const relay = direct && parseGroupRelayUrl(direct);
  const addresses = relay ? group?.cores.find(core => core.coreId === relay.coreId)?.addresses ?? [] : [direct ?? pageOrigin];
  for (const address of [publicUrl, ...addresses]) {
    if (!address || !URL.canParse(address)) continue;
    const base = new URL(address);
    if (base.protocol === 'http:' || base.protocol === 'https:') return new URL(path, base).href;
  }
  return null;
}
