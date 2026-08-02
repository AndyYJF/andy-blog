#!/usr/bin/env bash
# host/baidu-push.sh — push ONLY newly added post URLs (never full sitemap).
set -Eeuo pipefail

RELEASE_ID="${1:?}"
# Prefer explicit previous id from blog-rebuild (captured before last-success overwrite).
PREV_ID="${2:-}"
WWW_ROOT="${WWW_ROOT:?}"
STATE_DIR="${STATE_DIR:-$WWW_ROOT/state}"
mkdir -p "$STATE_DIR"

NEW_SITE="$WWW_ROOT/releases/$RELEASE_ID/site"
if [[ -z "$PREV_ID" ]]; then
  # Fallback only when invoked standalone; prefer $WWW_ROOT/previous symlink.
  if [[ -L "$WWW_ROOT/previous" ]]; then
    PREV_ID="$(basename "$(readlink -f "$WWW_ROOT/previous")")"
  fi
fi
TOKEN_FILE="${BAIDU_PUSH_TOKEN_FILE:-/run/secrets/baidu_push_token}"

# Emit canonical post URLs: https://www.andy-y.cn/posts/<slug>/
# Do not replace $root with "/" — that leaves a leading slash and creates "//posts/".
list_posts() {
  local root="${1%/}"
  [[ -d "$root/posts" ]] || return 0
  local f rel
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    rel="${f#"$root"/}"
    rel="${rel%/index.html}"
    printf 'https://www.andy-y.cn/%s/\n' "$rel"
  done < <(find "$root/posts" -mindepth 2 -maxdepth 2 -type f -name index.html | sort -u)
}

mapfile -t NEW_URLS < <(list_posts "$NEW_SITE")
if [[ ${#NEW_URLS[@]} -eq 0 ]]; then
  echo "no post URLs in release" >&2
  exit 0
fi

OLD_URLS=()
if [[ -n "$PREV_ID" && -d "$WWW_ROOT/releases/$PREV_ID/site" ]]; then
  mapfile -t OLD_URLS < <(list_posts "$WWW_ROOT/releases/$PREV_ID/site")
fi

# Diff: only URLs present in new but not old.
ADDED=()
for u in "${NEW_URLS[@]}"; do
  skip=0
  for o in "${OLD_URLS[@]:-}"; do
    if [[ "$u" == "$o" ]]; then skip=1; break; fi
  done
  if [[ $skip -eq 0 ]]; then ADDED+=("$u"); fi
done

if [[ ${#ADDED[@]} -eq 0 ]]; then
  echo "no newly added posts — skip baidu push"
  exit 0
fi

# Reject non-canonical forms before recording/pushing.
for u in "${ADDED[@]}"; do
  if [[ "$u" != https://www.andy-y.cn/posts/* ]] || [[ "$u" != */ ]]; then
    echo "baidu-push refused unexpected URL: $u" >&2
    exit 65
  fi
  if [[ "$u" == https://www.andy-y.cn//* ]] || [[ "$u" == *andy-y.cn//posts* ]]; then
    echo "baidu-push refused double-slash URL: $u" >&2
    exit 65
  fi
done

printf '%s\n' "${ADDED[@]}" >"$STATE_DIR/baidu-last-added.txt"

if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "baidu token missing — recorded ${#ADDED[@]} URLs for manual push" >&2
  exit 0
fi

TOKEN="$(tr -d ' \n\r' <"$TOKEN_FILE")"
# Official endpoint: http://data.zz.baidu.com/urls?site=https://www.andy-y.cn&token=TOKEN
RESP="$(curl -sS -X POST "http://data.zz.baidu.com/urls?site=https://www.andy-y.cn&token=$TOKEN" \
  --data-binary @"$STATE_DIR/baidu-last-added.txt" || true)"
printf '%s\n' "$RESP" >"$STATE_DIR/baidu-last-response.json"
echo "baidu push attempted for ${#ADDED[@]} URL(s)"
