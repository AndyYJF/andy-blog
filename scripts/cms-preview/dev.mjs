#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = path.join(root, 'typecho/usr/plugins/AstroPreview/assets');
const posts = path.join(root, 'astro/src/content/posts');
const port = Number(process.env.PORT || 4177);

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts/cms-preview/build.mjs')], {
    stdio: 'inherit',
    cwd: root,
  });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
});

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  let file;
  if (url.pathname === '/' || url.pathname === '/debug.html') {
    file = path.join(root, 'scripts/cms-preview/debug.html');
  } else if (url.pathname.startsWith('/samples/')) {
    file = path.join(posts, path.basename(url.pathname));
  } else {
    file = path.join(assets, path.normalize(url.pathname).replace(/^[/\\]+/, ''));
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Astro preview debug http://127.0.0.1:${port}/?sample=omv-webui-400-bad-request`);
});
