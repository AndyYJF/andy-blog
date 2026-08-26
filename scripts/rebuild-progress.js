#!/usr/bin/env node
/**
 * Atomic rebuild progress file for CMS status.
 * Fail-open from the host: a crash here must not fail the release.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STEP_ORDER = [
  'queued',
  'snapshot',
  'sync',
  'deps',
  'tests',
  'sync-typecho',
  'maps',
  'astro',
  'gates',
  'package',
  'switch',
  'cdn',
  'done',
];

const STEP_LABEL = {
  queued: '排队',
  snapshot: '导出 snapshot',
  sync: '同步源码',
  deps: '依赖',
  tests: '构建测试',
  'sync-typecho': '同步文章',
  maps: 'URL / nginx map',
  astro: 'Astro / mermaid',
  gates: 'render-gate',
  package: '打包',
  switch: '原子切换',
  cdn: 'CDN 入队',
  done: '完成',
};

export const parseArgs = (argv) => {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
};

const emptySteps = () =>
  STEP_ORDER.filter((id) => id !== 'done').map((id) => ({
    id,
    label: STEP_LABEL[id],
    state: 'pending',
  }));

export const applyPhase = (steps, phase, status) => {
  const list = steps.length ? steps : emptySteps();
  if (status === 'queued') {
    return list.map((step) => ({
      ...step,
      state: step.id === 'queued' ? 'running' : 'pending',
    }));
  }
  if (status === 'success') {
    return list.map((step) => ({ ...step, state: 'done' }));
  }
  const idx = STEP_ORDER.indexOf(phase);
  return list.map((step) => {
    const stepIdx = STEP_ORDER.indexOf(step.id);
    if (idx < 0) return step;
    if (stepIdx < idx) return { ...step, state: 'done' };
    if (stepIdx === idx) {
      return { ...step, state: status === 'failed' ? 'failed' : 'running' };
    }
    return { ...step, state: 'pending' };
  });
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

export const mergeProgress = (current, patch) => {
  const prev = current && typeof current === 'object' ? current : {};
  const next = {
    status: 'idle',
    phase: 'idle',
    builder: null,
    releaseId: null,
    current: null,
    previous: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    error: null,
    steps: emptySteps(),
    ...prev,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  };
  next.updatedAt = new Date().toISOString();
  const prevBusy = prev.status === 'queued' || prev.status === 'running';
  const nextBusy = next.status === 'queued' || next.status === 'running';
  if (nextBusy && !prevBusy) {
    next.startedAt = next.updatedAt;
  }
  if (!next.startedAt && nextBusy) {
    next.startedAt = next.updatedAt;
  }
  if (next.retryCount !== undefined && next.retryCount !== null && next.retryCount !== '') {
    const retryCount = Number(next.retryCount);
    next.retryCount = Number.isFinite(retryCount) ? retryCount : 0;
  }
  if (next.retryMax !== undefined && next.retryMax !== null && next.retryMax !== '') {
    const retryMax = Number(next.retryMax);
    next.retryMax = Number.isFinite(retryMax) ? retryMax : 3;
  }
  if (next.retryExhausted !== undefined) {
    next.retryExhausted = Boolean(next.retryExhausted);
  }
  next.steps = applyPhase(next.steps, next.phase, next.status);
  if (next.status === 'success' || next.status === 'failed') {
    next.lastOutcome = {
      status: next.status,
      finishedAt: next.updatedAt,
      releaseId: next.releaseId ?? null,
      phase: next.phase,
      error: next.error ?? null,
      retryCount: next.retryCount ?? 0,
      retryExhausted: Boolean(next.retryExhausted),
    };
  }
  return next;
};

export const historyRecord = (progress) => ({
  finishedAt: progress?.lastOutcome?.finishedAt || progress?.updatedAt || new Date().toISOString(),
  startedAt: progress?.startedAt ?? null,
  status: progress?.status === 'success' ? 'success' : 'failed',
  phase: progress?.phase ?? null,
  releaseId: progress?.releaseId ?? null,
  builder: progress?.builder ?? null,
  error: progress?.error ?? null,
  retryCount: progress?.retryCount ?? 0,
  retryMax: progress?.retryMax ?? 3,
  retryExhausted: Boolean(progress?.retryExhausted),
});

const HISTORY_MAX = 200;

const appendHistory = async (dir, record) => {
  const file = path.join(dir, 'history.jsonl');
  let lines = [];
  try {
    const text = await fsp.readFile(file, 'utf8');
    lines = text.split(/\r?\n/).filter(Boolean);
  } catch {
    lines = [];
  }
  lines.push(JSON.stringify(record));
  if (lines.length > HISTORY_MAX) lines = lines.slice(-HISTORY_MAX);
  await atomicWrite(file, `${lines.join('\n')}\n`);
};

const atomicWrite = async (file, body) => {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, body, { encoding: 'utf8', mode: 0o644 });
  await fsp.rename(tmp, file);
  await fsp.chmod(file, 0o644);
};

export const updateProgress = async ({ runtime, patch, appendLog }) => {
  const dir = path.resolve(runtime);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'progress.json');
  const logFile = path.join(dir, 'progress.log');
  const current = readJson(file);
  const prevStatus = current.status;
  const next = mergeProgress(current, patch);
  await atomicWrite(file, `${JSON.stringify(next)}\n`);
  if (appendLog !== undefined && appendLog !== '') {
    await fsp.appendFile(logFile, `${String(appendLog).replace(/\s+$/u, '')}\n`, 'utf8');
    await fsp.chmod(logFile, 0o644).catch(() => undefined);
  }
  const completed = next.status === 'success' || next.status === 'failed';
  if (completed && prevStatus !== next.status) {
    await appendHistory(dir, historyRecord(next));
  }
  return next;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runtime) {
    console.error('rebuild-progress: --runtime is required');
    process.exit(64);
  }
  const patch = {};
  if (args.status !== undefined) patch.status = String(args.status);
  if (args.phase !== undefined) patch.phase = String(args.phase);
  if (args.builder !== undefined) patch.builder = String(args.builder);
  if (args['release-id'] !== undefined) patch.releaseId = String(args['release-id']);
  if (args.current !== undefined) patch.current = String(args.current);
  if (args.previous !== undefined) patch.previous = String(args.previous);
  if (args.error !== undefined) patch.error = String(args.error);
  if (args['clear-error']) patch.error = null;
  if (args['retry-count'] !== undefined) patch.retryCount = args['retry-count'];
  if (args['retry-max'] !== undefined) patch.retryMax = args['retry-max'];
  if (args['retry-exhausted']) patch.retryExhausted = true;
  const next = await updateProgress({
    runtime: args.runtime,
    patch,
    appendLog: args['append-log'],
  });
  process.stdout.write(`${JSON.stringify({ ok: true, phase: next.phase, status: next.status })}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
