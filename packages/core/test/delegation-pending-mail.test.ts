import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal.ts';
import { pendingMail } from '../src/delegation/pending-mail.ts';

const dir = mkdtempSync(join(tmpdir(), 'boite-pending-mail-'));
const journal = new Journal(join(dir, 'journal.db'));
afterEach(() => { journal.close(); rmSync(dir, { recursive: true, force: true }); });

test('paused results stay on disk, ordinary letters remain eligible for expiry, and resume or defaults expose results immediately', () => {
  const insert = journal.db.query(`INSERT INTO delegation_messages
    (id, root_id, sender_id, recipient_id, request_id, fingerprint, status, created_at, data)
    VALUES (?, ?, 'child', ?, ?, '', 'received', 1, ?)`);
  for (const root of ['default', 'paused', 'disabled']) {
    insert.run(`${root}-result`, root, root, `result:${root}`, 'result body');
    insert.run(`${root}-letter`, root, root, root, JSON.stringify({ expiresAt: 1 }));
  }
  journal.setSetting('delegation:paused', { enabled: true, paused: true, profiles: [] });
  journal.setSetting('delegation:disabled', { enabled: false, paused: false, profiles: [] });
  const rows = pendingMail(journal.db);
  expect(rows.filter(row => row.data === null).map(row => row.root_id)).toEqual(['default']);
  expect(rows.filter(row => row.data !== null).map(row => row.root_id).sort()).toEqual(['default', 'disabled', 'paused']);
  expect(journal.db.query("SELECT COUNT(*) AS n FROM delegation_messages WHERE status = 'received'").get()).toEqual({ n: 6 });
  journal.setSetting('delegation:paused', { enabled: true, paused: false, profiles: [] });
  expect(pendingMail(journal.db).filter(row => row.data === null).map(row => row.root_id).sort()).toEqual(['default', 'paused']);
});
