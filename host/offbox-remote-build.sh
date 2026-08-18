#!/usr/bin/env bash
# Native Astro/Playwright release build on the off-box host.
# stdout: exactly one release ID. Never reads Typecho DB_*.
set -Eeuo pipefail
umask 027
exec 3>&1
exec 1>&2

OFFBOX_ROOT="${OFFBOX_ROOT:-/opt/andy-blog-offbox}"
OFFBOX_WORK="${OFFBOX_WORK:-$OFFBOX_ROOT/work}"
SNAPSHOT_JSON="${FIXTURE_PATH:-$OFFBOX_ROOT/in/snapshot.json}"
export APP_ROOT="$OFFBOX_WORK"
export BUILD_LOCK_DIR="${BUILD_LOCK_DIR:-$OFFBOX_ROOT/runtime}"
export WWW_ROOT="${WWW_ROOT:-$OFFBOX_ROOT/www}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$OFFBOX_ROOT/ms-playwright}"
export FIXTURE_PATH="$SNAPSHOT_JSON"
export CI=1

REDIRECT_STATUS="${REDIRECT_STATUS:?host must pass persisted redirect state}"
COMMENT_WRITE_MODE="${COMMENT_WRITE_MODE:?host must pass persisted comment state}"
SNAPSHOT_EPOCH="${SNAPSHOT_EPOCH:?host must pass persisted job cutoff}"
export SNAPSHOT_EPOCH REDIRECT_STATUS COMMENT_WRITE_MODE

unset DB_HOST DB_USER DB_PASSWORD DB_NAME TYPECHO_DB_HOST TYPECHO_RO_DB_USER TYPECHO_RO_DB_PASSWORD TYPECHO_DB_NAME || true

test -f "$SNAPSHOT_JSON"
test -d "$OFFBOX_WORK/scripts"
test -f "$OFFBOX_WORK/scripts/build-release.sh"
mkdir -p "$BUILD_LOCK_DIR" "$WWW_ROOT/releases" "$OFFBOX_ROOT/in" "$OFFBOX_ROOT/out" "$OFFBOX_ROOT/state"

cd "$OFFBOX_WORK"
STAMP_FILE="$OFFBOX_ROOT/state/deps.sha256"
NEW_STAMP="$(sha256sum package-lock.json astro/package.json astro/package-lock.json | sha256sum | awk '{print $1}')"
OLD_STAMP=""
if [[ -f "$STAMP_FILE" ]]; then
  OLD_STAMP="$(tr -d '[:space:]' <"$STAMP_FILE")"
fi
if [[ "$NEW_STAMP" != "$OLD_STAMP" ]] || [[ ! -d node_modules ]] || [[ ! -d astro/node_modules ]]; then
  npm ci --no-audit --no-fund
  npm --prefix astro ci --no-audit --no-fund
  printf '%s\n' "$NEW_STAMP" >"$STAMP_FILE"
fi

if [[ ! -d "$PLAYWRIGHT_BROWSERS_PATH" ]]; then
  echo "PLAYWRIGHT_BROWSERS_PATH missing: $PLAYWRIGHT_BROWSERS_PATH" >&2
  exit 65
fi

RELEASE_ID="$(bash "$OFFBOX_WORK/scripts/build-release.sh")"
RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -d '\r' | tail -n1)"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || {
  echo "offbox build-release produced no release id" >&2
  exit 66
}

FINAL="$WWW_ROOT/releases/$RELEASE_ID"
test -d "$FINAL"
test -f "$FINAL/checksums.sha256"
TAR="$OFFBOX_ROOT/out/release.tar.gz"
rm -f "$TAR"
tar -C "$WWW_ROOT/releases" -czf "$TAR" "$RELEASE_ID"
printf '%s\n' "$RELEASE_ID" >"$OFFBOX_ROOT/out/release-id.txt"
chmod 0644 "$OFFBOX_ROOT/out/release-id.txt"
chmod 0644 "$TAR"
printf '%s\n' "$RELEASE_ID" >&3
