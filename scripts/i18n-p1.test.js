/**
 * P1 verification — i18n CAS protocol + outbox, against an isolated MySQL
 * schema (see docs/i18n-p1-design-2026-09-26.md §7), plus a local rebuild-api
 * dedup test that imports docker/rebuild-api/server.js directly.
 *
 * DB tests run only when I18N_TEST_DB=1 with DB_HOST/DB_USER/DB_PASSWORD/DB_NAME
 * pointing at the isolated test schema (migrations already applied).
 *
 *   I18N_TEST_DB=1 DB_HOST=... DB_USER=... DB_NAME=i18n_p1_test node --test scripts/i18n-p1.test.js
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  claimJob, compensatePublish, compensateTranslation, contentDigest,
  dueOutboxEvents, markOutboxAccepted, publishIdemKey, reapExpiredLeases,
  sourceHash, translateIdemKey, writeBackDraft,
} from './lib/i18n-store.js';

const PREFIX = process.env.DB_PREFIX || 'typecho_';
const RUN_DB = process.env.I18N_TEST_DB === '1';

async function openDb() {
  const mysql = await import('mysql2/promise');
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    connectionLimit: 4,
  });
}

/** Reset all i18n tables + seed one public source row. */
async function seed(db, p, { cid = 9001, title = '中文标题', text = '中文正文', revision = 1 } = {}) {
  for (const t of ['source_state', 'translation_head', 'translation_version', 'translation_job', 'publish_outbox', 'publication_ledger']) {
    await db.query(`DELETE FROM ${p}i18n_${t}`);
  }
  await db.query(`DELETE FROM ${p}contents WHERE cid >= 9000`);
  const hash = sourceHash(title, text);
  await db.query(
    `INSERT INTO ${p}contents (cid, title, text, type, status, password, created, modified)
     VALUES (?, ?, ?, 'post', 'publish', '', 1000, 1000)`,
    [cid, title, text],
  );
  await db.query(
    `INSERT INTO ${p}i18n_source_state (cid, source_revision, source_hash, visibility, content_type, saved_at)
     VALUES (?, ?, ?, 'publish', 'post', UNIX_TIMESTAMP())`,
    [cid, revision, hash],
  );
  await db.query(
    `INSERT INTO ${p}i18n_translation_job
       (idem_key, cid, locale, status, expected_source_revision, expected_source_hash,
        next_run_at, created_at, updated_at)
     VALUES (?, ?, 'en', 'queued', ?, ?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())`,
    [translateIdemKey(cid, 'en', revision), cid, revision, hash],
  );
  return { cid, revision, hash };
}

/** Simulate the plugin's editor save: bump source revision (new content). */
async function editorSave(db, p, cid, newTitle, newText) {
  const hash = sourceHash(newTitle, newText);
  await db.query(`UPDATE ${p}contents SET title = ?, text = ?, modified = modified + 1 WHERE cid = ?`, [newTitle, newText, cid]);
  await db.query(
    `UPDATE ${p}i18n_source_state
     SET source_revision = source_revision + 1, source_hash = ?, saved_at = UNIX_TIMESTAMP()
     WHERE cid = ?`,
    [hash, cid],
  );
  return hash;
}

/** Simulate the plugin approve transaction (PHP Action parity). */
async function approve(db, p, cid, locale, versionId, digest) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [v] = await conn.query(
      `SELECT content_digest FROM ${p}i18n_translation_version WHERE version_id = ? AND cid = ? AND locale = ?`,
      [versionId, cid, locale],
    );
    assert.ok(v.length, 'version exists');
    assert.equal(v[0].content_digest, digest, 'digest matches');
    await conn.query(
      `UPDATE ${p}i18n_translation_head SET approved_version_id = ?, updated_at = UNIX_TIMESTAMP() WHERE cid = ? AND locale = ?`,
      [versionId, cid, locale],
    );
    await conn.query(
      `INSERT IGNORE INTO ${p}i18n_publish_outbox
         (idem_key, cid, locale, version_id, status, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())`,
      [publishIdemKey(cid, locale, versionId), cid, locale, versionId],
    );
    await conn.query(
      `INSERT INTO ${p}i18n_publication_ledger (cid, locale, translation_available_at, updated_at)
       VALUES (?, ?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         translation_available_at = IFNULL(translation_available_at, VALUES(translation_available_at)),
         updated_at = VALUES(updated_at)`,
      [cid, locale],
    );
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

const draft = { title: 'English title', summary: 'English summary', body: 'English body', author: 'worker:kimi:test', glossaryVersion: 'test' };

