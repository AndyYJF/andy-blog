import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CDN_PURGE_SITE,
  createAliyunV3SignedRequest,
  createPurgePlan,
  parseAliyunRefreshResponse,
  parseCloudflarePurgeResponse,
  verifyPurgePlan,
} from './cdn-purge-core.js';
import { runCdnPurge } from './run-cdn-purge.js';

const RELEASE_ID = '20260810T120000Z-deadbeef';

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-cdn-purge-'));
  const wwwRoot = path.join(root, 'deploy');
  const stateDir = path.join(wwwRoot, 'state');
  const releaseDir = path.join(wwwRoot, 'releases', RELEASE_ID);
  fs.mkdirSync(releaseDir, { recursive: true });
  const legacy = Array.from({ length: 105 }, (_, index) => ({
    oldPath: `/legacy-${String(index).padStart(3, '0')}/`,
    queryKey: null,
    action: 'redirect',
    targetPath: `/target-${String(index).padStart(3, '0')}/`,
  }));
  const plan = createPurgePlan({ releaseId: RELEASE_ID, legacy });
  fs.writeFileSync(path.join(releaseDir, 'cdn-purge-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  return { root, wwwRoot, stateDir, plan };
}

function response(status, payload) {
  return { status, text: async () => JSON.stringify(payload) };
}

const env = {
  ALIYUN_CDN_ACCESS_KEY_ID: 'test-access-id',
  ALIYUN_CDN_ACCESS_KEY_SECRET: 'test-access-secret',
  ALIYUN_CDN_DOMAIN: 'www.andy-y.cn',
  CF_API_TOKEN: 'test-cloudflare-token',
  CF_ZONE_ID: '0123456789abcdef0123456789abcdef',
};

test('purge plan covers legacy/query/canonical URLs and is host-bound', () => {
  const plan = createPurgePlan({
    releaseId: RELEASE_ID,
    legacy: [
      { oldPath: '/index.php/tag/%E5%88%86%E6%9E%90fen-x/', action: 'redirect', targetPath: '/tag/fen-x/' },
      { queryKey: '/:47', action: 'redirect', targetPath: '/posts/typecho-joe-mermaid/' },
    ],
  });
  verifyPurgePlan(plan, RELEASE_ID);
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/index.php/tag/%E5%88%86%E6%9E%90fen-x/`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/?p=47`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/tag/fen-x/`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/moments/`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/moments/rss.xml`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/listening/`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/llms.txt`));
  assert.ok(plan.urls.includes(`${CDN_PURGE_SITE}/llms-full.txt`));
  assert.throws(() => verifyPurgePlan({ ...plan, urls: [...plan.urls, 'https://evil.example/'] }, RELEASE_ID));
});

test('Aliyun V3 signer matches the official fixed vector', () => {
  const signed = createAliyunV3SignedRequest({
    accessKeyId: 'YourAccessKeyId',
    accessKeySecret: 'YourAccessKeySecret',
    endpoint: 'ecs.cn-shanghai.aliyuncs.com',
    action: 'RunInstances',
    version: '2014-05-26',
    query: {
      ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd',
      RegionId: 'cn-shanghai',
    },
    date: '2023-10-26T10:22:32Z',
    nonce: '3156853299f313e23d1673dc12e1703d',
  });
  assert.equal(signed.signature, '06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0');
});

test('provider response parsers require real success identifiers', () => {
  assert.deepEqual(parseAliyunRefreshResponse(200, { RefreshTaskId: '704222901', RequestId: 'request-a' }), {
    taskId: '704222901',
    requestId: 'request-a',
  });
  assert.throws(() => parseAliyunRefreshResponse(200, { RequestId: 'request-a' }));
  assert.deepEqual(parseCloudflarePurgeResponse(200, { success: true, result: { id: 'request-cf' } }), {
    requestId: 'request-cf',
  });
  assert.throws(() => parseCloudflarePurgeResponse(200, { success: false, result: { id: 'request-cf' } }));
});

test('dual purge records validated responses and batches Cloudflare at 100 URLs', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const calls = [];
  const result = await runCdnPurge({
    releaseId: RELEASE_ID,
    wwwRoot: fixture.wwwRoot,
    stateDir: fixture.stateDir,
    env,
    now: () => new Date('2026-08-10T12:00:00Z'),
    nonce: () => 'nonce-fixed',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('aliyuncs.com')) return response(200, { RefreshTaskId: 'task-a', RequestId: 'request-a' });
      return response(200, { success: true, result: { id: `cf-${calls.length}` } });
    },
  });
  assert.equal(result.aliyun, 'ok');
  assert.equal(result.cloudflare, 'ok');
  assert.equal(calls.filter((call) => call.url.includes('cloudflare.com')).length, Math.ceil(fixture.plan.urls.length / 100));
  const job = JSON.parse(fs.readFileSync(result.jobFile, 'utf8'));
  assert.equal(job.status, 'ok');
  assert.equal(job.planSha256, fixture.plan.sha256);
  const serializedJob = JSON.stringify(job);
  for (const secret of [env.ALIYUN_CDN_ACCESS_KEY_ID, env.ALIYUN_CDN_ACCESS_KEY_SECRET, env.CF_API_TOKEN]) {
    assert.equal(serializedJob.includes(secret), false);
  }
});

test('rerun resumes after the last validated Cloudflare batch without repeating Aliyun', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let cloudflareCalls = 0;
  await assert.rejects(() => runCdnPurge({
    releaseId: RELEASE_ID,
    wwwRoot: fixture.wwwRoot,
    stateDir: fixture.stateDir,
    env,
    now: () => new Date('2026-08-10T12:00:00Z'),
    nonce: () => 'nonce-first',
    fetchImpl: async (url) => {
      if (url.includes('aliyuncs.com')) return response(200, { RefreshTaskId: 'task-a', RequestId: 'request-a' });
      cloudflareCalls += 1;
      if (cloudflareCalls === 1) return response(200, { success: true, result: { id: 'cf-first' } });
      return response(500, { success: false, errors: [{ code: 1000 }] });
    },
  }));

  let aliyunRepeated = false;
  let resumedCloudflare = 0;
  const result = await runCdnPurge({
    releaseId: RELEASE_ID,
    wwwRoot: fixture.wwwRoot,
    stateDir: fixture.stateDir,
    env,
    now: () => new Date('2026-08-10T12:01:00Z'),
    nonce: () => 'nonce-second',
    fetchImpl: async (url) => {
      if (url.includes('aliyuncs.com')) aliyunRepeated = true;
      resumedCloudflare += 1;
      return response(200, { success: true, result: { id: 'cf-resume' } });
    },
  });
  assert.equal(aliyunRepeated, false);
  assert.equal(resumedCloudflare, Math.ceil(fixture.plan.urls.length / 100) - 1);
  assert.equal(result.cloudflare, 'ok');
});

test('missing credentials fail before network and never mark the job ok', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let network = false;
  await assert.rejects(() => runCdnPurge({
    releaseId: RELEASE_ID,
    wwwRoot: fixture.wwwRoot,
    stateDir: fixture.stateDir,
    env: {},
    fetchImpl: async () => {
      network = true;
      throw new Error('must not run');
    },
  }));
  assert.equal(network, false);
  const job = JSON.parse(fs.readFileSync(path.join(fixture.stateDir, 'cdn-jobs', `${RELEASE_ID}.json`), 'utf8'));
  assert.equal(job.status, undefined);
  assert.equal(job.aliyun.status, 'blocked');
});

test('missing Cloudflare credentials block before submitting an Aliyun task', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let network = false;
  await assert.rejects(() => runCdnPurge({
    releaseId: RELEASE_ID,
    wwwRoot: fixture.wwwRoot,
    stateDir: fixture.stateDir,
    env: {
      ALIYUN_CDN_ACCESS_KEY_ID: env.ALIYUN_CDN_ACCESS_KEY_ID,
      ALIYUN_CDN_ACCESS_KEY_SECRET: env.ALIYUN_CDN_ACCESS_KEY_SECRET,
      ALIYUN_CDN_DOMAIN: env.ALIYUN_CDN_DOMAIN,
    },
    fetchImpl: async () => {
      network = true;
      throw new Error('must not run');
    },
  }));
  assert.equal(network, false);
  const job = JSON.parse(fs.readFileSync(path.join(fixture.stateDir, 'cdn-jobs', `${RELEASE_ID}.json`), 'utf8'));
  assert.equal(job.aliyun.status, 'pending');
  assert.equal(job.cloudflare.status, 'blocked');
});
