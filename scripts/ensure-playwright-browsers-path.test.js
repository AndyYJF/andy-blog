import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolvePlaywrightBrowsersPath } from './ensure-playwright-browsers-path.js';

test('replaces Cursor sandbox cache with the local ms-playwright install', () => {
  const resolved = resolvePlaywrightBrowsersPath({
    platform: 'win32',
    current: 'C:\\Users\\AndyYan\\AppData\\Local\\Temp\\cursor-sandbox-cache\\abc\\playwright',
    localAppData: 'C:\\Users\\AndyYan\\AppData\\Local',
    exists: () => true,
  });
  assert.equal(resolved, path.join('C:\\Users\\AndyYan\\AppData\\Local', 'ms-playwright'));
});

test('fills an unset Windows path when the local install exists', () => {
  const resolved = resolvePlaywrightBrowsersPath({
    platform: 'win32',
    current: undefined,
    localAppData: 'C:\\Users\\AndyYan\\AppData\\Local',
    exists: () => true,
  });
  assert.equal(resolved, path.join('C:\\Users\\AndyYan\\AppData\\Local', 'ms-playwright'));
});

test('leaves Docker and already-correct paths unchanged', () => {
  assert.equal(
    resolvePlaywrightBrowsersPath({
      platform: 'linux',
      current: '/ms-playwright',
      exists: () => true,
    }),
    '/ms-playwright',
  );
  assert.equal(
    resolvePlaywrightBrowsersPath({
      platform: 'win32',
      current: 'C:\\Users\\AndyYan\\AppData\\Local\\ms-playwright',
      localAppData: 'C:\\Users\\AndyYan\\AppData\\Local',
      exists: () => true,
    }),
    'C:\\Users\\AndyYan\\AppData\\Local\\ms-playwright',
  );
});
