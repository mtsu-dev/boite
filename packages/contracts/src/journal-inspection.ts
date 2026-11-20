export const JOURNAL_INSPECTION_TABLES = ['threads', 'turns', 'messages', 'turn_requests', 'background_observations', 'coordination_letters'] as const;
export type JournalInspectionTable = typeof JOURNAL_INSPECTION_TABLES[number];
export interface JournalInspectionCursor { table: JournalInspectionTable; afterRowid: number }
export interface JournalInspectionIssue {
  table: JournalInspectionTable;
  rowId: number;
  code: 'missing-thread' | 'missing-turn' | 'turn-thread-mismatch' | 'terminal-streaming-message' | 'invalid-queue-hold'
    | 'oversized-json' | 'malformed-json' | 'invalid-fork-origin' | 'fork-origin-owner-mismatch'
    | 'invalid-background-observation' | 'background-owner-mismatch' | 'background-parent-mismatch'
    | 'request-message-mismatch' | 'invalid-letter-owner';
  field: string;
  /** Fixed diagnostic expectation, never stored text, IDs, payloads or credentials. */
  expected: string;
}
export interface JournalInspection {
  issues: JournalInspectionIssue[];
  checked: number;
  cursor: JournalInspectionCursor | null;
  /** Further rows remain. Concurrent pages do not form an atomic global integrity proof. */
  truncated: boolean;
}
