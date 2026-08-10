#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  chunk,
  createAliyunRefreshRequest,
  createCloudflarePurgeRequest,
  parseAliyunRefreshResponse,
  parseCloudflarePurgeResponse,
  verifyPurgePlan,
} from './cdn-purge-core.js';

class PurgeError extends Error {
  constructor(message, exitCode = 71) {
    super(message);
    this.exitCode = exitCode;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

function isoNow(now) {
  return now().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function initialJob(plan, now) {
  return {
    schemaVersion: 1,
    releaseId: plan.releaseId,
    planSha256: plan.sha256,
    urlCount: plan.urls.length,
    createdAt: isoNow(now),
    aliyun: { status: 'pending', batches: [] },
    cloudflare: { status: 'pending', batches: [] },
  };
}

function requireJob(job, plan) {
  if (job?.schemaVersion !== 1 || job.releaseId !== plan.releaseId || job.planSha256 !== plan.sha256 || job.urlCount !== plan.urls.length) {
    throw new PurgeError('existing CDN job does not match immutable purge plan', 72);
  }
  for (const provider of ['aliyun', 'cloudflare']) {
    if (!job[provider] || !Array.isArray(job[provider].batches)) throw new PurgeError(`invalid ${provider} job state`, 72);
  }
}

async function responseJson(response) {
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('provider response is too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('provider returned non-JSON response');
  }
}

function completedBatch(provider, index, expectedCount) {
  const item = provider.batches.find((batch) => batch.index === index);
  return item?.status === 'ok' && item.count === expectedCount;
}

export async function runCdnPurge({
  releaseId,
  wwwRoot,
  stateDir,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  nonce = () => randomUUID(),
}) {
  if (!/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(releaseId ?? '')) throw new PurgeError('invalid release id', 72);
  if (typeof wwwRoot !== 'string' || typeof stateDir !== 'string' || !path.isAbsolute(wwwRoot) || !path.isAbsolute(stateDir)) {
    throw new PurgeError('WWW_ROOT and STATE_DIR must be absolute', 72);
  }
  const releaseDir = path.join(wwwRoot, 'releases', releaseId);
  const planFile = path.join(releaseDir, 'cdn-purge-plan.json');
  if (!fs.existsSync(planFile)) throw new PurgeError('release is missing cdn-purge-plan.json', 72);
  let plan;
  try {
    plan = verifyPurgePlan(readJson(planFile), releaseId);
  } catch (error) {
    throw new PurgeError(`invalid CDN purge plan: ${error.message}`, 72);
  }

  const jobDir = path.join(stateDir, 'cdn-jobs');
  fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(jobDir, 0o700);
  const jobFile = path.join(jobDir, `${releaseId}.json`);
  const job = fs.existsSync(jobFile) ? readJson(jobFile) : initialJob(plan, now);
  requireJob(job, plan);
  writeJsonAtomic(jobFile, job);

  const aliyunMissing = ['ALIYUN_CDN_ACCESS_KEY_ID', 'ALIYUN_CDN_ACCESS_KEY_SECRET', 'ALIYUN_CDN_DOMAIN'].filter((name) => !env[name]);
  const cloudflareMissing = ['CF_API_TOKEN', 'CF_ZONE_ID'].filter((name) => !env[name]);
  if (aliyunMissing.length > 0 || cloudflareMissing.length > 0) {
    if (aliyunMissing.length > 0) {
      job.aliyun = { ...job.aliyun, status: 'blocked', reason: `missing ${aliyunMissing.join(',')}`, at: isoNow(now) };
    }
    if (cloudflareMissing.length > 0) {
      job.cloudflare = { ...job.cloudflare, status: 'blocked', reason: `missing ${cloudflareMissing.join(',')}`, at: isoNow(now) };
    }
    writeJsonAtomic(jobFile, job);
    throw new PurgeError('dual-CDN credentials are incomplete', 72);
  }
  if (env.ALIYUN_CDN_DOMAIN !== 'www.andy-y.cn') {
    job.aliyun = { ...job.aliyun, status: 'blocked', reason: 'ALIYUN_CDN_DOMAIN must be www.andy-y.cn', at: isoNow(now) };
    writeJsonAtomic(jobFile, job);
    throw new PurgeError('Aliyun CDN domain must be www.andy-y.cn', 72);
  }
  if (!/^[a-f0-9]{32}$/i.test(env.CF_ZONE_ID)) {
    job.cloudflare = { ...job.cloudflare, status: 'blocked', reason: 'invalid CF_ZONE_ID', at: isoNow(now) };
    writeJsonAtomic(jobFile, job);
    throw new PurgeError('invalid Cloudflare zone id', 72);
  }

  if (job.aliyun.status !== 'ok') {
    const batches = chunk(plan.urls, 1000);
    job.aliyun.status = 'running';
    writeJsonAtomic(jobFile, job);
    try {
      for (let index = 0; index < batches.length; index += 1) {
        if (completedBatch(job.aliyun, index, batches[index].length)) continue;
        const request = createAliyunRefreshRequest({
          urls: batches[index],
          accessKeyId: env.ALIYUN_CDN_ACCESS_KEY_ID,
          accessKeySecret: env.ALIYUN_CDN_ACCESS_KEY_SECRET,
          securityToken: env.ALIYUN_CDN_SECURITY_TOKEN,
          date: isoNow(now),
          nonce: nonce(),
        });
        const response = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(20_000) });
        const result = parseAliyunRefreshResponse(response.status, await responseJson(response));
        job.aliyun.batches = job.aliyun.batches.filter((batch) => batch.index !== index);
        job.aliyun.batches.push({ index, count: batches[index].length, status: 'ok', ...result, at: isoNow(now) });
        writeJsonAtomic(jobFile, job);
      }
      job.aliyun.status = 'ok';
      job.aliyun.at = isoNow(now);
      delete job.aliyun.reason;
      writeJsonAtomic(jobFile, job);
    } catch (error) {
      job.aliyun.status = 'failed';
      job.aliyun.reason = error.message;
      job.aliyun.at = isoNow(now);
      writeJsonAtomic(jobFile, job);
      throw new PurgeError(error.message, 71);
    }
  }

  if (job.cloudflare.status !== 'ok') {
    const batches = chunk(plan.urls, 100);
    job.cloudflare.status = 'running';
    writeJsonAtomic(jobFile, job);
    try {
      for (let index = 0; index < batches.length; index += 1) {
        if (completedBatch(job.cloudflare, index, batches[index].length)) continue;
        const request = createCloudflarePurgeRequest({ zoneId: env.CF_ZONE_ID, apiToken: env.CF_API_TOKEN, urls: batches[index] });
        const response = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(20_000) });
        const result = parseCloudflarePurgeResponse(response.status, await responseJson(response));
        job.cloudflare.batches = job.cloudflare.batches.filter((batch) => batch.index !== index);
        job.cloudflare.batches.push({ index, count: batches[index].length, status: 'ok', ...result, at: isoNow(now) });
        writeJsonAtomic(jobFile, job);
      }
      job.cloudflare.status = 'ok';
      job.cloudflare.at = isoNow(now);
      delete job.cloudflare.reason;
      writeJsonAtomic(jobFile, job);
    } catch (error) {
      job.cloudflare.status = 'failed';
      job.cloudflare.reason = error.message;
      job.cloudflare.at = isoNow(now);
      writeJsonAtomic(jobFile, job);
      throw new PurgeError(error.message, 71);
    }
  }

  job.status = 'ok';
  job.completedAt = isoNow(now);
  writeJsonAtomic(jobFile, job);
  return { jobFile, releaseId, urlCount: plan.urls.length, aliyun: job.aliyun.status, cloudflare: job.cloudflare.status };
}

async function main() {
  const args = process.argv.slice(2);
  const releaseIndex = args.indexOf('--release-id');
  if (releaseIndex === -1 || !args[releaseIndex + 1]) throw new PurgeError('missing --release-id', 72);
  const result = await runCdnPurge({
    releaseId: args[releaseIndex + 1],
    wwwRoot: process.env.WWW_ROOT,
    stateDir: process.env.STATE_DIR || path.join(process.env.WWW_ROOT ?? '', 'state'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`cdn purge failed: ${error.message}\n`);
    process.exit(error.exitCode || 71);
  });
}
