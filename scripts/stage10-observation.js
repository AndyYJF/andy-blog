/**
 * Stage 10 read-only 302 observation collector.
 *
 * It connects to explicit origin/Aliyun/Cloudflare IPs with www.andy-y.cn as
 * both TLS SNI and Host, so three labels cannot silently resolve to one edge.
 * Only GET and HEAD are accepted. Evidence is written even when the matrix
 * fails, and a failed observation exits 2 (never authorizes a 301 change).
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const DOMAIN = 'www.andy-y.cn';
const USER_AGENT = 'andy-blog-stage10-observation/1.0';
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
    /<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"']*\/cloudflare-static\/email-decode\.min\.js"><\/script>/gi,
    '',
  );
  const marker = '/cdn-cgi/challenge-platform/scripts/jsd/main.js';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex !== -1) {
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
  const request = https.request({
    hostname: vantage.ip,
    port: 443,
    path: options.requestPath,
    method,
    servername: DOMAIN,
    headers,
    timeout: options.timeoutMs,
  }, (response) => {
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
  });
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

const runRequest = async (vantage, requestPath, method, config) => {
  try {
    return {response: await requestVantage(vantage, {
      requestPath,
      method,
      timeoutMs: config.timeoutMs,
      maxBytes: config.maxBytes,
    }), error:null};
  } catch (error) {
    return {response:null, error:error.message};
  }
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
  const ok = crossVantageFailures.length === 0 && Object.values(byVantage).every((item) =>
    item.releasePass && item.legacyPass === item.legacyTotal && item.terminalPass === item.terminalTotal && item.probePass === item.probeTotal);
  return {ok, byVantage, crossVantageFailures};
};

const sourceHead = () => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd:ROOT, encoding:'utf8'}).trim(); }
  catch { return null; }
};

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
  const crossVantageFailures = addCrossVantageChecks(vantageResults);
  const summary = summarize(vantageResults, crossVantageFailures);
  return {
    schemaVersion:1,
    tool:'scripts/stage10-observation.js',
    toolVersion:'1.0.0',
    sourceHead:sourceHead(),
    capturedAt:new Date().toISOString(),
    observationDate:config.observationDate,
    readOnlyMethods:[...ALLOWED_METHODS],
    expected:{domain:DOMAIN,releaseId:config.expectedRelease,redirectStatus:config.expectedRedirect,legacyEntries:legacyMap.length,uniqueTargets:targets.length},
    summary,
    vantages:vantageResults,
    hostChecks:'not-collected-by-public-read-only-collector',
    decision: summary.ok ? 'OBSERVATION_PASS_DOES_NOT_AUTHORIZE_301' : 'OBSERVATION_FAIL_301_PROHIBITED',
  };
}

const main = async () => {
  const observationDate = arg('--date', new Date().toISOString().slice(0,10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) throw new Error('--date must be YYYY-MM-DD');
  const expectedRelease = arg('--expected-release');
  if (!/^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(expectedRelease || '')) throw new Error('--expected-release is required');
  const vantages = [
    {name:'origin', ip:assertIPv4('--origin-ip', arg('--origin-ip')), expectedServer:'openresty'},
    {name:'aliyun', ip:assertIPv4('--aliyun-ip', arg('--aliyun-ip')), expectedServer:'tengine'},
    {name:'cloudflare', ip:assertIPv4('--cloudflare-ip', arg('--cloudflare-ip')), expectedServer:'cloudflare'},
  ];
  const outputPath = path.resolve(ROOT, arg('--output', `docs/baselines/reports/stage10-observation-${observationDate}.json`));
  const config = {
    observationDate,
    expectedRelease,
    expectedRedirect:Number(arg('--expected-redirect','302')),
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
  if (config.expectedRedirect !== 302) throw new Error('observation collector is locked to expected redirect 302');
  const evidence = await collect(config);
  fs.mkdirSync(path.dirname(outputPath), {recursive:true});
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence,null,2)}\n`, 'utf8');
  console.log(JSON.stringify({output:path.relative(ROOT,outputPath),capturedAt:evidence.capturedAt,decision:evidence.decision,summary:evidence.summary}));
  if (!evidence.summary.ok) process.exitCode = 2;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ok:false,error:error.message}));
    process.exitCode = 1;
  });
}
