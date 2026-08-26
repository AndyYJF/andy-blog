# Stage 6 gates

**Result:** FAIL

- Pagefind artifacts: 29 files under dist/pagefind
- lastmod keys: 26
- active taxonomy pages: 13
- discoverable taxonomy pages: 7
- Lazy UI: home HTML has zero pagefind-ui / pagefind.js references
- KaTeX CSS is self-hosted and linked only on pages that rendered .katex
- Personal home + /posts/ + taxonomies + /archive/ + /page/2/ + 404.html present
- Sitemap includes discoverable list canonicals with lastmod; excludes compatibility-only taxonomies and 404

## Failures

- sitemap must hide https://www.andy-y.cn/category/default/
- sitemap must hide https://www.andy-y.cn/tag/music/
- sitemap must hide https://www.andy-y.cn/tag/app/
- sitemap must hide https://www.andy-y.cn/tag/tec/
- sitemap must hide https://www.andy-y.cn/tag/argue/
- sitemap must hide https://www.andy-y.cn/tag/fen-x/
- About must render the factual profile sections
