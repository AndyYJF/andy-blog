/**
 * Serve astro/dist and assert Lighthouse budgets (Perf≥95, SEO 100, A11y≥95).
 * Uses the lighthouse package directly (more reliable than LHCI autorun on Windows).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'astro', 'dist');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('astro/dist missing — run npm run build first');
  process.exit(1);
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!filePath.startsWith(DIST) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

const findChrome = () => {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (base && fs.existsSync(base)) {
    const headless = fs
      .readdirSync(base)
      .filter((n) => n.startsWith('chromium_headless_shell'))
      .sort()
      .reverse();
    for (const ent of headless) {
      const exe = path.join(base, ent, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (fs.existsSync(exe)) return exe;
      const linux = path.join(base, ent, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(linux)) return linux;
    }
    const full = fs
      .readdirSync(base)
      .filter((n) => n.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const ent of full) {
      const win = path.join(base, ent, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(win)) return win;
      const linux = path.join(base, ent, 'chrome-linux', 'chrome');
      if (fs.existsSync(linux)) return linux;
    }
  }
  for (const p of [
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const port = await new Promise((resolve, reject) => {
  server.listen(0, '127.0.0.1', (err) => {
    if (err) reject(err);
    else resolve(server.address().port);
  });
});

const chromePath = findChrome();
if (!chromePath) {
  server.close();
  console.error('No Chrome/Chromium found (set CHROME_PATH or install Playwright browsers)');
  process.exit(1);
}

const urls = [`http://127.0.0.1:${port}/`, `http://127.0.0.1:${port}/posts/maibot-astrbot-napcat/`];

// Resolve lighthouse from @lhci/cli dependency tree or top-level.
let lighthouseMod;
const candidates = [
  path.join(ROOT, 'node_modules', 'lighthouse', 'core', 'index.js'),
  path.join(ROOT, 'node_modules', 'lighthouse', 'lighthouse-core', 'index.js'),
];
// Also search nested under @lhci
const nested = path.join(ROOT, 'node_modules');
if (fs.existsSync(nested)) {
  for (const name of fs.readdirSync(nested)) {
    if (name.startsWith('@')) continue;
  }
}
try {
  lighthouseMod = await import('lighthouse');
} catch {
  server.close();
  console.error('lighthouse package not resolvable — npm install @lhci/cli (pulls lighthouse)');
  process.exit(1);
}
const lighthouse = lighthouseMod.default || lighthouseMod;

const chromeLauncher = await import('chrome-launcher');
const launch = chromeLauncher.launch || chromeLauncher.default?.launch;
if (!launch) {
  server.close();
  console.error('chrome-launcher not available');
  process.exit(1);
}

const outDir = path.join(ROOT, 'docs/baselines/reports/lighthouse');
fs.mkdirSync(outDir, { recursive: true });

const scores = [];
let chrome;
let runError = null;
try {
  chrome = await launch({
    chromePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  for (const url of urls) {
    const result = await Promise.race([
      lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'seo', 'accessibility'],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${url}`)), 120000)),
    ]);
    const lhr = result.lhr;
    const row = {
      url,
      performance: lhr.categories.performance?.score,
      seo: lhr.categories.seo?.score,
      accessibility: lhr.categories.accessibility?.score,
    };
    scores.push(row);
    const safe = url.replace(/[^\w]+/g, '_').slice(0, 80);
    fs.writeFileSync(path.join(outDir, `${safe}.json`), JSON.stringify(lhr, null, 2));
  }
} catch (err) {
  runError = err;
} finally {
  if (chrome) {
    try {
      await chrome.kill();
    } catch {
      // Windows often EPERM on temp profile cleanup after kill — ignore.
    }
  }
  server.close();
}

if (runError) {
  console.error(String(runError));
  process.exit(1);
}

const failures = [];
for (const row of scores) {
  if ((row.performance ?? 0) < 0.95) failures.push(`${row.url} performance ${row.performance}`);
  if ((row.seo ?? 0) < 1) failures.push(`${row.url} seo ${row.seo}`);
  if ((row.accessibility ?? 0) < 0.95) failures.push(`${row.url} accessibility ${row.accessibility}`);
}

const summary = { ok: failures.length === 0, chromePath, scores, failures };
fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exit(1);
