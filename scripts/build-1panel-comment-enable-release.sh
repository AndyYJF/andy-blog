#!/usr/bin/env bash
# Build a Phase 9c 302 + comments-enabled immutable release in an isolated checkout.
set -Eeuo pipefail
umask 027

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${PHASE9C_OUTPUT_DIR:?set an absolute artifact output directory outside the repository}"
expected_current="${PHASE9C_EXPECTED_CURRENT:?set the current production release id}"
release_id="${PHASE9C_RELEASE_ID:-$(date -u '+%Y%m%dT%H%M%SZ')-$(openssl rand -hex 4)}"

case "$output_dir" in /*) ;; *) echo 'PHASE9C_OUTPUT_DIR must be absolute' >&2; exit 64 ;; esac
case "$output_dir" in "$root"|"$root"/*) echo 'PHASE9C_OUTPUT_DIR must be outside repository' >&2; exit 64 ;; esac
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || { echo 'bad PHASE9C_RELEASE_ID' >&2; exit 64; }
[[ "$expected_current" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || { echo 'bad PHASE9C_EXPECTED_CURRENT' >&2; exit 64; }
test "$(node -p 'Number(process.versions.node.split(".")[0]) >= 22')" = 'true' || { echo 'Node >=22 required' >&2; exit 64; }
test -z "$(git -C "$root" status --porcelain)" || { echo 'worktree must be clean, including untracked files' >&2; exit 65; }

package_name="stage10-phase9c-$release_id"
package_root="$output_dir/$package_name"
release_dir="$package_root/release/$release_id"
archive="$output_dir/$package_name.tar.gz"
test ! -e "$package_root"
test ! -e "$archive"
mkdir -p "$release_dir/site" "$release_dir/nginx" "$package_root/meta"

cd "$root"
snapshot_epoch="${SNAPSHOT_EPOCH:-$(node scripts/read-db-epoch.js)}"
[[ "$snapshot_epoch" =~ ^[0-9]{10}$ ]] || { echo 'bad snapshot epoch' >&2; exit 65; }
export SNAPSHOT_EPOCH="$snapshot_epoch" REDIRECT_STATUS='302' COMMENT_WRITE_MODE='enabled'

node scripts/sync-typecho.js
node scripts/build-legacy-url-map.js
node scripts/generate-nginx.js --status 302
node scripts/generate-comment-policy.js --mode enabled --out .cache/comment-policy.json
node scripts/finalize-manifest.js \
  --release-id "$release_id" --redirect-status 302 --comment-write-mode enabled
node scripts/migrate-comments.js --epoch "$snapshot_epoch" --backend memory --twice
npm --prefix astro run build
node scripts/render-gate.js
node scripts/rss-gate.js
node scripts/stage4-gate.js
node scripts/stage6-gate.js
node scripts/stage8-gate.js
node scripts/stage10-gate.js
node scripts/generate-candidate-nginx.js --release-id "$release_id" --out .cache/phase9c-release-nginx
test -z "$(git -C "$root" status --porcelain)" || { echo 'build changed the committed source snapshot' >&2; exit 65; }

cp -a astro/dist/. "$release_dir/site/"
cp nginx/release-http.conf "$release_dir/nginx/release-http.conf"
cp .cache/phase9c-release-nginx/candidate-nginx.conf "$release_dir/nginx/candidate-nginx.conf"
cp .cache/manifest.json "$release_dir/manifest.json"
cp .cache/comment-policy.json "$release_dir/comment-policy.json"
printf '%s\n' "$release_id" > "$release_dir/site/release-id.txt"

source_head="$(git -C "$root" rev-parse HEAD)"
cp host/transition-deploy-state.sh "$package_root/meta/transition-deploy-state.sh"
cp scripts/phase9c-validate-release.js "$package_root/meta/phase9c-validate-release.mjs"
node - "$package_root/meta/deployment.json" "$release_id" "$expected_current" "$snapshot_epoch" "$source_head" <<'NODE'
const fs = require('fs');
const [,, output, releaseId, previousReleaseId, snapshotEpoch, sourceHead] = process.argv;
const metadata = {
  version: 1,
  phase: 'stage10-phase9c-comment-enable',
  releaseId,
  previousReleaseId,
  snapshotEpoch: Number(snapshotEpoch),
  redirectStatus: 302,
  commentWriteMode: 'enabled',
  closedCommentKey: '/posts/typecho-joe-mermaid/',
  openProbeKey: '/posts/stable-diffusion-notes-p1/',
  sourceHead,
  sourceWorktree: 'clean',
  targetHost: 'www.andy-y.cn',
  topology: '1Panel OpenResty adapter; no repository nginx container',
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
NODE

find "$release_dir" ! -type f ! -type d -print -quit | grep -q . && { echo 'release contains special files' >&2; exit 65; }
find "$release_dir" -type d -exec chmod 0755 {} +
find "$release_dir" -type f -exec chmod 0644 {} +
(
  cd "$release_dir"
  find . -type f ! -name checksums.sha256 -printf '%P\0' | sort -z \
    | xargs -0 sha256sum > checksums.sha256
)
chmod 0644 "$release_dir/checksums.sha256" "$package_root/meta/"*
node scripts/phase9c-validate-release.js --release-dir "$release_dir" --release-id "$release_id"

tar -czf "$archive" -C "$output_dir" "$package_name"
printf 'release_id=%s\narchive=%s\narchive_sha256=%s\nsource_head=%s\nsnapshot_epoch=%s\n' \
  "$release_id" "$archive" "$(sha256sum "$archive" | awk '{print $1}')" "$source_head" "$snapshot_epoch"
printf 'PHASE9C_BUILD_OK\n'
