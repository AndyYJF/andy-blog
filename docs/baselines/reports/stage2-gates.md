# Stage 2 gates

Date: 2026-08-01

## Delivered

- `scripts/lib/shortcodes.js` — `{alert}` / Joe `{message}` / `{cloud}` / `{bilibili}` → directives
- Dry-run: `docs/baselines/reports/shortcode-dry-run.json` (15 articles, **10 hits**, 0 failed)
- `remark-directives.js` + Lucide icons → real HTML tags + CSS
- KaTeX self-hosted at `public/vendor/katex/`
- `remark-image-size.js` + `.cache/img-dims.json`
- Local uploads copied to `public/usr/uploads/` (2 PNGs)

## Hit summary

| Kind | Count |
|---|---|
| alert-block | 5 |
| message | 3 |
| cloud | 1 |
| bilibili | 1 |

## Build checks

| Check | Result |
|---|---|
| `astro build` | PASS |
| Alert HTML (`.alert`, Lucide SVG) | PASS |
| Bilibili iframe | PASS |
| Mermaid → `.beoe` light/dark imgs + SVG files in `dist/beoe/` | PASS |
| Remote images have `width`/`height` | PASS |
| `/usr/uploads/` present in dist | PASS |
| No leftover `{alert|message|...}` in HTML | PASS |

## Known warnings (non-blocking)

Expressive Code falls back to `txt` for typo langs in source (`commend`, `context`, `content`, `file`). Stage 8 content review can fix fences.

## Preview

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm --prefix astro run preview -- --host 127.0.0.1 --port 4321
```
