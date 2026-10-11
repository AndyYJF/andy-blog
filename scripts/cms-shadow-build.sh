#!/usr/bin/env bash
# Sync a frozen build snapshot into an independent work directory.
# This does not switch a release, purge a CDN, or write the repository route maps.
# Dist is not built unless SHADOW_BUILD_DIST=1. That build stays in the work directory.
set -euo pipefail

if [[ -z "${SHADOW_WORK:-}" || -z "${SNAPSHOT_EPOCH:-}" || -z "${FIXTURE_PATH:-}" ]]; then
  echo "usage: SHADOW_WORK=dir SNAPSHOT_EPOCH=seconds FIXTURE_PATH=snapshot.json cms-shadow-build.sh" >&2
  exit 64
fi
if [[ ! "$SNAPSHOT_EPOCH" =~ ^[0-9]{10}$ ]]; then
  echo "SNAPSHOT_EPOCH is required (10-digit unix seconds)" >&2
  exit 64
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

to_unix() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s\n' "$1"
  fi
}
to_win() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

WORK_UNIX=$(to_unix "$SHADOW_WORK")
FIXTURE_UNIX=$(to_unix "$FIXTURE_PATH")
case "$WORK_UNIX" in
  /*) ;;
  *) echo "SHADOW_WORK must be an absolute path" >&2; exit 65 ;;
esac
case "$FIXTURE_UNIX" in
  /*) ;;
  *) echo "FIXTURE_PATH must be an absolute path" >&2; exit 65 ;;
esac
case "$WORK_UNIX" in
  *..*) echo "SHADOW_WORK must not contain .." >&2; exit 65 ;;
esac
case "$FIXTURE_UNIX" in
  *..*) echo "FIXTURE_PATH must not contain .." >&2; exit 65 ;;
esac
if [[ "$WORK_UNIX" == "$ROOT" || "$WORK_UNIX" == "$ROOT"/* ]]; then
  echo "shadow build refuses the repository worktree" >&2
  exit 65
fi
if [[ ! -f "$FIXTURE_UNIX" ]]; then
  echo "FIXTURE_PATH does not exist" >&2
  exit 65
fi

mkdir -p "$WORK_UNIX/input" "$WORK_UNIX/content"
cp "$ROOT/data/route-map.json" "$WORK_UNIX/input/route-map.json"
cp "$ROOT/data/meta-route-map.json" "$WORK_UNIX/input/meta-route-map.json"

copy_override() {
  local src="$1"
  local dest="$2"
  local label="$3"
  if [[ -z "$src" ]]; then
    return
  fi
  local unix
  unix=$(to_unix "$src")
  case "$unix" in
    /*) ;;
    *) echo "$label must be an absolute path" >&2; exit 65 ;;
  esac
  case "$unix" in
    *..*) echo "$label must not contain .." >&2; exit 65 ;;
  esac
  if [[ ! -f "$unix" ]]; then
    echo "$label does not exist" >&2
    exit 65
  fi
  cp "$unix" "$dest"
}

copy_override "${SHADOW_ROUTE_MAP:-}" "$WORK_UNIX/input/route-map.json" "SHADOW_ROUTE_MAP"
copy_override "${SHADOW_META_ROUTE_MAP:-}" "$WORK_UNIX/input/meta-route-map.json" "SHADOW_META_ROUTE_MAP"

(
  export CONTENT_BACKUP_DIR="$(to_win "$WORK_UNIX/content")"
  export ROUTE_MAP_PATH="$(to_win "$WORK_UNIX/input/route-map.json")"
  export META_ROUTE_MAP_PATH="$(to_win "$WORK_UNIX/input/meta-route-map.json")"
  export FIXTURE_PATH="$(to_win "$FIXTURE_UNIX")"
  export SNAPSHOT_EPOCH
  export DB_HOST=
  export DB_USER=
  export DB_PASSWORD=
  export DB_NAME=
  export CONTENT_SOURCE=
  cd "$ROOT"
  node scripts/sync-typecho.js
)

if [[ "${SHADOW_BUILD_DIST:-}" != "1" ]]; then
  if [[ ! -d "$ROOT/astro/node_modules/astro" ]]; then
    echo "shadow dist was not built: astro toolchain is not installed" >&2
    exit 65
  fi
  echo "shadow dist was not built: the work copy has no isolated Astro build yet" >&2
  exit 65
fi

SITE="$WORK_UNIX/site"
rm -rf "$SITE"
mkdir -p "$SITE"
tar -C "$ROOT" -cf - \
  --exclude .git \
  --exclude node_modules \
  --exclude astro/dist \
  --exclude astro/.cache \
  --exclude secrets \
  --exclude backups \
  --exclude .env \
  . | tar -C "$SITE" -xf -

for name in posts pages moments en-posts en-pages; do
  dest="$SITE/astro/src/content/$name"
  rm -rf "$dest"
  mkdir -p "$dest"
  src="$WORK_UNIX/content/$name"
  if [[ -d "$src" ]]; then
    cp -a "$src"/. "$dest"/
  fi
done

manifest="$WORK_UNIX/content/manifests"
if [[ ! -f "$manifest/route-map.json" || ! -f "$manifest/meta-route-map.json" ]]; then
  echo "shadow dist was not built: sync manifests are missing" >&2
  exit 65
fi
cp "$manifest/route-map.json" "$SITE/data/route-map.json"
cp "$manifest/meta-route-map.json" "$SITE/data/meta-route-map.json"
if [[ -f "$manifest/lastmod.json" ]]; then
  cp "$manifest/lastmod.json" "$SITE/data/lastmod.json"
fi

cd "$SITE/astro"
if [[ ! -f package-lock.json ]]; then
  echo "shadow dist was not built: astro package-lock is missing" >&2
  exit 65
fi
if ! npm ci; then
  echo "shadow dist was not built: npm ci failed" >&2
  exit 65
fi
if ! npm run build; then
  echo "shadow dist was not built: astro build failed" >&2
  exit 65
fi
if [[ ! -d dist ]]; then
  echo "shadow dist was not built: astro build produced no dist" >&2
  exit 65
fi
echo "shadow dist built: $SITE/astro/dist"
