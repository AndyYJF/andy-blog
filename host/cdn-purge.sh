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
  cat >"$JOB" <<EOF
{
  "releaseId": "$RELEASE_ID",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "paths": ["/", "/rss.xml", "/sitemap-index.xml", "/sitemap-0.xml", "/robots.txt", "/__release"],
  "aliyun": {"status": "pending"},
  "cloudflare": {"status": "pending"}
}
EOF
fi

# --- Aliyun CDN ---
if [[ -n "${ALIYUN_CDN_ACCESS_KEY_ID:-}" && -n "${ALIYUN_CDN_ACCESS_KEY_SECRET:-}" && -n "${ALIYUN_CDN_DOMAIN:-}" ]]; then
  # Placeholder until OpenAPI RefreshObjectCaches is wired. Never report success.
  echo "aliyun purge not-implemented for $RELEASE_ID (domain=$ALIYUN_CDN_DOMAIN)" >&2
  python3 - "$JOB" <<'PY'
import json, sys, datetime
p = sys.argv[1]
data = json.load(open(p))
data["aliyun"] = {
  "status": "not-implemented",
  "reason": "OpenAPI RefreshObjectCaches not wired",
  "at": datetime.datetime.utcnow().isoformat()+"Z",
}
json.dump(data, open(p, "w"), indent=2)
open(p, "a").write("\n")
PY
  echo "edge-pending: aliyun purge stub must not report ok" >&2
  exit 71
else
  echo "ALIYUN credentials missing — recording skipped" >&2
  python3 - "$JOB" <<'PY'
import json, sys
p = sys.argv[1]
data = json.load(open(p))
data["aliyun"] = {"status": "skipped", "reason": "missing credentials"}
json.dump(data, open(p, "w"), indent=2)
open(p, "a").write("\n")
PY
fi

# --- Cloudflare SaaS ---
if [[ -n "${CF_API_TOKEN:-}" && -n "${CF_ZONE_ID:-}" ]]; then
  echo "cloudflare purge not-implemented for $RELEASE_ID (zone=$CF_ZONE_ID)" >&2
  python3 - "$JOB" <<'PY'
import json, sys, datetime
p = sys.argv[1]
data = json.load(open(p))
data["cloudflare"] = {
  "status": "not-implemented",
  "reason": "Cloudflare purge API not wired",
  "at": datetime.datetime.utcnow().isoformat()+"Z",
}
json.dump(data, open(p, "w"), indent=2)
open(p, "a").write("\n")
PY
  echo "edge-pending: cloudflare purge stub must not report ok" >&2
  exit 71
else
  echo "CF credentials missing — recording skipped" >&2
  python3 - "$JOB" <<'PY'
import json, sys
p = sys.argv[1]
data = json.load(open(p))
data["cloudflare"] = {"status": "skipped", "reason": "missing credentials"}
json.dump(data, open(p, "w"), indent=2)
open(p, "a").write("\n")
PY
fi

echo "cdn purge job written: $JOB"
