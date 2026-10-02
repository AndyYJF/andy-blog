#!/usr/bin/env node
/**
 * Export zh source + latest en translation pairs for proofreading.
 * Reads via SSH tunnel. Output: <outDir>/<cid>/zh.md, en.md, meta.json
 * Usage: DB_HOST=127.0.0.1 DB_PORT=13308 DB_USER=... DB_PASSWORD=... DB_NAME=typecho_frf6hh node scripts/i18n-export-pairs.js <outDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const outDir = process.argv[2];
if (!outDir) { console.error('usage: i18n-export-pairs.js <outDir>'); process.exit(64); }
const p = process.env.DB_PREFIX || 'typecho_';

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
});

// 所有有 head（含草稿或已批准）的条目，取各自最新版本
const [heads] = await db.query(
  `SELECT h.cid, h.locale, h.translation_revision, h.draft_version_id, h.approved_version_id,
          s.source_revision, s.source_hash
   FROM ${p}i18n_translation_head h
   JOIN ${p}i18n_source_state s ON s.cid = h.cid
   ORDER BY h.cid`,
);
console.log(`heads: ${heads.length}`);

for (const h of heads) {
  const [contents] = await db.query(
    `SELECT title, text FROM ${p}contents WHERE cid = ?`, [h.cid]);
  if (!contents.length) { console.log(`cid ${h.cid}: source gone, skip`); continue; }
  const [versions] = await db.query(
    `SELECT version_id, title, summary, body, source_revision, author
     FROM ${p}i18n_translation_version WHERE cid = ? AND locale = ? ORDER BY version_id DESC LIMIT 1`,
    [h.cid, h.locale]);
  if (!versions.length) { console.log(`cid ${h.cid}: no version, skip`); continue; }
  const v = versions[0];
  const dir = path.join(outDir, String(h.cid));
  fs.mkdirSync(dir, { recursive: true });
  // 去掉 <!--markdown--> 前缀，给子代理看干净原文
  const zhText = contents[0].text.replace(/^<!--markdown-->/, '');
  fs.writeFileSync(path.join(dir, 'zh.md'), `# ${contents[0].title}\n\n${zhText}`);
  fs.writeFileSync(path.join(dir, 'en.md'), `# ${v.title}\n\n${v.body}`);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    cid: h.cid, locale: h.locale, title: v.title, summary: v.summary,
    versionId: v.version_id, translationRevision: h.translation_revision,
    sourceRevision: h.source_revision, sourceHash: h.source_hash,
    author: v.author, zhTitle: contents[0].title,
  }, null, 2));
  console.log(`cid ${h.cid}: zh=${zhText.length}B en=${v.body.length}B (v${v.version_id}, ${v.author})`);
}
await db.end();
