import assert from 'node:assert/strict';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { setTranslationPublication } from '../cms/src/lib/i18n-edit.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';
import {
  claimJob,
  compensateTranslation,
  sourceForJob,
  sourceHash,
  writeBackDraft,
} from './lib/i18n-store.js';

const draft = {
  title: 'English title',
  summary: 'English summary',
  body: 'English body\n',
  author: 'worker:local',
  glossaryVersion: '',
};

test('the worker CAS on CMS tables rejects a stale source and skips moments', async (t) => {
  const mysql = await import('mysql2/promise');
  let root;
  try {
    root = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await root.query('DROP DATABASE IF EXISTS cms_worker');
  await root.query('CREATE DATABASE cms_worker CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await root.end();

  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_worker',
  });
  const pool = mysql.createPool({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_worker',
    connectionLimit: 2,
  });
  try {
    await ensureCmsSchema(db);
    const saved = await saveContent(db, {
      cid: 20,
      baseRevision: 0,
      title: '中文标题',
      slug: 'worker-20',
      text: '<!--markdown-->中文正文\n',
    });
    assert.equal(saved.ok, true, saved.error);

    const job = await claimJob(pool, 'cms_', 'cms-worker');
    assert.equal(Number(job.cid), 20);
    const source = await sourceForJob(pool, 'cms_', job);
    assert.equal(sourceHash(source.title, source.text), job.expected_source_hash);
    assert.equal(sourceHash('中文标题', '<!--markdown-->中文正文\n'), job.expected_source_hash);

    const edited = await saveContent(db, {
      cid: 20,
      baseRevision: 1,
      title: '改过的标题',
      slug: 'worker-20',
      text: '<!--markdown-->改过的正文\n',
    });
    assert.equal(edited.ok, true, edited.error);
    const stale = await writeBackDraft(pool, 'cms_', job, draft);
    assert.equal(stale.outcome, 'superseded');
    const [noVersion] = await db.query(
      'SELECT COUNT(*) AS n FROM cms_i18n_translation_version WHERE cid = 20',
    );
    assert.equal(Number(noVersion[0].n), 0);
    const [staleJob] = await db.query(
      'SELECT status FROM cms_i18n_translation_job WHERE job_id = ?',
      [job.job_id],
    );
    assert.equal(staleJob[0].status, 'superseded');

    const next = await claimJob(pool, 'cms_', 'cms-worker');
    assert.equal(Number(next.expected_source_revision), 2);
    assert.equal(sourceHash('改过的标题', '<!--markdown-->改过的正文\n'), next.expected_source_hash);
    const written = await writeBackDraft(pool, 'cms_', next, draft);
    assert.equal(written.outcome, 'written');
    const [head] = await db.query(
      `SELECT draft_version_id, approved_version_id FROM cms_i18n_translation_head
       WHERE cid = 20 AND locale = 'en'`,
    );
    assert.equal(Number(head[0].draft_version_id), written.versionId);
    assert.equal(head[0].approved_version_id, null);

    const moment = await saveContent(db, {
      cid: 21,
      baseRevision: 0,
      title: '闲话',
      slug: 'moment-21',
      text: '<!--markdown-->闲话\n',
      fields: [{ name: 'content_kind', type: 'str', str_value: 'moment', int_value: null, float_value: null }],
    });
    assert.equal(moment.ok, true, moment.error);
    await compensateTranslation(pool, 'cms_', ['en']);
    const [momentJobs] = await db.query(
      'SELECT COUNT(*) AS n FROM cms_i18n_translation_job WHERE cid = 21',
    );
    assert.equal(Number(momentJobs[0].n), 0);

    const disabled = await setTranslationPublication(db, { cid: 20, locale: 'en', state: 'disabled' });
    assert.equal(disabled.ok, true, disabled.error);
    const [left] = await db.query(
      `SELECT status FROM cms_i18n_translation_job WHERE cid = 20 ORDER BY job_id`,
    );
    assert.deepEqual(left.map((row) => row.status), ['superseded', 'done']);
    const [state] = await db.query(
      `SELECT publication_state FROM cms_i18n_translation_head WHERE cid = 20 AND locale = 'en'`,
    );
    assert.equal(state[0].publication_state, 'disabled');
  } finally {
    await pool.end();
    await db.end();
  }
});
