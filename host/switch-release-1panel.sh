#!/usr/bin/env bash
# Switch an already-built release under the existing 1Panel OpenResty config.
# This script deliberately cannot reload OpenResty, purge CDN, or change state.
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
STATE_DIR="${STATE_DIR:?set absolute STATE_DIR}"
RELEASE_ID="${1:?release id required}"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || exit 64

RELEASES_REAL="$(realpath "$WWW_ROOT/releases")"
RELEASE_DIR="$WWW_ROOT/releases/$RELEASE_ID"
RELEASE_REAL="$(realpath "$RELEASE_DIR")"
[[ "$(dirname "$RELEASE_REAL")" == "$RELEASES_REAL" ]] || exit 65
test -f "$RELEASE_DIR/manifest.json"
test -f "$RELEASE_DIR/checksums.sha256"
test -f "$RELEASE_DIR/site/release-id.txt"
test -f "$RELEASE_DIR/nginx/release-http.conf"
grep -qx "$RELEASE_ID" "$RELEASE_DIR/site/release-id.txt"

if find "$RELEASE_DIR" ! -type f ! -type d -print -quit | grep -q .; then
  echo "release contains special files" >&2
  exit 65
fi
(cd "$RELEASE_DIR" && sha256sum -c checksums.sha256 >/dev/null)

REDIRECT_STATUS="$(cat "$STATE_DIR/redirect-status")"
COMMENT_WRITE_MODE="$(cat "$STATE_DIR/comment-write-mode")"
case "$REDIRECT_STATUS" in 302|301) ;; *) echo "redirect-status must be 302 or 301" >&2; exit 68; esac
[[ "$COMMENT_WRITE_MODE" == "enabled" ]] || { echo "expected comment-write-mode=enabled" >&2; exit 68; }
node -e '
  const fs=require("fs");
  const [file,release,status,comments]=process.argv.slice(1);
  const m=JSON.parse(fs.readFileSync(file,"utf8"));
  if(m.releaseId!==release || String(m.redirectStatus)!==status || m.commentWriteMode!==comments) process.exit(68);
' "$RELEASE_DIR/manifest.json" "$RELEASE_ID" "$REDIRECT_STATUS" "$COMMENT_WRITE_MODE"

OLD_ID=""
if [[ -L "$WWW_ROOT/current" ]]; then
  OLD_ID="$(basename "$(readlink -f "$WWW_ROOT/current")")"
  # Identical nginx, or extra map entries for newly published posts, is allowed.
  # Status flips, location/server drift, removals, and retargets still exit 69.
  node "$(dirname "$0")/../scripts/compare-nginx-policy.js" \
    "$WWW_ROOT/current/nginx/release-http.conf" \
    "$RELEASE_DIR/nginx/release-http.conf"
fi

ln -sfn "releases/$RELEASE_ID" "$WWW_ROOT/current.next"
if [[ -n "$OLD_ID" ]]; then
  ln -sfn "releases/$OLD_ID" "$WWW_ROOT/previous.next"
  mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
fi
mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"

ORIGIN_ID="$(curl -fsS --max-time 10 --resolve www.andy-y.cn:443:127.0.0.1 https://www.andy-y.cn/__release || true)"
if [[ "$ORIGIN_ID" != "$RELEASE_ID" ]]; then
  if [[ -n "$OLD_ID" ]]; then
    ln -sfn "releases/$OLD_ID" "$WWW_ROOT/current.next"
    mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"
  fi
  echo "origin release mismatch; restored $OLD_ID" >&2
  exit 70
fi
echo "switched current -> $RELEASE_ID (previous=${OLD_ID:-none})"
