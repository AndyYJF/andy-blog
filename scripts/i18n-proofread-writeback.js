#!/usr/bin/env node
/**
 * Proofread write-back: write a proofread English draft for a cid that
 * already has a translation head. Synthesizes the CAS job snapshot from
 * current source_state + head (no queued job row needed). The final
 * job-status update targets a non-existent job_id=0 and harmlessly no-ops.
 *
 * Input dir layout (from i18n-export-pairs.js + proofreader edits):
 *   <dir>/en.md      first line `# <title>`, rest is the body
 *   <dir>/meta.json  summary field is used; cid taken from argv
 *
 * Usage: DB_* env + node scripts/i18n-proofread-writeback.js <dir>
 * Exit 0 written / 2 superseded / 3 unchanged (skipped).
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { writeBackDraft } from './lib/i18n-store.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: i18n-proofread-writeback.js <dir>'); process.exit(64); }
const enPath = path.join(dir, 'en.md');
const metaPath = path.join(dir, 'meta.json');
const raw = fs.readFileSync(enPath, 'utf8');
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const cid = Number(process.argv[3] ?? path.basename(dir));
if (!Number.isInteger(cid) || cid <= 0) throw new Error(`bad cid: ${dir}`);

const titleMatch = raw.match(/^# (.+)\n/);
if (!titleMatch) throw new Error(`${enPath}: missing h1 title line`);
const title = titleMatch[1].trim();
const body = raw.slice(titleMatch[0].length).replace(/^\s*\n/, '');
const p = process.env.DB_PREFIX || 'typecho_';

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
});

const [states] = await db.query(
  `SELECT source_revision, source_hash FROM ${p}i18n_source_state WHERE cid = ?`, [cid]);
if (!states.length) { console.error(`cid ${cid}: no source_state`); process.exit(1); }
const [heads] = await db.query(
  `SELECT translation_revision FROM ${p}i18n_translation_head WHERE cid = ? AND locale = 'en'`, [cid]);
if (!heads.length) { console.error(`cid ${cid}: no translation head`); process.exit(1); }

// skip when unchanged vs the latest stored version
const [latest] = await db.query(
  `SELECT title, body, summary FROM ${p}i18n_translation_version
   WHERE cid = ? AND locale = 'en' ORDER BY version_id DESC LIMIT 1`, [cid]);
if (latest.length && latest[0].body === body && latest[0].title === title && latest[0].summary === (meta.summary ?? '')) {
  console.log(`cid ${cid}: unchanged, skip`);
  await db.end();
  process.exit(3);
}

const job = {
  job_id: 0,
  cid,
  locale: 'en',
  expected_source_revision: Number(states[0].source_revision),
  expected_source_hash: states[0].source_hash,
  expected_translation_revision: Number(heads[0].translation_revision),
};
const result = await writeBackDraft(db, p, job, {
  title,
  summary: meta.summary ?? '',
  body,
  author: 'manual:proofread',
});
console.log(`cid ${cid}: ${result.outcome}${result.versionId ? ` versionId=${result.versionId}` : ''}`);
await db.end();
process.exit(result.outcome === 'written' ? 0 : 2);
