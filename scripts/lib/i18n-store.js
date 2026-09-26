/**
 * i18n store — all translation-table access for the worker and tests.
 * Implements the CAS protocol from docs/i18n-p1-design-2026-09-26.md §4–5.
 * Every write path opens its own transaction; the worker never touches the
 * approved pointer (approval lives in the Typecho plugin Action).
 */
import crypto from 'node:crypto';

export const JOB = {
  QUEUED: 'queued', LEASED: 'leased', DONE: 'done',
  FAILED: 'failed', SUPERSEDED: 'superseded', CANCELLED: 'cancelled',
};
export const OUTBOX = {
  PENDING: 'pending', ACCEPTED: 'accepted', NEEDS_FIX: 'needs_fix',
  SUPERSEDED: 'superseded', CANCELLED: 'cancelled', LIVE: 'live',
};

export function sourceHash(title, text) {
  return crypto.createHash('sha256').update(`${title}\0${text}`).digest('hex');
}

export function contentDigest(title, summary, body) {
  return crypto.createHash('sha256').update(`${title}\0${summary}\0${body}`).digest('hex');
}

export function translateIdemKey(cid, locale, sourceRevision) {
  return `translate:${cid}:${locale}:${sourceRevision}`;
}

export function publishIdemKey(cid, locale, versionId) {
  return `publish:${cid}:${locale}:${versionId}`;
}

const now = () => Math.floor(Date.now() / 1000);

/** Requeue leased jobs whose lease expired (owner crashed). */
export async function reapExpiredLeases(db, p) {
  const [r] = await db.query(
    `UPDATE ${p}i18n_translation_job
     SET status = ?, lease_owner = NULL, lease_until = NULL, updated_at = UNIX_TIMESTAMP()
     WHERE status = ? AND lease_until IS NOT NULL AND lease_until < UNIX_TIMESTAMP()`,
    [JOB.QUEUED, JOB.LEASED],
  );
  return r.affectedRows;
}

/**
 * Atomically claim one due job. Snapshots expected_translation_revision from
 * the head at claim time so a later human approval makes the CAS fail.
 * Returns the claimed job row, or null when nothing is due.
 */
export async function claimJob(db, p, owner, leaseSeconds = 120) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [jobs] = await conn.query(
      `SELECT * FROM ${p}i18n_translation_job
       WHERE status = ? AND next_run_at <= UNIX_TIMESTAMP() AND attempts < max_attempts
       ORDER BY next_run_at, job_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [JOB.QUEUED],
    );
    if (!jobs.length) {
      await conn.rollback();
      return null;
    }
    const job = jobs[0];
    const [heads] = await conn.query(
      `SELECT translation_revision FROM ${p}i18n_translation_head
       WHERE cid = ? AND locale = ?`,
      [job.cid, job.locale],
    );
    const headRevision = heads.length ? Number(heads[0].translation_revision) : 0;
    const [r] = await conn.query(
      `UPDATE ${p}i18n_translation_job
       SET status = ?, lease_owner = ?, lease_until = ?,
           expected_translation_revision = ?, attempts = attempts + 1, updated_at = ?
       WHERE job_id = ? AND status = ?`,
      [JOB.LEASED, owner, now() + leaseSeconds, headRevision, now(), job.job_id, JOB.QUEUED],
    );
    if (r.affectedRows !== 1) {
      await conn.rollback();
      return null;
    }
    await conn.commit();
    return { ...job, status: JOB.LEASED, lease_owner: owner, expected_translation_revision: headRevision };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * CAS write-back of a translated draft. Only moves the draft pointer; the
 * approved pointer is untouched. Returns { outcome, versionId? }.
 * outcome: 'written' | 'superseded' (source or head moved since claim).
 */
export async function writeBackDraft(db, p, job, draft) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [states] = await conn.query(
      `SELECT * FROM ${p}i18n_source_state WHERE cid = ? FOR UPDATE`,
      [job.cid],
    );
    const [heads] = await conn.query(
      `SELECT * FROM ${p}i18n_translation_head WHERE cid = ? AND locale = ? FOR UPDATE`,
      [job.cid, job.locale],
    );
    const state = states[0] || null;
    const head = heads[0] || null;

    const sourceMatches = state
      && Number(state.source_revision) === Number(job.expected_source_revision)
      && state.source_hash === job.expected_source_hash;
    const headMatches = (head ? Number(head.translation_revision) : 0)
      === Number(job.expected_translation_revision ?? 0);
    const enabled = !head || head.publication_state === 'enabled';

    if (!sourceMatches || !headMatches || !enabled) {
      await conn.query(
        `UPDATE ${p}i18n_translation_job SET status = ?, updated_at = ? WHERE job_id = ?`,
        [JOB.SUPERSEDED, now(), job.job_id],
      );
      await conn.commit();
      return { outcome: 'superseded' };
    }

    const newRevision = (head ? Number(head.translation_revision) : 0) + 1;
    const digest = contentDigest(draft.title, draft.summary ?? '', draft.body);
    const [ins] = await conn.query(
      `INSERT INTO ${p}i18n_translation_version
         (cid, locale, translation_revision, title, summary, body,
          source_revision, source_hash, content_digest, glossary_version, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [job.cid, job.locale, newRevision, draft.title, draft.summary ?? '', draft.body,
        job.expected_source_revision, job.expected_source_hash, digest,
        draft.glossaryVersion ?? '', draft.author, now()],
    );
    const versionId = Number(ins.insertId);
    if (head) {
      await conn.query(
        `UPDATE ${p}i18n_translation_head
         SET draft_version_id = ?, translation_revision = ?, updated_at = ?
         WHERE cid = ? AND locale = ?`,
        [versionId, newRevision, now(), job.cid, job.locale],
      );
    } else {
      await conn.query(
        `INSERT INTO ${p}i18n_translation_head
           (cid, locale, translation_revision, draft_version_id, approved_version_id, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [job.cid, job.locale, newRevision, versionId, now()],
      );
    }
    await conn.query(
      `UPDATE ${p}i18n_translation_job SET status = ?, updated_at = ? WHERE job_id = ?`,
      [JOB.DONE, now(), job.job_id],
    );
    await conn.commit();
    return { outcome: 'written', versionId, revision: newRevision };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

/** Mark a leased job failed with backoff; terminal once attempts run out. */
export async function failJob(db, p, job, message) {
  const exhausted = Number(job.attempts) >= Number(job.max_attempts);
  const backoff = Math.min(3600, 60 * 2 ** Number(job.attempts));
  await db.query(
    `UPDATE ${p}i18n_translation_job
     SET status = ?, last_error = ?, lease_owner = NULL, lease_until = NULL,
         next_run_at = ?, updated_at = ?
     WHERE job_id = ?`,
    [exhausted ? JOB.FAILED : JOB.QUEUED, String(message).slice(0, 500),
      now() + backoff, now(), job.job_id],
  );
  return exhausted;
}

/** Mark a leased job superseded (source no longer matches expectations). */
export async function supersedeJob(db, p, job) {
  await db.query(
    `UPDATE ${p}i18n_translation_job SET status = ?, updated_at = ? WHERE job_id = ?`,
    [JOB.SUPERSEDED, now(), job.job_id],
  );
}

/**
 * Translation compensation: public contents whose newest source revision has
 * no queued/leased job and no approved version at that revision get a job.
 * INSERT IGNORE on the idem key makes re-scans free of duplicates.
 */
export async function compensateTranslation(db, p, locales = ['en']) {
  const [rows] = await db.query(
    `SELECT s.cid, s.source_revision, s.source_hash
     FROM ${p}i18n_source_state s
     WHERE s.visibility = 'publish' AND s.content_type IN ('post','page')`,
  );
  let enqueued = 0;
  for (const row of rows) {
    for (const locale of locales) {
      const [heads] = await db.query(
        `SELECT approved_version_id FROM ${p}i18n_translation_head
         WHERE cid = ? AND locale = ? AND publication_state = 'enabled'`,
        [row.cid, locale],
      );
      if (heads.length && heads[0].approved_version_id) {
        const [ok] = await db.query(
          `SELECT 1 FROM ${p}i18n_translation_version
           WHERE version_id = ? AND source_revision = ?`,
          [heads[0].approved_version_id, row.source_revision],
        );
        if (ok.length) continue; // approved version already covers this source revision
      }
      const [r] = await db.query(
        `INSERT IGNORE INTO ${p}i18n_translation_job
           (idem_key, cid, locale, status, expected_source_revision, expected_source_hash,
            next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [translateIdemKey(row.cid, locale, row.source_revision), row.cid, locale,
          JOB.QUEUED, row.source_revision, row.source_hash, now(), now(), now()],
      );
      enqueued += r.affectedRows;
    }
  }
  return enqueued;
}

