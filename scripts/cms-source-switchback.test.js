import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function unixPath(file) {
  const result = spawnSync('bash', ['-lc', 'cygpath -u "$1"', 'bash', path.resolve(file)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('a CMS source group can switch back to Typecho and a leftover host does not keep the CMS flag', () => {
  const helper = fs.readFileSync(path.join(root, 'host/content-source-env.sh'), 'utf8');
  assert.equal(helper.includes('\r'), false);
  const repo = unixPath(root);
  const script = `
set -euo pipefail
cd "$REPO"
export COMPOSE_DIR="$REPO"
unset CONTENT_SOURCE DB_PREFIX I18N_OBSERVE_PREFIX I18N_OBSERVE_DB CMS_DB_HOST CMS_RO_DB_USER CMS_RO_DB_PASSWORD CMS_DB_NAME TYPECHO_DB_NAME
source host/content-source-env.sh
content_source_resolve
test "$CONTENT_SOURCE_USE_CMS_DB" = 0
test "$(content_source_snapshot_script)" = export-typecho-snapshot.js
export CONTENT_SOURCE=cms DB_PREFIX=cms_ I18N_OBSERVE_PREFIX=cms_
export CMS_DB_HOST=127.0.0.1 CMS_RO_DB_USER=cms CMS_RO_DB_PASSWORD=cms-dev CMS_DB_NAME=cms_local TYPECHO_DB_NAME=typecho_db
content_source_resolve
test "$CONTENT_SOURCE_USE_CMS_DB" = 1
test "$(content_source_snapshot_script)" = export-content-snapshot.js
unset CONTENT_SOURCE DB_PREFIX I18N_OBSERVE_PREFIX CMS_DB_HOST CMS_RO_DB_USER CMS_RO_DB_PASSWORD CMS_DB_NAME TYPECHO_DB_NAME
content_source_resolve
test "$CONTENT_SOURCE_USE_CMS_DB" = 0
test "$(content_source_snapshot_script)" = export-typecho-snapshot.js
export CMS_DB_HOST=127.0.0.1
set +e
content_source_resolve
status=$?
set -e
test "$status" = 65
test -z "$CONTENT_SOURCE_USE_CMS_DB"
set +e
content_source_snapshot_script >/dev/null
script_status=$?
set -e
test "$script_status" = 65
`;
  const result = spawnSync('bash', ['-lc', script], {
    cwd: root,
    env: { ...process.env, REPO: repo },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
