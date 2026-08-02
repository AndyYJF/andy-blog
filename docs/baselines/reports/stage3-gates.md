# Stage 3 gates

Date: 2026-08-02

## Delivered

- `src/styles/global.css` — all 10 animations, 2 themes, sticky nav, responsive rules, reduced-motion fallback
- `src/components/ThemeInit.astro` — first-paint theme, delegated toggle, `astro:before-swap` sync
- `src/components/CommonHead.astro` — `<ClientRouter />`
- `src/scripts/article.ts` → `lightbox.ts` + `reading-progress.ts`, both returning disposers
- `BaseLayout.astro` — generation-guarded mount/cleanup on `astro:page-load` / `astro:before-swap`
- Post cards on the index, `.prose` article shell, back-to-top, footer

## Animation checklist (§2.3)

| # | Element | Implementation | Duration |
|---|---|---|---|
| 1 | Page transition | `::view-transition-old/new(root)` fade | 200ms |
| 2 | Link hover | `background-size` underline grow (nav / cards / brand) | 150ms |
| 3 | Copy button | Expressive Code `inlineButtonBackground*Opacity` 0.1→0.2→0.3, easing overridden | 150ms |
| 4 | Sticky nav | `backdrop-filter: blur(12px)`, no animation | — |
| 5 | Card hover | `translateY(-2px)` + shadow | 200ms |
| 6 | Theme switch | `background-color` / `color` transition on `body` | 200ms |
| 7 | External link icon | Lucide `arrow-up-right` via CSS mask, `translate(2px, -2px)` on hover | 150ms |
| 8 | Back to top | opacity + visibility, driven by top-sentinel IntersectionObserver | 250ms |
| 9 | Reading progress | Right rail, one tick per `h2[id]`, IntersectionObserver-driven active state | 150ms |
| 10 | Image lightbox | FLIP (`transform` interpolation, not fade) | 250ms |

Only easing curve in site CSS: `cubic-bezier(0.4, 0, 0.2, 1)`.

## Build checks

| Check | Result |
|---|---|
| `astro build` | PASS |
| Theme init script precedes site CSS in `<head>` | PASS |
| Reading rail present on articles, absent on index | PASS |
| Site CSS uses a single easing curve | PASS |
| Expressive Code easing overridden with higher specificity | PASS |
| JS total | **8.88 KB gzip** (budget 12 KB) |

JS breakdown (gzip): ClientRouter 5.51 KB · BaseLayout 1.10 KB · Expressive Code 1.17 KB · article chunk 1.33 KB.
The article chunk is a dynamic import and is not referenced by `index.html`.

## Runtime checks (Chromium, `astro preview`)

| Check | Result |
|---|---|
| 20 consecutive ClientRouter navigations | No listener growth on `window`/`document` |
| IntersectionObservers | 2 on articles with headings, 1 elsewhere, back to 1 after leaving |
| Theme across 20 navigations | Stays `dark`, no flash |
| Reading rail | 11 ticks on `typecho-joe-mermaid`, active index tracks scroll |
| Lightbox | Opens, FLIP settles to `transform: none`, Escape closes, source image restored |
| `prefers-reduced-motion: reduce` | All transition durations collapse to 0.01ms, `scroll-behavior: auto` |

## Defects found and fixed during this stage

### 1. Mermaid failure silently emptied whole documents (critical)

`@beoe/rehype-mermaid` drops the **entire document** without any build error when
Playwright cannot launch a browser. `posts/grafana-bird-status` had been shipping a
completely empty body since Stage 2 and the build still reported success.

Root cause: `PLAYWRIGHT_BROWSERS_PATH` pointed at a sandbox cache directory with no
Chromium. The eight already-cached diagrams under `public/beoe/` kept rendering, which
masked the failure.

Fixes:

- `scripts/render-gate.js` (`npm run render:gate`, wired into `npm run build`) compares
  every source document against its rendered `<article>` body and against the expected
  mermaid image count, and fails the build on mismatch.
- Documented the required `PLAYWRIGHT_BROWSERS_PATH`.

After the fix `grafana-bird-status` renders 525 KB of HTML (was 0).

### 2. Joe `{collapse}` shortcode was never converted (Stage 2 gap)

Four posts rendered literal `{collapse}` / `{collapse-item label="…" close}` text.
Added a converter in `scripts/lib/shortcodes.js` (→ `:::collapse{label="…"}`) and a
`<details>` / `<summary>` renderer in `remark-directives.js` with matching CSS.

### 3. Headings without a space after `#` were lost

126 lines across 11 documents use Typecho's lenient `#标题` form. Typecho renders those
as real headings — verified against production, `https://www.andy-y.cn/index.php/archives/30/`
returns `# 写在前面`, `# 搭建`, `## 部署 Prometheus Server` — but CommonMark requires the
space, so they were degrading to paragraphs and starving the reading-progress rail.

`scripts/lib/headings.js` now normalises them during sync, skipping fenced code blocks so
shell comments and commented-out YAML survive untouched (7 such lines correctly preserved).
The sync report records per-CID fix counts under `headingFixes`.

Heading counts after the fix, e.g. `typecho-joe-mermaid` 1×h1 / 12×h2 / 10×h3,
`asterisk-telephony42` 6×h1 / 8×h2 / 16×h4.

## Open issue — heading level structure

Now that the headings exist, several posts skip levels (`h2` → `h4` in
`asterisk-telephony42`, `ios-lz4-extract`, `screen-tmux-ssh-background`) and several use
`h1` for in-body sections alongside the page title. Lighthouse's
"heading elements are not in a sequentially-descending order" audit will flag this, so it
needs a pass before the §2.6 Accessibility ≥95 target is measured. This is source content
structure, not a pipeline bug — best handled with the Stage 8 content review.

## Commands

```powershell
$env:SNAPSHOT_EPOCH = "1785565762"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm run build
npm --prefix astro run preview -- --host 127.0.0.1 --port 4321
```
