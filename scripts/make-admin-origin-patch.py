"""Apply admin-origin patches to Typecho 1.2.1 copies and emit a unified diff."""
from __future__ import annotations

import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / ".cache" / "typecho-src" / "typecho-1.2.1"
WORK = ROOT / ".cache" / "typecho-patch-work"
ORIG = WORK / "orig"
NEW = WORK / "new"
OUT_PATCH = ROOT / "patches" / "typecho-1.2.1" / "admin-origin.patch"
HASHES = ROOT / "patches" / "typecho-1.2.1" / "file-hashes.json"

FILES = {
    "Permalink.php": SRC / "var" / "Widget" / "Options" / "Permalink.php",
    "Profile.php": SRC / "var" / "Widget" / "Users" / "Profile.php",
    "Login.php": SRC / "var" / "Widget" / "Login.php",
}

REL_PATHS = {
    "Permalink.php": "var/Widget/Options/Permalink.php",
    "Profile.php": "var/Widget/Users/Profile.php",
    "Login.php": "var/Widget/Login.php",
}


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def patch_permalink(text: str) -> str:
    old1 = "parse_url($this->options->siteUrl)"
    new1 = "parse_url($this->options->rootUrl)"
    old2 = "Common::url('/action/ajax', $this->options->siteUrl)"
    new2 = "Common::url('/action/ajax', $this->options->rootUrl)"
    if text.count(old1) != 1:
        raise SystemExit(f"Permalink parse_url count={text.count(old1)}")
    if text.count(old2) != 2:
        raise SystemExit(f"Permalink ajax url count={text.count(old2)}")
    return text.replace(old1, new1).replace(old2, new2)


def patch_profile(text: str) -> str:
    old = "$this->response->redirect($this->options->siteUrl);"
    new = "$this->response->redirect(Common::url('profile.php', $this->options->adminUrl));"
    if text.count(old) != 1:
        raise SystemExit(f"Profile redirect count={text.count(old)}")
    return text.replace(old, new)


def patch_login(text: str) -> str:
    old = """            if (
                0 === strpos($this->request->referer, $this->options->adminUrl)
                || 0 === strpos($this->request->referer, $this->options->siteUrl)
            ) {
                $this->response->redirect($this->request->referer);
            }"""
    new = """            if (0 === strpos($this->request->referer, $this->options->adminUrl)) {
                $this->response->redirect($this->request->referer);
            }"""
    if old not in text:
        raise SystemExit("Login referer block not found")
    return text.replace(old, new)


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    ORIG.mkdir(parents=True, exist_ok=True)
    NEW.mkdir(parents=True, exist_ok=True)

    original_hashes = {}
    patched_hashes = {}

    patchers = {
        "Permalink.php": patch_permalink,
        "Profile.php": patch_profile,
        "Login.php": patch_login,
    }

    for name, src in FILES.items():
        raw = src.read_text(encoding="utf-8")
        original_hashes[REL_PATHS[name]] = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        (ORIG / name).write_text(raw, encoding="utf-8", newline="\n")
        patched = patchers[name](raw)
        patched_hashes[REL_PATHS[name]] = hashlib.sha256(patched.encode("utf-8")).hexdigest()
        (NEW / name).write_text(patched, encoding="utf-8", newline="\n")

    # Build a multi-file unified diff with Typecho-rooted paths.
    chunks = []
    for name, rel in REL_PATHS.items():
        proc = subprocess.run(
            ["git", "diff", "--no-index", "--", str(ORIG / name), str(NEW / name)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        # git diff --no-index returns 1 when differences exist
        diff = proc.stdout
        if not diff.strip():
            raise SystemExit(f"no diff for {name}")
        # Rewrite path headers to Typecho-relative paths.
        lines = []
        for line in diff.splitlines():
            if line.startswith("--- "):
                lines.append(f"--- a/{rel}")
            elif line.startswith("+++ "):
                lines.append(f"+++ b/{rel}")
            else:
                lines.append(line)
        chunks.append("\n".join(lines) + "\n")

    OUT_PATCH.parent.mkdir(parents=True, exist_ok=True)
    patch_body = "".join(chunks)
    OUT_PATCH.write_text(patch_body, encoding="utf-8", newline="\n")
    patch_hash = hashlib.sha256(OUT_PATCH.read_bytes()).hexdigest()

    import json

    HASHES.write_text(
        json.dumps(
            {
                "typechoVersion": "1.2.1",
                "original": original_hashes,
                "patched": patched_hashes,
                "patchSha256": patch_hash,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    # Dry-run apply against a clean tree copy
    check_root = WORK / "apply-check"
    if check_root.exists():
        import shutil

        shutil.rmtree(check_root)
    import shutil

    for rel in REL_PATHS.values():
        dest = check_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SRC / rel, dest)

    check = subprocess.run(
        ["git", "apply", "--check", str(OUT_PATCH)],
        cwd=check_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if check.returncode != 0:
        print(check.stderr, file=sys.stderr)
        raise SystemExit("git apply --check failed")

    print(
        json.dumps(
            {
                "patch": str(OUT_PATCH.relative_to(ROOT)).replace("\\", "/"),
                "patchSha256": patch_hash,
                "applyCheck": "ok",
                "files": list(REL_PATHS.values()),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
