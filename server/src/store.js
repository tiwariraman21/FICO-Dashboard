// Where the dashboard's own decisions are kept.
//
// SAP is the system of record for the ledgers, and the dashboard never pretends otherwise.
// What it records here is what people DID from it: an approval, a rejection, a problem
// marked fixed, a reminder sent, a promise to pay noted, a close task moved on. Each is
// laid over the data read from the provider when the dashboard is built, so the screens
// show the decision immediately.
//
// When the SAP provider is built, the approve and release actions will also call SAP (post
// the parked entry, release the blocked invoice, release the payment proposal). This file
// stays as the audit trail either way.
//
// SQLite, built into Node 22.5 and later as node:sqlite: nothing to install, nothing to
// compile, and every write is a transaction, so a decision cannot be half-recorded.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
export const DB_FOLDER = path.resolve(thisFolder, '../../db');
export const DB_PATH = path.join(DB_FOLDER, 'fico.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_kind     TEXT NOT NULL,           -- JE, INV, RUN
  doc_id       TEXT NOT NULL,
  step_level   TEXT NOT NULL,           -- whose signature this is: 'controller' or 'cfo'
  decision     TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  decided_by   TEXT NOT NULL,
  decided_at   TEXT NOT NULL,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS decisions_doc ON decisions (doc_kind, doc_id);

CREATE TABLE IF NOT EXISTS problem_fixes (
  problem_id   TEXT PRIMARY KEY,
  fix          TEXT NOT NULL,
  fixed_by     TEXT NOT NULL,
  fixed_at     TEXT NOT NULL,
  note         TEXT
);

CREATE TABLE IF NOT EXISTS task_updates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      TEXT NOT NULL,
  status       TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  note         TEXT
);

CREATE TABLE IF NOT EXISTS promises (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL,
  amount       REAL NOT NULL,
  promised_for TEXT NOT NULL,
  recorded_at  TEXT NOT NULL,
  recorded_by  TEXT NOT NULL,
  note         TEXT
);

CREATE TABLE IF NOT EXISTS reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  TEXT NOT NULL,
  level        INTEGER NOT NULL,
  sent_at      TEXT NOT NULL,
  sent_by      TEXT NOT NULL,
  note         TEXT,
  email_to     TEXT,
  email_status TEXT
);

