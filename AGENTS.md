# andy-blog 工作说明

给后续在这个仓库里改代码的模型。先读完再动手。给人看的简介在 `README.md`；本文件是约束和地图。事实以仓库代码为准，本文件过期时先改代码再回写这里。

站点：<https://www.andy-y.cn>。作者 AndyYan。个人技术账本，主题是 VPS、BGP、DN42（ASN 4242422921，节点洛杉矶 / 法兰克福 / 香港 / 东京）和自托管。简介数据在 `astro/src/data/profile.ts`。

## 这是什么系统

编辑在 Typecho 1.2.1 写，访客读 Astro 7 静态页。Typecho 是内容源。Astro 仓库里的 Markdown 是同步产物，下一次带数据库的 `scripts/sync-typecho.js` 会按快照重写。改文章正文、标题、缩略图、分类、是否允许评论或订阅，去 Typecho，不要手改 `astro/src/content/**/*.md` 当作正式发布。

构建默认在 off-box，不在网站 VPS 上跑 Playwright。发布是蓝绿：校验 `checksums.sha256` 后原子切换 `current` / `previous`。边缘是 1Panel 上的 OpenResty。CDN 是阿里云加 Cloudflare。评论是 Waline，经 www 反代。搜索是 Pagefind，构建参数 `--force-language zh`。

Node 要求 `>= 22.12`。根目录 `package.json` 管同步、门禁、nginx、CDN。`astro/package.json` 管站点构建。

## 必须遵守

- 生产 SSH 和 MySQL 默认可读。写生产、触发重建、切换 release、清 CDN，都要用户在当次对话里明确授权。
- 不提交 `secrets/`、`backups/`、`.env`、私钥、`.planning/`。工作区里的 `comfy_diag.json` 和 `resume-work/` 与博客无关，不要加进提交。
- 不把生产主机、SSH 端口、私钥路径写进仓库。离机构建 SSH 只存在 VPS 的 `/etc/andy-blog/offbox-builder.env`。
- 不手改生成的 nginx 配置。遗留 URL 改 `data/legacy-url-map.json`，再用 `npm run nginx:302` 或 `npm run nginx:301`。
- 已知 CID 的路由以 `data/route-map.json` 为准。同步脚本禁止给已有 CID 另造 `routeId`。新文章的路径来自 Typecho slug 或自定义字段 `astroPath`。
- 页面 `trailingSlash: 'always'`。例外是无尾斜杠的端点：`/rss.xml`、`/moments/rss.xml`、`/llms.txt`、`/llms-full.txt`。这四个和 `/404` 不进 sitemap。
- 正文里的 `#` 标题在构建期降成 `h2`。目录和阅读进度只认 `h2`。不要改回允许多个 `h1`。
- Markdown 经 `rehype-raw` 之后必须过 `rehype-sanitize`。`:::cloud` 只允许 `http(s)` 或同源路径。`{netease}` / `:::netease` 最少只要歌曲 id（可写 `id="数字"`，或把网易云歌曲链接贴进 `id`）；`title` / `artist` / `cover` 可选，未填时构建期按 id 请求网易云补全（封面仅 `music.126.net` / `music.163.net`，失败用 SVG 唱片占位）。可选 `note` 听后感（最多 48 字，渲染为卡片级 `.netease-note`，ListeningPage 再收进听后感槽；无 note 时不显示听后感槽）。外链文案为「网易云收听」，站内 iframe 收在「站内播放」。网易云 iframe 依赖 nginx CSP `frame-src` 含 `https://music.163.com`（与 bilibili 并列）。`/linuxdo/` 静态页在站点；challenge/claim 走 off-box `https://build2.fei.cx/linuxdo/*`（自建 PoW，不依赖 Turnstile）。
- 文章分享图用 Typecho 自定义字段 `thumb`（环境变量 `FIELD_COVER`，默认 `thumb`）。同步写成 frontmatter `cover`，文章页把它交给 `og:image`。没填缩略图才落到 `/og-default.png`。不要另做一套按篇生成的分享卡，除非用户明确改口。
- `llms.txt` 和 `llms-full.txt` 只收录 `allowFeed === true` 的文章。闲话只在索引里留一个入口链接，不输出闲话正文。
- 新增固定公开 URL 时，同时改三处：`scripts/cdn-purge-core.js` 的 `FIXED_PATHS`、`scripts/generate-cdn-preheat-plan.js` 的固定预热列表、`scripts/stage4-gate.js`。sitemap 过滤在 `astro/astro.config.mjs`。
- 用户没要求时不 `git commit`、不 `git push`。本机提交需要脱离沙箱（Windows 上 sandbox 无法 spawn git）。`core.autocrlf` 会把工作区变成 CRLF；送到 VPS 的文件用 `git archive` 取 LF blob，不要 rsync 工作区副本。
- PowerShell 会展开双引号字符串里的 `$(...)`。远程命令用单引号，或先把脚本 scp 上去再执行。

