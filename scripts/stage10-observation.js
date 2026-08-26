/**
 * Stage 10 read-only 302 observation collector.
 *
 * It connects to explicit origin/Aliyun/Cloudflare IPs with www.andy-y.cn as
 * both TLS SNI and Host, so three labels cannot silently resolve to one edge.
 * Cloudflare may CONNECT through an HTTP proxy to a distinct hostname
 * (cname.517963.xyz) while keeping SNI+Host as www.andy-y.cn.
 * Only GET and HEAD are accepted. Evidence is written even when the matrix
 * fails, and a failed observation exits 2 (never authorizes a 301 change).
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const DOMAIN = 'www.andy-y.cn';
const USER_AGENT = 'andy-blog-stage10-observation/1.0';
const REQUIRED_VANTAGE_NAMES = ['origin', 'aliyun', 'cloudflare'];
const SELECTED_HEADERS = [
  'location',
  'server',
  'date',
  'cf-ray',
  'cf-cache-status',
  'x-cache',
  'age',
  'cache-control',
  'content-type',
  'content-length',
  'etag',
  'last-modified',
  'via',
];

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const integerArg = (name, fallback) => {
  const value = Number(arg(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

const assertIPv4 = (label, value) => {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value || '')) throw new Error(`${label} must be an explicit IPv4 address`);
  const octets = value.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) throw new Error(`${label} is invalid`);
  return value;
};

const selectedHeaders = (headers) => Object.fromEntries(
  SELECTED_HEADERS.map((name) => [name, headers[name]]).filter(([, value]) => value != null),
);

const sha256 = (body) => crypto.createHash('sha256').update(body).digest('hex');

const decodeCfEmail = (encoded) => {
  if (!/^[0-9a-f]+$/i.test(encoded) || encoded.length < 4 || encoded.length % 2 !== 0) return null;
  const key = Number.parseInt(encoded.slice(0, 2), 16);
  let decoded = '';
  for (let index = 2; index < encoded.length; index += 2) decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16) ^ key);
  return decoded;
};

export const normalizeBodyForHash = (body, contentType = '') => {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (!String(contentType).toLowerCase().includes('text/html')) return source;
  const text = source.toString('utf8');
  let normalized = text.replace(
    /<a href="\/cdn-cgi\/l\/email-protection#[0-9a-f]+"><span class="__cf_email__" data-cfemail="([0-9a-f]+)">[\s\S]*?<\/span><\/a>/gi,
    (match, encoded) => {
      const decoded = decodeCfEmail(encoded);
      return decoded == null ? match : `<a href="mailto:${decoded}">${decoded}</a>`;
    },
  );
  normalized = normalized.replace(
    /<a href="\/cdn-cgi\/l\/email-protection" class="__cf_email__" data-cfemail="([0-9a-f]+)">[\s\S]*?<\/a>/gi,
    (match, encoded) => decodeCfEmail(encoded) ?? match,
  );
  normalized = normalized.replace(
    /<a\b([^>]*?)href="\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"([^>]*)>([\s\S]*?)<\/a>/gi,
    (match, before, encoded, after, inner) => {
      const decoded = decodeCfEmail(encoded);
      return decoded == null ? match : `<a${before}href="mailto:${decoded}"${after}>${inner}</a>`;
    },
  );
  normalized = normalized.replace(
    /<span class="__cf_email__" data-cfemail="([0-9a-f]+)">[\s\S]*?<\/span>/gi,
    (match, encoded) => decodeCfEmail(encoded) ?? match,
  );
  normalized = normalized.replace(
    /<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"']*\/cloudflare-static\/email-decode\.min\.js"><\/script>/gi,
    '',
  );
  const marker = 'cdn-cgi/challenge-platform';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex !== -1 && normalized.includes('jsd/main.js')) {
    const start = normalized.lastIndexOf('<script>', markerIndex);
    const end = normalized.indexOf('</script>', markerIndex);
    if (start !== -1 && end !== -1 && normalized.slice(end + 9).trimStart().startsWith('</body>')) {
      normalized = `${normalized.slice(0, start)}${normalized.slice(end + 9)}`;
    }
  }
  return Buffer.from(normalized, 'utf8');
};

export const requestPathForEntry = (entry) => {
  if (entry.oldPath) return entry.oldPath;
  if (!entry.queryKey) throw new Error('legacy entry has neither oldPath nor queryKey');
  const separator = entry.queryKey.lastIndexOf(':');
  if (separator <= 0 || separator === entry.queryKey.length - 1) throw new Error(`invalid queryKey ${entry.queryKey}`);
  const base = entry.queryKey.slice(0, separator);
  const cid = entry.queryKey.slice(separator + 1);
  if (!/^\d+$/.test(cid) || !base.startsWith('/')) throw new Error(`invalid queryKey ${entry.queryKey}`);
  return `${base}?p=${cid}`;
};

export const absoluteUrl = (requestPath) => new URL(requestPath, `https://${DOMAIN}`).href;

export const sameUrl = (left, right) => {
  try {
    return new URL(left, `https://${DOMAIN}`).href === new URL(right, `https://${DOMAIN}`).href;
  } catch {
    return false;
  }
};

export const extractCanonical = (html) => {
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (!rel.split(/\s+/).some((value) => value.toLowerCase() === 'canonical')) continue;
    return (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '').replaceAll('&amp;', '&') || null;
  }
  return null;
};

const finishResponse = (vantage, options, response, resolve) => {
  const chunks = [];
  let bytes = 0;
  response.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes <= options.maxBytes) chunks.push(chunk);
  });
  response.once('end', () => {
    const body = Buffer.concat(chunks);
    const server = String(response.headers.server || '').toLowerCase();
    resolve({
      status: response.statusCode,
      headers: selectedHeaders(response.headers),
      body,
      bytes,
      truncated: bytes > options.maxBytes,
      bodySha256: sha256(body),
      serverIdentityOk: server.includes(vantage.expectedServer.toLowerCase()),
    });
  });
};

const connectThroughHttpProxy = (proxyUrl, connectHost, port, timeoutMs) => new Promise((resolve, reject) => {
  const proxy = new URL(proxyUrl);
  if (proxy.protocol !== 'http:') {
    reject(new Error('vantage proxy must be http://'));
    return;
  }
  const request = http.request({
    host: proxy.hostname,
    port: Number(proxy.port) || 80,
    method: 'CONNECT',
    path: `${connectHost}:${port}`,
    timeout: timeoutMs,
  });
  request.once('connect', (response, socket) => {
    if (response.statusCode !== 200) {
      socket.destroy();
      reject(new Error(`proxy CONNECT ${response.statusCode}`));
      return;
    }
    resolve(socket);
  });
  request.once('timeout', () => request.destroy(new Error(`proxy timeout after ${timeoutMs}ms`)));
  request.once('error', reject);
  request.end();
});

export const requestVantage = (vantage, options) => new Promise((resolve, reject) => {
  const method = String(options.method || 'HEAD').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    reject(new Error(`read-only collector rejects method ${method}`));
    return;
  }
  const headers = {
    Host: DOMAIN,
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'identity',
    Connection: 'close',
  };
  if (method === 'GET') headers.Accept = '*/*';
  const port = Number(vantage.port || 443);
  const connectHost = vantage.connectHost || vantage.ip;
  const requestOptions = {
    hostname: vantage.proxyUrl ? DOMAIN : vantage.ip,
    port,
    path: options.requestPath,
    method,
    servername: DOMAIN,
    headers,
    timeout: options.timeoutMs,
  };
  if (vantage.proxyUrl) {
    requestOptions.createConnection = (_opts, callback) => {
      connectThroughHttpProxy(vantage.proxyUrl, connectHost, port, options.timeoutMs)
        .then((socket) => {
          const tlsSocket = tls.connect({
            socket,
            servername: DOMAIN,
            ALPNProtocols: ['http/1.1'],
            timeout: options.timeoutMs,
          }, () => callback(null, tlsSocket));
          tlsSocket.once('error', (error) => callback(error));
        })
        .catch((error) => callback(error));
    };
  }
  const request = https.request(requestOptions, (response) => finishResponse(vantage, options, response, resolve));
  request.once('timeout', () => request.destroy(new Error(`timeout after ${options.timeoutMs}ms`)));
  request.once('error', reject);
  request.end();
});