/**
 * Publish compensation: approved versions with no live/pending/accepted outbox
 * event get one (INSERT IGNORE on the publish idem key).
 */
export async function compensatePublish(db, p) {
  const [rows] = await db.query(
    `SELECT h.cid, h.locale, h.approved_version_id
     FROM ${p}i18n_translation_head h
     WHERE h.approved_version_id IS NOT NULL AND h.publication_state = 'enabled'`,
  );
  let created = 0;
  for (const row of rows) {
    const [r] = await db.query(
      `INSERT IGNORE INTO ${p}i18n_publish_outbox
         (idem_key, cid, locale, version_id, status, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [publishIdemKey(row.cid, row.locale, row.approved_version_id),
        row.cid, row.locale, row.approved_version_id, OUTBOX.PENDING, now(), now(), now()],
    );
    created += r.affectedRows;
  }
  return created;
}

/** Due outbox events to (re)send. DB time is the single time authority. */
export async function dueOutboxEvents(db, p, limit = 20) {
  const [rows] = await db.query(
    `SELECT * FROM ${p}i18n_publish_outbox
     WHERE status = ? AND next_retry_at <= UNIX_TIMESTAMP() ORDER BY next_retry_at, event_id LIMIT ?`,
    [OUTBOX.PENDING, limit],
  );
  return rows;
}

export async function markOutboxAccepted(db, p, eventId) {
  await db.query(
    `UPDATE ${p}i18n_publish_outbox
     SET status = ?, attempts = attempts + 1, updated_at = ?
     WHERE event_id = ? AND status = ?`,
    [OUTBOX.ACCEPTED, now(), eventId, OUTBOX.PENDING],
  );
}

export async function markOutboxRetry(db, p, eventId, message) {
  const backoff = 60;
  await db.query(
    `UPDATE ${p}i18n_publish_outbox
     SET attempts = attempts + 1, next_retry_at = ?, last_error = ?, updated_at = ?
     WHERE event_id = ? AND status = ?`,
    [now() + backoff, String(message).slice(0, 500), now(), eventId, OUTBOX.PENDING],
  );
}

/** Fetch the fixed source text a job must translate. */
export async function sourceForJob(db, p, job) {
  const [rows] = await db.query(
    `SELECT cid, type, title, text, status, password FROM ${p}contents WHERE cid = ?`,
    [job.cid],
  );
  return rows[0] || null;
}
