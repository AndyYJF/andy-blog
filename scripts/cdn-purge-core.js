import { createHash, createHmac } from 'node:crypto';

export const CDN_PURGE_SITE = 'https://www.andy-y.cn';
export const CDN_PURGE_SCHEMA_VERSION = 1;
export const CDN_PREHEAT_SCHEMA_VERSION = 1;

const FIXED_PATHS = [
  '/',
  '/__release',
  '/robots.txt',
  '/llms.txt',
  '/llms-full.txt',
  '/rss.xml',
  '/moments/',
  '/moments/rss.xml',
  '/sitemap-0.xml',
  '/sitemap-index.xml',
  // Pagefind entry + WASM/UI must be purged with CSP/MIME changes; otherwise
  // desktop browsers can keep a broken search bundle while phone edges refresh.
  '/pagefind/pagefind-entry.json',
  '/pagefind/pagefind.js',
  '/pagefind/pagefind-ui.js',
  '/pagefind/pagefind-ui.css',
  '/pagefind/pagefind-worker.js',
  '/pagefind/pagefind-highlight.js',
  '/pagefind/wasm.unknown.pagefind',
];

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function queryKeyToPath(queryKey) {
  const match = /^(\/|\/index\.php):(\d+)$/.exec(queryKey ?? '');
  if (!match) throw new Error(`invalid legacy queryKey: ${queryKey}`);
  return `${match[1]}?p=${match[2]}`;
}

function exactSiteUrl(input, site = CDN_PURGE_SITE) {
  const base = new URL(site);
  const url = new URL(input, `${base.origin}/`);
  if (url.origin !== base.origin) throw new Error(`purge URL escaped site: ${url.href}`);
  if (url.username || url.password || url.hash) throw new Error(`unsafe purge URL: ${url.href}`);
  return url.href;
}

export function buildPurgeUrls(legacy, site = CDN_PURGE_SITE, extraPaths = []) {
  if (!Array.isArray(legacy) || legacy.length === 0) throw new Error('legacy map is empty');
  const urls = new Set(FIXED_PATHS.map((path) => exactSiteUrl(path, site)));

  for (const entry of legacy) {
    if (!entry || !['redirect', 'not_found', 'gone'].includes(entry.action)) {
      throw new Error(`invalid legacy entry: ${JSON.stringify(entry)}`);
    }
    if (entry.oldPath) urls.add(exactSiteUrl(entry.oldPath, site));
    if (entry.queryKey) urls.add(exactSiteUrl(queryKeyToPath(entry.queryKey), site));
    if (entry.action === 'redirect') {
      if (!entry.targetPath) throw new Error(`redirect missing target: ${JSON.stringify(entry)}`);
      urls.add(exactSiteUrl(entry.targetPath, site));
    }
  }

  for (const path of extraPaths) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new Error(`invalid extra purge path: ${JSON.stringify(path)}`);
    }
    urls.add(exactSiteUrl(path, site));
  }

  return [...urls].sort();
}

function planDigestPayload(plan) {
  return JSON.stringify({
    schemaVersion: plan.schemaVersion,
    releaseId: plan.releaseId,
    site: plan.site,
    urls: plan.urls,
  });
}

function preheatPlanDigestPayload(plan) {
  return JSON.stringify({
    schemaVersion: plan.schemaVersion,
    releaseId: plan.releaseId,
    site: plan.site,
    urls: plan.urls,
  });
}

export function createPurgePlan({ releaseId, legacy, site = CDN_PURGE_SITE, extraPaths = [] }) {
  if (!/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(releaseId ?? '')) {
    throw new Error(`invalid release id: ${releaseId}`);
  }
  const plan = {
    schemaVersion: CDN_PURGE_SCHEMA_VERSION,
    releaseId,
    site,
    urls: buildPurgeUrls(legacy, site, extraPaths),
  };
  plan.sha256 = sha256Hex(planDigestPayload(plan));
  return plan;
}