const publicResponse = (response) => ({
  status: response.status,
  headers: response.headers,
  bytes: response.bytes,
  truncated: response.truncated,
  bodySha256: response.bodySha256,
  serverIdentityOk: response.serverIdentityOk,
});

export const evaluateRedirect = (response, expectedStatus, expectedLocation) => {
  const reasons = [];
  if (!response) reasons.push('request-failed');
  if (response && response.status !== expectedStatus) reasons.push(`status:${response.status}!=${expectedStatus}`);
  if (response && !sameUrl(response.headers.location, expectedLocation)) reasons.push(`location:${response.headers.location || 'missing'}!=${expectedLocation}`);
  if (response && !response.serverIdentityOk) reasons.push('server-identity-mismatch');
  return {pass: reasons.length === 0, reasons};
};

const mapLimit = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runRequest = async (vantage, requestPath, method, config) => {
  const attempts = vantage.proxyUrl ? 3 : 1;
  let last = {response:null, error:'no-attempt'};
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return {response: await requestVantage(vantage, {
        requestPath,
        method,
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxBytes,
      }), error:null};
    } catch (error) {
      last = {response:null, error:error.message};
      if (attempt + 1 < attempts) await sleep(300 * (attempt + 1));
    }
  }
  return last;
};

const observeVantage = async (vantage, legacyMap, targets, config) => {
  const releaseRaw = await runRequest(vantage, '/__release', 'GET', config);
  const releaseText = releaseRaw.response?.body.toString('utf8').trim() || null;
  const release = {
    ...publicResponse(releaseRaw.response || {headers:{}}),
    releaseId: releaseText,
    error: releaseRaw.error,
    pass: releaseRaw.response?.status === 200 && releaseText === config.expectedRelease && releaseRaw.response.serverIdentityOk,
  };

  const terminalRows = await mapLimit(targets, config.concurrency, async (target) => {
    const raw = await runRequest(vantage, target.targetPath, 'GET', config);
    const contentType = raw.response?.headers['content-type'] || '';
    const bodyText = raw.response?.body.toString('utf8') || '';
    const isHtml = contentType.toLowerCase().includes('text/html');
    const canonical = isHtml ? extractCanonical(bodyText) : null;
    const reasons = [];
    if (!raw.response) reasons.push(`request-failed:${raw.error}`);
    if (raw.response && raw.response.status !== target.expectedTerminalStatus) reasons.push(`status:${raw.response.status}!=${target.expectedTerminalStatus}`);
    if (raw.response && !raw.response.serverIdentityOk) reasons.push('server-identity-mismatch');
    if (raw.response?.truncated) reasons.push('body-truncated');
    if (raw.response && isHtml && !sameUrl(canonical, absoluteUrl(target.targetPath))) reasons.push(`canonical:${canonical || 'missing'}!=${absoluteUrl(target.targetPath)}`);
    if (raw.response && target.targetPath.endsWith('.xml') && (!bodyText.includes('<rss') || !bodyText.includes(`https://${DOMAIN}/`))) reasons.push('xml-content-invalid');
    const observed = raw.response ? publicResponse(raw.response) : null;
    if (raw.response) observed.normalizedBodySha256 = sha256(normalizeBodyForHash(raw.response.body, contentType));
    return {
      targetPath: target.targetPath,
      expectedStatus: target.expectedTerminalStatus,
      expectedCanonical: isHtml ? absoluteUrl(target.targetPath) : null,
      contentKind: isHtml ? 'html' : target.targetPath.endsWith('.xml') ? 'xml' : 'other',
      observed,
      canonical,
      error: raw.error,
      pass: reasons.length === 0,
      reasons,
    };
  });
  const terminalByPath = new Map(terminalRows.map((row) => [row.targetPath, row]));

  const legacyRows = await mapLimit(legacyMap, config.concurrency, async (entry) => {
    const requestPath = requestPathForEntry(entry);
    const expectedLocation = absoluteUrl(entry.targetPath);
    const raw = await runRequest(vantage, requestPath, 'HEAD', config);
    const redirect = evaluateRedirect(raw.response, config.expectedRedirect, expectedLocation);
    if (raw.error) redirect.reasons.push(`request-error:${raw.error}`);
    const terminal = terminalByPath.get(entry.targetPath);
    if (!terminal?.pass) redirect.reasons.push(`terminal-failed:${entry.targetPath}`);
    return {
      oldPath: entry.oldPath,
      queryKey: entry.queryKey,
      requestPath,
      action: entry.action,
      targetPath: entry.targetPath,
      expectedStatus: config.expectedRedirect,
      expectedLocation,
      observed: raw.response ? publicResponse(raw.response) : null,
      error: raw.error,
      terminalPath: entry.targetPath,
      pass: redirect.reasons.length === 0,
      reasons: redirect.reasons,
    };
  });

  const probes = await mapLimit(config.probes, Math.min(config.concurrency, config.probes.length), async (probe) => {
    const raw = await runRequest(vantage, probe.path, probe.method, config);
    const reasons = [];
    if (!raw.response) reasons.push(`request-failed:${raw.error}`);
    if (raw.response && raw.response.status !== probe.expectedStatus) reasons.push(`status:${raw.response.status}!=${probe.expectedStatus}`);
    if (raw.response && !raw.response.serverIdentityOk) reasons.push('server-identity-mismatch');
    return {
      ...probe,
      observed: raw.response ? publicResponse(raw.response) : null,
      error: raw.error,
      pass: reasons.length === 0,
      reasons,
    };
  });

  return {
    name: vantage.name,
    ip: vantage.ip,
    expectedServer: vantage.expectedServer,
    release,
    terminals: terminalRows,
    legacy: legacyRows,
    probes,
  };
};

