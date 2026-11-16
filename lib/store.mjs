import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE REFERENCES drafts(id), reply TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status = 'delivered'), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id),
      status TEXT NOT NULL CHECK(status IN ('failed', 'delivered')), created_at TEXT NOT NULL);`);
  const draftInsert = db.prepare('INSERT INTO drafts (id, value) VALUES (?, ?)');
  const getDraft = db.prepare('SELECT value FROM drafts WHERE id = ?');
  const getHandoff = db.prepare('SELECT id, draft_id AS draftId, reply, status, created_at AS createdAt FROM handoffs WHERE draft_id = ?');
  const attemptInsert = db.prepare('INSERT INTO attempts (id, draft_id, status, created_at) VALUES (?, ?, ?, ?)');
  return {
    saveDraft(draft) { draftInsert.run(draft.id, JSON.stringify(draft)); return draft; },
    deliver({ draftId, reply, simulateFailure = false }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = getDraft.get(draftId);
        if (!row) throw new RequestError(404, 'Draft not found.');
        if (!['answered', 'needs-information'].includes(JSON.parse(row.value).status)) {
          throw new RequestError(409, 'This draft cannot be delivered. Resolve the missing evidence or blocked content first.');
        }
        const existing = getHandoff.get(draftId);
        if (existing) {
          if (existing.reply !== reply) throw new RequestError(409, 'This draft was already delivered with a different reply. Create a new draft.');
          db.exec('COMMIT');
          return { ...existing };
        }
        const createdAt = new Date().toISOString();
        attemptInsert.run(randomUUID(), draftId, simulateFailure ? 'failed' : 'delivered', createdAt);
        if (simulateFailure) {
          db.exec('COMMIT');
          throw new RequestError(503, 'Mock CRM delivery failed as requested. Your draft and failed attempt were saved; you can retry.');
        }
        const handoff = { id: randomUUID(), draftId, reply, status: 'delivered', createdAt };
        db.prepare('INSERT INTO handoffs (id, draft_id, reply, status, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(handoff.id, draftId, reply, handoff.status, createdAt);
        db.exec('COMMIT');
        return handoff;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    history() {
      return {
        drafts: db.prepare('SELECT value FROM drafts ORDER BY rowid DESC LIMIT 100').all().map(({ value }) => JSON.parse(value)),
        handoffs: db.prepare('SELECT id, draft_id AS draftId, reply, status, created_at AS createdAt FROM handoffs ORDER BY rowid DESC LIMIT 100').all(),
        attempts: db.prepare('SELECT id, draft_id AS draftId, status, created_at AS createdAt FROM attempts ORDER BY rowid DESC LIMIT 100').all(),
      };
    },
    close() { db.close(); },
  };
}