export function verifyPurgePlan(plan, expectedReleaseId) {
  if (!plan || plan.schemaVersion !== CDN_PURGE_SCHEMA_VERSION) throw new Error('unsupported purge plan schema');
  if (plan.releaseId !== expectedReleaseId) throw new Error('purge plan release mismatch');
  if (plan.site !== CDN_PURGE_SITE) throw new Error(`unexpected purge site: ${plan.site}`);
  if (!Array.isArray(plan.urls) || plan.urls.length === 0 || plan.urls.length > 1000) {
    throw new Error(`invalid purge URL count: ${plan.urls?.length}`);
  }
  if (new Set(plan.urls).size !== plan.urls.length) throw new Error('duplicate purge URLs');
  if ([...plan.urls].sort().some((url, index) => url !== plan.urls[index])) throw new Error('purge URLs are not sorted');
  for (const value of plan.urls) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.andy-y.cn' || url.username || url.password || url.hash) {
      throw new Error(`purge URL is outside exact production host: ${value}`);
    }
  }
  const digest = sha256Hex(planDigestPayload(plan));
  if (digest !== plan.sha256) throw new Error('purge plan digest mismatch');
  return plan;
}

export function createPreheatPlan({ releaseId, urls, site = CDN_PURGE_SITE }) {
  if (!/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(releaseId ?? '')) {
    throw new Error(`invalid release id: ${releaseId}`);
  }
  if (!Array.isArray(urls) || urls.length === 0) throw new Error('preheat URL list is empty');
  const normalized = [...new Set(urls.map((value) => exactSiteUrl(value, site)))].sort();
  const plan = {
    schemaVersion: CDN_PREHEAT_SCHEMA_VERSION,
    releaseId,
    site,
    urls: normalized,
  };
  plan.sha256 = sha256Hex(preheatPlanDigestPayload(plan));
  return plan;
}

export function verifyPreheatPlan(plan, expectedReleaseId) {
  if (!plan || plan.schemaVersion !== CDN_PREHEAT_SCHEMA_VERSION) throw new Error('unsupported preheat plan schema');
  if (plan.releaseId !== expectedReleaseId) throw new Error('preheat plan release mismatch');
  if (plan.site !== CDN_PURGE_SITE) throw new Error(`unexpected preheat site: ${plan.site}`);
  if (!Array.isArray(plan.urls) || plan.urls.length === 0 || plan.urls.length > 1000) {
    throw new Error(`invalid preheat URL count: ${plan.urls?.length}`);
  }
  if (new Set(plan.urls).size !== plan.urls.length) throw new Error('duplicate preheat URLs');
  if ([...plan.urls].sort().some((url, index) => url !== plan.urls[index])) throw new Error('preheat URLs are not sorted');
  for (const value of plan.urls) {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'www.andy-y.cn'
      || url.username
      || url.password
      || url.hash
      || url.search
      || url.pathname === '/__release'
      || url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/admin/')
      || url.pathname.startsWith('/ui/')
    ) {
      throw new Error(`preheat URL is not a canonical public object: ${value}`);
    }
  }
  const digest = sha256Hex(preheatPlanDigestPayload(plan));
  if (digest !== plan.sha256) throw new Error('preheat plan digest mismatch');
  return plan;
}

export function chunk(values, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`invalid chunk size: ${size}`);
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function canonicalQuery(query) {
  return Object.entries(query)
    .flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]]))
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export function createAliyunV3SignedRequest({
  accessKeyId,
  accessKeySecret,
  endpoint,
  action,
  version,
  method = 'POST',
  query = {},
  body = '',
  contentType,
  date,
  nonce,
  securityToken,
}) {
  if (!accessKeyId || !accessKeySecret) throw new Error('Aliyun credentials missing');
  if (!/^[a-z0-9.-]+\.aliyuncs\.com$/i.test(endpoint ?? '')) throw new Error(`invalid Aliyun endpoint: ${endpoint}`);
  const payloadHash = sha256Hex(body);
  const headers = {
    host: endpoint,
    'x-acs-action': action,
    'x-acs-content-sha256': payloadHash,
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': version,
  };
  if (contentType) headers['content-type'] = contentType;
  if (securityToken) headers['x-acs-security-token'] = securityToken;

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, ' ')}`)
    .join('\n');
  const queryString = canonicalQuery(query);
  // Alibaba Cloud V3 terminates CanonicalHeaders with an extra newline before SignedHeaders.
  const canonicalRequest = [method.toUpperCase(), '/', queryString, canonicalHeaders, '', signedHeaders, payloadHash].join('\n');
  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = createHmac('sha256', accessKeySecret).update(stringToSign).digest('hex');
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

  return {
    url: `https://${endpoint}/${queryString ? `?${queryString}` : ''}`,
    method: method.toUpperCase(),
    headers,
    body,
    signature,
    canonicalRequest,
  };
}

