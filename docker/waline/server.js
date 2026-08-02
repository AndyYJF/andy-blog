/**
 * Thin HTTP wrapper: enforce comment-policy.json then proxy to Waline.
 * WALINE_UPSTREAM defaults to 127.0.0.1:8361 (sidecar inside same container).
 *
 * Mutating methods are fail-closed:
 * - /api/comment and /api/comment/* → policy gate
 * - any other /api/* write → 403
 * Safe methods (GET/HEAD/OPTIONS) always proxy.
 */
import http from 'node:http';
import fs from 'node:fs';
import {
  authorizeCommentWrite,
  extractPathFromBody,
  loadPolicyFile,
  normalizeCommentPath,
} from './policy.js';
import { isApiPath, isCommentWritePath, isSafeMethod } from './server-path.js';

const listenPort = Number(process.env.PORT || 8360);
const upstream = process.env.WALINE_UPSTREAM || '127.0.0.1:8361';
const policyFile = process.env.COMMENT_POLICY_FILE || '/var/www/andy-y.cn/current/comment-policy.json';
const MAX_BODY = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function proxy(req, res, bodyBuf) {
  const [host, port] = upstream.split(':');
  const headers = { ...req.headers, host: upstream };
  delete headers['content-length'];
  if (bodyBuf) headers['content-length'] = String(bodyBuf.length);

  const preq = http.request(
    {
      host,
      port: Number(port) || 8361,
      path: req.url,
      method: req.method,
      headers,
    },
    (pres) => {
      res.writeHead(pres.statusCode || 502, {
        ...pres.headers,
        'cache-control': 'no-store',
      });
      pres.pipe(res);
    },
  );
  preq.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ errno: 502, errmsg: 'waline upstream unavailable' }));
  });
  if (bodyBuf) preq.write(bodyBuf);
  preq.end();
}

const server = http.createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://waline.local');
  const { pathname } = url;

  if (isSafeMethod(method)) {
    return proxy(req, res, null);
  }

  // Fail closed: mutating non-comment API paths never reach upstream.
  if (isApiPath(pathname) && !isCommentWritePath(pathname)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errno: 403, errmsg: 'api-write-denied' }));
    return;
  }

  if (!isCommentWritePath(pathname)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errno: 403, errmsg: 'write-denied' }));
    return;
  }

  let policy;
  try {
    policy = loadPolicyFile(fs, policyFile);
  } catch {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errno: 503, errmsg: 'comment policy unavailable' }));
    return;
  }

  let bodyBuf;
  try {
    bodyBuf = await readBody(req);
  } catch (err) {
    const status = err.status || 400;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errno: status, errmsg: err.message || 'bad body' }));
    return;
  }

  let bodyJson = null;
  try {
    bodyJson = bodyBuf.length ? JSON.parse(bodyBuf.toString('utf8')) : null;
  } catch {
    bodyJson = null;
  }

  const fromBody = extractPathFromBody(bodyJson);
  const fromQuery = normalizeCommentPath(url.searchParams.get('url') || url.searchParams.get('path'));
  const commentKey = fromBody || fromQuery;
  const decision = authorizeCommentWrite(policy, method, commentKey);
  if (!decision.ok) {
    res.writeHead(decision.status || 403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errno: 403, errmsg: decision.reason }));
    return;
  }
  return proxy(req, res, bodyBuf);
});

server.listen(listenPort, () => {
  console.error(`waline-policy listening on ${listenPort} -> ${upstream} policy=${policyFile}`);
});
