---
slug: astro
kind: post
locale: en
title: A Minimalist Full-Static Blog Based on Astro
legacyCid: 87
canonicalPath: /en/posts/astro/
commentKey: /posts/astro/
feedGuid: urn:andy-y:post:87#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:12:17.000Z'
updatedDate: '2026-09-26T15:12:17.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 13
    name: 调优
    slug: refine
  - mid: 14
    name: 运维
    slug: mnt
  - mid: 16
    name: Astro
    slug: Astro
tags: []
sourceFormat: markdown
sourceCid: 87
sourceRevision: 1
sourcePublishedAt: '2026-08-17T12:24:00.000Z'
translationVersionId: 10
translationStatus: current
translationAvailableAt: '2026-09-26T15:12:17.000Z'
description: This post introduces a minimalist full-static blog architecture based on Astro, using Typecho as a headless CMS. It details an automated build and release pipeline with containerization, zero-downtime symlink switching, split domestic and overseas CDN distribution, and a self-hosted Waline comment system.
cover: https://tc.andy-y.cn/i/2026/08/17/6a82fb9a4bcf5.png
---

# Background

I previously deployed a personal blog using `Typecho`. To be honest, I really liked the overall maintenance model. However, even with a CDN in front, requests almost always hit the origin database, and I was not satisfied with the current frontend.  
Around that time, I happened to learn about a framework called `Astro`, which by default can render components like `.astro` into static `HTML` during the build phase. This greatly reduces ~~my potato server's~~ performance overhead and makes frontend customization easy, so I decided to turn the current blog frontend into static pages with Astro.

# Planning the Workflow

Considering that I am already used to the operating model of a dynamic CMS like `Typecho`, and `Astro` itself does not provide a convenient post-editing system, I still chose `Typecho` as the CMS to trigger `Astro`'s automatic build and update the frontend after editing posts. The overall workflow is roughly: Typecho post publishing → webhook → systemd → builder rebuild → symlink switch → CDN refresh → visitor:

1. Content editing and automatic rebuild trigger

   ```mermaid
   flowchart LR
       TC["Typecho 1.2.1<br/>headless CMS"] --> DB[("MySQL<br/>typecho_* 表")]
       TC -- "发布 / 下线 / 删除文章" --> AR["AutoRebuild 插件<br/>HMAC-SHA256 签名 webhook"]
       AR --> API["rebuild-api 容器 :9000<br/>验签 + nonce + 防抖"]
       API -- "写 pending / dirty 标记" --> FS["runtime/build/pending"]
       FS --> SD["systemd path unit<br/>blog-rebuild-1panel.path"]
       SD --> SVC["blog-rebuild-1panel.service<br/>启动 builder 容器"]
   ```

2. Build pipeline (inside the builder container)

   ```mermaid
   flowchart LR
       SYNC["sync-typecho.js<br/>只读账号拉取 contents / relations /<br/>fields / metas → Markdown"] --> ASTRO["Astro 7 静态构建<br/>Playwright 渲染 mermaid · KaTeX · sitemap"]
       ASTRO --> PF["Pagefind<br/>生成搜索索引"]
       PF --> ALT["patch-beoe-alt.js"]
       ALT --> GATE["门禁链<br/>node --test · render gate<br/>rss gate · stage gates"]
       GATE --> OUT["产出 dist 静态产物"]
   ```

3. Immutable release and switching

   ```mermaid
   flowchart TB
       OUT["构建产物"] --> REL["releases/{时间戳-hash8}/<br/>site/ 静态文件<br/>nginx/release-http.conf（旧 URL 301/302 map）<br/>manifest.json · comment-policy.json<br/>cdn-purge-plan.json · cdn-preheat-plan.json<br/>checksums.sha256"]
       REL --> CHK{"switch-release<br/>校验 checksum"}
       CHK -- "通过" --> SYM["切换 current 软链<br/>（回滚 = 指回上一个 release）"]
       CHK -- "失败" --> ABORT["中止，不影响线上"]
       SYM --> CLEAN["cleanup-old-releases.js<br/>仅保留最近 3 个"]
       SYM --> Q["release ID 写入<br/>runtime/cdn/pending 队列"]
   ```

4. Online runtime and CDN distribution

   ```mermaid
   flowchart TB
       subgraph VPS["1Panel VPS"]
           OR["宿主机 OpenResty 80/443<br/>静态伺服 current/site/<br/>include current/nginx/release-http.conf"]
           WA["Waline 评论 :8360<br/>仅监听 loopback"]
           OR -- "/api · /ui 反代" --> WA
           CADMIN["comments.andy-y.cn<br/>Waline 管理端独立 vhost"] -.-> WA
       end

       Q["runtime/cdn/pending 非空"] --> PATH["blog-aliyun-cdn.path"]
       PATH --> ALI["阿里云 CDN（国内）<br/>RefreshUrls 精确刷新<br/>PushObjectCache 预热<br/>配额检查，失败不回滚 release"]
       OR --> ALI
       OR --> CF["Cloudflare（海外）<br/>无自动 purge，靠<br/>probe-dual-cdn.js 只读对账"]
       ALI --> USER(["👤 访客"])
       CF --> USER
   ```


