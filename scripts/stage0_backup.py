#!/usr/bin/env python3
"""Stage-0 read-only production backup via SSH/SFTP. Creds from env only."""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import paramiko

from ssh_readonly import connect, require_env, require_ssh_target

ROOT = Path(__file__).resolve().parents[1]
BASELINES = ROOT / "docs" / "baselines"
BACKUPS = ROOT / "backups"
TS = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def must(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> str:
    code, out, err = run(client, cmd, timeout)
    if code != 0:
        raise RuntimeError(f"cmd failed ({code}): {cmd}\nSTDERR:\n{err}\nSTDOUT:\n{out}")
    return out


REMOTE_HELPER = r'''#!/bin/bash
set -euo pipefail
TYPECHO=1Panel-typecho-f31a
MYSQL=1Panel-mysql-RSa9
OUTDIR=/tmp/andy-blog-stage0-$$
mkdir -p "$OUTDIR"
trap 'rm -rf "$OUTDIR"' EXIT

envlines=$(docker inspect "$TYPECHO" --format '{{range .Config.Env}}{{println .}}{{end}}')
DB_USER=$(printf '%s\n' "$envlines" | awk -F= '/^TYPECHO_DB_USER=/{print substr($0,index($0,"=")+1)}')
DB_NAME=$(printf '%s\n' "$envlines" | awk -F= '/^TYPECHO_DB_DATABASE=/{print substr($0,index($0,"=")+1)}')
DB_PASS=$(printf '%s\n' "$envlines" | awk -F= '/^TYPECHO_DB_PASSWORD=/{print substr($0,index($0,"=")+1)}')

echo "DB_USER=$DB_USER" > "$OUTDIR/recon-meta.txt"
echo "DB_NAME=$DB_NAME" >> "$OUTDIR/recon-meta.txt"
echo "TYPECHO_DATA=/opt/1panel/apps/typecho/typecho/data" >> "$OUTDIR/recon-meta.txt"
echo "MYSQL_CONTAINER=$MYSQL" >> "$OUTDIR/recon-meta.txt"
echo "TYPECHO_CONTAINER=$TYPECHO" >> "$OUTDIR/recon-meta.txt"
ls -la /opt/1panel/apps/typecho/typecho/data/usr/themes/ >> "$OUTDIR/recon-meta.txt"
du -sh /opt/1panel/apps/typecho/typecho/data/usr/uploads 2>/dev/null >> "$OUTDIR/recon-meta.txt" || true
find /opt/1panel/apps/typecho/typecho/data/usr/uploads -type f 2>/dev/null | wc -l >> "$OUTDIR/recon-meta.txt" || true

# snapshot epoch from DB clock
docker exec "$MYSQL" mysql -N -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e 'SELECT UNIX_TIMESTAMP();' \
  | tr -d '\r' | awk 'NF{print; exit}' > "$OUTDIR/snapshot-epoch.txt"
EPOCH=$(cat "$OUTDIR/snapshot-epoch.txt")

mysqlq() {
  docker exec "$MYSQL" mysql -N -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "$1"
}

{
  echo '## VERSION'
  mysqlq 'SELECT VERSION();'
  echo '## ENGINES'
  mysqlq "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('typecho_contents','typecho_relationships','typecho_metas','typecho_fields','typecho_comments');"
  echo '## OPTIONS'
  mysqlq "SELECT name, value FROM typecho_options WHERE name IN ('siteUrl','rewrite','routingTable','frontPage','postsListSize','theme');"
  echo '## VISIBILITY'
  mysqlq "SELECT type, status, COUNT(*) total, SUM(created >= UNIX_TIMESTAMP()) future_count, SUM(COALESCE(password, '') <> '') password_count FROM typecho_contents WHERE type IN ('post','page') GROUP BY type, status;"
  echo '## PUBLIC_SET'
  mysqlq "SELECT cid, type, title, slug, created, modified, allowComment, allowFeed FROM typecho_contents WHERE type IN ('post','page') AND status='publish' AND created < $EPOCH AND COALESCE(password, '')='' ORDER BY cid;"
  echo '## MULTI_CATEGORY'
  mysqlq "SELECT r.cid, COUNT(*) category_count FROM typecho_relationships r JOIN typecho_metas m ON m.mid=r.mid WHERE m.type='category' GROUP BY r.cid HAVING COUNT(*) > 1;"
  echo '## BAD_SLUGS'
  mysqlq "SELECT type, slug, COUNT(*) c FROM typecho_contents WHERE type IN ('post','page') AND status='publish' GROUP BY type, slug HAVING c>1 OR slug IS NULL OR slug='';"
  echo '## FORMAT'
  mysqlq "SELECT type, SUM(text LIKE '<!--markdown-->%') md_mode, SUM(text NOT LIKE '<!--markdown-->%') html_mode FROM typecho_contents WHERE type IN ('post','page') GROUP BY type;"
  echo '## FIELDS'
  mysqlq "SELECT name, type, COUNT(*) FROM typecho_fields GROUP BY name, type;"
  echo '## LOCAL_UPLOADS_REFS'
  mysqlq "SELECT COUNT(*) FROM typecho_contents WHERE text LIKE '%/usr/uploads/%';"
  echo '## COMMENTS'
  mysqlq "SELECT type, status, COUNT(*) total FROM typecho_comments GROUP BY type, status;"
  echo '## ORPHAN_COMMENTS'
  mysqlq "SELECT c.coid, c.cid, c.parent FROM typecho_comments c LEFT JOIN typecho_contents p ON p.cid=c.cid LEFT JOIN typecho_comments parent ON parent.coid=c.parent WHERE p.cid IS NULL OR (c.parent<>0 AND parent.coid IS NULL);"
  echo '## EXCLUDED'
  mysqlq "SELECT cid, type, title, slug, status, created, CASE WHEN created >= $EPOCH THEN 1 ELSE 0 END AS is_future, CASE WHEN COALESCE(password,'')<>'' THEN 1 ELSE 0 END AS has_password FROM typecho_contents WHERE type IN ('post','page') AND NOT (status='publish' AND created < $EPOCH AND COALESCE(password,'')='');"
} > "$OUTDIR/sql-gates.txt" 2>"$OUTDIR/sql-gates.err"

# public articles export (full text) as JSONL via SQL TSV then convert locally? Use JSON_OBJECT if available
mysqlq "SELECT cid, type, title, slug, created, modified, allowComment, allowFeed, CHAR_LENGTH(text), SHA2(text,256), LEFT(text,80) FROM typecho_contents WHERE type IN ('post','page') AND status='publish' AND created < $EPOCH AND COALESCE(password,'')='' ORDER BY cid;" \
  > "$OUTDIR/public-index.tsv"

# dump full contents of public set to SQL INSERT-friendly CSV of cid/type/title/slug/text
docker exec "$MYSQL" mysqldump --single-transaction --routines --triggers -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  > "$OUTDIR/typecho-full.sql"

# also export public posts/pages as individual files via SELECT into outfile not available; use mysql -B
mkdir -p "$OUTDIR/articles"
mysqlq "SELECT cid FROM typecho_contents WHERE type IN ('post','page') AND status='publish' AND created < $EPOCH AND COALESCE(password,'')='' ORDER BY cid;" \
  | tr -d '\r' | while read -r CID; do
    [ -z "$CID" ] && continue
    mysqlq "SELECT text FROM typecho_contents WHERE cid=$CID;" > "$OUTDIR/articles/$CID.body"
    mysqlq "SELECT CONCAT_WS('\t', cid, type, title, slug, created, modified, allowComment, allowFeed, IF(text LIKE '<!--markdown-->%', 'markdown', 'html')) FROM typecho_contents WHERE cid=$CID;" \
      > "$OUTDIR/articles/$CID.meta.tsv"
  done

# pack for download (no secrets in pack except dump which has hashed users - still gitignored)
tar -C "$OUTDIR" -czf /tmp/andy-blog-stage0-$EPOCH.tgz \
  recon-meta.txt snapshot-epoch.txt sql-gates.txt sql-gates.err public-index.tsv typecho-full.sql articles
ls -lh /tmp/andy-blog-stage0-$EPOCH.tgz
sha256sum /tmp/andy-blog-stage0-$EPOCH.tgz
echo "PACK=/tmp/andy-blog-stage0-$EPOCH.tgz"
echo "EPOCH=$EPOCH"
'''


def sftp_get(client: paramiko.SSHClient, remote: str, local: Path) -> None:
    local.parent.mkdir(parents=True, exist_ok=True)
    sftp = client.open_sftp()
    try:
        sftp.get(remote, str(local))
    finally:
        sftp.close()


def main() -> int:
    host, user = require_ssh_target()
    password = require_env("SSH_PASS")
    port = int(os.environ.get("SSH_PORT", "22"))

    BASELINES.mkdir(parents=True, exist_ok=True)
    (BACKUPS / "mysql").mkdir(parents=True, exist_ok=True)
    (BACKUPS / "typecho-uploads").mkdir(parents=True, exist_ok=True)
    (BASELINES / "sql").mkdir(parents=True, exist_ok=True)
    (BASELINES / "reports").mkdir(parents=True, exist_ok=True)
    (BASELINES / "rss").mkdir(parents=True, exist_ok=True)
    (BASELINES / "urls").mkdir(parents=True, exist_ok=True)

    client = connect(host, user, password, port)
    try:
        # upload helper
        remote_script = f"/tmp/andy-blog-stage0-helper-{int(time.time())}.sh"
        sftp = client.open_sftp()
        with sftp.file(remote_script, "w") as f:
            f.write(REMOTE_HELPER)
        sftp.chmod(remote_script, 0o700)
        sftp.close()

        print("Running remote read-only backup helper...", flush=True)
        code, out, err = run(client, f"bash {remote_script}", timeout=1800)
        sys.stdout.write(out)
        if err:
            # mysql password warnings often go to stderr
            sys.stderr.write(err)
        if code != 0:
            raise RuntimeError(f"remote helper failed: {code}")

        pack = None
        epoch = None
        for line in out.splitlines():
            if line.startswith("PACK="):
                pack = line.split("=", 1)[1].strip()
            if line.startswith("EPOCH="):
                epoch = line.split("=", 1)[1].strip()
        if not pack or not epoch:
            raise RuntimeError("missing PACK/EPOCH in remote output")

        local_tgz = BACKUPS / "mysql" / f"stage0-{epoch}-{TS}.tgz"
        print(f"Downloading {pack} -> {local_tgz}", flush=True)
        sftp_get(client, pack, local_tgz)

        # extract locally
        import tarfile

        extract_dir = BACKUPS / "mysql" / f"stage0-{epoch}-{TS}"
        extract_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(local_tgz, "r:gz") as tar:
            tar.extractall(extract_dir)

        # copy non-secret baselines
        import shutil

        shutil.copy2(extract_dir / "snapshot-epoch.txt", BASELINES / "sql" / "snapshot-epoch.txt")
        shutil.copy2(extract_dir / "sql-gates.txt", BASELINES / "sql" / "sql-gates.txt")
        shutil.copy2(extract_dir / "public-index.tsv", BASELINES / "sql" / "public-index.tsv")
        shutil.copy2(extract_dir / "recon-meta.txt", BASELINES / "recon-notes.txt")
        if (extract_dir / "sql-gates.err").exists():
            shutil.copy2(extract_dir / "sql-gates.err", BASELINES / "sql" / "sql-gates.err")

        # move dump into backups (gitignored)
        dump_src = extract_dir / "typecho-full.sql"
        dump_dst = BACKUPS / "mysql" / f"typecho-{epoch}-{TS}.sql"
        shutil.copy2(dump_src, dump_dst)

        # articles copy for evidence
        articles_dst = BACKUPS / "mysql" / f"articles-{epoch}"
        if articles_dst.exists():
            shutil.rmtree(articles_dst)
        shutil.copytree(extract_dir / "articles", articles_dst)

        # uploads pull
        print("Pulling uploads...", flush=True)
        code, out, err = run(
            client,
            "cd /opt/1panel/apps/typecho/typecho/data && tar czf /tmp/typecho-uploads.tgz usr/uploads && ls -lh /tmp/typecho-uploads.tgz && sha256sum /tmp/typecho-uploads.tgz",
        )
        sys.stdout.write(out)
        if code == 0:
            sftp_get(client, "/tmp/typecho-uploads.tgz", BACKUPS / "typecho-uploads" / f"uploads-{TS}.tgz")
            with tarfile.open(BACKUPS / "typecho-uploads" / f"uploads-{TS}.tgz", "r:gz") as tar:
                tar.extractall(BACKUPS / "typecho-uploads" / f"extracted-{TS}")

        # cleanup remote temp artifacts (read-only spirit: remove only our temp files)
        run(client, f"rm -f {remote_script} {pack} /tmp/typecho-uploads.tgz")

        # write checksums / sizes (no passwords)
        dump_size = dump_dst.stat().st_size
        dump_sha = hashlib.sha256(dump_dst.read_bytes()).hexdigest()
        summary = {
            "snapshotEpoch": epoch,
            "downloadedAt": TS,
            "dumpPath": str(dump_dst.relative_to(ROOT)),
            "dumpBytes": dump_size,
            "dumpSha256": dump_sha,
            "packPath": str(local_tgz.relative_to(ROOT)),
            "articlesDir": str(articles_dst.relative_to(ROOT)),
        }
        (BASELINES / "backup-manifest.json").write_text(
            json.dumps(summary, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(summary, indent=2))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
