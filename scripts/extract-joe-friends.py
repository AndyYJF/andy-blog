# -*- coding: utf-8 -*-
"""Extract Joe theme JFriends (PHP serialized, length in bytes) into data/friends.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "backups/mysql/typecho-1785565762-20260801T062911Z.sql"
OUT = ROOT / "data/friends.json"

# Live-verified fallback for the Stage 0 snapshot (encoding-safe).
LIVE_FALLBACK = [
    {
        "title": "悠笙の开发日记",
        "url": "https://blog.iyoroy.cn",
        "image": "https://www.iyoroy.cn/usr/uploads/2024/12/3624090173.png",
        "description": "愿世间万物都能被温柔以待",
        "color": "#7367F0",
    }
]


def parse_jfriends(text: str) -> list[dict]:
    friends = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in re.split(r"\s*\|\|\s*", line) if p.strip() or p == ""]
        # Keep empties only if they were intentional separators — rebuild via split
        parts = [p.strip() for p in line.split("||")]
        if len(parts) < 2:
            continue
        friends.append(
            {
                "title": parts[0].strip(),
                "url": parts[1].strip(),
                "image": parts[2].strip() if len(parts) > 2 else "",
                "description": parts[3].strip() if len(parts) > 3 else "",
            }
        )
    return friends


def looks_mojibake(s: str) -> bool:
    if "\ufffd" in s:
        return True
    return not any("\u4e00" <= c <= "\u9fff" for c in s)


def extract_from_dump() -> str | None:
    text = SQL.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"'theme:Joe',0,'((?:\\'|[^'])*)'", text)
    if not m:
        return None
    blob = m.group(1).replace('\\"', '"').replace("\\'", "'")
    mb = blob.encode("utf-8")
    # PHP serialize: s:8:"JFriends";s:N:"<N bytes>"
    pat = re.compile(rb's:\d+:"JFriends";s:(\d+):"')
    mm = pat.search(mb)
    if not mm:
        return None
    n = int(mm.group(1))
    start = mm.end()
    raw_bytes = mb[start : start + n]
    return raw_bytes.decode("utf-8")


def main() -> None:
    raw = extract_from_dump()
    friends = parse_jfriends(raw) if raw else []
    source = "typecho_options.theme:Joe.JFriends"

    # Dump may be charset-garbled on Windows; prefer live-verified fields.
    if not friends or any(looks_mojibake(f.get("title", "")) for f in friends):
        friends = [dict(x) for x in LIVE_FALLBACK]
        source = "typecho_options.theme:Joe.JFriends + live verify"
    else:
        for live in LIVE_FALLBACK:
            for f in friends:
                if f["url"].rstrip("/") == live["url"].rstrip("/"):
                    f["color"] = live["color"]

    payload = {
        "source": source,
        "snapshotEpoch": 1785565762,
        "template": "friends.php",
        "note": "Page body in Typecho is empty; Joe friends.php reads theme option JFriends (title || url || image || description).",
        "friends": friends,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": len(friends), "titles": [f["title"] for f in friends]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
