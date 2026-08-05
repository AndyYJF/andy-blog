#!/usr/bin/env bash
# host/roll-forward-release.sh — undo a rollback by switching back to previous.
# After rollback-release.sh, previous points at the release that was rolled away.
# This script promotes that release to current again (one-click roll-forward).
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
COMPOSE_DIR="${COMPOSE_DIR:-}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
SKIP_CDN="${SKIP_CDN:-0}"

test -L "$WWW_ROOT/previous" || {
  echo "previous symlink missing — nothing to roll forward to" >&2
  exit 64
}

TARGET_REL="$(readlink "$WWW_ROOT/previous")"
TARGET_ID="${TARGET_REL#releases/}"
[[ "$TARGET_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
  echo "bad roll-forward id: $TARGET_ID" >&2
  exit 64
}

# Reuse switch-release when compose nginx path is available.
if [[ -n "$COMPOSE_DIR" && -x "$COMPOSE_DIR/host/switch-release.sh" ]]; then
  export WWW_ROOT
  "$COMPOSE_DIR/host/switch-release.sh" "$TARGET_ID"
else
  # 1Panel / host-only: atomic symlink swap without compose nginx.
  CUR_REL="$(readlink "$WWW_ROOT/current")"
  CUR_ID="${CUR_REL#releases/}"
  TARGET_DIR="$WWW_ROOT/releases/$TARGET_ID"
  test -f "$TARGET_DIR/manifest.json"
  test -f "$TARGET_DIR/site/release-id.txt"
  grep -qx "$TARGET_ID" "$TARGET_DIR/site/release-id.txt"

  ln -sfn "releases/$TARGET_ID" "$WWW_ROOT/current.next"
  ln -sfn "releases/$CUR_ID" "$WWW_ROOT/previous.next"
  mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
  mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"

  ORIGIN_ID="$(curl -fsS --max-time 10 http://127.0.0.1/__release || true)"
  if [[ "$ORIGIN_ID" != "$TARGET_ID" ]]; then
    echo "origin /__release mismatch after roll-forward: got '$ORIGIN_ID' want '$TARGET_ID'" >&2
    ln -sfn "releases/$CUR_ID" "$WWW_ROOT/current.next"
    ln -sfn "releases/$TARGET_ID" "$WWW_ROOT/previous.next"
    mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
    mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"
    exit 70
  fi
  echo "rolled forward current -> $TARGET_ID (compose switch unavailable; reload OpenResty if needed)" >&2
fi

mkdir -p "$STATE_DIR"
node - "$WWW_ROOT/releases/$TARGET_ID/manifest.json" "$STATE_DIR" <<'NODE'
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
  "$COMPOSE_DIR/host/cdn-purge.sh" "$TARGET_ID" || {
    echo "edge-pending" >"$STATE_DIR/edge-status"
    echo "cdn purge failed after roll-forward — marked edge-pending" >&2
    exit 71
  }
  echo "ok" >"$STATE_DIR/edge-status"
fi

echo "roll-forward complete: $TARGET_ID"
