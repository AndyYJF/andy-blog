"""Stage 3 build-artifact gates: head order, markup hooks, CSS features, JS budget."""
from __future__ import annotations

import gzip
import pathlib
import re

DIST = pathlib.Path(__file__).resolve().parents[1] / "astro" / "dist"


def main() -> None:
    post = (DIST / "posts" / "stable-diffusion-notes-p1" / "index.html").read_text(encoding="utf-8")
    index = (DIST / "index.html").read_text(encoding="utf-8")
    head = post.split("</head>")[0]

    theme_at = head.find("__andyThemeControllerInstalled")
    css_at = head.find("/_astro/")
    print(f"theme-init before site css : {0 <= theme_at < css_at} (theme={theme_at}, css={css_at})")
    print(f"ClientRouter present       : {'astro:' in post or 'ClientRouter' in post}")
    print(f'prose article on post      : {bool(re.search(chr(34) + "?<article class=.prose. data-article", post))}')
    print(f"reading rail post/index    : {'data-reading-progress' in post} / {'data-reading-progress' in index}")
    print(f"sticky header + to-top     : {'site-header' in post} / {'data-to-top' in post}")

    css = "".join(p.read_text(encoding="utf-8") for p in sorted((DIST / "_astro").glob("*.css")))
    features = [
        "view-transition-old(root)",
        "backdrop-filter:blur(12px)",
        "prefers-reduced-motion",
        "--icon-external",
        "lightbox-image",
        "reading-progress",
        "translateY(-2px)",
    ]
    for key in features:
        print(f"css {key:28s}: {key in css}")

    # Expressive Code ships its own easing; we override it with a more specific selector.
    override = ".expressive-code .frame .copy button,.expressive-code .frame .copy .feedback"
    print(f"css EC easing overridden    : {override in css.replace(' {', '{')}")

    site_css = css[: css.find(".expressive-code")] if ".expressive-code" in css else css
    curves = set(re.findall(r"cubic-bezier\([^)]*\)", site_css))
    print(f"css site easing curves      : {sorted(curves)}")

    total = 0
    for js in sorted((DIST / "_astro").glob("*.js")):
        size = len(gzip.compress(js.read_bytes(), 9))
        total += size
        print(f"js  {js.name[:44]:44s}: {size:6d} B gzip")
    print(f"js  TOTAL                       : {total} B gzip = {total / 1024:.2f} KB (budget 12 KB)")


if __name__ == "__main__":
    main()
