---
slug: astro
kind: post
title: 一个基于Astro的极简风全静态博客
legacyCid: 87
canonicalPath: /posts/astro/
commentKey: /posts/astro/
feedGuid: urn:andy-y:post:87
allowComment: true
allowFeed: true
pubDate: '2026-08-17T12:24:00.000Z'
updatedDate: '2026-08-19T03:34:21.000Z'
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
description: 我之前通过 Typecho 部署了一个个人博客，说实话，整体运维模式我很喜欢。但是博客即使套了 CDN，请求也几乎都会打到源站数据库，而且我对目前的前端并不满意。 这时我刚好了解到有个叫 Astro 的框架，其默认可以在构建阶段把 .astro 等组件渲染成静态 HTML，这样极大减少了 我土豆服务…
cover: https://tc.andy-y.cn/i/2026/08/17/6a82fb9a4bcf5.png
---

# 背景

我之前通过 `Typecho` 部署了一个个人博客，说实话，整体运维模式我很喜欢。但是博客即使套了 CDN，请求也几乎都会打到源站数据库，而且我对目前的前端并不满意。  
这时我刚好了解到有个叫 `Astro` 的框架，其默认可以在构建阶段把 `.astro` 等组件渲染成静态 `HTML`，这样极大减少了 ~~我土豆服务器的~~ 性能开销，也可以方便地自定义前端，遂打算把目前的博客前端做成 Astro 的静态页面。

# 规划工作流

考虑到我已经习惯了 `Typecho` 这种动态 CMS 的操作模式，且 `Astro` 本身并不提供方便的博文编辑系统，所以我仍然选择将 `Typecho` 作为 CMS，编辑文章之后触发 `Astro` 自动构建、更新前端。总的工作流大概是：Typecho 发文 → webhook → systemd → builder 重建 → 软链切换 → CDN 刷新 → 访客：

1. 内容编辑与自动重建触发

   ```mermaid
   flowchart LR
       TC["Typecho 1.2.1<br/>headless CMS"] --> DB[("MySQL<br/>typecho_* 表")]
       TC -- "发布 / 下线 / 删除文章" --> AR["AutoRebuild 插件<br/>HMAC-SHA256 签名 webhook"]
       AR --> API["rebuild-api 容器 :9000<br/>验签 + nonce + 防抖"]
       API -- "写 pending / dirty 标记" --> FS["runtime/build/pending"]
       FS --> SD["systemd path unit<br/>blog-rebuild-1panel.path"]
       SD --> SVC["blog-rebuild-1panel.service<br/>启动 builder 容器"]
   ```

2. 构建管线（builder 容器内）

   ```mermaid
   flowchart LR
       SYNC["sync-typecho.js<br/>只读账号拉取 contents / relations /<br/>fields / metas → Markdown"] --> ASTRO["Astro 7 静态构建<br/>Playwright 渲染 mermaid · KaTeX · sitemap"]
       ASTRO --> PF["Pagefind<br/>生成搜索索引"]
       PF --> ALT["patch-beoe-alt.js"]
       ALT --> GATE["门禁链<br/>node --test · render gate<br/>rss gate · stage gates"]
       GATE --> OUT["产出 dist 静态产物"]
   ```

3. 不可变 release 与切换

   ```mermaid
   flowchart TB
       OUT["构建产物"] --> REL["releases/{时间戳-hash8}/<br/>site/ 静态文件<br/>nginx/release-http.conf（旧 URL 301/302 map）<br/>manifest.json · comment-policy.json<br/>cdn-purge-plan.json · cdn-preheat-plan.json<br/>checksums.sha256"]
       REL --> CHK{"switch-release<br/>校验 checksum"}
       CHK -- "通过" --> SYM["切换 current 软链<br/>（回滚 = 指回上一个 release）"]
       CHK -- "失败" --> ABORT["中止，不影响线上"]
       SYM --> CLEAN["cleanup-old-releases.js<br/>仅保留最近 3 个"]
       SYM --> Q["release ID 写入<br/>runtime/cdn/pending 队列"]
   ```

4. 线上运行时与 CDN 分发

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


# 内容同步：从 MySQL 到 Markdown

整条链路的第一步是把 Typecho 里的内容变成 Astro 能吃的东西。`Astro` 的内容层是 Content Collections，期望的是一堆带 frontmatter 的 Markdown 文件，而 Typecho 的内容在 MySQL 里，所以我们需要一个同步脚本。

