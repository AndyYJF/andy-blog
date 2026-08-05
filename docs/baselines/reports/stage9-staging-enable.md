# Stage 9 — enable `new.andy-y.cn` staging (host runbook)

Do this only on the VPS after Stage 9 in-repo gates pass. Production `www` stays
on the current Typecho/static setup; this runbook does **not** cut DNS for www.

## Prerequisites

1. DNS `A`/`AAAA` for `new.andy-y.cn` → origin.
2. Digest-pinned images in `.env` (`NGINX_IMAGE`, …).
3. Independent Waline staging MySQL schema + `WALINE_STAGING_*` / `WALINE_STAGING_JWT`.
4. A built release under `$WWW_ROOT/releases/<id>` with `site/`, `nginx/staging-http.conf`,
   `comment-policy.staging.json`, and `candidate-*.conf`.

## Enable order (fail closed — stop on any step)

```bash
export WWW_ROOT=/var/www/andy-y.cn
export COMPOSE_DIR=/var/www/andy-blog
export CERTBOT_EMAIL=you@example.com

# 1. Certificate
sudo -E "$COMPOSE_DIR/host/cert-new-andy-y.sh"

# 2. Compose config (base + staging)
cd "$COMPOSE_DIR"
docker compose -f compose.yml config >/dev/null
docker compose -f compose.yml -f compose.staging.yml --profile staging config >/dev/null

# 3. Start staging Waline only (profile), keep production services as-is
docker compose -f compose.yml -f compose.staging.yml --profile staging up -d waline-staging

# 4. Point candidate at the release under test (relative symlink)
ln -sfn "releases/<release-id>" "$WWW_ROOT/candidate"

# 5. Isolated nginx -t against candidate-staging (must not include current/)
docker compose run --rm --no-deps nginx \
  nginx -t -c /var/www/andy-y.cn/candidate/nginx/candidate-staging-nginx.conf

# 6. Reload nginx with staging-loader (compose.staging.yml mounts 90-staging-loader.conf)
docker compose -f compose.yml -f compose.staging.yml --profile staging up -d nginx

# 7. Smoke
curl -fsS https://new.andy-y.cn/__release
curl -fsSI https://new.andy-y.cn/ | grep -i 'x-robots-tag'
# Comments on new must hit waline-staging only (never production schema)
```

Any failure: remove `90-staging-loader` by bringing nginx back with base compose only,
tear down `waline-staging`, leave `candidate` unset or pointed at a known-good release.

## Teardown after acceptance

```bash
docker compose -f compose.yml up -d nginx   # drop staging-loader mount
docker compose -f compose.yml --profile staging stop waline-staging
# Archive or drop waline_staging schema — never merge into production
```
