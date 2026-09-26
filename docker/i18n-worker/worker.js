#!/usr/bin/env node
/**
 * i18n translation worker. Long-running loop; runs in the cms compose project.
 * Translates via Kimi, writes drafts back through the CAS protocol, sends
 * publish outbox events to rebuild-api, and runs both compensation scans.
 *
 * Env: DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME DB_PREFIX
 *      KIMI_BASE_URL KIMI_MODEL KIMI_API_KEY_FILE
 *      WEBHOOK_SECRET_FILE  REBUILD_ENDPOINT (default http://rebuild-api:9000/hooks/rebuild)
 *      WORKER_POLL_MS (default 15000)  WORKER_INSTANCE_ID  GLOSSARY_FILE
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimJob, compensatePublish, compensateTranslation, dueOutboxEvents,
  failJob, markOutboxAccepted, markOutboxRetry, reapExpiredLeases,
  sourceForJob, sourceHash, supersedeJob, writeBackDraft,
} from '../../scripts/lib/i18n-store.js';
import { translateWithKimi } from '../../scripts/lib/i18n-kimi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const env = (key, fallback = '') => process.env[key] ?? fallback;
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'KIMI_API_KEY_FILE', 'KIMI_MODEL'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required`);
    process.exit(64);
  }
}

const PREFIX = env('DB_PREFIX', 'typecho_');
const INSTANCE = env('WORKER_INSTANCE_ID', `worker-${process.pid}-${crypto.randomBytes(3).toString('hex')}`);
const POLL_MS = Number(env('WORKER_POLL_MS', '15000'));
// Bodies above this fail fast instead of burning tokens on truncated output.
// kimi-k2 max output is ~8K tokens; 60K chars of Chinese is already ~2x that.
const MAX_TRANSLATE_CHARS = Number(env('MAX_TRANSLATE_CHARS', '60000'));
const COMPENSATE_EVERY = 40; // ~10min at 15s poll
const REBUILD_ENDPOINT = env('REBUILD_ENDPOINT', 'http://rebuild-api:9000/hooks/rebuild');
const GLOSSARY_FILE = env('GLOSSARY_FILE', path.join(REPO_ROOT, 'data', 'i18n-glossary.json'));

const readSecret = (file) => fs.readFileSync(file, 'utf8').trim();

function loadGlossary() {
  try {
    const raw = fs.readFileSync(GLOSSARY_FILE, 'utf8');
    const version = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    const data = JSON.parse(raw);
    const text = (data.terms || []).map((t) => `${t.zh} = ${t.en}`).join('\n');
    return { version, text };
  } catch {
    return { version: '', text: '' };
  }
}

async function sendRebuild(secret, payload) {
  const body = JSON.stringify({
    event: 'typecho-content-changed',
    ts: Math.floor(Date.now() / 1000),
    nonce: crypto.randomBytes(16).toString('hex'),
    i18n: payload,
  });
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const res = await fetch(REBUILD_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': sig },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

async function processJob(db, glossary, kimi) {
  const job = await claimJob(db, PREFIX, INSTANCE);
  if (!job) return false;
  try {
    const source = await sourceForJob(db, PREFIX, job);
    const isPublic = source && source.status === 'publish' && !source.password
      && ['post', 'page'].includes(source.type);
    const hash = source ? sourceHash(source.title, source.text) : null;
    if (!isPublic || hash !== job.expected_source_hash) {
      await supersedeJob(db, PREFIX, job);
      console.log(`job ${job.job_id} superseded (source changed or not public)`);
      return true;
    }
    const text = String(source.text).replace(/^<!--markdown-->\s*/i, '');
    if (text.length > MAX_TRANSLATE_CHARS) {
      throw new Error(`body too long to translate safely: ${text.length} > ${MAX_TRANSLATE_CHARS} chars; split or handle manually`);
    }
    const draft = await translateWithKimi({
      baseUrl: kimi.baseUrl, apiKey: kimi.apiKey, model: kimi.model,
      glossaryText: glossary.text, title: String(source.title), body: text,
    });
    const result = await writeBackDraft(db, PREFIX, job, {
      ...draft,
      glossaryVersion: glossary.version,
      author: `worker:kimi:${kimi.model}`,
    });
    console.log(`job ${job.job_id} cid=${job.cid} → ${result.outcome}${result.versionId ? ` version=${result.versionId}` : ''}`);
    return true;
  } catch (err) {
    const exhausted = await failJob(db, PREFIX, job, err instanceof Error ? err.message : String(err));
    console.error(`job ${job.job_id} failed${exhausted ? ' (exhausted)' : ''}:`, err instanceof Error ? err.message : err);
    return true;
  }
}

async function pumpOutbox(db, secret) {
  const events = await dueOutboxEvents(db, PREFIX);
  for (const event of events) {
    try {
      const status = await sendRebuild(secret, {
        cid: Number(event.cid), locale: event.locale, versionId: Number(event.version_id),
      });
      if (status === 202) {
        await markOutboxAccepted(db, PREFIX, event.event_id);
        console.log(`outbox ${event.event_id} accepted`);
      } else {
        await markOutboxRetry(db, PREFIX, event.event_id, `rebuild-api http ${status}`);
      }
    } catch (err) {
      await markOutboxRetry(db, PREFIX, event.event_id, err instanceof Error ? err.message : String(err));
    }
  }
}

async function main() {
  const mysql = await import('mysql2/promise');
  const db = mysql.createPool({
    host: env('DB_HOST'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
    charset: 'utf8mb4',
    connectionLimit: 4,
  });
  const kimi = {
    baseUrl: env('KIMI_BASE_URL', 'https://api.moonshot.cn/v1'),
    apiKey: readSecret(env('KIMI_API_KEY_FILE')),
    model: env('KIMI_MODEL'),
  };
  const webhookSecretFile = env('WEBHOOK_SECRET_FILE', '/run/secrets/webhook_secret');

  console.log(`i18n worker ${INSTANCE} up; poll=${POLL_MS}ms model=${kimi.model}`);
  let tick = 0;
  for (;;) {
    try {
      await reapExpiredLeases(db, PREFIX);
      // Drain everything due before sleeping.
      // eslint-disable-next-line no-await-in-loop
      while (await processJob(db, loadGlossary(), kimi)) { /* keep draining */ }
      const secret = readSecret(webhookSecretFile);
      await pumpOutbox(db, secret);
      tick += 1;
      if (tick % COMPENSATE_EVERY === 0) {
        const t = await compensateTranslation(db, PREFIX);
        const p = await compensatePublish(db, PREFIX);
        if (t || p) console.log(`compensation: +${t} jobs, +${p} outbox events`);
      }
    } catch (err) {
      console.error('worker loop error:', err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
