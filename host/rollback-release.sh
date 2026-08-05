#!/usr/bin/env bash
# host/rollback-release.sh — swap current ↔ previous after a bad production switch.
# Plan §8.3: validate previous, atomic relative symlink swap, nginx -t/reload,
# sync redirect-status / comment-write-mode from the rolled-back manifest.
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
COMPOSE_DIR="${COMPOSE_DIR:-}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
SKIP_CDN="${SKIP_CDN:-0}"

test -L "$WWW_ROOT/previous" || {
  echo "previous symlink missing — nothing to roll back to" >&2
  exit 64
}
test -L "$WWW_ROOT/current" || {
  echo "current symlink missing" >&2
  exit 64
}

PREV_REL="$(readlink "$WWW_ROOT/previous")"
CUR_REL="$(readlink "$WWW_ROOT/current")"
PREV_ID="${PREV_REL#releases/}"
CUR_ID="${CUR_REL#releases/}"

[[ "$PREV_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
  echo "bad previous id: $PREV_ID" >&2
  exit 64
}
[[ "$CUR_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
  echo "bad current id: $CUR_ID" >&2
  exit 64
}
[[ "$PREV_ID" != "$CUR_ID" ]] || {
  echo "previous and current are the same release" >&2
  exit 64
}

PREV_DIR="$WWW_ROOT/releases/$PREV_ID"
REAL="$(realpath "$PREV_DIR")"
case "$REAL" in
  "$WWW_ROOT/releases/"*) ;;
  *) echo "previous path escaped releases/: $REAL" >&2; exit 65 ;;
esac
parent="$(dirname "$REAL")"
[[ "$parent" == "$(realpath "$WWW_ROOT/releases")" ]] || {
  echo "previous not direct child of releases/" >&2
  exit 65
}

test -f "$PREV_DIR/manifest.json"
test -f "$PREV_DIR/checksums.sha256"
test -f "$PREV_DIR/site/release-id.txt"
grep -qx "$PREV_ID" "$PREV_DIR/site/release-id.txt"

# Prefer verifying checksums when sha256sum is available.
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$PREV_DIR" && sha256sum -c checksums.sha256) >/dev/null
fi

# Atomic swap: new current = previous; new previous = former current (roll-forward target).
ln -sfn "releases/$PREV_ID" "$WWW_ROOT/current.next"
ln -sfn "releases/$CUR_ID" "$WWW_ROOT/previous.next"
mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"

reload_nginx() {
  if [[ -n "$COMPOSE_DIR" && -f "$COMPOSE_DIR/compose.yml" ]]; then
    (cd "$COMPOSE_DIR" && docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload)
    return
  fi
  # 1Panel OpenResty path: operator reloads outside this script when COMPOSE_DIR unset.
  echo "COMPOSE_DIR unset — skipped compose nginx reload (reload OpenResty manually if maps changed)" >&2
}

NEED_RELOAD=1
if diff -qr "$WWW_ROOT/releases/$CUR_ID/nginx" "$PREV_DIR/nginx" >/dev/null 2>&1; then
  NEED_RELOAD=0
fi
if [[ "$NEED_RELOAD" -eq 1 ]]; then
  reload_nginx
fi

ORIGIN_ID="$(curl -fsS --max-time 10 http://127.0.0.1/__release || true)"
if [[ "$ORIGIN_ID" != "$PREV_ID" ]]; then
  echo "origin /__release mismatch after rollback: got '$ORIGIN_ID' want '$PREV_ID'" >&2
  # Attempt to restore pre-rollback pointers.
  ln -sfn "releases/$CUR_ID" "$WWW_ROOT/current.next"
  ln -sfn "releases/$PREV_ID" "$WWW_ROOT/previous.next"
  mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
  mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"
  if [[ "$NEED_RELOAD" -eq 1 ]]; then
    reload_nginx || true
  fi
  exit 70
fi

# Sync deploy state from rolled-back release manifest (plan §8.3).
mkdir -p "$STATE_DIR"
node - "$PREV_DIR/manifest.json" "$STATE_DIR" <<'NODE'
const fs = require('fs');
const [,, manifestPath, stateDir] = process.argv;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const redirect = String(manifest.redirectStatus ?? 302);
const comment = String(manifest.commentWriteMode ?? 'disabled');
if (!['302', '301'].includes(redirect)) throw new Error(`bad redirectStatus: ${redirect}`);
if (!['disabled', 'enabled'].includes(comment)) throw new Error(`bad commentWriteMode: ${comment}`);
fs.writeFileSync(`${stateDir}/redirect-status`, `${redirect}\n`);
fs.writeFileSync(`${stateDir}/comment-write-mode`, `${comment}\n`);
if (manifest.releaseId) fs.writeFileSync(`${stateDir}/last-success-release`, `${manifest.releaseId}\n`);
console.log(`state synced redirect=${redirect} comment=${comment}`);
NODE

if [[ "$SKIP_CDN" != "1" && -n "$COMPOSE_DIR" && -x "$COMPOSE_DIR/host/cdn-purge.sh" ]]; then
  "$COMPOSE_DIR/host/cdn-purge.sh" "$PREV_ID" || {
    echo "edge-pending" >"$STATE_DIR/edge-status"
    echo "cdn purge failed after rollback — marked edge-pending" >&2
    exit 71
  }
  echo "ok" >"$STATE_DIR/edge-status"
fi

echo "rolled back current -> $PREV_ID (previous/roll-forward target=$CUR_ID)"
