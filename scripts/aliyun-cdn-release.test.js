import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createAliyunPreheatRequest,
  createPreheatPlan,
  createPurgePlan,
  parseAliyunPreheatResponse,
  parseAliyunQuotaResponse,
  verifyPreheatPlan,
} from './cdn-purge-core.js';
import { collectPreheatUrls } from './generate-cdn-preheat-plan.js';
import { runAliyunCdnRelease } from './run-aliyun-cdn-release.js';

const RELEASE_ID = '20260813T120000Z-deadbeef';
const env = {
  ALIYUN_CDN_ACCESS_KEY_ID: 'test-access-id',
  ALIYUN_CDN_ACCESS_KEY_SECRET: 'test-access-secret',
  ALIYUN_CDN_DOMAIN: 'www.andy-y.cn',
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-aliyun-cdn-'));
  const wwwRoot = path.join(root, 'deploy');
  const stateDir = path.join(wwwRoot, 'state');
  const releaseDir = path.join(wwwRoot, 'releases', RELEASE_ID);
  fs.mkdirSync(releaseDir, { recursive: true });
  const legacy = Array.from({ length: 105 }, (_, index) => ({
    oldPath: `/legacy-${index}/`,
    action: 'redirect',
    targetPath: `/target-${index}/`,
  }));
  const purgePlan = createPurgePlan({ releaseId: RELEASE_ID, legacy });
  const preheatPlan = createPreheatPlan({
    releaseId: RELEASE_ID,
    urls: Array.from({ length: 205 }, (_, index) => `https://www.andy-y.cn/posts/item-${index}/`),
  });
  fs.writeFileSync(path.join(releaseDir, 'cdn-purge-plan.json'), `${JSON.stringify(purgePlan)}\n`);
  fs.writeFileSync(path.join(releaseDir, 'cdn-preheat-plan.json'), `${JSON.stringify(preheatPlan)}\n`);
  return { root, wwwRoot, stateDir, purgePlan, preheatPlan };
}

const response = (status, payload) => ({ status, text: async () => JSON.stringify(payload) });

test('preheat plan is canonical, query-free, and release-bound', () => {
  const plan = createPreheatPlan({ releaseId: RELEASE_ID, urls: ['/', '/posts/example/', '/'] });
  verifyPreheatPlan(plan, RELEASE_ID);
  assert.deepEqual(plan.urls, ['https://www.andy-y.cn/', 'https://www.andy-y.cn/posts/example/']);
  assert.throws(() => createPreheatPlan({ releaseId: RELEASE_ID, urls: ['https://evil.example/'] }));
  const unsafe = createPreheatPlan({ releaseId: RELEASE_ID, urls: ['/?p=1'] });
  assert.throws(() => verifyPreheatPlan(unsafe, RELEASE_ID));
});

test('preheat plan generator accepts only objects present in Astro output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-preheat-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of ['index.html', 'posts/example/index.html', 'robots.txt', 'rss.xml', 'sitemap-index.xml']) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, relative === 'sitemap-index.xml' ? '<sitemapindex />' : 'ok');
  }
  fs.writeFileSync(path.join(root, 'sitemap-0.xml'), '<urlset><url><loc>https://www.andy-y.cn/</loc></url><url><loc>https://www.andy-y.cn/posts/example/</loc></url></urlset>');
  const urls = collectPreheatUrls(root);
  assert.ok(urls.includes('https://www.andy-y.cn/posts/example/'));
  assert.equal(urls.some((url) => url.includes('?')), false);
});

test('Aliyun preheat and quota parsers require provider identifiers and integer quota', () => {
  const request = createAliyunPreheatRequest({
    urls: ['https://www.andy-y.cn/'],
    accessKeyId: env.ALIYUN_CDN_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_CDN_ACCESS_KEY_SECRET,
    date: '2026-08-13T12:00:00Z',
    nonce: 'nonce',
  });
  assert.equal(request.headers['x-acs-action'], 'PushObjectCache');
  assert.deepEqual(parseAliyunPreheatResponse(200, { PushTaskId: 'push-a', RequestId: 'request-a' }), { taskId: 'push-a', requestId: 'request-a' });
  assert.deepEqual(parseAliyunQuotaResponse(200, { UrlRemain: '10000', PreloadRemain: '1000', RequestId: 'quota-a' }), { urlRemain: 10000, preloadRemain: 1000, requestId: 'quota-a' });
  assert.throws(() => parseAliyunQuotaResponse(200, { UrlRemain: '-1', PreloadRemain: '1000', RequestId: 'quota-a' }));
});

test('release automation checks quota then submits exact refresh and 100-URL preheat batches', async (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const actions = [];
  const result = await runAliyunCdnRelease({
    releaseId: RELEASE_ID,
    wwwRoot: current.wwwRoot,
    stateDir: current.stateDir,
    env,
    now: () => new Date('2026-08-13T12:00:00Z'),
    nonce: () => `nonce-${actions.length}`,
    fetchImpl: async (_url, options) => {
      const action = options.headers['x-acs-action'];
      actions.push(action);
      if (action === 'DescribeRefreshQuota') return response(200, { UrlRemain: '10000', PreloadRemain: '1000', RequestId: 'quota-a' });
      if (action === 'RefreshObjectCaches') return response(200, { RefreshTaskId: 'refresh-a', RequestId: 'refresh-request' });
      if (action === 'PushObjectCache') return response(200, { PushTaskId: `push-${actions.length}`, RequestId: `push-request-${actions.length}` });
      throw new Error(`unexpected action ${action}`);
    },
  });
  assert.equal(result.status, 'submitted');
  assert.equal(actions.filter((action) => action === 'RefreshObjectCaches').length, Math.ceil(current.purgePlan.urls.length / 1000));
  assert.equal(actions.filter((action) => action === 'PushObjectCache').length, Math.ceil(current.preheatPlan.urls.length / 100));
  const job = JSON.parse(fs.readFileSync(result.jobFile, 'utf8'));
  assert.equal(job.status, 'submitted');
  assert.equal(job.refresh.status, 'submitted');
  assert.equal(job.preheat.status, 'submitted');
  const serialized = JSON.stringify(job);
  assert.equal(serialized.includes(env.ALIYUN_CDN_ACCESS_KEY_ID), false);
  assert.equal(serialized.includes(env.ALIYUN_CDN_ACCESS_KEY_SECRET), false);
});

test('insufficient quota fails before refresh or preheat submission', async (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const actions = [];
  await assert.rejects(() => runAliyunCdnRelease({
    releaseId: RELEASE_ID,
    wwwRoot: current.wwwRoot,
    stateDir: current.stateDir,
    env,
    fetchImpl: async (_url, options) => {
      actions.push(options.headers['x-acs-action']);
      return response(200, { UrlRemain: '1', PreloadRemain: '1', RequestId: 'quota-low' });
    },
  }), /quota is insufficient/);
  assert.deepEqual(actions, ['DescribeRefreshQuota']);
});
