import { Database } from 'bun:sqlite';
import type { AgentContact, AgentMatch } from '@boite/contracts';
import { redactSharedText } from './contacts/file-policy.ts';
import { searchContacts } from './coordination-lookup.ts';
import { messageOf } from './errors.ts';

export interface SearchRequest { file: string; candidates: AgentContact[]; words: string[]; redact: boolean }
export type SearchReply = { matches: AgentMatch[] } | { error: string };

const scope = globalThis as unknown as {
  onmessage: ((event: { data: SearchRequest }) => void) | null;
  postMessage(reply: SearchReply): void;
};

scope.onmessage = ({ data: { file, candidates, words, redact } }) => {
  try {
    let matches: AgentMatch[];
    {
      using db = new Database(file, { readonly: true });
      matches = db.transaction(() => searchContacts(db, candidates, words, true, redact ? redactSharedText : undefined))();
    }
    scope.postMessage({ matches });
  } catch (error) {
    scope.postMessage({ error: messageOf(error) });
  }
};