const addCrossVantageChecks = (vantages) => {
  const failures = [];
  const names = vantages.map((item) => item.name);
  const ips = vantages.map((item) => item.ip);
  if (names.slice().sort().join(',') !== REQUIRED_VANTAGE_NAMES.slice().sort().join(',')) {
    failures.push('vantages must be origin, aliyun, and cloudflare');
  }
  if (new Set(names).size !== names.length) failures.push('vantage names are not unique');
  if (new Set(ips).size !== ips.length) failures.push('vantage IPs are not unique');

  const terminalPaths = vantages[0]?.terminals.map((row) => row.targetPath) || [];
  for (const targetPath of terminalPaths) {
    const rows = vantages.map((vantage) => vantage.terminals.find((row) => row.targetPath === targetPath));
    if (rows.every((row) => row?.pass) && new Set(rows.map((row) => row.observed.normalizedBodySha256)).size !== 1) {
      failures.push(`terminal hash mismatch ${targetPath}`);
      for (const row of rows) {
        row.pass = false;
        row.reasons.push('cross-vantage-hash-mismatch');
      }
    }
  }
  return failures;
};

const summarize = (vantages, crossVantageFailures) => {
  const byVantage = Object.fromEntries(vantages.map((vantage) => {
    const legacyPass = vantage.legacy.filter((row) => row.pass).length;
    const terminalPass = vantage.terminals.filter((row) => row.pass).length;
    const probePass = vantage.probes.filter((row) => row.pass).length;
    return [vantage.name, {
      releasePass: vantage.release.pass,
      legacyPass,
      legacyTotal: vantage.legacy.length,
      terminalPass,
      terminalTotal: vantage.terminals.length,
      probePass,
      probeTotal: vantage.probes.length,
    }];
  }));
  const completeSet = namesAreRequiredSet(vantages);
  const ok = completeSet && crossVantageFailures.length === 0 && Object.values(byVantage).every((item) =>
    item.releasePass && item.legacyPass === item.legacyTotal && item.terminalPass === item.terminalTotal && item.probePass === item.probeTotal);
  return {ok, completeSet, byVantage, crossVantageFailures};
};

