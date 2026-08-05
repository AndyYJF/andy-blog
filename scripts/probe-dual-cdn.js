/**
 * Dual-CDN / dual-path read-only HTML hash probe (Stage 9).
 *
 * Compares decompressed body SHA-256 for the same paths via:
 *   - direct (no proxy) against DIRECT_BASE (default https://www.andy-y.cn)
 *   - via PROXY (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY or http://127.0.0.1:7892)
 *
 * Never fakes ok when a side fails. Unreachable proxy fails the run (exit 1).
 *
 * Usage:
 *   node scripts/probe-dual-cdn.js
 *   node scripts/probe-dual-cdn.js --paths /,/__release,/rss.xml
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { Agent, ProxyAgent, fetch } from 'undici';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

const DIRECT_BASE = (arg('--direct') || process.env.DIRECT_BASE || 'https://www.andy-y.cn').replace(/\/$/, '');
const PROXY_URL =
  process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || 'http://127.0.0.1:7892';
const paths = (arg('--paths') || '/,/__release,/rss.xml')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const gunzipIfNeeded = (buf, encoding) => {
  const enc = String(encoding || '').toLowerCase();
  if (enc.includes('gzip')) return zlib.gunzipSync(buf);
  if (enc.includes('br')) {
    try {
      return zlib.brotliDecompressSync(buf);
    } catch {
      return buf;
    }
  }
  return buf;
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const fetchSide = async (label, url, dispatcher) => {
  const res = await fetch(url, {
    dispatcher,
    headers: {
      'accept-encoding': 'gzip, deflate, br',
      'user-agent': 'andy-blog-dual-cdn-probe/1.0',
    },
    redirect: 'manual',
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const body = gunzipIfNeeded(raw, res.headers.get('content-encoding'));
  return {
    label,
    url,
    status: res.status,
    cacheStatus: res.headers.get('cf-cache-status') || res.headers.get('x-cache') || null,
    cacheControl: res.headers.get('cache-control'),
    server: res.headers.get('server'),
    sha256: sha256(body),
    bytes: body.length,
  };
};

const apiMustNotHit = async (base, dispatcher, label) => {
  const url = `${base}/api/comment?path=/posts/probe/`;
  const res = await fetch(url, {
    dispatcher,
    method: 'GET',
    headers: { 'user-agent': 'andy-blog-dual-cdn-probe/1.0' },
    redirect: 'manual',
  });
  const cache = (res.headers.get('cf-cache-status') || res.headers.get('x-cache') || '').toUpperCase();
  return { label, url, status: res.status, cacheStatus: cache || null, hit: cache.includes('HIT') };
};

async function main() {
  const results = {
    ok: true,
    directBase: DIRECT_BASE,
    proxyUrl: PROXY_URL,
    paths: [],
    api: [],
    failures: [],
  };

  const directAgent = new Agent();
  let proxyAgent = null;
  let proxyReachable = false;
  try {
    proxyAgent = new ProxyAgent(PROXY_URL);
    await fetch(`${DIRECT_BASE}/`, {
      dispatcher: proxyAgent,
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    proxyReachable = true;
  } catch (err) {
    results.failures.push(`proxy unreachable (${PROXY_URL}): ${err.cause?.message || err.message}`);
    results.ok = false;
  }

  for (const p of paths) {
    const pathPart = p.startsWith('/') ? p : `/${p}`;
    const url = `${DIRECT_BASE}${pathPart}`;
    let direct;
    try {
      direct = await fetchSide('direct', url, directAgent);
    } catch (err) {
      results.ok = false;
      results.failures.push(`direct fetch failed ${url}: ${err.message}`);
      continue;
    }

    let viaProxy = null;
    if (proxyReachable && proxyAgent) {
      try {
        viaProxy = await fetchSide('via-proxy', url, proxyAgent);
      } catch (err) {
        results.ok = false;
        results.failures.push(`proxy fetch failed ${url}: ${err.message}`);
      }
    }

    if (viaProxy && direct.sha256 !== viaProxy.sha256) {
      results.ok = false;
      results.failures.push(`hash mismatch ${pathPart}: direct=${direct.sha256} proxy=${viaProxy.sha256}`);
    }
    results.paths.push({ path: pathPart, direct, viaProxy });
  }

  try {
    const d = await apiMustNotHit(DIRECT_BASE, directAgent, 'direct');
    results.api.push(d);
    if (d.hit) {
      results.ok = false;
      results.failures.push(`API cache HIT on direct: ${d.cacheStatus}`);
    }
  } catch (err) {
    results.failures.push(`API direct probe failed: ${err.message}`);
    results.ok = false;
  }
  if (proxyReachable && proxyAgent) {
    try {
      const p = await apiMustNotHit(DIRECT_BASE, proxyAgent, 'via-proxy');
      results.api.push(p);
      if (p.hit) {
        results.ok = false;
        results.failures.push(`API cache HIT on proxy: ${p.cacheStatus}`);
      }
    } catch (err) {
      results.failures.push(`API proxy probe failed: ${err.message}`);
      results.ok = false;
    }
  }

  const outDir = path.join(ROOT, 'docs/baselines/reports');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stage9-dual-cdn-probe.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  if (!results.ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err) }));
  process.exit(1);
});
