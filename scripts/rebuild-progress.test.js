import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPhase, mergeProgress, updateProgress } from './rebuild-progress.js';

test('queued marks only the queue step running', () => {
  const steps = applyPhase([], 'queued', 'queued');
  assert.equal(steps[0].id, 'queued');
  assert.equal(steps[0].state, 'running');
  assert.equal(steps[1].state, 'pending');
});

test('astro phase completes earlier steps', () => {
  const steps = applyPhase([], 'astro', 'running');
  const astro = steps.find((step) => step.id === 'astro');
  const snapshot = steps.find((step) => step.id === 'snapshot');
  const cdn = steps.find((step) => step.id === 'cdn');
  assert.equal(snapshot.state, 'done');
  assert.equal(astro.state, 'running');
  assert.equal(cdn.state, 'pending');
});

test('merge keeps last success release across a new queue', () => {
  const next = mergeProgress(
    { status: 'success', releaseId: 'rel-old', current: 'rel-old' },
    { status: 'queued', phase: 'queued' },
  );
  assert.equal(next.status, 'queued');
  assert.equal(next.current, 'rel-old');
  assert.equal(next.releaseId, 'rel-old');
  assert.ok(next.startedAt);
});

test('failed status writes lastOutcome and history.jsonl', async () => {
  const runtime = await fsp.mkdtemp(path.join(os.tmpdir(), 'rebuild-progress-'));
  await updateProgress({
    runtime,
    patch: { status: 'running', phase: 'astro', builder: 'offbox' },
  });
  await updateProgress({
    runtime,
    patch: { status: 'failed', phase: 'astro', error: 'rebuild exited 65', retryCount: 1, retryMax: 3 },
  });
  const body = JSON.parse(fs.readFileSync(path.join(runtime, 'progress.json'), 'utf8'));
  assert.equal(body.lastOutcome.status, 'failed');
  assert.equal(body.lastOutcome.phase, 'astro');
  const queued = mergeProgress(body, { status: 'queued', phase: 'queued' });
  assert.equal(queued.lastOutcome.status, 'failed');
  const history = fs.readFileSync(path.join(runtime, 'history.jsonl'), 'utf8').trim();
  assert.match(history, /"status":"failed"/);
  await fsp.rm(runtime, { recursive: true, force: true });
});

test('updateProgress writes json and appends log', async () => {
  const runtime = await fsp.mkdtemp(path.join(os.tmpdir(), 'rebuild-progress-'));
  await updateProgress({
    runtime,
    patch: { status: 'running', phase: 'snapshot', builder: 'offbox' },
    appendLog: 'export snapshot',
  });
  const body = JSON.parse(fs.readFileSync(path.join(runtime, 'progress.json'), 'utf8'));
  assert.equal(body.phase, 'snapshot');
  assert.equal(body.builder, 'offbox');
  assert.match(fs.readFileSync(path.join(runtime, 'progress.log'), 'utf8'), /export snapshot/);
  await fsp.rm(runtime, { recursive: true, force: true });
});