const namesAreRequiredSet = (vantages) =>
  vantages.length === REQUIRED_VANTAGE_NAMES.length
  && REQUIRED_VANTAGE_NAMES.every((name) => vantages.some((item) => item.name === name));

const decisionFor = (summary) => {
  if (!summary.completeSet) return 'OBSERVATION_PARTIAL_301_PROHIBITED';
  return summary.ok ? 'OBSERVATION_PASS_DOES_NOT_AUTHORIZE_301' : 'OBSERVATION_FAIL_301_PROHIBITED';
};

const sourceHead = () => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd:ROOT, encoding:'utf8'}).trim(); }
  catch { return null; }
};

const assembleEvidence = (config, vantageResults, extra = {}) => {
  const crossVantageFailures = addCrossVantageChecks(vantageResults);
  const summary = summarize(vantageResults, crossVantageFailures);
  return {
    schemaVersion:1,
    tool:'scripts/stage10-observation.js',
    toolVersion:'1.1.0',
    sourceHead:sourceHead(),
    capturedAt:new Date().toISOString(),
    observationDate:config.observationDate,
    readOnlyMethods:[...ALLOWED_METHODS],
    expected:{domain:DOMAIN,releaseId:config.expectedRelease,redirectStatus:config.expectedRedirect,legacyEntries:config.legacyEntries,uniqueTargets:config.uniqueTargets},
    summary,
    vantages:vantageResults,
    hostChecks:'not-collected-by-public-read-only-collector',
    decision: decisionFor(summary),
    ...extra,
  };
};