test('P1-DB: happy path — claim, CAS write-back moves draft only', { skip: !RUN_DB }, async () => {
  const db = await openDb();
  try {
    const { cid } = await seed(db, PREFIX);
    const job = await claimJob(db, PREFIX, 'w1');
    assert.ok(job, 'job claimed');
    assert.equal(Number(job.expected_translation_revision), 0);

    const r = await writeBackDraft(db, PREFIX, job, draft);
    assert.equal(r.outcome, 'written');

    const [heads] = await db.query(`SELECT * FROM ${PREFIX}i18n_translation_head WHERE cid = ?`, [cid]);
    assert.equal(Number(heads[0].draft_version_id), r.versionId);
    assert.equal(heads[0].approved_version_id, null, 'approved pointer untouched by worker');
    assert.equal(Number(heads[0].translation_revision), 1);
  } finally {
    await db.end();
  }
});

test('P1-DB: editor saves while worker translates → superseded, no overwrite', { skip: !RUN_DB }, async () => {
  const db = await openDb();
  try {
    const { cid } = await seed(db, PREFIX);
    const job = await claimJob(db, PREFIX, 'w1');
    await editorSave(db, PREFIX, cid, '编辑后的标题', '编辑后的正文');

    const r = await writeBackDraft(db, PREFIX, job, draft);
    assert.equal(r.outcome, 'superseded');

    const [versions] = await db.query(`SELECT COUNT(*) n FROM ${PREFIX}i18n_translation_version WHERE cid = ?`, [cid]);
    assert.equal(Number(versions[0].n), 0, 'no stale version written');
    const [jobs] = await db.query(`SELECT status FROM ${PREFIX}i18n_translation_job WHERE job_id = ?`, [job.job_id]);
    assert.equal(jobs[0].status, 'superseded');
  } finally {
    await db.end();
  }
});

test('P1-DB: human approval interleaves → stale worker CAS fails, human version intact', { skip: !RUN_DB }, async () => {
  const db = await openDb();
  try {
    const { cid } = await seed(db, PREFIX);
    // Worker A writes a draft (revision 1), human approves it.
    const jobA = await claimJob(db, PREFIX, 'wA');
    const ra = await writeBackDraft(db, PREFIX, jobA, draft);
    const humanDigest = contentDigest(draft.title, draft.summary, draft.body);
    await approve(db, PREFIX, cid, 'en', ra.versionId, humanDigest);

    // Editor saves again (revision 2); worker B claims the new job and writes.
    const newHash = await editorSave(db, PREFIX, cid, '第二版标题', '第二版正文');
    await db.query(
      `INSERT INTO ${PREFIX}i18n_translation_job
         (idem_key, cid, locale, status, expected_source_revision, expected_source_hash,
          next_run_at, created_at, updated_at)
       VALUES (?, ?, 'en', 'queued', 2, ?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())`,
      [translateIdemKey(cid, 'en', 2), cid, newHash],
    );
    const jobB = await claimJob(db, PREFIX, 'wB');
    const rb = await writeBackDraft(db, PREFIX, jobB, { ...draft, title: 'Second version' });
    assert.equal(rb.outcome, 'written');

    // Stale worker A finishes late with a result computed against revision 2's
    // source but the OLD head revision snapshot (1). CAS must reject it.
    const staleJob = {
      ...jobB, job_id: jobA.job_id,
      expected_source_revision: 2, expected_source_hash: newHash,
      expected_translation_revision: 1,
    };
    const rs = await writeBackDraft(db, PREFIX, staleJob, { ...draft, title: 'STALE' });
    assert.equal(rs.outcome, 'superseded');

    const [heads] = await db.query(`SELECT * FROM ${PREFIX}i18n_translation_head WHERE cid = ?`, [cid]);
    assert.equal(Number(heads[0].approved_version_id), ra.versionId, 'human-approved version still approved');
    assert.equal(Number(heads[0].draft_version_id), rb.versionId, 'newest draft intact, not clobbered by stale worker');
  } finally {
    await db.end();
  }
});

test('P1-DB: crash after approve → publish compensation re-creates event exactly once', { skip: !RUN_DB }, async () => {
  const db = await openDb();
  try {
    const { cid } = await seed(db, PREFIX);
    const job = await claimJob(db, PREFIX, 'w1');
    const r = await writeBackDraft(db, PREFIX, job, draft);
    await approve(db, PREFIX, cid, 'en', r.versionId, contentDigest(draft.title, draft.summary, draft.body));

    // Worker "crashed" before sending; event is durable in outbox.
    let events = await dueOutboxEvents(db, PREFIX);
    assert.equal(events.length, 1);
    await markOutboxAccepted(db, PREFIX, events[0].event_id);

    // Compensation after restart: event already accepted → nothing new created.
    const created = await compensatePublish(db, PREFIX);
    events = await dueOutboxEvents(db, PREFIX);
    assert.equal(events.length, 0, 'accepted event not resent by compensation');
    const [all] = await db.query(`SELECT COUNT(*) n FROM ${PREFIX}i18n_publish_outbox`);
    assert.equal(Number(all[0].n), 1, 'no duplicate events');
    assert.equal(created, 0, 'compensation created nothing — event already durable');
  } finally {
    await db.end();
  }
});

