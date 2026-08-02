# Stage 4 gates

Date: 2026-08-02

## Delivered

1. **Legacy URL inventory** — `data/legacy-url-map.json` (149 redirects)
   - Sources: `route-map` / `meta-route-map` / live crawl / RSS fixture / Typecho routing table
   - Path redirects: 119 · Query redirects (`$uri:$arg_p`): 30
   - Query keys only on `/` and `/index.php` (no bare `$arg_p`)

2. **Nginx generator** — `nginx/release-http.conf` + `00-release-loader.conf`
   - Observation release uses literal **302** on all three public vhosts
   - Tombstone maps present (empty for now); 404/410 unaffected by 302→301 flip
   - `npm run nginx:301` regenerates the approved permanent release

3. **RSS** — `/rss.xml` via `@astrojs/rss`
   - GUID override through `customData` (top-level `guid` is stripped by the package)
   - Window = 10, matching Typecho `postsListSize` and the live fixture
   - Fixture lock: `scripts/rss-gate.js`

4. **Sitemap / robots**
   - `@astrojs/sitemap` with real `lastmod` from `data/lastmod.json` (sync writes it from `modified`)
   - 16 URLs = home + 3 pages + 12 posts; every `<url>` has `<lastmod>`
   - `robots.txt` → `Sitemap: https://www.andy-y.cn/sitemap-index.xml`

5. **SEO meta**
   - Absolute https/www/trailing-slash canonical on every page
   - OG + Twitter `summary_large_image`
   - Posts use Typecho `thumb` cover; home/pages fall back to `public/og-default.png`
   - JSON-LD via `set:html={JSON.stringify(...)}` (`BlogPosting` / `WebSite`)

## Gate results

| Check | Result |
|---|---|
| `npm run build` (sync → legacy → nginx 302 → astro → render/rss/stage4 gates) | PASS |
| RSS 10 GUIDs == fixture order | PASS |
| One `<guid>` per item, no auto link-guid | PASS |
| Nginx observation status 302 | PASS |
| Query allowlist `/` + `/index.php` only | PASS |
| Sitemap ↔ active canonicals + lastmod | PASS (16/16) |
| Canonical / OG / Twitter / JSON-LD sample | PASS |

## Intentionally deferred

- **Category / tag / archive HTML pages** land in Stage 6. Their legacy redirects are already in the map targeting `/category/*/`, `/tag/*/`, `/` (for `/blog/`). Until Stage 6, those targets 404 in Astro preview; Nginx will still emit the redirects so the cutover is not blocked.
- **CDN / live matrix** (源站 · 阿里 · Cloudflare) needs a deployed release — Stage 5/8.
- **302 → 301 flip** after ≥7-day observation window — regenerate with `npm run nginx:301`.

## Commands

```powershell
$env:SNAPSHOT_EPOCH = "1785565762"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm run og:default          # once, or after branding change
npm run build
npm --prefix astro run preview -- --host 127.0.0.1 --port 4321
```
