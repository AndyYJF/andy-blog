import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { saveContent } from '../cms/src/lib/content-store.js';
import { readPublishState } from '../cms/src/lib/publish-outbox.js';
import { ensureCmsSchema } from '../cms/src/lib/schema.js';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'cms-publish-consume.js');

function run(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('the generic consumer delivers only to loopback and 202 is not live', async (t) => {
  const mysql = await import('mysql2/promise');
  let rootDb;
  try {
    rootDb = await mysql.createConnection({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', connectTimeout: 2000,
    });
  } catch (error) {
    t.skip(`isolated MySQL is not available: ${error.message}`);
    return;
  }
  await rootDb.query('DROP DATABASE IF EXISTS cms_consume');
  await rootDb.query('CREATE DATABASE cms_consume CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await rootDb.end();
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'cms_consume',
  });
  const secret = 'local-consume-secret';
  const secretFile = path.join(os.tmpdir(), `cms-consume-secret-${process.pid}`);
  fs.writeFileSync(secretFile, `${secret}\n`);
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
      seen.push({ body, signature: req.headers['x-signature'], expected });
      res.writeHead(202);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseEnv = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'cms_consume',
    WEBHOOK_SECRET_FILE: secretFile,
  };
  try {
    await ensureCmsSchema(db);
    const saved = await saveContent(db, {
      cid: 1, baseRevision: 0, title: '入队', slug: 'queued', text: '<!--markdown-->正文\n',
    });
    assert.equal(saved.ok, true, saved.error);
    const remote = await run({ ...baseEnv, REBUILD_ENDPOINT: 'http://example.com/hooks/rebuild' });
    assert.equal(remote.status, 65, remote.stderr);
    assert.match(remote.stderr, /non-local rebuild endpoint/);
    assert.equal((await readPublishState(db, 1)).queue, 'pending');

    const local = await run({ ...baseEnv, REBUILD_ENDPOINT: `http://127.0.0.1:${port}/hooks/rebuild` });
    assert.equal(local.status, 0, local.stderr);
    const report = JSON.parse(local.stdout);
    assert.equal(report.claimed, 1);
    assert.equal(report.results[0].status, 'accepted');
    const payload = JSON.parse(seen[0].body);
    assert.equal(payload.event, 'typecho-content-changed');
    assert.equal(Object.hasOwn(payload, 'i18n'), false);
    assert.equal(seen[0].signature, seen[0].expected);
    const state = await readPublishState(db, 1);
    assert.equal(state.requestAccepted, true);
    assert.equal(state.live, false);
  } finally {
    server.close();
    await db.end();
    fs.rmSync(secretFile, { force: true });
  }
});
