import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createEditorSession } from '../cms/src/lib/editor-session.js';
import {
  acceptStoredText,
  classifyNewlines,
  joeMarkerRanges,
  prepareEditorDocument,
} from '../cms/src/lib/text-fidelity.js';
import { exportContentRow, saveContent, getContent, ensureCmsSchema, sha256Text } from '../cms/src/lib/content-store.js';
import { applyDelivery, markDelivery, recoverExpiredLeases } from '../cms/src/lib/publish-outbox.js';
import {
  acceptPreviewMessage,
  assertPreviewFetchUrl,
  createPreviewGate,
  previewBody,
} from '../cms/src/lib/preview-body.js';

const samples = {
  lf: '<!--markdown-->你好 🌟\n\n$$E=mc^2$$\n\n```js\nconst x = 1;\n```\n{netease id="1"/}\n',
  crlf: '<!--markdown-->第一行\r\n第二行  \r\n',
  cr: '<!--markdown-->甲\r乙\r',
  mixed: '<!--markdown-->甲\r\n乙\n丙\r丁\n',
};

test('uniform newlines and markers round-trip through CodeMirror without a browser', () => {
  for (const text of [samples.lf, samples.crlf, samples.cr]) {
    const session = createEditorSession(text);
    assert.equal(session.doc(), text);
    assert.equal(session.save().text, text);
    session.insert('更多');
    assert.equal(session.undo(), true);
    assert.equal(session.doc(), text);
    assert.equal(session.redo(), true);
    assert.match(session.doc(), /更多$/);
    session.undo();
  }
  const decorated = createEditorSession(samples.lf);
  assert.ok(joeMarkerRanges(decorated.doc()).some((range) => range.text.includes('netease')));
  assert.equal(decorated.doc(), samples.lf);
});

test('an unchanged mixed document keeps original bytes; an edit must be explicit', () => {
  const prepared = prepareEditorDocument(samples.mixed);
  assert.equal(prepared.mixed, true);
  assert.equal(prepared.doc.includes('\r'), false);
  const session = createEditorSession(samples.mixed);
  assert.equal(session.save().text, samples.mixed);
  session.insert('改');
  const saved = session.save();
  assert.equal(saved.normalized, true);
  assert.equal(saved.newlineNormalization.to, 'LF');
  assert.equal(acceptStoredText(samples.mixed, saved.text, null).ok, false);
  assert.equal(acceptStoredText(samples.mixed, saved.text, saved.newlineNormalization).ok, true);
  assert.equal(classifyNewlines(samples.crlf).uniform, 'CRLF');
});

