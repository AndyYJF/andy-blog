#!/usr/bin/env bash
# host/transition-deploy-state.sh — authorized Stage 10 state transitions only.
# Ordinary rebuild jobs inherit state; they must never invent 301/enabled.
#
# Usage:
#   transition-deploy-state.sh redirect-status 301
#   transition-deploy-state.sh comment-write-mode enabled
#
# Writes an audit descriptor under $STATE_DIR/transitions/ then atomically
# updates the live state file. Does NOT build/switch a release — operator must
# trigger a rebuild that embeds the new state into the next release manifest.
set -Eeuo pipefail

WWW_ROOT="${WWW_ROOT:?set absolute WWW_ROOT}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
KEY="${1:?key required: redirect-status|comment-write-mode}"
VALUE="${2:?value required}"

case "$KEY" in
  redirect-status)
    case "$VALUE" in 302|301) ;; *) echo "redirect-status must be 302|301" >&2; exit 64 ;; esac
    FILE="$STATE_DIR/redirect-status"
    ;;
  comment-write-mode)
    case "$VALUE" in disabled|enabled) ;; *) echo "comment-write-mode must be disabled|enabled" >&2; exit 64 ;; esac
    FILE="$STATE_DIR/comment-write-mode"
    ;;
  *)
    echo "unknown key: $KEY" >&2
    exit 64
    ;;
esac

mkdir -p "$STATE_DIR/transitions"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DESC="$STATE_DIR/transitions/${TS}-${KEY}.json"
PREV=""
if [[ -f "$FILE" ]]; then
  PREV="$(tr -d '\r\n' <"$FILE")"
fi

node - "$DESC" "$KEY" "$VALUE" "$PREV" <<'NODE'
const fs = require('fs');
const [,, path, key, value, prev] = process.argv;
const doc = {
  at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  key,
  from: prev || null,
  to: value,
  note: 'authorized host transition; rebuild required to embed in release',
};
fs.writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify(doc));
NODE

# Atomic replace via temp + mv
TMP="$FILE.next"
printf '%s\n' "$VALUE" >"$TMP"
mv -T "$TMP" "$FILE"

echo "transitioned $KEY: ${PREV:-<unset>} -> $VALUE (descriptor=$DESC)"
echo "next: run an authorized rebuild so the new release manifest embeds this state" >&2
