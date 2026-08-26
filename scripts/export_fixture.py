#!/usr/bin/env python3
"""Export stage-0 snapshot as UTF-8 JSON fixture via read-only SSH/MySQL."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from ssh_readonly import connect, require_env, require_ssh_target

ROOT = Path(__file__).resolve().parents[1]
EPOCH = os.environ.get("SNAPSHOT_EPOCH", "1785565762")
OUT = ROOT / "docs" / "baselines" / "fixtures" / f"snapshot-{EPOCH}.json"

REMOTE = r'''#!/bin/bash
set -euo pipefail
TYPECHO=1Panel-typecho-f31a
MYSQL=1Panel-mysql-RSa9
EPOCH=__EPOCH__
envlines=$(docker inspect "$TYPECHO" --format '{{range .Config.Env}}{{println .}}{{end}}')
DB_USER=$(printf '%s\n' "$envlines" | awk -F= '/^TYPECHO_DB_USER=/{print substr($0,index($0,"=")+1)}')
DB_NAME=$(printf '%s\n' "$envlines" | awk -F= '/^TYPECHO_DB_DATABASE=/{print substr($0,index($0,"=")+1)}')
DB_PASS=$(printf '%s\n' "$envlines" | awk -F= '/^TYPECHO_DB_PASSWORD=/{print substr($0,index($0,"=")+1)}')

# Export JSON using MySQL JSON functions (8.4)
docker exec "$MYSQL" mysql -N -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" --default-character-set=utf8mb4 -e "
SET SESSION group_concat_max_len = 1024*1024*64;
SELECT JSON_OBJECT(
  'snapshotEpoch', $EPOCH,
  'contents', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'cid', cid, 'type', type, 'title', title, 'slug', slug, 'text', text,
      'created', created, 'modified', modified,
      'allowComment', allowComment, 'allowFeed', allowFeed,
      'order', \`order\`, 'template', IFNULL(template,''), 'password', IFNULL(password,''),
      'status', status
    ))
    FROM (
      SELECT * FROM typecho_contents
      WHERE type IN ('post','page')
      ORDER BY cid
    ) c
  ),
  'relations', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'cid', r.cid, 'mid', m.mid, 'name', m.name, 'slug', m.slug, 'type', m.type, 'order', m.\`order\`
    ))
    FROM typecho_relationships r
    JOIN typecho_metas m ON m.mid=r.mid
    ORDER BY r.cid, m.type, m.\`order\`, m.mid
  ),
  'fields', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'cid', cid, 'name', name, 'type', type,
      'str_value', IFNULL(str_value,''),
      'int_value', int_value,
      'float_value', float_value
    ))
    FROM typecho_fields
    ORDER BY cid, name
  ),
  'metas', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'mid', mid, 'name', name, 'slug', slug, 'type', type, 'description', IFNULL(description,''),
      'count', count, 'order', \`order\`
    ))
    FROM typecho_metas
    WHERE type IN ('category','tag')
    ORDER BY type, \`order\`, mid
  )
);
" > /tmp/andy-fixture-$EPOCH.json
# strip mysql warnings from file if mixed — mysql -N only data; password warning on stderr
wc -c /tmp/andy-fixture-$EPOCH.json
sha256sum /tmp/andy-fixture-$EPOCH.json
echo PACK=/tmp/andy-fixture-$EPOCH.json
'''


def main():
    host, user = require_ssh_target()
    password = require_env("SSH_PASS")
    port = int(os.environ.get("SSH_PORT", "22"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    script = REMOTE.replace("__EPOCH__", EPOCH)
    remote_path = f"/tmp/andy-fixture-export-{int(time.time())}.sh"
    client = connect(host, user, password, port)
    try:
        sftp = client.open_sftp()
        with sftp.file(remote_path, "w") as f:
            f.write(script)
        sftp.chmod(remote_path, 0o700)
        sftp.close()
        _, stdout, stderr = client.exec_command(f"bash {remote_path}", timeout=600)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        print(out)
        if err:
            print(err, flush=True)
        if code != 0:
            raise SystemExit(f"remote failed: {code}")
        pack = None
        for line in out.splitlines():
            if line.startswith("PACK="):
                pack = line.split("=", 1)[1].strip()
        if not pack:
            raise SystemExit("no PACK")
        sftp = client.open_sftp()
        sftp.get(pack, str(OUT))
        sftp.close()
        client.exec_command(f"rm -f {remote_path} {pack}")
    finally:
        client.close()

    # validate JSON
    raw = OUT.read_text(encoding="utf-8")
    # MySQL may wrap with quotes or add newlines — find first {
    start = raw.find("{")
    end = raw.rfind("}")
    data = json.loads(raw[start : end + 1])
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pubs = [
        c
        for c in data["contents"]
        if c["type"] in ("post", "page")
        and c["status"] == "publish"
        and int(c["created"]) < int(EPOCH)
        and not (c.get("password") or "")
    ]
    print("public", len(pubs))
    for c in pubs:
        print(c["cid"], c["type"], c["title"], c["slug"])


if __name__ == "__main__":
    main()