export function createAliyunRefreshRequest({ urls, accessKeyId, accessKeySecret, date, nonce, securityToken }) {
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 1000) throw new Error('Aliyun batch must contain 1..1000 URLs');
  const body = `ObjectPath=${encodeRfc3986(urls.join('\n'))}&ObjectType=File`;
  return createAliyunV3SignedRequest({
    accessKeyId,
    accessKeySecret,
    endpoint: 'cdn.aliyuncs.com',
    action: 'RefreshObjectCaches',
    version: '2018-05-10',
    body,
    contentType: 'application/x-www-form-urlencoded',
    date,
    nonce,
    securityToken,
  });
}

export function createAliyunPreheatRequest({ urls, accessKeyId, accessKeySecret, date, nonce, securityToken }) {
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 100) throw new Error('Aliyun preheat batch must contain 1..100 URLs');
  const body = `ObjectPath=${encodeRfc3986(urls.join('\n'))}`;
  return createAliyunV3SignedRequest({
    accessKeyId,
    accessKeySecret,
    endpoint: 'cdn.aliyuncs.com',
    action: 'PushObjectCache',
    version: '2018-05-10',
    body,
    contentType: 'application/x-www-form-urlencoded',
    date,
    nonce,
    securityToken,
  });
}

export function createAliyunQuotaRequest({ accessKeyId, accessKeySecret, date, nonce, securityToken }) {
  return createAliyunV3SignedRequest({
    accessKeyId,
    accessKeySecret,
    endpoint: 'cdn.aliyuncs.com',
    action: 'DescribeRefreshQuota',
    version: '2018-05-10',
    date,
    nonce,
    securityToken,
  });
}

export function parseAliyunRefreshResponse(status, payload) {
  if (status < 200 || status >= 300 || !payload || typeof payload.RefreshTaskId !== 'string' || typeof payload.RequestId !== 'string') {
    throw new Error(`Aliyun purge rejected (HTTP ${status}, code=${String(payload?.Code ?? 'invalid-response')})`);
  }
  return { taskId: payload.RefreshTaskId, requestId: payload.RequestId };
}

export function parseAliyunPreheatResponse(status, payload) {
  if (status < 200 || status >= 300 || !payload || typeof payload.PushTaskId !== 'string' || typeof payload.RequestId !== 'string') {
    throw new Error(`Aliyun preheat rejected (HTTP ${status}, code=${String(payload?.Code ?? 'invalid-response')})`);
  }
  return { taskId: payload.PushTaskId, requestId: payload.RequestId };
}

export function parseAliyunQuotaResponse(status, payload) {
  const urlRemain = Number(payload?.UrlRemain);
  const preloadRemain = Number(payload?.PreloadRemain);
  if (
    status < 200
    || status >= 300
    || typeof payload?.RequestId !== 'string'
    || !Number.isInteger(urlRemain)
    || urlRemain < 0
    || !Number.isInteger(preloadRemain)
    || preloadRemain < 0
  ) {
    throw new Error(`Aliyun quota query rejected (HTTP ${status}, code=${String(payload?.Code ?? 'invalid-response')})`);
  }
  return { urlRemain, preloadRemain, requestId: payload.RequestId };
}

export function createCloudflarePurgeRequest({ zoneId, apiToken, urls }) {
  if (!/^[a-f0-9]{32}$/i.test(zoneId ?? '')) throw new Error('invalid Cloudflare zone id');
  if (!apiToken) throw new Error('Cloudflare API token missing');
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 100) throw new Error('Cloudflare batch must contain 1..100 URLs');
  return {
    url: `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ files: urls }),
  };
}

export function parseCloudflarePurgeResponse(status, payload) {
  if (status < 200 || status >= 300 || payload?.success !== true || typeof payload?.result?.id !== 'string') {
    const code = Array.isArray(payload?.errors) && payload.errors[0] ? payload.errors[0].code : 'invalid-response';
    throw new Error(`Cloudflare purge rejected (HTTP ${status}, code=${String(code)})`);
  }
  return { requestId: payload.result.id };
}
