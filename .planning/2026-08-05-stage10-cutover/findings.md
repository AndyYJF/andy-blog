# Stage 10 Findings

## 2026-08-09 comments admin registration failure

- Waline admin UI loaded from `comments.andy-y.cn`, but active `SERVER_URL=https://www.andy-y.cn` caused registration to POST to `https://www.andy-y.cn/api/user`.
- The public www wrapper correctly rejected that management endpoint with HTTP 403; opening `/api/user` on www would weaken the public comment boundary.
- The comments vhost already proxies both `/ui/` and `/api/` to the direct loopback Waline management upstream on `127.0.0.1:8362` behind HTTP Basic Auth.
- Minimal repair: rewrite only the admin UI response's public server URL to `https://comments.andy-y.cn`, leaving the container-wide `SERVER_URL`, public www API, Waline container, database, release, and 302 state unchanged.
