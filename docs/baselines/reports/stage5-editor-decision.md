# Stage 5 — editor decision

Date: 2026-08-02

## Decision

**Primary: keep the Joe theme as the CMS-only editor.**

Astro owns every public page. Joe stays installed solely so the Typecho admin keeps its familiar editor and shortcode buttons. Database bodies retain `{alert}` / `{message}` / `{cloud}` / `{bilibili}` / `{collapse}` syntax; conversion still happens at build time in `scripts/lib/shortcodes.js`.

## XEditor timeboxed verification — skipped

Plan §7 lists XEditor (Vditor) as a 2-hour optional spike. Risks already documented there:

- 27 stars / 29 commits, **no releases**, **no license**
- No documented Lsky upload config
- No declared Typecho version compatibility

Given the zero-cost Joe fallback and those upstream risks, we adopt Joe immediately and do not spend the spike budget. Revisit only if Joe admin UX becomes a real bottleneck.

## CMS host constants

See `typecho/config.cms-constants.php.example`:

- `__TYPECHO_PLUGIN_URL__` → `https://cms.andy-y.cn/usr/plugins`
- `__TYPECHO_THEME_URL__` → `https://cms.andy-y.cn/usr/themes/Joe` (activity-theme root; no extra directory append)
- Public `siteUrl` remains `https://www.andy-y.cn`

Stage 0 already confirmed the on-disk theme directory is `Joe`.

## admin-origin.patch

Three Typecho 1.2.1 sites that still force `siteUrl` into admin flows are patched:

1. `Permalink.php` rewrite probe → `rootUrl`
2. `Profile.php` action fallthrough redirect → `adminUrl/profile.php`
3. `Login.php` referer allowlist → `adminUrl` only

Artifacts:

- `patches/typecho-1.2.1/admin-origin.patch`
- `patches/typecho-1.2.1/file-hashes.json` (original + patched SHA-256 + patch hash)

Apply on the CMS tree only after verifying original file hashes. `git apply --check` is part of `scripts/stage5-gate.js`.
