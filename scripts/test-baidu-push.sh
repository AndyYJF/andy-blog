#!/usr/bin/env bash
# scripts/test-baidu-push.sh — behavioral fixture for host/baidu-push.sh
# Asserts previous-release diff + canonical single-slash post URLs.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/baidu-push-test.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

WWW_ROOT="$TMP/www"
STATE_DIR="$WWW_ROOT/state"
OLD_ID="20260101T000000Z-oldold01"
NEW_ID="20260102T000000Z-newnew02"
mkdir -p \
  "$WWW_ROOT/releases/$OLD_ID/site/posts/kept" \
  "$WWW_ROOT/releases/$NEW_ID/site/posts/kept" \
  "$WWW_ROOT/releases/$NEW_ID/site/posts/added" \
  "$STATE_DIR"

printf '<html></html>\n' >"$WWW_ROOT/releases/$OLD_ID/site/posts/kept/index.html"
printf '<html></html>\n' >"$WWW_ROOT/releases/$NEW_ID/site/posts/kept/index.html"
printf '<html></html>\n' >"$WWW_ROOT/releases/$NEW_ID/site/posts/added/index.html"

export WWW_ROOT STATE_DIR
# No token → records added URLs and exits 0
bash "$ROOT/host/baidu-push.sh" "$NEW_ID" "$OLD_ID"

ADDED_FILE="$STATE_DIR/baidu-last-added.txt"
[[ -f "$ADDED_FILE" ]] || { echo "missing baidu-last-added.txt" >&2; exit 1; }

mapfile -t ADDED < "$ADDED_FILE"
if [[ ${#ADDED[@]} -ne 1 ]]; then
  echo "expected 1 added URL, got ${#ADDED[@]}: ${ADDED[*]-}" >&2
  exit 1
fi

EXPECTED='https://www.andy-y.cn/posts/added/'
if [[ "${ADDED[0]}" != "$EXPECTED" ]]; then
  echo "URL mismatch: got '${ADDED[0]}' expected '$EXPECTED'" >&2
  exit 1
fi

if grep -q 'andy-y.cn//' "$ADDED_FILE"; then
  echo "double-slash URL leaked into baidu-last-added.txt" >&2
  exit 1
fi

echo '{"ok":true,"added":1,"url":"'"$EXPECTED"'"}'