:::alert{type="info"}
我的 CDN 采用了国内外分流的模式：国内走阿里云 CDN，国外走 Cloudflare。
:::


# Content Synchronization: From MySQL to Markdown

The first step of the entire pipeline is turning Typecho's content into something Astro can digest. `Astro`'s content layer uses Content Collections, expecting a collection of Markdown files with frontmatter, whereas Typecho's content lives in MySQL, so we need a sync script.

So `sync-typecho.js` does exactly this: using a **read-only** database account, it pulls four tables—`contents` / `relations` / `fields` / `metas`—and assembles posts, categories, tags, and custom fields into Markdown files, while handling various shortcodes and formatting habits left over from the Typecho era, and then generates route mapping tables and build manifests.



:::alert{type="info"}
本地开发时可以不连数据库，用一份导出的 JSON 快照代替，这样写前端的时候不用把整套 MySQL 也搬到笔记本上。
:::




# Build: One Build, One Release

The build runs in a dedicated builder container (node 22 + pre-installed Playwright Chromium, used to render mermaid code blocks in posts into diagrams at build time). A complete build roughly involves:

1. `sync-typecho.js` syncs content from MySQL;
2. `astro build` outputs pure static HTML while generating sitemaps, KaTeX, and mermaid diagrams;
3. `pagefind` indexes the build artifacts to achieve backend-free on-site search;
4. Run a series of gatekeeper scripts (unit tests, render diffs, RSS validation, etc.); any failure aborts the process, leaving production unchanged.

Each build artifact does not directly overwrite the site directory, but instead generates an independent release directory with a timestamp and hash. In addition to static files, it contains matching nginx redirect rules for old links (URLs like `/archives/123` from the Typecho era are all 301/302 redirected to new routes, so external links and search engine indexes don't break), CDN purge/preheat plans, and a full-package sha256 checksum.

The deployment workflow simply switches the `current` symlink to the new directory—validating the checksum before switching, aborting if anything is wrong so production is unaffected; rollback is nothing more than pointing the symlink back. The last 3 old releases are retained, and older ones are automatically purged to prevent disk exhaustion.

# Comments: Waline Bypass

After going fully static, the only dynamic service retained is comments. Comments were migrated from Typecho's built-in comments to self-hosted `Waline` (had AI write a migration script to move old comments into Waline, ~~though there weren't many~~). The container only listens on `127.0.0.1`, with OpenResty reverse-proxying `/api` and `/ui` to it, and the admin panel is hosted separately at `[数据删除].andy-y.cn`. Static pages load the comment section via `@waline/client`; other than this, nothing on the visitor side touches PHP or the database.


:::alert{type="info"}
关于评论的进一步静态化，我最近在考虑接入[giscus](https://giscus.app/zh-CN)，一个基于 GitHub Discussions 的网站评论系统，这样评论全部走GitHub仓库，服务器可以完全不暴露数据库
:::



# CDN: Domestic and Overseas Split Routing

The CDN uses domestic and overseas split routing: domestic resolves to Aliyun CDN, while overseas goes through Cloudflare.

After each release switch, the URL-level exact purge manifest in the build artifact is written into a queue directory, monitored by another systemd path unit and automatically submitted to Alibaba Cloud: `RefreshUrls` purges changed pages (including old redirected URLs), and `PushObjectCache` preheats canonical URLs back to edge nodes, checking the daily quota before submission.

On the Cloudflare side, no credentials are stored on the server, so it does not auto-purge; it relies on `probe-dual-cdn.js` to perform periodic read-only hash probe reconciliation against edge nodes. The site also exposes a `/__release` endpoint returning the current release ID to easily verify whether the cache on both sides is up to date.

# Lessons Learned

- **Webhooks need debouncing**. In Typecho, we might accidentally click save several times or save again before a build finishes. If every save triggered a full rebuild, it would not only produce dirty data, but also cause my server to OOM directly. Therefore, rebuild-api only handles signature verification and writes flag files, leaving the actual merge debouncing to systemd's trigger cadence.
- **Rendering mermaid at build time incurs performance overhead**. The builder image has to include Chromium, which significantly increases image size. Therefore, I also prepared an overlay image that reuses base dependencies and only swaps source code, serving as a fallback when the network is down or dependencies fail to install. (This thing has already crashed my server twice.)
- **Observe redirect rules before rolling them out**. The 301/302 map for old links currently runs in 302 observation mode; only after confirming that the mapping is correct will I consider switching to 301—301 redirects are cached long-term by browsers and CDNs, making mistakes difficult to recover from.

# Conclusion

I am very satisfied with the state after all the tinkering: after editing an article in the Typecho admin panel and clicking publish, what visitors see a few minutes later is pure static HTML on the CDN, with the origin database invisible in the visitor path. The frontend is entirely custom-written in Astro, allowing me to modify whatever I want. Maintenance-wise, it didn't add much burden either—no CI platform, no complex pipelines, just webhook + systemd + a build container; if something goes wrong, pointing the symlink back is the rollback.

~~Although turning a static blog into something resembling a release system might be making a mountain out of a molehill, isn't tinkering the whole point of having a blog?~~

