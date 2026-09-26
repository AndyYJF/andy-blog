#!/usr/bin/env node
/**
 * Manual translation write-back: claim a specific cid's queued job and write
 * a subagent-produced draft via the same CAS protocol the worker uses.
 * Usage: DB_* env + node scripts/i18n-manual-writeback.js <cid> <bodyFile> <metaJsonFile>
 */
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { writeBackDraft } from './lib/i18n-store.js';

const [cid, bodyFile, metaFile] = process.argv.slice(2);
if (!cid || !bodyFile || !metaFile) {
  console.error('usage: i18n-manual-writeback.js <cid> <body.md> <meta.json>');
  process.exit(64);
}
const body = fs.readFileSync(bodyFile, 'utf8');
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const p = process.env.DB_PREFIX || 'typecho_';
const owner = `manual:${process.pid}`;

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 3,
});

// claimJob by cid — same SQL as lib claimJob plus cid filter.
async function claimJobForCid() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [jobs] = await conn.query(
      `SELECT * FROM ${p}i18n_translation_job
       WHERE status = 'queued' AND cid = ? AND next_run_at <= UNIX_TIMESTAMP() AND attempts < max_attempts
       ORDER BY next_run_at, job_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [cid],
    );
    if (!jobs.length) { await conn.rollback(); return null; }
    const job = jobs[0];
    const [heads] = await conn.query(
      `SELECT translation_revision FROM ${p}i18n_translation_head WHERE cid = ? AND locale = ?`,
      [job.cid, job.locale],
    );
    const headRevision = heads.length ? Number(heads[0].translation_revision) : 0;
    const now = Math.floor(Date.now() / 1000);
    const [r] = await conn.query(
      `UPDATE ${p}i18n_translation_job
       SET status = 'leased', lease_owner = ?, lease_until = ?,
           expected_translation_revision = ?, attempts = attempts + 1, updated_at = ?
       WHERE job_id = ? AND status = 'queued'`,
      [owner, now + 3600, headRevision, now, job.job_id],
    );
    if (r.affectedRows !== 1) { await conn.rollback(); return null; }
    await conn.commit();
    return { ...job, status: 'leased', lease_owner: owner, expected_translation_revision: headRevision };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

const job = await claimJobForCid();
if (!job) {
  console.error(`no claimable queued job for cid ${cid} (already leased? next_run_at in future?)`);
  process.exit(1);
}
const result = await writeBackDraft(db, p, job, {
  title: meta.title,
  summary: meta.summary ?? '',
  body,
  author: 'manual:subagent',
});
console.log(`cid ${cid}: ${result.outcome}${result.versionId ? ` versionId=${result.versionId}` : ''}`);
await db.end();
process.exit(result.outcome === 'written' ? 0 : 2);