export function mergeObservationParts(parts, config) {
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('merge requires observation parts');
  const byName = new Map();
  for (const part of parts) {
    if (!Array.isArray(part.vantages) || part.vantages.length !== 1) {
      throw new Error('each merge input must contain exactly one vantage');
    }
    const vantage = part.vantages[0];
    if (byName.has(vantage.name)) throw new Error(`duplicate vantage ${vantage.name}`);
    byName.set(vantage.name, vantage);
  }
  const vantageResults = REQUIRED_VANTAGE_NAMES.map((name) => {
    const vantage = byName.get(name);
    if (!vantage) throw new Error(`missing vantage ${name}`);
    return vantage;
  });
  return assembleEvidence(config, vantageResults, {mergedFrom: parts.map((part) => part.capturedAt)});
}

export async function collect(config) {
  const legacyMap = JSON.parse(fs.readFileSync(config.mapPath, 'utf8'));
  if (!Array.isArray(legacyMap) || legacyMap.length === 0) throw new Error('legacy map must be a non-empty array');
  if (legacyMap.some((entry) => entry.action !== 'redirect')) throw new Error('collector currently requires every legacy action to be redirect');
  legacyMap.forEach(requestPathForEntry);
  const targetMap = new Map();
  for (const entry of legacyMap) {
    const existing = targetMap.get(entry.targetPath);
    if (existing && existing.expectedTerminalStatus !== entry.expectedTerminalStatus) throw new Error(`terminal status conflict ${entry.targetPath}`);
    targetMap.set(entry.targetPath, {targetPath:entry.targetPath, expectedTerminalStatus:entry.expectedTerminalStatus});
  }
  const targets = [...targetMap.values()].sort((a,b) => a.targetPath.localeCompare(b.targetPath));
  const vantageResults = [];
  for (const vantage of config.vantages) vantageResults.push(await observeVantage(vantage, legacyMap, targets, config));
  return assembleEvidence({
    observationDate: config.observationDate,
    expectedRelease: config.expectedRelease,
    expectedRedirect: config.expectedRedirect,
    legacyEntries: legacyMap.length,
    uniqueTargets: targets.length,
  }, vantageResults);
}

