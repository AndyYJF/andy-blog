#!/usr/bin/env bash
# host/switch-release.sh — atomic current/previous swap after nginx -t -c.
# Invoked by blog-rebuild.service as the deploy user. No Docker socket in
# public containers; this script runs on the host with docker compose access.
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
RELEASE_ID="${1:?release id required}"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
  echo "bad release id: $RELEASE_ID" >&2
  exit 64
}

RELEASE_DIR="$WWW_ROOT/releases/$RELEASE_ID"
REAL="$(realpath "$RELEASE_DIR")"
case "$REAL" in
  "$WWW_ROOT/releases/"*) ;;
  *) echo "release path escaped releases/: $REAL" >&2; exit 65 ;;
esac
# Must be exactly one level under releases/
parent="$(dirname "$REAL")"
[[ "$parent" == "$(realpath "$WWW_ROOT/releases")" ]] || {
  echo "release not direct child of releases/" >&2
  exit 65
}

test -f "$RELEASE_DIR/manifest.json"
test -f "$RELEASE_DIR/checksums.sha256"
test -f "$RELEASE_DIR/site/release-id.txt"
test -f "$RELEASE_DIR/nginx/candidate-nginx.conf"
grep -qx "$RELEASE_ID" "$RELEASE_DIR/site/release-id.txt"

# Reject symlinks / special files inside the release.
if find "$RELEASE_DIR" ! -type f ! -type d -print -quit | grep -q .; then
  echo "special files in release" >&2
  exit 65
fi

# Isolated nginx -t against the candidate (must not include current/).
docker compose exec -T nginx nginx -t -c "$RELEASE_DIR/nginx/candidate-nginx.conf"

OLD_ID=""
if [[ -L "$WWW_ROOT/current" ]]; then
  OLD_TARGET="$(readlink "$WWW_ROOT/current")"
  OLD_ID="${OLD_TARGET#releases/}"
fi

# Relative symlinks so host + container namespaces both resolve.
ln -sfn "releases/$RELEASE_ID" "$WWW_ROOT/current.next"
if [[ -n "$OLD_ID" ]]; then
  ln -sfn "releases/$OLD_ID" "$WWW_ROOT/previous.next"
  mv -T "$WWW_ROOT/previous.next" "$WWW_ROOT/previous"
fi
mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"

# Reload only when nginx tree changed vs previous.
NEED_RELOAD=1
if [[ -n "$OLD_ID" ]]; then
  if diff -qr "$WWW_ROOT/releases/$OLD_ID/nginx" "$RELEASE_DIR/nginx" >/dev/null 2>&1; then
    NEED_RELOAD=0
  fi
fi
if [[ "$NEED_RELOAD" -eq 1 ]]; then
  docker compose exec -T nginx nginx -t
  docker compose exec -T nginx nginx -s reload
fi

# Origin health: release marker must match.
ORIGIN_ID="$(curl -fsS --max-time 10 http://127.0.0.1/__release || true)"
if [[ "$ORIGIN_ID" != "$RELEASE_ID" ]]; then
  echo "origin /__release mismatch: got '$ORIGIN_ID' want '$RELEASE_ID' — rolling back" >&2
  if [[ -n "$OLD_ID" ]]; then
    ln -sfn "releases/$OLD_ID" "$WWW_ROOT/current.next"
    mv -T "$WWW_ROOT/current.next" "$WWW_ROOT/current"
    if [[ "$NEED_RELOAD" -eq 1 ]]; then
      docker compose exec -T nginx nginx -t
      docker compose exec -T nginx nginx -s reload
    fi
  fi
  exit 70
fi

echo "switched current -> $RELEASE_ID (previous=${OLD_ID:-none})"