## 不要顺手做的迁移

保持 Astro 静态站。不要改成 SvelteKit，不要把站点搬到只剩 Cloudflare Workers，不要换成 Giscus，不要加 Inter / Lora 或另一套分析（现有统计保持不动）。首页 DN42 拓扑卡目前是装饰动画，链到 `/dn42/`。把它改成实时状态、做 DN42 阅读路线、做「现在在折腾什么」页，都要等用户点名再做。

## 目录

| 路径 | 作用 |
|---|---|
| `astro/` | 站点。页面、布局、样式、内容集合、Astro 配置 |
| `astro/src/content/posts/` | 文章 Markdown（同步产物） |
| `astro/src/content/pages/` | 独立页，如 about、dn42。`/friends/` 由 `friends.astro` 单独渲染 |
| `astro/src/content/moments/` | 闲话 |
| `astro/src/content.config.ts` | 三个集合的 schema |
| `astro/src/layouts/BaseLayout.astro` | head、OG、JSON-LD、导航、主题 |
| `astro/src/components/ListeningPage.astro` | `/listening/` 曲目目录壳（编号、听后感槽、站内播放互斥） |
| `astro/src/pages/linuxdo/index.astro` | `/linuxdo/` 邀请领取页（静态壳在站点；PoW/发码 API 在 off-box `build2.fei.cx`） |
| `docker/linuxdo-invite/` + `compose.offbox-linuxdo.yml` | off-box 发码 API（8370 + Caddy），env 在构建机 `/etc/andy-blog/linuxdo-invite.env` |
| `astro/src/data/profile.ts` | 首页人物与项目文案 |
| `astro/src/lib/llms.ts` | `llms.txt` / `llms-full.txt` 的纯格式化 |
| `scripts/sync-typecho.js` | 快照 → 内容集合。需要 10 位 `SNAPSHOT_EPOCH` |
| `scripts/` | 门禁、遗留映射、nginx、CDN、评论迁移 |
| `data/` | `route-map.json`、`meta-route-map.json`、`legacy-url-map.json`、`lastmod.json` |
| `host/` | VPS / off-box 发布脚本、systemd、状态页 |
| `typecho/` | CMS 插件脚手架（AutoRebuild、预览） |
| `docker/` | rebuild-api、Waline |
| `nginx/` | 生成出的 `release-http.conf` |
| `docs/` | 阶段基线、方案、runbook |
| `audit/` | 2026-08-26 安全审计与前端复审 |

## 内容模型

三个集合共用字段见 `astro/src/content.config.ts`：`kind`、`title`、`legacyCid`、`canonicalPath`（以 `/` 开头和结尾）、`commentKey`、`feedGuid`、`allowComment`、`allowFeed`、`pubDate`、`updatedDate`、`categories`、`tags`、`cover`、`sourceFormat`（`markdown` 或 `html`）。

