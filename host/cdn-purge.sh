#!/usr/bin/env bash
# host/cdn-purge.sh — durable dual-CDN purge after origin is healthy.
# Credentials come from env / secret files; never from webhook payloads.
set -Eeuo pipefail

RELEASE_ID="${1:?release id}"
WWW_ROOT="${WWW_ROOT:?}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
JOB_DIR="$STATE_DIR/cdn-jobs"
mkdir -p "$JOB_DIR"

JOB="$JOB_DIR/${RELEASE_ID}.json"
if [[ ! -f "$JOB" ]]; then
  # Purge HTML/XML/redirect surfaces only — hashed /_astro/* is immutable.
  node - "$JOB" "$RELEASE_ID" <<'NODE'
const fs = require('fs');
const [,, job, releaseId] = process.argv;
const doc = {
  releaseId,
  createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  paths: ['/', '/rss.xml', '/sitemap-index.xml', '/sitemap-0.xml', '/robots.txt', '/__release'],
  aliyun: { status: 'pending' },
  cloudflare: { status: 'pending' },
};
fs.writeFileSync(job, `${JSON.stringify(doc, null, 2)}\n`);
NODE
fi

patch_job() {
  local provider="$1"
  local status="$2"
  local reason="$3"
  node - "$JOB" "$provider" "$status" "$reason" <<'NODE'
const fs = require('fs');
const [,, job, provider, status, reason] = process.argv;
const data = JSON.parse(fs.readFileSync(job, 'utf8'));
data[provider] = {
  status,
  reason,
  at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
};
fs.writeFileSync(job, `${JSON.stringify(data, null, 2)}\n`);
NODE
}

# --- Aliyun CDN ---
if [[ -n "${ALIYUN_CDN_ACCESS_KEY_ID:-}" && -n "${ALIYUN_CDN_ACCESS_KEY_SECRET:-}" && -n "${ALIYUN_CDN_DOMAIN:-}" ]]; then
  # Placeholder until OpenAPI RefreshObjectCaches is wired. Never report success.
  echo "aliyun purge not-implemented for $RELEASE_ID (domain=$ALIYUN_CDN_DOMAIN)" >&2
  patch_job aliyun not-implemented "OpenAPI RefreshObjectCaches not wired"
  echo "edge-pending: aliyun purge stub must not report ok" >&2
  exit 71
else
  echo "ALIYUN credentials missing — recording skipped" >&2
  patch_job aliyun skipped "missing credentials"
fi

# --- Cloudflare SaaS ---
if [[ -n "${CF_API_TOKEN:-}" && -n "${CF_ZONE_ID:-}" ]]; then
  echo "cloudflare purge not-implemented for $RELEASE_ID (zone=$CF_ZONE_ID)" >&2
  patch_job cloudflare not-implemented "Cloudflare purge API not wired"
  echo "edge-pending: cloudflare purge stub must not report ok" >&2
  exit 71
else
  echo "CF credentials missing — recording skipped" >&2
  patch_job cloudflare skipped "missing credentials"
fi

echo "cdn purge job written: $JOB"
