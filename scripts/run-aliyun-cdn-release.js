#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  chunk,
  createAliyunPreheatRequest,
  createAliyunQuotaRequest,
  createAliyunRefreshRequest,
  parseAliyunPreheatResponse,
  parseAliyunQuotaResponse,
  parseAliyunRefreshResponse,
  verifyPreheatPlan,
  verifyPurgePlan,
} from './cdn-purge-core.js';

class AliyunCdnError extends Error {
  constructor(message, exitCode = 71) {
    super(message);
    this.exitCode = exitCode;
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

const isoNow = (now) => now().toISOString().replace(/\.\d{3}Z$/, 'Z');

function initialJob(purgePlan, preheatPlan, now) {
  return {
    schemaVersion: 1,
    releaseId: purgePlan.releaseId,
    purgePlanSha256: purgePlan.sha256,
    preheatPlanSha256: preheatPlan.sha256,
    refreshUrlCount: purgePlan.urls.length,
    preheatUrlCount: preheatPlan.urls.length,
    createdAt: isoNow(now),
    quota: { status: 'pending' },
    refresh: { status: 'pending', batches: [] },
    preheat: { status: 'pending', batches: [] },
  };
}

function requireJob(job, purgePlan, preheatPlan) {
  if (
    job?.schemaVersion !== 1
    || job.releaseId !== purgePlan.releaseId
    || job.purgePlanSha256 !== purgePlan.sha256
    || job.preheatPlanSha256 !== preheatPlan.sha256
    || job.refreshUrlCount !== purgePlan.urls.length
    || job.preheatUrlCount !== preheatPlan.urls.length
    || !Array.isArray(job.refresh?.batches)
    || !Array.isArray(job.preheat?.batches)
  ) {
    throw new AliyunCdnError('existing Aliyun CDN job does not match immutable release plans', 72);
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

function completedBatch(section, index, count) {
  const item = section.batches.find((batch) => batch.index === index);
  return item?.status === 'submitted' && item.count === count;
}

async function requestJson(request, fetchImpl) {
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, payload: await responseJson(response) };
}

export async function runAliyunCdnRelease({
  releaseId,
  wwwRoot,
  stateDir,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  nonce = () => randomUUID(),
}) {
  if (!/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(releaseId ?? '')) throw new AliyunCdnError('invalid release id', 72);
  if (typeof wwwRoot !== 'string' || typeof stateDir !== 'string' || !path.isAbsolute(wwwRoot) || !path.isAbsolute(stateDir)) {
    throw new AliyunCdnError('WWW_ROOT and STATE_DIR must be absolute', 72);
  }
  const releaseDir = path.join(wwwRoot, 'releases', releaseId);
  let purgePlan;
  let preheatPlan;
  try {
    purgePlan = verifyPurgePlan(readJson(path.join(releaseDir, 'cdn-purge-plan.json')), releaseId);
    preheatPlan = verifyPreheatPlan(readJson(path.join(releaseDir, 'cdn-preheat-plan.json')), releaseId);
  } catch (error) {
    throw new AliyunCdnError(`invalid release CDN plan: ${error.message}`, 72);
  }

  const jobDir = path.join(stateDir, 'aliyun-cdn-jobs');
  fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(jobDir, 0o700);
  const jobFile = path.join(jobDir, `${releaseId}.json`);
  const job = fs.existsSync(jobFile) ? readJson(jobFile) : initialJob(purgePlan, preheatPlan, now);
  requireJob(job, purgePlan, preheatPlan);
  writeJsonAtomic(jobFile, job);

  const missing = ['ALIYUN_CDN_ACCESS_KEY_ID', 'ALIYUN_CDN_ACCESS_KEY_SECRET', 'ALIYUN_CDN_DOMAIN'].filter((name) => !env[name]);
  if (missing.length > 0 || env.ALIYUN_CDN_DOMAIN !== 'www.andy-y.cn') {
    job.status = 'blocked';
    job.reason = missing.length > 0 ? `missing ${missing.join(',')}` : 'ALIYUN_CDN_DOMAIN must be www.andy-y.cn';
    job.at = isoNow(now);
    writeJsonAtomic(jobFile, job);
    throw new AliyunCdnError('Aliyun CDN credentials are incomplete or domain-bound incorrectly', 72);
  }

  const requestContext = () => ({
    accessKeyId: env.ALIYUN_CDN_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_CDN_ACCESS_KEY_SECRET,
    securityToken: env.ALIYUN_CDN_SECURITY_TOKEN,
    date: isoNow(now),
    nonce: nonce(),
  });

  try {
    if (job.status !== 'submitted') {
      const request = createAliyunQuotaRequest(requestContext());
      const response = await requestJson(request, fetchImpl);
      const quota = parseAliyunQuotaResponse(response.status, response.payload);
      job.quota = { status: 'ok', ...quota, at: isoNow(now) };
      delete job.reason;
      writeJsonAtomic(jobFile, job);
    }
    const remainingRefresh = purgePlan.urls.length - job.refresh.batches
      .filter((batch) => batch.status === 'submitted')
      .reduce((total, batch) => total + batch.count, 0);
    const remainingPreheat = preheatPlan.urls.length - job.preheat.batches
      .filter((batch) => batch.status === 'submitted')
      .reduce((total, batch) => total + batch.count, 0);
    if (job.quota.urlRemain < remainingRefresh || job.quota.preloadRemain < remainingPreheat) {
      throw new Error(`Aliyun CDN quota is insufficient (refresh ${job.quota.urlRemain}/${remainingRefresh}, preheat ${job.quota.preloadRemain}/${remainingPreheat})`);
    }

    if (job.refresh.status !== 'submitted') {
      job.refresh.status = 'running';
      writeJsonAtomic(jobFile, job);
      const batches = chunk(purgePlan.urls, 1000);
      for (let index = 0; index < batches.length; index += 1) {
        if (completedBatch(job.refresh, index, batches[index].length)) continue;
        const request = createAliyunRefreshRequest({ urls: batches[index], ...requestContext() });
        const response = await requestJson(request, fetchImpl);
        const result = parseAliyunRefreshResponse(response.status, response.payload);
        job.refresh.batches = job.refresh.batches.filter((batch) => batch.index !== index);
        job.refresh.batches.push({ index, count: batches[index].length, status: 'submitted', ...result, at: isoNow(now) });
        writeJsonAtomic(jobFile, job);
      }
      job.refresh.status = 'submitted';
      job.refresh.at = isoNow(now);
      writeJsonAtomic(jobFile, job);
    }

    if (job.preheat.status !== 'submitted') {
      job.preheat.status = 'running';
      writeJsonAtomic(jobFile, job);
      const batches = chunk(preheatPlan.urls, 100);
      for (let index = 0; index < batches.length; index += 1) {
        if (completedBatch(job.preheat, index, batches[index].length)) continue;
        const request = createAliyunPreheatRequest({ urls: batches[index], ...requestContext() });
        const response = await requestJson(request, fetchImpl);
        const result = parseAliyunPreheatResponse(response.status, response.payload);
        job.preheat.batches = job.preheat.batches.filter((batch) => batch.index !== index);
        job.preheat.batches.push({ index, count: batches[index].length, status: 'submitted', ...result, at: isoNow(now) });
        writeJsonAtomic(jobFile, job);
      }
      job.preheat.status = 'submitted';
      job.preheat.at = isoNow(now);
      writeJsonAtomic(jobFile, job);
    }
  } catch (error) {
    job.status = 'failed';
    job.reason = error.message;
    job.at = isoNow(now);
    writeJsonAtomic(jobFile, job);
    throw new AliyunCdnError(error.message, 71);
  }

  job.status = 'submitted';
  job.submittedAt = isoNow(now);
  delete job.reason;
  writeJsonAtomic(jobFile, job);
  return {
    jobFile,
    releaseId,
    refreshUrlCount: purgePlan.urls.length,
    preheatUrlCount: preheatPlan.urls.length,
    refreshBatches: job.refresh.batches.length,
    preheatBatches: job.preheat.batches.length,
    status: job.status,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const releaseIndex = args.indexOf('--release-id');
  if (releaseIndex === -1 || !args[releaseIndex + 1]) throw new AliyunCdnError('missing --release-id', 72);
  const result = await runAliyunCdnRelease({
    releaseId: args[releaseIndex + 1],
    wwwRoot: process.env.WWW_ROOT,
    stateDir: process.env.STATE_DIR || path.join(process.env.WWW_ROOT ?? '', 'state'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`Aliyun CDN release failed: ${error.message}\n`);
    process.exit(error.exitCode || 71);
  });
}