const vantageSpec = (name, expectedServer) => {
  const ip = arg(`--${name}-ip`);
  const only = arg('--only-vantage');
  if (only && only !== name) return null;
  if (!ip) throw new Error(`--${name}-ip is required`);
  const vantage = {name, ip: assertIPv4(`--${name}-ip`, ip), expectedServer};
  const port = arg(`--${name}-port`);
  if (port) vantage.port = integerArg(`--${name}-port`, Number(port));
  const connectHost = arg(`--${name}-connect-host`);
  if (connectHost) vantage.connectHost = connectHost;
  const proxyUrl = arg(`--${name}-proxy`);
  if (proxyUrl) vantage.proxyUrl = proxyUrl;
  return vantage;
};

const writeEvidence = (outputPath, evidence) => {
  fs.mkdirSync(path.dirname(outputPath), {recursive:true});
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence,null,2)}\n`, 'utf8');
  console.log(JSON.stringify({output:path.relative(ROOT,outputPath),capturedAt:evidence.capturedAt,decision:evidence.decision,summary:evidence.summary}));
  if (!evidence.summary.ok) process.exitCode = 2;
};

const main = async () => {
  const observationDate = arg('--date', new Date().toISOString().slice(0,10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) throw new Error('--date must be YYYY-MM-DD');
  const expectedRelease = arg('--expected-release');
  if (!/^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(expectedRelease || '')) throw new Error('--expected-release is required');
  const expectedRedirect = Number(arg('--expected-redirect','302'));
  if (expectedRedirect !== 302 && expectedRedirect !== 301) {
    throw new Error('observation collector expected redirect must be 302 or 301');
  }
  const outputPath = path.resolve(ROOT, arg('--output', `docs/baselines/reports/stage10-observation-${observationDate}.json`));
  const mergeArg = arg('--merge');
  if (mergeArg) {
    const parts = mergeArg.split(',').map((item) => JSON.parse(fs.readFileSync(path.resolve(ROOT, item.trim()), 'utf8')));
    const evidence = mergeObservationParts(parts, {
      observationDate,
      expectedRelease,
      expectedRedirect,
      legacyEntries: parts[0]?.expected?.legacyEntries,
      uniqueTargets: parts[0]?.expected?.uniqueTargets,
    });
    writeEvidence(outputPath, evidence);
    return;
  }
  const only = arg('--only-vantage');
  if (only && !REQUIRED_VANTAGE_NAMES.includes(only)) throw new Error('--only-vantage must be origin, aliyun, or cloudflare');
  const vantages = [
    vantageSpec('origin', 'openresty'),
    vantageSpec('aliyun', 'tengine'),
    vantageSpec('cloudflare', 'cloudflare'),
  ].filter(Boolean);
  const config = {
    observationDate,
    expectedRelease,
    expectedRedirect,
    mapPath:path.resolve(ROOT, arg('--map','data/legacy-url-map.json')),
    outputPath,
    vantages,
    concurrency:integerArg('--concurrency',8),
    timeoutMs:integerArg('--timeout-ms',10000),
    maxBytes:integerArg('--max-bytes',4*1024*1024),
    probes:[
      {path:'/admin/',method:'HEAD',expectedStatus:404},
      {path:'/admin/index.php',method:'HEAD',expectedStatus:404},
      {path:'/index.php/action/login',method:'HEAD',expectedStatus:404},
      {path:'/phpinfo.php',method:'HEAD',expectedStatus:404},
      {path:'/rss.xml',method:'GET',expectedStatus:200},
      {path:'/sitemap-index.xml',method:'GET',expectedStatus:200},
    ],
  };
  const evidence = await collect(config);
  writeEvidence(outputPath, evidence);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ok:false,error:error.message}));
    process.exitCode = 1;
  });
}
