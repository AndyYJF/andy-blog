# -*- coding: utf-8 -*-
"""Parse stage0 mysqldump into UTF-8 JSON fixture (offline, no SSH)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "backups/mysql/typecho-1785565762-20260801T062911Z.sql"
EPOCH = 1785565762
OUT = ROOT / "docs/baselines/fixtures" / f"snapshot-{EPOCH}.json"


def parse_values_blob(blob: str) -> list[tuple]:
    """Parse MySQL INSERT VALUES tuples into Python tuples (best-effort for this dump)."""
    rows = []
    i = 0
    n = len(blob)
    while i < n:
        while i < n and blob[i] in " \r\n\t,":
            i += 1
        if i >= n:
            break
        if blob[i] != "(":
            raise ValueError(f"expected '(' at {i}: {blob[i:i+40]!r}")
        i += 1
        fields = []
        while True:
            while i < n and blob[i] in " \r\n\t":
                i += 1
            if blob.startswith("NULL", i):
                fields.append(None)
                i += 4
            elif blob[i] == "'":
                i += 1
                buf = []
                while i < n:
                    ch = blob[i]
                    if ch == "\\" and i + 1 < n:
                        nxt = blob[i + 1]
                        mapping = {
                            "0": "\0",
                            "n": "\n",
                            "r": "\r",
                            "t": "\t",
                            "b": "\b",
                            "Z": "\x1a",
                            '"': '"',
                            "'": "'",
                            "\\": "\\",
                        }
                        buf.append(mapping.get(nxt, nxt))
                        i += 2
                        continue
                    if ch == "'":
                        # '' escape
                        if i + 1 < n and blob[i + 1] == "'":
                            buf.append("'")
                            i += 2
                            continue
                        i += 1
                        break
                    buf.append(ch)
                    i += 1
                fields.append("".join(buf))
            else:
                j = i
                while j < n and blob[j] not in ",)":
                    j += 1
                raw = blob[i:j].strip()
                if "." in raw:
                    fields.append(float(raw))
                else:
                    fields.append(int(raw))
                i = j
            while i < n and blob[i] in " \r\n\t":
                i += 1
            if i < n and blob[i] == ",":
                i += 1
                continue
            if i < n and blob[i] == ")":
                i += 1
                break
            raise ValueError(f"unexpected at {i}: {blob[i:i+40]!r}")
        rows.append(tuple(fields))
    return rows


def table_cols(text: str, table: str) -> list[str]:
    block = re.search(rf"CREATE TABLE `{table}` \((.*?)\) ENGINE", text, re.S).group(1)
    cols = []
    for line in block.splitlines():
        line = line.strip().rstrip(",")
        m = re.match(r"`(\w+)`\s+", line)
        if not m:
            continue
        # skip KEY / UNIQUE / PRIMARY lines — those also start with `name` sometimes as KEY `cid`
        if re.match(r"(PRIMARY|UNIQUE|KEY|FULLTEXT|CONSTRAINT)\b", line):
            continue
        if line.upper().startswith("KEY ") or line.upper().startswith("UNIQUE ") or line.upper().startswith("PRIMARY "):
            continue
        cols.append(m.group(1))
    return cols


def main():
    text = SQL.read_text(encoding="utf-8")
    contents_m = re.search(r"INSERT INTO `typecho_contents` VALUES (.*?);\n", text, re.S)
    metas_m = re.search(r"INSERT INTO `typecho_metas` VALUES (.*?);\n", text, re.S)
    rel_m = re.search(r"INSERT INTO `typecho_relationships` VALUES (.*?);\n", text, re.S)
    fields_m = re.search(r"INSERT INTO `typecho_fields` VALUES (.*?);\n", text, re.S)
    assert contents_m and metas_m and rel_m and fields_m

    cols = table_cols(text, "typecho_contents")
    print("contents cols", cols)

    contents = []
    for row in parse_values_blob(contents_m.group(1)):
        d = dict(zip(cols, row))
        contents.append(
            {
                "cid": int(d["cid"]),
                "type": d["type"],
                "title": d["title"],
                "slug": d["slug"],
                "text": d["text"] or "",
                "created": int(d["created"]),
                "modified": int(d["modified"]),
                "allowComment": int(d["allowComment"]),
                "allowFeed": int(d["allowFeed"]),
                "order": int(d["order"]),
                "template": d.get("template") or "",
                "password": d.get("password") or "",
                "status": d["status"],
            }
        )

    meta_cols = table_cols(text, "typecho_metas")
    metas = []
    for row in parse_values_blob(metas_m.group(1)):
        d = dict(zip(meta_cols, row))
        if d["type"] not in ("category", "tag"):
            continue
        metas.append(
            {
                "mid": int(d["mid"]),
                "name": d["name"],
                "slug": d["slug"],
                "type": d["type"],
                "description": d.get("description") or "",
                "count": int(d.get("count") or 0),
                "order": int(d["order"]),
            }
        )

    meta_by_mid = {m["mid"]: m for m in metas}
    relations = []
    for cid, mid in parse_values_blob(rel_m.group(1)):
        m = meta_by_mid.get(int(mid))
        if not m:
            continue
        relations.append(
            {
                "cid": int(cid),
                "mid": int(mid),
                "name": m["name"],
                "slug": m["slug"],
                "type": m["type"],
                "order": m["order"],
            }
        )
    relations.sort(key=lambda r: (r["cid"], r["type"], r["order"], r["mid"]))

    field_cols = table_cols(text, "typecho_fields")
    fields = []
    for row in parse_values_blob(fields_m.group(1)):
        d = dict(zip(field_cols, row))
        fields.append(
            {
                "cid": int(d["cid"]),
                "name": d["name"],
                "type": d["type"],
                "str_value": d.get("str_value") or "",
                "int_value": int(d.get("int_value") or 0),
                "float_value": float(d.get("float_value") or 0),
            }
        )
    fields.sort(key=lambda f: (f["cid"], f["name"]))

    data = {
        "snapshotEpoch": EPOCH,
        "contents": contents,
        "relations": relations,
        "fields": fields,
        "metas": metas,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    pubs = [
        c
        for c in contents
        if c["type"] in ("post", "page")
        and c["status"] == "publish"
        and c["created"] < EPOCH
        and not c["password"]
    ]
    titles = ROOT / "docs/baselines/fixtures/public-titles.txt"
    titles.write_text(
        "\n".join(f"{c['cid']}\t{c['type']}\t{c['title']}\t{c['slug']}" for c in pubs) + "\n",
        encoding="utf-8",
    )
    print("wrote", OUT, "bytes", OUT.stat().st_size, "public", len(pubs))
    print("titles ->", titles)


if __name__ == "__main__":
    main()