所以`sync-typecho.js` 干的就是这件事：用一个**只读**数据库账号拉取 `contents` / `relations` / `fields` / `metas` 四张表，把文章、分类、标签、自定义字段拼成 Markdown 文件，顺带处理 Typecho 时代留下的各种 shortcode 和排版习惯，再生成路由映射表和构建清单。



:::alert{type="info"}
本地开发时可以不连数据库，用一份导出的 JSON 快照代替，这样写前端的时候不用把整套 MySQL 也搬到笔记本上。
:::




# 构建：一次构建，一个 release

构建跑在一个专门的 builder 容器里（node 22 + 预装 Playwright Chromium，用来在构建期把文章里的 mermaid 代码块渲染成图）。一次完整构建大概是：

1. `sync-typecho.js` 从 MySQL 同步内容；
2. `astro build` 产出纯静态 HTML，同时生成 sitemap、KaTeX、mermaid 图；
3. `pagefind` 对产物建索引，得到免后端的站内搜索；
4. 跑一串门禁脚本（单元测试、渲染 diff、RSS 校验等），任何一步失败就中止，线上保持原样。

每次构建的产物不是直接覆盖站点目录，而是生成一个带时间戳和哈希的独立 release 目录，里面除了静态文件，还有配套的 nginx 旧链接跳转规则（Typecho 时代的 `/archives/123` 这类 URL 全部 301/302 到新路由，外链和搜索引擎收录不至于死掉）、CDN 刷新/预热清单和整包的 sha256 校验和。

上线工作流只是把 `current` 软链切到新目录——切换前先校验 checksum，有问题就中止，线上不受影响；回滚也无非是把软链指回去。旧 release 保留最近 3 个，再多的会自动清掉防止硬盘爆炸。

# 评论：Waline 旁路

全静态之后唯一保留下来的动态服务即是评论。评论从 Typecho 自带的评论迁到了自建的 `Waline`（让ai写了一个迁移脚本把旧评论搬进 Waline ， ~~虽然没几条~~ ），容器只监听 `127.0.0.1`，由 OpenResty 把 `/api`、`/ui` 反代过去，管理后台单独挂在 `[数据删除].andy-y.cn`。静态页面通过 `@waline/client` 加载评论区，除此之外访客侧没有任何东西会碰到 PHP 和数据库。


:::alert{type="info"}
关于评论的进一步静态化，我最近在考虑接入[giscus](https://giscus.app/zh-CN)，一个基于 GitHub Discussions 的网站评论系统，这样评论全部走GitHub仓库，服务器可以完全不暴露数据库
:::



# CDN：国内外分流

CDN 用了国内外分流：国内解析到阿里云 CDN，海外走 Cloudflare。

每次 release 切换后，构建产物里那份 URL 级的精确刷新清单会被写进一个队列目录，由另一个 systemd path unit 监视并自动提交给阿里云：`RefreshUrls` 刷新变化的页面（包括被跳转的旧 URL），`PushObjectCache` 把规范 URL 预热回边缘节点，提交前还会检查当日配额。

Cloudflare 侧服务器上没有存凭据，不自动 purge，靠 `probe-dual-cdn.js` 定期对边缘节点做只读 hash 探测对账；站点还暴露了一个 `/__release` 端点返回当前 release ID，方便确认两边的缓存到底是不是最新。

# 踩坑总结

- **webhook 要防抖**。在 Typecho 里我们有可能会误点几下保存，或者在构建未完成的时候再次保存，如果每次都触发一次完整构建，不仅会造出一堆脏数据，我的服务器也会直接OOM。所以 rebuild-api 只做验签和写标记文件，真正的合并防抖则交给 systemd 的触发节奏。
- **构建期渲染 mermaid 有性能开销**。builder 镜像里得带 Chromium，镜像体积会增长很多；故我还准备了一个 overlay 镜像，复用底座的依赖只换源码，断网/依赖装不上的时候可以作为回退。（这玩意已经把我的服务器搞崩两次了）
- **跳转规则先观察再放量**。旧链接的 301/302 map 目前跑在 302 观察模式，确认映射没问题之后我才会考虑换 301——301 会被浏览器和 CDN 长缓存，写错了很难收场。

# 总结

折腾完之后的状态我还是很满意的：在 Typecho 后台编辑完文章点下发布，几分钟后访客看到的就是 CDN 上的纯静态 HTML，源站数据库在访客链路上不可见；前端则完全是自己写的 Astro，想改哪里就改哪里。而运维上也没增加什么负担——没有 CI 平台，没有复杂的流水线，就是 webhook + systemd + 一个构建容器，出问题时软链指回去就是回滚。

~~虽然我把一套静态博客搞得像发布系统有点小题大做，但折腾本身不就是博客的意义嘛。~~

