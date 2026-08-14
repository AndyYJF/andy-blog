import fs from 'node:fs';
import path from 'node:path';

/**
 * Cursor agent shells point PLAYWRIGHT_BROWSERS_PATH at an empty
 * cursor-sandbox-cache. Mermaid needs the real Chromium under
 * %LOCALAPPDATA%\ms-playwright. Leave Docker/Linux paths alone.
 */
export function resolvePlaywrightBrowsersPath({
  platform = process.platform,
  current = process.env.PLAYWRIGHT_BROWSERS_PATH,
  localAppData = process.env.LOCALAPPDATA,
  exists = fs.existsSync,
} = {}) {
  const sandbox = /cursor-sandbox-cache/i.test(current || '');
  if (platform === 'win32' && (!current || sandbox)) {
    const real = path.join(localAppData || '', 'ms-playwright');
    if (exists(real)) return real;
  }
  return current || undefined;
}

export function ensurePlaywrightBrowsersPath(env = process.env) {
  const current = env.PLAYWRIGHT_BROWSERS_PATH;
  const resolved = resolvePlaywrightBrowsersPath({
    current,
    localAppData: env.LOCALAPPDATA,
  });
  if (resolved) env.PLAYWRIGHT_BROWSERS_PATH = resolved;
  if (resolved && resolved !== current) {
    console.error(`[playwright] browsers path: ${resolved}`);
  }
  return env.PLAYWRIGHT_BROWSERS_PATH;
}
