# Astro 7.1.6 integration spike — result

Date: 2026-08-01

## Locked versions (installed)

| Package | Version |
|---|---|
| astro | 7.1.6 |
| @astrojs/markdown-remark | 7.2.2 |
| astro-expressive-code | 0.44.1 |
| @beoe/rehype-mermaid | 0.4.2 |
| playwright (runtime for mermaid-isomorphic) | 1.62.1 |

Node: v24.16.0 (≥22.12.0).

## Plugin order under test

`rehypeRaw` → `rehypeKatex` → `rehypeMermaid(strategy:file, darkScheme:class)` → `rehypeDiagramImages` → `rehypeSlug`

Fixture: `astro/src/content/fixture.md` (TS fence + Mermaid fence).

## Gate results

| Check | Result |
|---|---|
| `npm run build` succeeds | PASS |
| TS fence → Expressive Code (`expressive-code`, `ec-line`, `data-language="ts"`) | PASS |
| Mermaid NOT left as `language-mermaid` / raw `graph LR` source | PASS |
| Mermaid → `<figure class="beoe mermaid">` with `.beoe-light` + `.beoe-dark` `<img>` | PASS |
| SVG files written under `public/beoe/` and copied to `dist/beoe/` | PASS (`uv6py5.svg`, `1yw2i1j.svg`) |
| Theme CSS selector hides opposite Mermaid variant via `data-theme` | PASS (CSS present in HTML) |

## Local tooling note

Cursor shells may redirect Playwright browsers into a sandbox cache. Builds need:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm run build
```

Chromium headless shell v1234 must be installed once via `npx playwright install chromium` with that path.

## Verdict

**Stage 0 Astro/Unified/EC/BEOE spike PASSED.** Safe to proceed to stage 1 content sync (still using these locked versions).