test('preview follows the sync transform copy and does not invoke file mermaid', () => {
  const source = '<!--markdown-->#标题\n\n```mermaid\ngraph TD;A-->B;\n```\n{netease id="3434220196"/}\n';
  const preview = previewBody(source, 7);
  assert.equal(preview.ok, true);
  assert.match(preview.markdown, /:::netease/);
  assert.match(preview.markdown, /^# 标题/m);
  assert.match(preview.html, /mermaid-pending/);
  assert.doesNotMatch(preview.html, /playwright|public\/beoe/);
  assert.equal(previewBody(`${'a'.repeat(600000)}`, 1).ok, false);
  assert.throws(() => assertPreviewFetchUrl('http://127.0.0.1/latest'));
  assert.throws(() => assertPreviewFetchUrl('https://music.163.com.evil/song'));
  assert.equal(assertPreviewFetchUrl('https://music.163.com/song?id=1').hostname, 'music.163.com');
  const event = { source: { id: 1 }, data: { type: 'cms-preview-ready', flowId: 'flow' } };
  assert.equal(acceptPreviewMessage(event, { iframeWindow: event.source, flowId: 'flow' }), true);
  assert.equal(acceptPreviewMessage(event, { iframeWindow: {}, flowId: 'flow' }), false);
  assert.equal(acceptPreviewMessage({ source: event.source, data: { type: 'other', flowId: 'flow' } }, { iframeWindow: event.source, flowId: 'flow' }), false);
});

test('preview gate limits concurrency', async () => {
  const gate = createPreviewGate();
  let running = 0;
  let max = 0;
  const jobs = Array.from({ length: 4 }, () => gate.run(async () => {
    running += 1;
    max = Math.max(max, running);
    await new Promise((resolve) => setTimeout(resolve, 30));
    running -= 1;
    return true;
  }));
  const results = await Promise.all(jobs);
  assert.equal(results.length, 4);
  assert.ok(max <= 2);
});

test('MySQL save reads the same bytes back and a stale revision does not overwrite', async (t) => {
  const mysql = await import('mysql2/promise');
  const connect = () => mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'cms',
    password: 'cms-dev',
    database: 'cms',
    charset: 'utf8mb4',
    connectTimeout: 2000,
  });
  let db;
  try {
    db = await connect();
  } catch {
    const docker = spawnSync('docker', ['compose', '-f', 'compose.cms-dev.yml', 'up', '-d'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
    });
    if (docker.status !== 0) {
      t.skip(`local MySQL is not available: ${docker.error?.message || docker.stderr || docker.stdout || 'docker compose failed'}`);
      return;
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !db) {
      try {
        db = await connect();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  if (!db) {
    t.skip('local MySQL did not accept connections');
    return;
  }
  try {
    await ensureCmsSchema(db);
    const cid = 800000 + (process.pid % 10000);
    await db.query('DELETE FROM cms_i18n_translation_job WHERE cid = ?', [cid]);
    await db.query('DELETE FROM cms_i18n_source_state WHERE cid = ?', [cid]);
    await db.query('DELETE FROM cms_publish_outbox WHERE cid = ?', [cid]);
    await db.query('DELETE FROM cms_change_log WHERE cid = ?', [cid]);
    await db.query('DELETE FROM cms_content_revisions WHERE cid = ?', [cid]);
    await db.query('DELETE FROM cms_contents WHERE cid = ?', [cid]);
    const text = samples.lf;
    const created = await saveContent(db, { cid, title: '示例', text, baseRevision: 0 });
    assert.equal(created.ok, true);
    const loaded = await getContent(db, cid);
    assert.equal(loaded.text, text);
    assert.equal(loaded.textSha256, sha256Text(text));
    const [queued] = await db.query(
      `SELECT op, status FROM cms_publish_outbox WHERE cid = ? ORDER BY event_id`,
      [cid],
    );
    assert.equal(queued.length, 1);
    assert.equal(queued[0].op, 'publish');
    assert.equal(queued[0].status, 'pending');
    const first = await saveContent(db, { cid, title: '第一处', text: `${text}尾\n`, baseRevision: 1 });
    const second = await saveContent(db, { cid, title: '第二处', text: `${text}另一处\n`, baseRevision: 1 });
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    const finalRow = await getContent(db, cid);
    assert.equal(finalRow.text, `${text}尾\n`);
    assert.equal(finalRow.title, '第一处');
    const exported = exportContentRow(finalRow);
    assert.equal(exported.text, finalRow.text);
    assert.equal(Object.hasOwn(exported, 'text_sha256'), false);
    const [afterConflict] = await db.query('SELECT COUNT(*) AS n FROM cms_publish_outbox WHERE cid = ?', [cid]);
    assert.equal(Number(afterConflict[0].n), 2);
    const now = Math.floor(Date.now() / 1000);
    await db.query(
      `UPDATE cms_publish_outbox SET status = 'sending', lease_until = ? WHERE cid = ?`,
      [now - 5, cid],
    );
    const recovered = await recoverExpiredLeases(db, now);
    assert.equal(recovered, 2);
    const [pendingAgain] = await db.query(
      `SELECT status FROM cms_publish_outbox WHERE cid = ? AND status = 'pending'`,
      [cid],
    );
    assert.equal(pendingAgain.length, 2);
    const [revisionRow] = await db.query(
      'SELECT text FROM cms_content_revisions WHERE cid = ? AND revision = 2',
      [cid],
    );
    assert.equal(Buffer.from(revisionRow[0].text).toString('utf8'), `${text}尾\n`);
    const [log] = await db.query('SELECT COUNT(*) AS n FROM cms_change_log WHERE cid = ?', [cid]);
    assert.equal(Number(log[0].n), 2);
    const [event] = await db.query(
      'SELECT event_id FROM cms_publish_outbox WHERE cid = ? ORDER BY event_id LIMIT 1',
      [cid],
    );
    await db.query(
      `UPDATE cms_publish_outbox SET status = 'sending', lease_owner = 'editor-test' WHERE event_id = ?`,
      [event[0].event_id],
    );
    await markDelivery(db, event[0].event_id, applyDelivery({ status: 202, attempts: 0, now }), now, 'editor-test');
    const [marked] = await db.query(
      'SELECT event_id, status FROM cms_publish_outbox WHERE event_id = ?',
      [event[0].event_id],
    );
    assert.equal(Number(marked[0].event_id), Number(event[0].event_id));
    assert.equal(marked[0].status, 'accepted');
  } finally {
    await db.end();
  }
});
