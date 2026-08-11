#!/usr/bin/env bash
# Durable exact-URL dual-CDN purge. The immutable release owns the URL plan;
# the source checkout owns the reviewed API client. Never purges a whole zone.
set -Eeuo pipefail
umask 077

RELEASE_ID="${1:?release id}"
WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
COMPOSE_DIR="${COMPOSE_DIR:?set absolute COMPOSE_DIR containing scripts/run-cdn-purge.js}"

[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
  echo "bad release id: $RELEASE_ID" >&2
  exit 64
}
[[ "$WWW_ROOT" == /* && "$STATE_DIR" == /* && "$COMPOSE_DIR" == /* ]] || {
  echo "WWW_ROOT, STATE_DIR, and COMPOSE_DIR must be absolute" >&2
  exit 64
}
RELEASE_DIR="$WWW_ROOT/releases/$RELEASE_ID"
test -f "$RELEASE_DIR/cdn-purge-plan.json"
test -f "$RELEASE_DIR/checksums.sha256"
test -f "$COMPOSE_DIR/scripts/run-cdn-purge.js"
[[ "$(basename "$(readlink -f "$WWW_ROOT/current")")" == "$RELEASE_ID" ]] || {
  echo "refusing to purge a non-current release" >&2
  exit 72
}
[[ -f "$STATE_DIR/edge-status" ]] || {
  echo "edge-status is missing" >&2
  exit 72
}
[[ "$(cat "$STATE_DIR/edge-status")" =~ ^(edge-pending|edge-purged)$ ]] || {
  echo "edge-status is not purgeable" >&2
  exit 72
}
(cd "$RELEASE_DIR" && sha256sum --check --status checksums.sha256) || {
  echo "release checksum verification failed" >&2
  exit 72
}

mkdir -p "$STATE_DIR/cdn-jobs"
chmod 0700 "$STATE_DIR/cdn-jobs"
exec 9>"$STATE_DIR/cdn-jobs/.lock"
flock -n 9 || {
  echo "another CDN purge is active" >&2
  exit 73
}

write_edge_status() {
  local value="$1"
  printf '%s\n' "$value" >"$STATE_DIR/edge-status.next"
  chmod --reference="$STATE_DIR/edge-status" "$STATE_DIR/edge-status.next"
  chown --reference="$STATE_DIR/edge-status" "$STATE_DIR/edge-status.next"
  mv -T "$STATE_DIR/edge-status.next" "$STATE_DIR/edge-status"
}

set +e
node "$COMPOSE_DIR/scripts/run-cdn-purge.js" --release-id "$RELEASE_ID"
PURGE_RC=$?
set -e
if [[ "$PURGE_RC" -ne 0 ]]; then
  write_edge_status 'edge-pending'
  exit "$PURGE_RC"
fi
write_edge_status 'edge-purged'