- 文章的 `description` 必填，24–180 字。
- 闲话的 `description` 是 8–180 字，另有 `edited`、`images`、`topics`。
- 封面图字段是可选字符串。列表页有封面才渲染；分享图逻辑见上文 `thumb`。
- 公开订阅（RSS 和 llms）用 `allowFeed`。排序是新的在前，然后按 `legacyCid`。

同步来源是 `FIXTURE_PATH` 指向的 JSON，或 `DB_*` 环境变量指向的 MySQL。`CONTENT_BACKUP_DIR` 若设置，只把 Markdown 写到该目录，不改生产路由表和 Astro 内容。

## 访客能看到的页面

- `/` 首页：简介、两张入口卡、最近 3 篇文章、项目卡。DN42 拓扑卡在桌面和简介并排；手机上跟在最近文章后面，首屏先看到文章。
- `/posts/`、`/page/[n]/` 文章列表。`/posts/[id]/` 文章。文头有发布日期、预计阅读时间（400 字/分钟，至少 1 分钟）和字数；`updatedDate` 与发布日不是同一天时再显示「更新于」。文末已有上一篇 / 下一篇和按标签挑的相关文章。
- `/moments/`、`/moments/[id]/`、`/moments/page/[n]/` 闲话。
- `/archive/` 归档。`/archives` 与 `/archives/` 重定向到 `/archive/`。
- `/category/[id]/`、`/tag/[id]/`。不可发现的分类不进 sitemap。
- `/friends/` 友链。`/listening/` 最近在听：Typecho 独立页正文只放 `{netease}` 短代码，页面壳是 `ListeningPage.astro`；`data/route-map.json` 须预置该页真实 cid（本地 fixture 可用临时 cid）。`/linuxdo/` 邀请领取：Astro 固定页在站点；验证与发码走 off-box `https://build2.fei.cx/linuxdo/{challenge,claim}`（自建 PoW）；不进 sitemap，默认 noindex；旧说明文 `/posts/linuxdo/` 可保留并链过来。`/about/`、`/dn42/` 来自 pages 集合，走 `astro/src/pages/[...page].astro`。
- `/rss.xml`、`/moments/rss.xml`。
- `/llms.txt` 链接目录，`/llms-full.txt` 文章全文。`robots.txt` 用注释指向这两个 URL。
- `/og-default.png` 全站兜底分享图，由 `scripts/generate-og-default.mjs` 用 Playwright 画 1200×630。

文章页阅读进度和侧边目录依赖 `h2`。KaTeX、Pagefind、Waline 按需加载。主题是亮 / 暗加 View Transitions，`prefers-reduced-motion` 要保持有效。代码块复制按钮文案是中文。Mermaid 在构建期由 `@beoe/rehype-mermaid` 画成双主题 SVG，访客可用 lightbox。字体是系统 CJK 栈，不要换成网页可变字体。

JSON-LD：文章是 `BlogPosting`，首页是 `ProfilePage`。`Person.sameAs` 还没有，不要擅自加。

## 渲染管线

配置在 `astro/astro.config.mjs`。`site` 固定为 `https://www.andy-y.cn`。

remark：`remark-math`、`remark-directive`、自定义 directive、图片尺寸探测。  
rehype：raw → sanitize → KaTeX → 标记使用了 KaTeX 的页 → Mermaid → 图表图片 → 降级 h1 → 表格包一层 → slug → 标题锚点。

Expressive Code 主题是 `github-light` / `github-dark`，跟 `data-theme` 走，不跟系统媒体查询走。CSS 构建目标是 chrome111、firefox128、safari16.4、edge111，避免压缩时丢掉标准 `backdrop-filter`。

## 本地怎么构建

只改前端、内容 Markdown 已经在树里时：

```powershell
npm --prefix astro install
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm --prefix astro run dev
```

`astro` 的 build 会跑 Playwright（Mermaid）、把 beoe 拷进 dist、再跑 `pagefind --site dist --force-language zh`。没设 `PLAYWRIGHT_BROWSERS_PATH` 时，Mermaid 可能静默丢掉正文。

