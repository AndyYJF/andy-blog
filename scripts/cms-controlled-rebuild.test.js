import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { owedRebuild, postOwedRebuild, releaseRetainedPublish } from './lib/cms-migration-cli.js';

const events = [
  { event_id: 4, status: 'pending', idem_key: 'a' },
  { event_id: 2, status: 'sending', idem_key: 'b' },
  { event_id: 9, status: 'accepted', idem_key: 'c' },
  { event_id: 3, status: 'failed', idem_key: 'd' },
];

test('unfinished publish events collapse to one owed rebuild and stay until that request is accepted', () => {
  assert.deepEqual(owedRebuild(events), {
    requests: 1,
    eventIds: [2, 3, 4],
    evidence: null,
  });
  assert.equal(owedRebuild([{ status: 'accepted', event_id: 9 }]), null);
  assert.throws(
    () => releaseRetainedPublish(events, null),
    /unfinished publish events stay until one accepted rebuild/,
  );
  assert.throws(
    () => releaseRetainedPublish(events, { status: 'accepted', requests: 1, eventIds: [2, 3] }),
    /unfinished publish events stay until one accepted rebuild/,
  );
  const released = releaseRetainedPublish(events, {
    status: 'accepted',
    requests: 1,
    eventIds: [2, 3, 4],
  });
  assert.equal(released.released, true);
  assert.equal(released.events.find((row) => row.event_id === 4).status, 'pending');
  assert.equal(releaseRetainedPublish([{ status: 'accepted', event_id: 1 }], null).released, false);
});

function runOwed(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(import.meta.dirname, 'cms-owed-rebuild.js'),
      '--package', env.PACKAGE_DIR,
    ], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('the owed rebuild is one loopback request and the package rows stay unfinished', async () => {
  const owed = owedRebuild(events);
  let called = false;
  await assert.rejects(
    () => postOwedRebuild({
      owed,
      endpoint: 'http://example.com/hooks/rebuild',
      secret: 'local',
      now: 1700000000,
      nonce: 'a'.repeat(32),
      fetchImpl: () => { called = true; },
    }),
    /non-local endpoint/,
  );
  assert.equal(called, false);

  const secret = 'local-owed-secret';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-owed-'));
  const outboxDir = path.join(dir, 'cms-only');
  fs.mkdirSync(outboxDir);
  const outbox = path.join(outboxDir, 'publish-outbox.json');
  const original = JSON.stringify(events);
  fs.writeFileSync(outbox, original);
  const secretFile = path.join(dir, 'secret');
  fs.writeFileSync(secretFile, `${secret}\n`);
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
      seen.push({ body, signature: req.headers['x-signature'], expected });
      res.writeHead(seen.length === 1 ? 500 : 202);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const endpoint = `http://127.0.0.1:${port}/hooks/rebuild`;
  try {
    const refused = await runOwed({
      PACKAGE_DIR: dir,
      REBUILD_ENDPOINT: endpoint,
      WEBHOOK_SECRET_FILE: secretFile,
    });
    assert.equal(refused.status, 65, refused.stderr);
    assert.equal(JSON.parse(refused.stdout).evidence, null);
    assert.equal(fs.readFileSync(outbox, 'utf8'), original);
    assert.throws(() => releaseRetainedPublish(events, null), /stay until one accepted rebuild/);

    const accepted = await runOwed({
      PACKAGE_DIR: dir,
      REBUILD_ENDPOINT: endpoint,
      WEBHOOK_SECRET_FILE: secretFile,
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    const report = JSON.parse(accepted.stdout);
    assert.equal(report.requests, 1);
    assert.deepEqual(report.evidence.eventIds, [2, 3, 4]);
    assert.equal(seen.length, 2);
    const payload = JSON.parse(seen[1].body);
    assert.equal(payload.event, 'typecho-content-changed');
    assert.equal(Object.hasOwn(payload, 'i18n'), false);
    assert.equal(seen[1].signature, seen[1].expected);
    assert.equal(fs.readFileSync(outbox, 'utf8'), original);
    const released = releaseRetainedPublish(events, report.evidence);
    assert.equal(released.released, true);
    assert.equal(released.events.find((row) => row.event_id === 4).status, 'pending');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