CREATE TABLE IF NOT EXISTS flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reference    TEXT NOT NULL,
  reason       TEXT,
  flagged_by   TEXT NOT NULL,
  flagged_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  action       TEXT NOT NULL,
  reference    TEXT,
  value        REAL,
  done_by      TEXT NOT NULL,
  note         TEXT,
  email_to     TEXT,
  email_status TEXT
);
`;

let db = null;

export function openStore() {
  if (db) return db;
  fs.mkdirSync(DB_FOLDER, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

function all(sql, params = []) {
  return openStore().prepare(sql).all(...params);
}

function run(sql, params = []) {
  return openStore().prepare(sql).run(...params);
}

// Several writes as one unit: they all land, or none of them do.
function transaction(work) {
  const conn = openStore();
  conn.exec('BEGIN');
  try {
    const result = work();
    conn.exec('COMMIT');
    return result;
  } catch (error) {
    conn.exec('ROLLBACK');
    throw error;
  }
}

function logLine({ at, action, reference = null, value = null, by, note = null, emailTo = null, emailStatus = null }) {
  run(
    'INSERT INTO action_log (at, action, reference, value, done_by, note, email_to, email_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [at, action, reference, value, by, note, emailTo, emailStatus]
  );
}

// --- Reading everything back, for laying over the provider's data -------------------

export function readOverlay() {
  return {
    decisions: all('SELECT doc_kind AS kind, doc_id AS docId, step_level AS level, decision, decided_by AS decidedBy, decided_at AS decidedAt, note FROM decisions ORDER BY id'),
    fixes: all('SELECT problem_id AS problemId, fix, fixed_by AS fixedBy, fixed_at AS fixedAt, note FROM problem_fixes'),
    taskUpdates: all('SELECT task_id AS taskId, status, updated_by AS updatedBy, updated_at AS updatedAt, note FROM task_updates ORDER BY id'),
    promises: all('SELECT id, customer_id AS customerId, amount, promised_for AS promisedFor, recorded_at AS recordedAt, recorded_by AS recordedBy, note FROM promises'),
    reminders: all('SELECT customer_id AS customerId, level, sent_at AS sentAt, sent_by AS "by", note, email_to AS emailTo, email_status AS emailStatus FROM reminders ORDER BY id'),
    flags: all('SELECT reference, reason, flagged_by AS flaggedBy, flagged_at AS flaggedAt FROM flags ORDER BY id')
  };
}

export function readActionLog(limit = 200) {
  return all(
    'SELECT at, action, reference, value, done_by AS doneBy, note, email_to AS emailTo, email_status AS emailStatus FROM action_log ORDER BY id DESC LIMIT ?',
    [limit]
  );
}

// --- Writes ----------------------------------------------------------------------------

export function saveDecision({ kind, docId, level, decision, by, at, note, value, label, mail }) {
  transaction(() => {
    run(
      'INSERT INTO decisions (doc_kind, doc_id, step_level, decision, decided_by, decided_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [kind, docId, level, decision, by, at, note || null]
    );
    logLine({ at, action: label, reference: docId, value, by, note, emailTo: mail?.to, emailStatus: mail?.status });
  });
}

export function saveFix({ problemId, fix, by, at, note, reference, mail }) {
  transaction(() => {
    run(
      'INSERT OR REPLACE INTO problem_fixes (problem_id, fix, fixed_by, fixed_at, note) VALUES (?, ?, ?, ?, ?)',
      [problemId, fix, by, at, note || null]
    );
    logLine({ at, action: 'problem fixed', reference, by, note: fix + (note ? `: ${note}` : ''), emailTo: mail?.to, emailStatus: mail?.status });
  });
}

export function saveTaskUpdate({ taskId, status, by, at, note, title }) {
  transaction(() => {
    run('INSERT INTO task_updates (task_id, status, updated_by, updated_at, note) VALUES (?, ?, ?, ?, ?)', [
      taskId,
      status,
      by,
      at,
      note || null
    ]);
    logLine({ at, action: `close task ${status}`, reference: taskId, by, note: title });
  });
}

export function savePromise({ id, customerId, amount, promisedFor, by, at, note, customerName }) {
  transaction(() => {
    run(
      'INSERT INTO promises (id, customer_id, amount, promised_for, recorded_at, recorded_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, customerId, amount, promisedFor, at, by, note || null]
    );
    logLine({ at, action: 'promise to pay recorded', reference: customerId, value: amount, by, note: `${customerName}, by ${promisedFor}` });
  });
}

export function saveReminder({ customerId, level, by, at, note, mail, value, customerName }) {
  transaction(() => {
    run('INSERT INTO reminders (customer_id, level, sent_at, sent_by, note, email_to, email_status) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      customerId,
      level,
      at,
      by,
      note || null,
      mail?.to || null,
      mail?.status || null
    ]);
    logLine({ at, action: `payment reminder, level ${level}`, reference: customerId, value, by, note: customerName, emailTo: mail?.to, emailStatus: mail?.status });
  });
}

export function saveFlag({ reference, reason, by, at }) {
  transaction(() => {
    run('INSERT INTO flags (reference, reason, flagged_by, flagged_at) VALUES (?, ?, ?, ?)', [reference, reason || null, by, at]);
    logLine({ at, action: 'flagged for review', reference, by, note: reason });
  });
}

export function saveMailLog({ by, at, action, reference, note, mail }) {
  logLine({ at, action, reference, by, note, emailTo: mail?.to, emailStatus: mail?.status });
}

export function usedPromiseIds() {
  return all('SELECT id FROM promises').map((r) => r.id);
}