根目录 `npm run build` 会先跑一组测试，再 `sync`（必须有 `SNAPSHOT_EPOCH`）、生成遗留映射和 nginx 302、然后 Astro build，最后跑 render、rss、stage4、stage6、stage7、stage8 门禁。没有快照或数据库时不要跑这条，改跑 `npm --prefix astro run build` 加你碰到的单测。

常用单测：`node --test scripts/llms.test.js`、`npm run cdn:purge:test`、`npm run cdn:aliyun:test`。改了对应脚本再跑，不要为了保险把全部 stage 门禁空跑一遍。

## 生产发布

控制树：`/var/www/andy-blog`。这里不是 git 仓库。站点根：`/opt/1panel/www/sites/www.andy-y.cn/deploy`，`current` 和 `previous` 是指向 `releases/<id>` 的符号链接。

systemd：

- `blog-rebuild-1panel.path` 监视 `/var/www/andy-blog/runtime/build/pending` 和 `dirty`。
- `blog-rebuild-1panel.service` 是 oneshot，`TimeoutStartSec=900`，执行 `host/blog-rebuild-1panel.sh`。
- 构建器默认 `offbox`。`ANDY_BLOG_BUILDER=vps-overlay` 才会在 VPS 上用 docker 构建，内存重，不要当默认。
- 切换成功后 `ENQUEUE_CDN=1` 会把清缓存任务放进 `/var/www/andy-blog/runtime/cdn`。阿里云任务由 `blog-aliyun-cdn.service` 消费。
- 源修订记在 `/var/www/andy-blog/.deploy-source-revision`，内容是 40 位 hex SHA。

发布顺序：VPS 导出 Typecho 快照 → rsync 控制树到 off-box（排除 `.git`、`node_modules`、`dist`、密钥，并 exclude `astro/.cache` 与 `astro/public/beoe` 以便构建机保留缓存）→ `host/offbox-remote-build.sh` 在 lockfile 变化时 `npm ci`，只清 `astro/node_modules/.astro`（保留 `astro/.cache/img-dims.json` 与 `beoe-cache.json`），再 `scripts/build-release.sh` → 拉回 `release.tar.gz` → 校验 checksum → `host/switch-release-1panel.sh` 原子切换。回滚和前进是 `host/rollback-release.sh`、`host/roll-forward-release.sh`。

Off-box 加速：Mermaid 经持久 Beoe Map 缓存（`astro/.cache/beoe-cache.json`）；`@beoe/rehype-code-hook-img` 上游不转发 `cache`，构建前由 `scripts/patch-beoe-cache-forward.js` 打补丁。`render-gate` / `rss-gate` / `stage4-gate` 并行。阶段耗时打 `PROGRESS_TIMING <phase> <Ns>`。不要整目录删 `astro/.cache`，否则图片尺寸与 Mermaid 缓存会冷启动。

旧的 `host/blog-rebuild.sh` 和 `WWW_ROOT=/var/www/andy-y.cn` 是另一套单元，当前生产走的是 1Panel 这套。不要对着旧路径改。

状态页是独立的：`build2.fei.cx` → Caddy → 环回 off-box status UI，密码会话，失败即关闭。

## 改完怎么确认

改了访客能看到的界面：用浏览器走一遍受影响的路径，包括共用同一布局或同一数据的页面。只截一张图不算验证。

改了 feed、llms、sitemap、robots：看 `astro/dist` 里的文件，并跑 `node scripts/stage4-gate.js`（它要求 dist 已经存在）。

改了 CDN 固定路径：跑 `npm run cdn:purge:test` 和 `npm run cdn:aliyun:test`。

上线之后用公网 URL 看状态码、`Content-Type` 和 body 是否是新的。阿里云响应头里的中文在 Windows 控制台可能乱码，以响应头和字节长度判断，不要据此改文件编码。
