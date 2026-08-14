import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePlaywrightBrowsersPath } from './ensure-playwright-browsers-path.js';

ensurePlaywrightBrowsersPath();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: run-with-playwright.mjs <command> [...args]');
  process.exit(2);
}

const [command, ...commandArgs] = args;
const astroCli = path.join(process.cwd(), 'node_modules', 'astro', 'bin', 'astro.mjs');
const useNodeAstro = command === 'astro' && fs.existsSync(astroCli);
const cmd = useNodeAstro ? process.execPath : command;
const argv = useNodeAstro ? [astroCli, ...commandArgs] : commandArgs;

const child = spawn(cmd, argv, {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