test('P1-DB: lease expiry — second owner wins, first owner CAS loses', { skip: !RUN_DB }, async () => {
  const db = await openDb();
  try {
    const { cid } = await seed(db, PREFIX);
    const jobA = await claimJob(db, PREFIX, 'wA', 1); // 1s lease
    assert.ok(jobA);
    // No second claim while lease valid:
    assert.equal(await claimJob(db, PREFIX, 'wB', 1), null);

    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(await reapExpiredLeases(db, PREFIX), 1, 'expired lease reaped');

    const jobB = await claimJob(db, PREFIX, 'wB', 60);
    assert.ok(jobB, 'second owner claims after reaper');
    const rb = await writeBackDraft(db, PREFIX, jobB, draft);
    assert.equal(rb.outcome, 'written');

    // Late worker A tries to write with its stale claim:
    const ra = await writeBackDraft(db, PREFIX, jobA, { ...draft, title: 'A is late' });
    assert.equal(ra.outcome, 'superseded', 'stale owner cannot write after lease loss');
  } finally {
    await db.end();
  }
});

test('P1-DB: translation compensation enqueues missing revision idempotently', { skip: !RUN_DB }, async () => {
  const db = await openDb();
  try {
    const { cid } = await seed(db, PREFIX);
    await db.query(`DELETE FROM ${PREFIX}i18n_translation_job`); // pretend enqueue was lost
    const first = await compensateTranslation(db, PREFIX, ['en']);
    assert.equal(first, 1, 'missing job re-enqueued');
    const second = await compensateTranslation(db, PREFIX, ['en']);
    assert.equal(second, 0, 'idempotent — no duplicate job');
    const [jobs] = await db.query(`SELECT * FROM ${PREFIX}i18n_translation_job WHERE cid = ?`, [cid]);
    assert.equal(jobs[0].status, 'queued');
  } finally {
    await db.end();
  }
});

// --- rebuild-api dedup: real server.js, local temp runtime, no DB needed ---

test('P1-API: rebuild-api merges rapid duplicate events (pending → dirty)', async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-api-'));
  const secretFile = path.join(runtime, 'webhook_secret');
  fs.writeFileSync(secretFile, 'test-secret');
  process.env.RUNTIME_DIR = runtime;
  process.env.WEBHOOK_SECRET_FILE = secretFile;
  const { createServer, _internal } = await import('../docker/rebuild-api/server.js');
  await _internal.ensureRuntime();

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const send = (cid) => {
    const body = JSON.stringify({
      event: 'typecho-content-changed',
      ts: Math.floor(Date.now() / 1000),
      nonce: crypto.randomBytes(16).toString('hex'),
      i18n: { cid, locale: 'en', versionId: cid },
    });
    return fetch(`http://127.0.0.1:${port}/hooks/rebuild`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': `sha256=${crypto.createHmac('sha256', 'test-secret').update(body).digest('hex')}`,
      },
      body,
    });
  };

  try {
    let res = await send(1);
    assert.equal(res.status, 202);
    assert.equal((await res.json()).mode, 'pending');

    // Simulate build in flight: dirty path.
    fs.writeFileSync(_internal.PATHS.building, '{}');
    res = await send(2);
    assert.equal(res.status, 202);
    assert.equal((await res.json()).mode, 'dirty');

    // A third event while building still merges into the same dirty flag:
    res = await send(3);
    assert.equal((await res.json()).mode, 'dirty');

    // Replay protection: identical nonce rejected.
    const replay = JSON.stringify({ event: 'typecho-content-changed', ts: Math.floor(Date.now() / 1000), nonce: 'a'.repeat(32) });
    const sig = `sha256=${crypto.createHmac('sha256', 'test-secret').update(replay).digest('hex')}`;
    const r1 = await fetch(`http://127.0.0.1:${port}/hooks/rebuild`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sig }, body: replay });
    const r2 = await fetch(`http://127.0.0.1:${port}/hooks/rebuild`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sig }, body: replay });
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 401, 'replay rejected — outbox resend must mint fresh ts+nonce');
  } finally {
    server.close();
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});
