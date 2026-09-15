#!/usr/bin/env bash
# Export published Typecho content to the public andy-blog-content GitHub mirror.
# Safe: does not mutate production route maps / Astro content (CONTENT_BACKUP_DIR mode).
set -Eeuo pipefail
umask 077

COMPOSE_DIR="${COMPOSE_DIR:-/var/www/andy-blog}"
# Reuse the durable rebuild runtime volume already mounted into the builder at /runtime/build.
set -a
# shellcheck disable=SC1090
source "$COMPOSE_DIR/.env"
set +a
REBUILD_RUNTIME_DIR="${REBUILD_RUNTIME_DIR:-$COMPOSE_DIR/runtime/build}"
RUNTIME_DIR="${RUNTIME_DIR:-$REBUILD_RUNTIME_DIR/content-backup}"
MIRROR_DIR="${CONTENT_MIRROR_DIR:-/opt/andy-blog-content}"
COMPOSE_FILE="${COMPOSE_FILE:-$COMPOSE_DIR/compose.1panel-cms.yml}"
SSH_KEY="${CONTENT_BACKUP_SSH_KEY:-/root/.ssh/andy_blog_content_ed25519}"
GIT_REMOTE_URL="${CONTENT_BACKUP_GIT_URL:-git@github.com:AndyYJF/andy-blog-content.git}"
LOCK="$RUNTIME_DIR/backup.lock"

mkdir -p "$RUNTIME_DIR"
# Builder container runs as uid 1000 (node/admin); keep export path writable.
chown -R admin:admin "$RUNTIME_DIR" 2>/dev/null || chown -R 1000:1000 "$RUNTIME_DIR"
chmod 775 "$RUNTIME_DIR"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "content backup already running" >&2
  exit 0
fi

command -v git >/dev/null
command -v docker >/dev/null
test -f "$COMPOSE_DIR/scripts/export-typecho-snapshot.js"
test -f "$COMPOSE_DIR/scripts/sync-typecho.js"
test -f "$SSH_KEY"

export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

# Root operates an admin-owned worktree; pass safe.directory per-invocation (no global git config).
git_mirror() {
  git -c "safe.directory=$MIRROR_DIR" -C "$MIRROR_DIR" "$@"
}

if [[ ! -d "$MIRROR_DIR/.git" ]]; then
  mkdir -p "$(dirname "$MIRROR_DIR")"
  git -c "safe.directory=$MIRROR_DIR" clone "$GIT_REMOTE_URL" "$MIRROR_DIR"
fi
# Sync container writes as uid 1000.
chown -R admin:admin "$MIRROR_DIR"

git_mirror fetch origin main
git_mirror checkout main
git_mirror reset --hard origin/main

SNAPSHOT_JSON="$RUNTIME_DIR/snapshot-export.json"
rm -f "$SNAPSHOT_JSON"
SNAPSHOT_EPOCH="$(date -u +%s)"
EXPORT_OVERRIDE="$RUNTIME_DIR/compose.export-mem.yml"
printf '%s\n' 'services:' '  builder:' '    mem_limit: 512m' '    memswap_limit: 512m' >"$EXPORT_OVERRIDE"
chown admin:admin "$EXPORT_OVERRIDE" 2>/dev/null || true

cd "$COMPOSE_DIR"
set +e
docker compose -f "$COMPOSE_FILE" -f "$EXPORT_OVERRIDE" run --rm --no-TTY --no-deps \
  -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" \
  -e "EXPORT_SNAPSHOT_JSON=/runtime/build/content-backup/snapshot-export.json" \
  -e NODE_OPTIONS=--max-old-space-size=256 \
  -v "$COMPOSE_DIR/scripts/export-typecho-snapshot.js:/app/scripts/export-typecho-snapshot.js:ro" \
  builder node /app/scripts/export-typecho-snapshot.js </dev/null
EXPORT_RC=$?
set -e
rm -f "$EXPORT_OVERRIDE"
[[ $EXPORT_RC -eq 0 ]] || exit "$EXPORT_RC"
test -s "$SNAPSHOT_JSON"
chmod 0600 "$SNAPSHOT_JSON"
chown admin:admin "$SNAPSHOT_JSON" 2>/dev/null || true

# Route maps are often 0600 root; builder (uid 1000) needs read for backup-only sync.
chmod a+r "$COMPOSE_DIR/data/route-map.json" "$COMPOSE_DIR/data/meta-route-map.json" 2>/dev/null || true

# Run sync inside the builder image (has js-yaml etc.); keep production data read-only.
set +e
docker compose -f "$COMPOSE_FILE" run --rm --no-TTY --no-deps \
  -e "SNAPSHOT_EPOCH=$SNAPSHOT_EPOCH" \
  -e "FIXTURE_PATH=/runtime/build/content-backup/snapshot-export.json" \
  -e "CONTENT_BACKUP_DIR=/mirror" \
  -e NODE_OPTIONS=--max-old-space-size=512 \
  -v "$COMPOSE_DIR/scripts:/app/scripts:ro" \
  -v "$COMPOSE_DIR/data:/app/data:ro" \
  -v "$MIRROR_DIR:/mirror" \
  builder node /app/scripts/sync-typecho.js </dev/null
SYNC_RC=$?
set -e
[[ $SYNC_RC -eq 0 ]] || exit "$SYNC_RC"

rm -f "$SNAPSHOT_JSON"

git_mirror add posts pages moments
if git_mirror diff --cached --quiet; then
  echo "content backup: no changes"
  exit 0
fi

git_mirror -c user.name='andy-blog-content-bot' -c user.email='bot@users.noreply.github.com' \
  commit -m "chore: sync published content $(date -u +%Y-%m-%dT%H:%MZ)"
git_mirror push origin main
echo "content backup: pushed $(git_mirror rev-parse --short HEAD)"
