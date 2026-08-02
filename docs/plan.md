# andy-y.cn 博客重构实施方案

> 版本：Draft（审计修订稿）· 2026-07-31
> 架构：Typecho 1.2.1 保留为 Headless CMS → Astro 7 静态站
> 内容：以阶段 0 的数据库一致快照为准；2026-07-31 只读现网基线为首页 12 篇、RSS 10 项、另有 3 个独立页面
> 状态：已修补审计中的设计缺口；只有阶段 0 全部门禁通过后才能升级为 Final

---

## 目录

- [〇、执行前阻断性基线与一致快照](#〇执行前阻断性基线与一致快照)
- [一、架构与技术选型](#一架构与技术选型)
- [二、视觉与动效](#二视觉与动效)
- [三、内容管线](#三内容管线)
- [四、动效实现要点](#四动效实现要点)
- [五、SEO 与 URL 迁移](#五seo-与-url-迁移)
- [六、评论系统](#六评论系统)
- [七、编辑器](#七编辑器)
- [八、部署](#八部署)
- [九、实施计划](#九实施计划)
- [十、风险清单](#十风险清单)
- [十一、参考](#十一参考)

---

## 〇、执行前阻断性基线与一致快照

写第一行代码前完成。**迁移集合不得简单等同于 `status='publish'`。** 默认可静态公开集合必须同时满足：

- `type IN ('post', 'page')`
- `status='publish'`
- `created < snapshotEpoch`
- `password IS NULL OR password=''`

`hidden/private/waiting`、未来发布时间和密码保护内容必须进入排除报告，不得静默发布。所有业务表应为 InnoDB；否则正式快照前必须停写。

```sql
-- 1. 数据库版本、表引擎与 Typecho 路由选项
SELECT VERSION();
SELECT TABLE_NAME, ENGINE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('typecho_contents','typecho_relationships','typecho_metas',
                     'typecho_fields','typecho_comments');
SELECT name, value FROM typecho_options
WHERE name IN ('siteUrl','rewrite','routingTable','frontPage','postsListSize');

-- 2. 内容可见性全貌与默认可导出 CID 集合
SELECT type, status, COUNT(*) total,
       SUM(created >= UNIX_TIMESTAMP()) future_count,
       SUM(COALESCE(password, '') <> '') password_count
FROM typecho_contents
WHERE type IN ('post','page')
GROUP BY type, status;
SELECT cid, type, title, slug, created, modified, allowComment, allowFeed
FROM typecho_contents
WHERE type IN ('post','page') AND status='publish'
  AND created < UNIX_TIMESTAMP() AND COALESCE(password, '')=''
ORDER BY cid;

-- 3. 多分类、空/重复 slug；多分类必须全部保留
SELECT r.cid, COUNT(*) category_count
FROM typecho_relationships r
JOIN typecho_metas m ON m.mid=r.mid
WHERE m.type='category'
GROUP BY r.cid HAVING COUNT(*) > 1;
SELECT type, slug, COUNT(*) c FROM typecho_contents
WHERE type IN ('post','page') AND status='publish'
GROUP BY type, slug HAVING c>1 OR slug IS NULL OR slug='';

-- 4. 内容格式、自定义字段与本地附件
SELECT type,
       SUM(text LIKE '<!--markdown-->%') md_mode,
       SUM(text NOT LIKE '<!--markdown-->%') html_mode
FROM typecho_contents WHERE type IN ('post','page') GROUP BY type;
SELECT name, type, COUNT(*) FROM typecho_fields GROUP BY name, type;
SELECT COUNT(*) FROM typecho_contents WHERE text LIKE '%/usr/uploads/%';

-- 5. 评论范围、孤儿内容与孤儿父评论
SELECT type, status, COUNT(*) total FROM typecho_comments GROUP BY type, status;
SELECT c.coid, c.cid, c.parent
FROM typecho_comments c
LEFT JOIN typecho_contents p ON p.cid=c.cid
LEFT JOIN typecho_comments parent ON parent.coid=c.parent
WHERE p.cid IS NULL OR (c.parent<>0 AND parent.coid IS NULL);
```

宿主为每个逻辑 job 固定并持久化一个数据库时钟 `snapshotEpoch`；同步脚本必须在**同一连接**上设置 `REPEATABLE READ`，用该 cutoff 在 consistent snapshot 中读取内容、关系、字段和评论基线。先把结果读入内存并记录行数/SHA-256，提交事务后再生成文件；同一 descriptor 的重试必须复用 cutoff，固定 fixture 的连续同步应得到字节级一致产物。

开发前、评论最终迁移前和正式切换前各做一次备份；至少完成一次恢复演练。示例：`mysqldump --single-transaction --routines --triggers typecho > backup-$(date +%F-%H%M%S).sql`。

**阶段 0 门禁**：SQL 可公开 CID、生成内容 CID、活动路由 CID 三个集合完全相等；未来/密码/隐藏内容意外导出数为 0；现网匿名可访问清单与 SQL 集合之间没有无法解释的差异。

---

## 一、架构与技术选型

### 1.1 架构图

```
┌──────────────────────────────────────────────────────────┐
│ Typecho 1.2.1 (PHP/MySQL) — cms.andy-y.cn 独立写作后台   │
│   ├─ 现有数据库不迁移、不改写                            │
│   ├─ 短代码 {alert}/{cloud}/{bilibili} 保持原样          │
│   └─ 发布/下线/删除钩子 → HMAC 排队，不阻塞后台请求      │
└───────────────┬──────────────────────────────────────────┘
                │ ① 构建时：Node 直连 MySQL 读取
                │ ② 发布时：HMAC 签名 webhook 触发重建
                ↓
┌──────────────────────────────────────────────────────────┐
│ Astro 7 SSG 构建管线 (Docker, Debian 基础镜像)           │
│   ├─ 一致快照 → 不可变路由表 → Content Collections       │
│   ├─ 短代码 → remark-directive（构建期，不改库）         │
│   ├─ 渲染：Expressive Code + BEOE Mermaid + KaTeX        │
│   ├─ 索引：Pagefind 站内搜索（构建期生成）               │
│   └─ 产物：静态 HTML + CSS + ≤12KB JS                    │
└───────────────┬──────────────────────────────────────────┘
                │ releases/ + mv -T 原子切换
                ↓
┌──────────────────────────────────────────────────────────┐
│ Nginx (同一源站、两个独立 vhost)                         │
│   ├─ www：静态站、旧 URL 重定向、Waline API、uploads     │
│   ├─ cms：Typecho/PHP-FPM，noindex + 访问控制             │
│   └─ 源站 gzip + TLS；Brotli 由两家 CDN 边缘提供          │
└───────────────┬──────────────────────────────────────────┘
                │ 阿里云 DNS 按地域/线路解析（源站不分流）
      ┌─────────┴────────────────────┐
      ↓                              ↓
  国内 CNAME                    境外 CNAME
  → 阿里云 CDN                  → Cloudflare SaaS 自定义主机名
```

两条 CDN 链路回源同一 VPS。`cms.andy-y.cn` 不加入双 CDN 缓存链。旁挂：Waline 评论服务（Docker，8360）、umami 统计、Lsky Pro 图床。

### 1.2 技术选型

| 层次 | 选型 | 版本（2026-07-31 核实） |
|---|---|---|
| 框架 | Astro | 7.1.6 |
| Markdown 处理器 | `@astrojs/markdown-remark` 的 `unified()` | 7.2.2 |
| 代码高亮 | astro-expressive-code | 0.44.1（peer 含 `^7.0.0`） |
| Mermaid | @beoe/rehype-mermaid | 0.4.2 |
| 数学公式 | remark-math + rehype-katex（**自托管 CSS**） | katex 0.18.1 |
| Directive | remark-directive | 4.0.0 |
| 图标 | astro-icon + @iconify-json/lucide | 1.1.5 / 1.2.121 |
| 站内搜索 | Pagefind | 1.5.2 |
| 评论 | @waline/client + `lizheming/waline` 镜像 | 3.15.2 |
| 图片尺寸探测 | probe-image-size | 7.3.0 |
| YAML 序列化 | js-yaml | 5.2.2 |
| 数据库驱动 | mysql2 | 3.23.2 |
| slug 生成 | slugify | 1.6.9 |
| 动效 | 原生 CSS + Astro View Transitions | 内置 |

**两点必须知道的版本事实**：

1. **Astro 7 的默认 Markdown 处理器是 Sätteri（Rust），remark/rehype 不再默认可用。** 本项目管线（directive、mermaid、katex）全依赖 unified 生态，因此必须单独安装 `@astrojs/markdown-remark` 并显式指定 `processor: unified({...})`。顶层的 `markdown.remarkPlugins` / `markdown.rehypePlugins` 已废弃，Astro 8 将移除，参数要传进 `unified()`。
2. **Astro 5+ 的 Content Collections 保留字段是 `id`，不是 `slug`。** 在 schema 中声明 `slug` 会抛 `ContentSchemaContainsSlugError`。本方案已用 Astro 7.1.6 实测：frontmatter 的 `slug` 可覆盖 glob loader 的默认 id；但它必须来自持久化的 `cid → routeId` 路由表，业务代码只读取 `entry.id`/`canonicalPath`，不得重新算 slug。`[id].astro` 是本项目约定，不是 Astro 的强制文件名。

**阶段 0 仍需做集成 spike**：锁定 Astro 7.1.6、`@astrojs/markdown-remark` 7.2.2、Expressive Code 0.44.1 与 BEOE 0.4.2，验证普通代码块、Mermaid、双主题和最终插件顺序。若 fixture 不通过，先停在阶段 0 决定是改用 Astro 内置 Shiki（排除 `mermaid`）还是降级框架；不得把未验证组合带入内容迁移。

---

## 二、视觉与动效

**定位**：排版驱动，内容优先。动效只服务阅读体验，不喧宾夺主。参照 Vercel Blog、Linear 文档、Astro 官方文档。

### 2.1 字体

无 Web Font，零加载时间，系统字体栈全平台可用。中文 Web Font 即使子集化 3500 字仍在 1.5–3MB 量级，与性能预算不相容，因此不使用。

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI",
             "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
--font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code",
             "Noto Sans Mono CJK SC", monospace;
```

### 2.2 配色

低饱和度，单一强调色，避免紫蓝渐变。

```css
:root[data-theme="light"] { --bg:#fafafa; --text:#1a1a1a; --muted:#6b7280; --accent:#d97706; }
:root[data-theme="dark"]  { --bg:#0a0a0a; --text:#e5e5e5; --muted:#9ca3af; --accent:#fbbf24; }
```

**无障碍约束**：`#d97706` 对 `#fafafa` 的对比度约 3.9:1，**低于正文所需的 4.5:1**。因此强调色仅用于下划线、图标、边框等非正文用途；正文链接文字用 `--text` 并以下划线区分，不靠颜色单独承载信息。这是 Accessibility ≥95 的必要条件。

### 2.3 动效清单

三档时长阶梯：**150ms**（即时反馈）/ **200ms**（状态变化）/ **250ms**（位置变化）。曲线统一 `cubic-bezier(0.4, 0, 0.2, 1)`。

| # | 元素 | 效果 | 时长 |
|---|---|---|---|
| 1 | 页面切换 | fade 淡入（View Transitions） | 200ms |
| 2 | 链接 hover | 下划线从左到右生长 | 150ms |
| 3 | 代码块复制按钮 | 不透明度 0.1→0.2 | 150ms |
| 4 | Sticky 导航 | `backdrop-filter: blur(12px)`，固定无动画 | — |
| 5 | 卡片 hover | 向上 -2px + 阴影增强 | 200ms |
| 6 | 暗色切换 | 颜色过渡 | 200ms |
| 7 | 外链图标 | 向右上 2px | 150ms |
| 8 | 返回顶部 | 淡入淡出 | 250ms |
| 9 | **文章阅读进度** | 右侧竖排指示器，每个 h2 一格，当前节高亮 | 150ms |
| 10 | **图片灯箱** | FLIP 变换放大（非淡入） | 250ms |

第 9、10 项说明：

- **阅读进度指示器**用纯 CSS `animation-timeline: view()` 驱动，IntersectionObserver 作兜底。长文导航确有实用价值，不是装饰。
- **FLIP 灯箱**记录缩略图与目标位置，用 `transform` 插值，观感优于淡入，代码量与 medium-zoom 相近。

### 2.4 图标

**全站统一 Lucide，构建期内联 SVG，零运行时。不使用表情符号**——跨平台字形不一致（Windows / macOS / Android 三套渲染），且与克制定位相悖。

### 2.5 反模板硬约束

- 无滚动逐段淡入（技术长文大忌）、无满屏视差、无弹跳效果、无装饰性 blob 图形
- 无玻璃拟态卡片阵列
- 无"居中大标题 + 副标题 + 两个按钮"的通用 hero
- 卡片圆角 6px，不用千篇一律的 12px
- 所有动效曲线统一，禁止各处随手 `ease-in-out`

### 2.6 性能预算

| 项 | 目标 |
|---|---|
| JS 总量 | ≤12KB gzip（ClientRouter ~8KB + 灯箱/主题/进度条 ~4KB） |
| LCP | <1.2s（国内 / 国外分别测） |
| Lighthouse | Performance ≥95 · SEO 100 · Accessibility ≥95 |

> Astro View Transitions 并非零成本，`<ClientRouter>` 约 6–8KB gzip。上表已计入。

**降级要求**：`prefers-reduced-motion: reduce` 下关闭全部 10 条动效，View Transitions 亦禁用。

---

## 三、内容管线

### 3.1 数据拉取

#### 3.1.1 一致快照与公开集合

同步同时读取 `post` 和 `page`。页面不能只触发 webhook 却不进入静态集合；多分类不能用 `find()` 折叠为一项。

```javascript
// scripts/sync-typecho.js（关键骨架）
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { convertShortcodes } from './lib/shortcodes.js';

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
});

await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
// cutoff 由一次 build run 先从数据库时钟捕获，再固定传入；禁止每次同步自行取“现在”。
const rawSnapshotEpoch = process.env.SNAPSHOT_EPOCH;
if (!/^\d{10}$/.test(rawSnapshotEpoch ?? '')) throw new Error('SNAPSHOT_EPOCH is required');
const snapshotEpoch = Number(rawSnapshotEpoch);
const [[clock]] = await db.query('SELECT UNIX_TIMESTAMP() dbNow');
if (!Number.isSafeInteger(snapshotEpoch) || snapshotEpoch > clock.dbNow) {
  throw new Error('invalid/future SNAPSHOT_EPOCH');
}

const [contents] = await db.query(`
  SELECT cid, type, title, slug, text, created, modified,
         allowComment, allowFeed, \`order\`
  FROM typecho_contents
  WHERE type IN ('post','page') AND status='publish'
    AND created < ? AND COALESCE(password, '')=''
  ORDER BY cid
`, [snapshotEpoch]);

const cids = contents.map((item) => item.cid);
const [relations] = cids.length ? await db.query(`
  SELECT r.cid, m.mid, m.name, m.slug, m.type, m.\`order\`
  FROM typecho_relationships r
  JOIN typecho_metas m ON m.mid=r.mid
  WHERE r.cid IN (?)
  ORDER BY r.cid, m.type, m.\`order\`, m.mid
`, [cids]) : [[]];
const [fields] = cids.length ? await db.query(`
  SELECT cid, name, type, str_value, int_value, float_value
  FROM typecho_fields WHERE cid IN (?) ORDER BY cid, name
`, [cids]) : [[]];

// 三组查询均完成后才提交；记录固定 snapshotEpoch、行数和规范化数据 SHA-256。
await db.commit();
await db.end();
```

若任一步读取失败必须 `rollback()`。每个 build run 先用数据库时钟捕获一次 cutoff，保存到 run descriptor 并以 `SNAPSHOT_EPOCH` 传给内容、关系、评论和 manifest 生成的所有进程；重试同一 run 必须复用它。生成文件发生在事务提交后，使用临时输出目录；全部 schema、短代码和对账检查通过后再原子替换生成目录，防止半批文件进入构建。

#### 3.1.2 不可变 `cid → routeId`

`.cache/manifest.json` 只是派生产物，不能充当路由事实来源。新增持久化、纳入版本控制和备份的 `data/route-map.json`：

```json
{
  "13": {
    "kind": "post",
    "routeId": "maibot-astrbot-napcat",
    "canonicalPath": "/posts/maibot-astrbot-napcat/",
    "sourceSlug": "typecho-original-slug",
    "feedGuid": "https://www.andy-y.cn/index.php/archives/13/",
    "commentKey": "/posts/maibot-astrbot-napcat/",
    "legacyPaths": [
      "/index.php/archives/13/",
      "/archives/13/"
    ],
    "state": "active"
  }
}
```

硬规则：

1. 既有 CID 的 `routeId`、`canonicalPath`、`feedGuid`、`commentKey` 不因标题、Typecho slug、查询顺序或新增内容变化。
2. 新 CID 只分配一次；碰撞用 `-${cid}`，禁止使用依赖遍历顺序的 `-2/-3`。
3. `routeId` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，并拒绝 `/`、`.`、`..`、空白、`?`、`#`、`%`、CR/LF 和 Nginx 控制字符。
4. `page` 的 `canonicalPath` 逐页人工确认（例如 `/about/`）；没有显式记录就阻断构建，不能默认当作 post。
5. Typecho slug 改名只更新 `sourceSlug` 并追加有证据的旧路径；新站 canonical 不变。
6. 删除或转草稿时输出文件消失，但路由记录保留为 `tombstone`，并显式记录处置：临时不可用 `not_found`（404）、确认永久删除 `gone`（410），或人工指定一个仍为 active 且终点 200 的 successor。历史路径不得继续重定向到已经消失的 canonical。
7. 路由表先写同目录临时文件、校验后原子 rename；构建失败不得留下半写状态。
8. 既有内容的 `feedGuid` 从切换前 RSS fixture/真实 permalink 导入，不按模板猜测；新内容首次发布时生成稳定 `urn:andy-y:post:{cid}` 并写回路由表，之后不变。

分类和标签使用同样持久的 `data/meta-route-map.json`（键为 `mid`，记录 type/routeId/canonicalPath/legacyPaths）。名称或 Typecho slug 改动不能无声改变新站分类/标签 URL；确需改路由时必须追加旧路径并走 302→301 流程。

#### 3.1.3 文件生成与关系保真

每个内容的 frontmatter 至少包含：

```yaml
slug: maibot-astrbot-napcat # 仅用于覆盖 entry.id；不进入 schema
kind: post
legacyCid: 13
canonicalPath: /posts/maibot-astrbot-napcat/
commentKey: /posts/maibot-astrbot-napcat/
feedGuid: https://www.andy-y.cn/index.php/archives/13/
allowComment: true
allowFeed: true
pubDate: 2026-01-01T00:00:00.000Z
updatedDate: 2026-01-02T00:00:00.000Z
categories:
  - { mid: 8, name: AI, slug: ai }
  - { mid: 9, name: 复盘, slug: review }
primaryCategoryMid: 8
tags:
  - { mid: 12, name: Astro, slug: astro }
sourceFormat: markdown
```

`categories`/`tags` 按 `order, mid` 稳定排序，保存全部关系。面包屑需要主分类时使用显式 `primaryCategoryMid`；无显式值时不擅自取查询第一行。MySQL 的 `allowComment/allowFeed` 明确转成布尔值，不能把 `0/1` 直接交给 boolean schema。封面字段名仍由阶段 0 查询决定，通过 `FIELD_COVER` 对齐。`sourceFormat: html`、旧站内部链接、附件和短代码残留全部进入报告；最终切换前正文中的旧内部链接数必须为 0。

posts 输出到 `src/content/posts/`，pages 输出到 `src/content/pages/`。文件内容继续用 `js-yaml` 序列化；`slug` 取路由表的 `routeId`，不得现场计算。派生 `.cache/manifest.json` 采用 `{ snapshotEpoch, entries, sitemapLastmod, sitemapExclude }` 结构；每个 entry 至少输出 `cid/kind/entryId/canonicalPath/commentKey/legacyPaths/updatedDate`，供 RSS、评论、重定向、sitemap 和全量对账共同使用。`sitemapLastmod` 覆盖 sitemap 中每个 post/page/list canonical（列表取该集合内最新 `modified`）；`sitemapExclude` 只能列阶段 0 明确认定的薄内容路径，不能靠字符串规则排除整个 tag/category 集合。

**Content Collection 定义**：

```typescript
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const meta = z.object({
  mid: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
});

const commonSchema = z.object({
  kind: z.enum(['post', 'page']),
  title: z.string(),
  legacyCid: z.number().int().positive(),
  canonicalPath: z.string().startsWith('/').endsWith('/'),
  commentKey: z.string().startsWith('/'),
  feedGuid: z.string().min(1),
  allowComment: z.boolean(),
  allowFeed: z.boolean(),
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date(),
  categories: z.array(meta).default([]),
  primaryCategoryMid: z.number().int().positive().optional(),
  tags: z.array(meta).default([]),
  cover: z.string().optional(),
  sourceFormat: z.enum(['markdown', 'html']),
});

export const collections = {
  posts: defineCollection({
    loader: glob({ base: './src/content/posts', pattern: '**/*.md' }),
    schema: commonSchema.extend({ kind: z.literal('post') }),
  }),
  pages: defineCollection({
    loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
    schema: commonSchema.extend({ kind: z.literal('page') }),
  }),
};
```

`slug` 绝不能加入 schema。Astro 7.1.6 契约测试必须证明每条 `entry.id === routeId`。post 使用 `src/pages/posts/[id].astro`；page 用 catch-all `getStaticPaths()` 返回路由表中已审定的 `canonicalPath`。canonical、RSS link、评论 key 和重定向目标全部读取同一派生 manifest。

**阶段 1 门禁**：固定同一个 caller-supplied `SNAPSHOT_EPOCH`、同一数据库快照 fixture 与同一路由表，连续同步两次后内容文件和规范化 manifest 字节级一致；run ID、耗时等运行元数据另存，不进入确定性比较。公开 SQL CID、输出 CID、活动路由 CID 三集合相等；每个 CID 的分类/标签 mid 集合与数据库完全一致；所有 page 有显式新旧路径；修改标题/slug 并新增同名内容后，既有 `routeId` 变化数为 0。

### 3.2 短代码转换（构建期，不改数据库）

数据库保持原样，转换发生在构建期。三个好处：正文可回滚、Typecho 后台继续用熟悉的 `{alert}` 语法、转换逻辑可单元测试。

```javascript
// scripts/lib/shortcodes.js
const parseAttrs = (s = '') => {
  const out = {};
  for (const m of s.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

// 保护代码围栏与行内代码，避免正文里的示例被误转
const shield = (text) => {
  const store = [];
  const masked = text.replace(/(```[\s\S]*?```|`[^`\n]*`)/g, (m) => {
    store.push(m);
    return `\u0000SHIELD${store.length - 1}\u0000`;
  });
  return [masked, (s) => s.replace(/\u0000SHIELD(\d+)\u0000/g, (_, i) => store[i])];
};

export function convertShortcodes(text, cid) {
  const [masked, unshield] = shield(text);
  let out = masked;

  // type 可缺省；内容允许含 { （配置片段、JSON 在技术长文里很常见）
  out = out.replace(/\{alert([^}]*)\}([\s\S]*?)\{\/alert\}/g, (_, attrs, body) => {
    const { type = 'info' } = parseAttrs(attrs);
    return `\n:::alert{type="${type}"}\n${body.trim()}\n:::\n`;
  });

  // 自闭合，属性顺序任意
  out = out.replace(/\{cloud([^}]*)\}/g, (_, attrs) => {
    const a = parseAttrs(attrs);
    return `\n:::cloud{title="${a.title ?? '文件'}" url="${a.url ?? ''}"}\n:::\n`;
  });

  out = out.replace(/\{bilibili([^}]*)\}/g, (_, attrs) => {
    const a = parseAttrs(attrs);
    return `\n:::bilibili{bvid="${a.bvid ?? ''}"}\n:::\n`;
  });

  // 残留检测：宁可构建失败，也不要静默产出半转换的正文
  const leftover = out.match(/\{(alert|cloud|bilibili)[^}]*\}/g);
  if (leftover) throw new Error(`cid=${cid} 短代码残留: ${leftover.join(', ')}`);

  return unshield(out);
}
```

接进构建前先跑 dry-run，打印全部命中与未命中，人工过一遍。

### 3.3 Directive 渲染

**关键约束**：`hName` 只能指定 **HTML 标签名**。`.md` 在 Astro 中被序列化为 HTML 字符串，Astro 组件引用在这条管线里没有表示形式——写 `hName: 'Alert'` 会产出浏览器不认识的 `<alert>` 空元素，组件永不被调用，**且不报错**。因此这里一律输出真实标签 + class，用纯 CSS 出样式。

```javascript
// src/plugins/remark-directives.js
import { visit } from 'unist-util-visit';
import { icons } from '@iconify-json/lucide';   // 构建期取 SVG path，零运行时

const LUCIDE = {
  info: 'info',
  warning: 'triangle-alert',
  danger: 'octagon-alert',
  success: 'circle-check',
};

const iconSvg = (name) => {
  const i = icons.icons[name];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ico">${i.body}</svg>`;
};

export function remarkCustomDirectives() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'containerDirective') return;
      const attrs = node.attributes ?? {};

      if (node.name === 'alert') {
        const type = LUCIDE[attrs.type] ? attrs.type : 'info';
        node.data = {
          hName: 'div',
          hProperties: {
            className: ['alert', `alert-${type}`],
            role: type === 'danger' ? 'alert' : 'note',
          },
        };
        node.children.unshift({ type: 'html', value: iconSvg(LUCIDE[type]) });
      }

      if (node.name === 'cloud') {
        node.data = {
          hName: 'a',
          hProperties: {
            className: ['cloud-card'],
            href: attrs.url,
            rel: 'noopener noreferrer',
            target: '_blank',
          },
        };
        node.children = [
          { type: 'html', value: iconSvg('hard-drive-download') },
          { type: 'html', value: `<span class="cloud-title">${attrs.title ?? '文件'}</span>` },
        ];
      }

      if (node.name === 'bilibili') {
        node.data = {
          hName: 'iframe',
          hProperties: {
            className: ['bili-embed'],
            loading: 'lazy',
            allowfullscreen: true,
            title: `Bilibili 视频 ${attrs.bvid}`,
            src: `https://player.bilibili.com/player.html?bvid=${attrs.bvid}&autoplay=0`,
          },
        };
        node.children = [];
      }
    });
  };
}
```

### 3.4 Markdown 管线

**固定顺序**：`@beoe/rehype-mermaid` 必须先处理标准的 `<pre><code class="language-mermaid">`，Expressive Code 再处理剩余代码块。禁止在 remark 阶段把 Mermaid fence 改成 raw `<pre>`；旧 `remarkMermaidShield` 会破坏 BEOE 的输入结构，必须删除文件、import 和注册项。阶段 0 用最终 HTML fixture 锁定插件顺序，依赖升级必须重跑。

`img-svg` 不是 BEOE 的合法 strategy；合法值只有 `inline | data-url | file`。这里选 `file`，将明暗两份 SVG 写入独立静态目录，减少 HTML/DOM 体积并允许真正懒加载。

```javascript
// src/plugins/rehype-diagram-images.js
import { visit } from 'unist-util-visit';

export function rehypeDiagramImages() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img') return;
      const raw = node.properties?.className ?? [];
      const classes = Array.isArray(raw) ? raw.map(String) : String(raw).split(/\s+/);
      if (!classes.some((name) => name === 'beoe-light' || name === 'beoe-dark')) return;
      node.properties.loading = 'lazy';
      node.properties.decoding = 'async';
    });
  };
}
```

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';   // Astro 7 必须显式安装并指定
import expressiveCode from 'astro-expressive-code';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeMermaid from '@beoe/rehype-mermaid';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { remarkCustomDirectives } from './src/plugins/remark-directives.js';
import { remarkImageSize } from './src/plugins/remark-image-size.js';
import { rehypeDiagramImages } from './src/plugins/rehype-diagram-images.js';
import manifest from './.cache/manifest.json' with { type: 'json' };

const site = 'https://www.andy-y.cn';
const lastmodByUrl = new Map(Object.entries(manifest.sitemapLastmod).map(([pathname, value]) => [
  new URL(pathname, site).href,
  new Date(value),
]));
const sitemapExcluded = new Set(manifest.sitemapExclude ?? []);

export default defineConfig({
  site,
  trailingSlash: 'always',

  integrations: [
    expressiveCode({
      themes: ['github-light', 'github-dark'],
      useDarkModeMediaQuery: false,
      themeCssSelector: (theme) => theme.name === 'github-dark'
        ? "[data-theme='dark']"
        : "[data-theme='light']",
      styleOverrides: { borderRadius: '6px', borderWidth: '1px' },
      defaultProps: { wrap: true },
    }),
    sitemap({
      filter: (page) => !sitemapExcluded.has(new URL(page).pathname),
      serialize: (item) => {
        const lastmod = lastmodByUrl.get(new URL(item.url, site).href);
        if (!lastmod || Number.isNaN(lastmod.valueOf())) {
          throw new Error(`missing sitemap lastmod: ${item.url}`);
        }
        return { ...item, lastmod };
      },
    }),
  ],

  markdown: {
    processor: unified({
      // gfm 默认开启，无需额外声明 remark-gfm
      remarkPlugins: [
        remarkMath,
        remarkDirective,
        remarkCustomDirectives,
        remarkImageSize,
      ],
      rehypePlugins: [
        rehypeRaw,                // directive 产出的 html 节点需要它解析
        rehypeKatex,
        [rehypeMermaid, {
          strategy: 'file',
          fsPath: 'public/beoe',
          webPath: '/beoe',
          darkScheme: 'class',
        }],
        rehypeDiagramImages,
        rehypeSlug,
        // behavior 用 append 而非 wrap —— wrap 会把标题文字整个包进 <a>，
        // 对可访问性与 SEO 都不理想。
        [rehypeAutolinkHeadings, {
          behavior: 'append',
          content: { type: 'text', value: '#' },
          properties: { className: ['anchor'], ariaLabel: '本节锚点' },
        }],
      ],
    }),
  },
});
```

```css
.beoe img { display:block; max-width:100%; height:auto; margin-inline:auto; }
html[data-theme='light'] .beoe-dark,
html[data-theme='dark'] .beoe-light { display:none; }
```

**管线门禁**：同一篇 fixture 同时包含 TypeScript fence 与 Mermaid fence。构建后普通 fence 必须是 Expressive Code markup；Mermaid 必须是 `.beoe` 下的 `<img>`，两份 SVG 均存在且返回 200，不能出现源码裸露或 EC 包裹。系统主题与站内主题相反时仍以 `data-theme` 为准；连续构建两次不得出现 Chromium、缓存或输出路径错误。Mermaid 渲染失败必须让构建失败，不能降级发布源码。

**KaTeX CSS 必须自托管**。把 `katex.min.css` 与 4 个字体文件拷进 `public/vendor/katex/`。jsDelivr 在中国大陆时通时不通，备案站不能赌；这也与"构建期渲染 Mermaid 以摆脱 CDN 依赖"的初衷一致。

**为什么用 `@beoe/rehype-mermaid`**：其 `darkScheme:'class'` 会生成 `.beoe-light/.beoe-dark` 两份图，可由站内 `data-theme` 明确控制，不依赖系统 `prefers-color-scheme`。

### 3.5 图片

远程图片不纳入 `astro:assets` 优化，直接引用——图床自托管且稳定，构建期下载会拖慢构建并引入外部依赖。

**防 CLS**：用 `probe-image-size` 只读图片头部（几 KB，不下载全图），构建期自动补 `width`/`height`。

```javascript
// src/plugins/remark-image-size.js
import { visit } from 'unist-util-visit';
import probe from 'probe-image-size';

const cache = new Map();   // 可持久化到 .cache/img-dims.json 跨构建复用

export function remarkImageSize() {
  return async (tree) => {
    const jobs = [];
    visit(tree, 'image', (node) => {
      if (!/^https?:/.test(node.url)) return;
      jobs.push((async () => {
        try {
          if (!cache.has(node.url)) {
            cache.set(node.url, await probe(node.url, { timeout: 5000 }));
          }
          const { width, height } = cache.get(node.url);
          node.data = { hProperties: { width, height, loading: 'lazy', decoding: 'async' } };
        } catch (error) {
          // 已有持久缓存时上面不会联网；新 URL 没有尺寸就阻断，不能悄悄破坏 CLS。
          throw new Error(`[img] 新图片尺寸探测失败: ${node.url}`, { cause: error });
        }
      })());
    });
    await Promise.all(jobs);
  };
}
```

`cache` 必须从 `.cache/img-dims.json` 加载并在成功构建后原子保存。已有缓存允许图床短时故障时继续构建；从未见过的新 URL 无尺寸就阻断。首页/文章首屏 cover 或实测 LCP 候选不得 lazy，明确使用 `loading="eager" fetchpriority="high"`；正文折叠线下图片、Bilibili iframe 和 Mermaid 图才使用 lazy。

**本地附件**（§0 第 5 条查询若非零）：Typecho 的 `/usr/uploads/` 原由 PHP 服务，公网 vhost 交给静态站后老文里的本地图会全挂。处置：把 `usr/uploads` 整个目录拷进 `public/usr/uploads/`，路径不变、零改写；nginx 同时保留该路径的 `alias` 兜底。

### 3.6 站内搜索

Pagefind 在构建后扫描产物生成索引，无需服务端，索引按需分片加载。加进构建链：

```json
{ "scripts": { "build": "astro build && pagefind --site dist" } }
```

中文分词依赖页面声明 `<html lang="zh-CN">`。不能只在文字上声称“懒加载”：搜索按钮先打开原生 `<dialog>`，首次交互时才动态插入 `/pagefind/pagefind-ui.css` 与 `/pagefind/pagefind-ui.js`，脚本加载完成后再创建一次 `PagefindUI`；加载 Promise 和已挂载状态要缓存，失败后允许重试。ClientRouter 换页后若 CSS 被 head swap 移除，下次打开需重新注入。

**验收只能用 `npm run build` 后的 `astro preview`**，因为 dev 模式没有 post-build Pagefind 目录。冷启动禁用缓存时，首页和文章首屏对 Pagefind UI、索引和 wasm 的请求数必须为 0；第一次点击搜索后才加载，连续打开只加载一次。用无空格中文句子验证命中，并做键盘焦点闭环和 Escape 关闭测试。

---

## 四、动效实现要点

### 4.1 View Transitions 下的初始化

先在所有页面共享的 `<head>` **实际挂载**路由器；仅写事件监听而没有 `<ClientRouter />` 不会启用客户端导航。

```astro
---
// src/components/CommonHead.astro
import { ClientRouter } from 'astro:transitions';
---
<ClientRouter />
```

`BaseLayout.astro` 固定 `<html lang="zh-CN">`，并让 `ThemeInit` 位于站点 CSS 与 `CommonHead` 之前。文章功能只在存在 `[data-article]` 时动态 import；每个 initializer 必须返回完整 disposer。

```astro
<script>
  type Dispose = () => void;
  let generation = 0;
  let disposers: Dispose[] = [];

  function cleanup() {
    generation += 1;
    for (const dispose of disposers.splice(0)) dispose();
  }

  async function mount() {
    cleanup();
    const current = generation;
    const article = document.querySelector<HTMLElement>('[data-article]');
    if (!article) return;

    const [{ initLightbox }, { initReadingProgress }] = await Promise.all([
      import('../scripts/lightbox'),
      import('../scripts/reading-progress'),
    ]);
    if (current !== generation || !article.isConnected) return;

    for (const result of [initLightbox(article), initReadingProgress(article)]) {
      if (typeof result === 'function') disposers.push(result);
      else if (result?.disconnect) disposers.push(() => result.disconnect());
    }
  }

  document.addEventListener('astro:page-load', mount);
  document.addEventListener('astro:before-swap', cleanup);
</script>
```

`initLightbox(root)` 的 disposer 必须移除 click/keydown/resize listener 并取消 rAF；进度条同理。Playwright 连续导航 20 次，监听器、observer 和 rAF 数量不得增长；非文章页不得请求两个功能 chunk。

### 4.2 主题切换无 FOUC

硬刷新和 ClientRouter swap 都要同步 `data-theme`。`ThemeInit.astro` 的内联脚本先设置首帧主题，再用只安装一次的委托监听把当前主题写进 `event.newDocument`：

```astro
<script is:inline>
  (() => {
    const readTheme = () => {
      try {
        const saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') return saved;
      } catch {}
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };
    const applyTheme = (doc, theme) => { doc.documentElement.dataset.theme = theme; };
    applyTheme(document, readTheme());

    if (window.__andyThemeControllerInstalled) return;
    window.__andyThemeControllerInstalled = true;
    document.addEventListener('astro:before-swap', (event) => {
      applyTheme(event.newDocument,
        document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    });
    document.addEventListener('click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-theme-toggle]') : null;
      if (!button) return;
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(document, next);
      try { localStorage.setItem('theme', next); } catch {}
      button.setAttribute('aria-pressed', String(next === 'dark'));
    });
  })();
</script>
```

Expressive Code 的 `themeCssSelector`、BEOE 的 `.beoe-light/.beoe-dark` CSS 和页面根主题必须同时通过测试。把系统设为浅色、站内选暗色后客户端导航 10 次，正文、代码块和 Mermaid 应始终保持暗色且无闪烁。

### 4.3 reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) {
    animation: none !important;
  }
}
```

灯箱的 FLIP 变换需在 JS 侧同样判断 `matchMedia('(prefers-reduced-motion: reduce)').matches`，命中则直接定位不做插值。

---

## 五、SEO 与 URL 迁移

### 5.1 旧 URL 清单与 302→301 映射

重定向不能只从“当前已发布文章 manifest”生成，也不能猜旧 `.html` 形式。新增持久化 `data/legacy-url-map.json`，来源至少包括：Typecho 路由配置、所有 post/page/category/tag 的现网 permalink、RSS link/guid、正文/导航内部链接、源站与两家 CDN 访问日志、GSC/百度资源平台以及已知外链。

```json
{
  "oldPath": "/index.php/archives/13/",
  "action": "redirect",
  "targetPath": "/posts/maibot-astrbot-napcat/",
  "expectedTerminalStatus": 200,
  "kind": "post",
  "source": ["live-crawl", "rss", "database"],
  "firstSeenAt": "2026-07-31T00:00:00Z",
  "lastVerifiedAt": "2026-07-31T00:00:00Z"
}
```

`action` 只允许 `redirect`、`not_found`、`gone`：后两者 `targetPath=null`，expected status 分别是 404/410；redirect 的 target 必须是 active 路由且终点 200。内容转 tombstone 时，同一事务式生成步骤更新 canonical 与全部 legacy/query 路径的 action，不能留下“301 到已删除页面”的悬空映射。

必须覆盖有证据的 post archive/slug 形式、全部 page、category/tag、旧首页、RSS/Atom、搜索/分页和查询路由。为满足“单跳到最终 canonical”，HTTP 与裸域 vhost 必须先执行同一份 legacy action map：命中 redirect 时直接跳到最终 `https://www` 目标；命中 not_found/gone 时直接返回 404/410；只有未登记路径才做协议/主机收敛。路径映射覆盖带/不带尾斜杠。未知路径返回真实 404，禁止批量跳首页。

Nginx 精确路径映射使用不含 query 的 `$uri`，不能用 `$request_uri`。`?p={cid}` 等查询式旧路由必须用 `"$uri:$arg_p"` 复合键，并只登记 `/`、`/index.php` 等日志/路由配置证实的旧入口；不能只 map `$arg_p`，否则任意新页面携带 `?p=13` 都会误跳。普通跟踪参数在重定向时统一丢弃，避免新 canonical 携带旧 query。Unicode/百分号路径必须用记录到的原始 URL 配合 `curl --path-as-is` 做集成测试，以 Nginx 实际归一化后的 `$uri` 为准。

生成器读取 `route-map.json + legacy-url-map.json`，拒绝同一 oldPath/query 的 action 冲突、CR/LF、非法/非 active target 和未登记 CID，并生成完整的版本化 `nginx/release-http.conf`。其中 map 位于 http 上下文，HTTP、裸域 HTTPS、www HTTPS 三个入口都包含相同 action；生成参数 `--status 302|301` 只把 redirect 状态码以字面量写进三个入口，404/410 不随观察阶段变化：

```nginx
map $uri $legacy_target {
  default "";
  "/index.php/archives/13/" "/posts/maibot-astrbot-napcat/";
}
map "$uri:$arg_p" $legacy_query_target {
  default "";
  "/:13"          "/posts/maibot-astrbot-napcat/";
  "/index.php:13" "/posts/maibot-astrbot-napcat/";
}
# tombstone canonical、path 与 query 分别进入 not_found/gone 布尔 map；不得进入 target map。
map $uri $legacy_not_found { default 0; }
map $uri $legacy_gone      { default 0; }
map "$uri:$arg_p" $legacy_query_not_found { default 0; }
map "$uri:$arg_p" $legacy_query_gone      { default 0; }
# 三个公开 server 都先返回 404/410，再处理下面两行；观察版为 302，固化版为 301。
# if ($legacy_query_target != "") { return 302 https://www.andy-y.cn$legacy_query_target; }
# if ($legacy_target != "")       { return 302 https://www.andy-y.cn$legacy_target; }
```

每个 release 同时携带 `site/`、完整 `nginx/release-http.conf`、候选测试主配置、manifest 和 release ID；URL action map、**302/301 动作**、静态 HTML、sitemap/RSS 必须是同一版本并一起回滚。active redirect 首次上线先用 **302**，在预发布和生产观察至少 7 个自然日，全量矩阵通过后才生成 **301** release；持久部署状态随后保持 301。tombstone 始终按记录返回 404/410，不受 302→301 阶段影响。

**URL 门禁**：对 `legacy-url-map` 与 route tombstone 100% 自动测试，不再抽查 10 条；三个视角中，redirect 必须一跳到记录的 active 终点 200，not_found/gone 必须直接返回 404/410，未知路径必须 404。active 最终 URL/self-canonical/sitemap 完全一致，悬空 target、循环、错误首页跳转和内部重定向链均为 0。

### 5.2 Nginx

```nginx
# /etc/nginx/conf.d/00-release-loader.conf 是唯一固定 loader，处于 http 上下文。
# 启动前必须已有经过验证的 bootstrap release。
include /var/www/andy-y.cn/current/nginx/release-http.conf;
```

以下是版本化 `release-http.conf` 的关键结构。观察版三个 legacy 分支都写字面量 `302`；批准固化时由生成器一次性改为 `301`，不得手工漏改某个 vhost。

```nginx
map $uri $legacy_target {
  default "";
  "/index.php/archives/13/" "/posts/maibot-astrbot-napcat/";
}
map "$uri:$arg_p" $legacy_query_target {
  default "";
  "/:13"          "/posts/maibot-astrbot-napcat/";
  "/index.php:13" "/posts/maibot-astrbot-napcat/";
}
map $uri $legacy_not_found { default 0; }
map $uri $legacy_gone      { default 0; }
map "$uri:$arg_p" $legacy_query_not_found { default 0; }
map "$uri:$arg_p" $legacy_query_gone      { default 0; }

server {
  listen 80;
  server_name www.andy-y.cn andy-y.cn;
  if ($legacy_query_not_found) { return 404; }
  if ($legacy_not_found)       { return 404; }
  if ($legacy_query_gone)      { return 410; }
  if ($legacy_gone)            { return 410; }
  if ($legacy_query_target != "") { return 302 https://www.andy-y.cn$legacy_query_target; }
  if ($legacy_target != "")       { return 302 https://www.andy-y.cn$legacy_target; }
  return 301 https://www.andy-y.cn$request_uri;
}
server {
  listen 80;
  server_name cms.andy-y.cn;
  return 301 https://cms.andy-y.cn$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name andy-y.cn;
  ssl_certificate     /etc/letsencrypt/live/andy-y.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/andy-y.cn/privkey.pem;
  if ($legacy_query_not_found) { return 404; }
  if ($legacy_not_found)       { return 404; }
  if ($legacy_query_gone)      { return 410; }
  if ($legacy_gone)            { return 410; }
  if ($legacy_query_target != "") { return 302 https://www.andy-y.cn$legacy_query_target; }
  if ($legacy_target != "")       { return 302 https://www.andy-y.cn$legacy_target; }
  return 301 https://www.andy-y.cn$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name www.andy-y.cn;

  ssl_certificate     /etc/letsencrypt/live/andy-y.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/andy-y.cn/privkey.pem;

  root /var/www/andy-y.cn/current/site;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml application/xml+rss;
  gzip_min_length 1024;
  # stock nginx 镜像不含 ngx_brotli；Brotli 由阿里云 CDN/Cloudflare 边缘提供。

  # tombstone 先返回策略状态；观察窗用 302，全量验证后把三个 redirect 入口同时改 301。
  if ($legacy_query_not_found) { return 404; }
  if ($legacy_not_found)       { return 404; }
  if ($legacy_query_gone)      { return 410; }
  if ($legacy_gone)            { return 410; }
  if ($legacy_query_target != "") { return 302 https://www.andy-y.cn$legacy_query_target; }
  if ($legacy_target != "")       { return 302 https://www.andy-y.cn$legacy_target; }

  # www 不暴露 Typecho 或任意 PHP。
  location = /admin { return 404; }
  location ^~ /admin/ { return 404; }
  location ~ \.php(?:/|$) { return 404; }

  # 不用 ^~，让上面的 PHP regex 仍能拦截 uploads 下的 PHP。
  location /usr/uploads/ {
    alias /var/www/typecho/usr/uploads/;
    expires 30d;
  }

  location ^~ /api/ {
    proxy_pass http://waline:8360;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_read_timeout 30s;
    add_header Cache-Control "no-store" always;
  }
  location = /ui { return 308 /ui/; }
  location ^~ /ui/ {
    proxy_pass http://waline:8360;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-store" always;
  }

  location ^~ /_astro/ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location = /__release {
    try_files /release-id.txt =503;
    add_header Cache-Control "no-store" always;
  }

  # HTML/XML/robots 短边缘缓存；禁止按扩展名给所有非指纹文件 immutable。
  location / {
    try_files $uri $uri/index.html =404;
    add_header Cache-Control "public, max-age=0, s-maxage=600, must-revalidate" always;
  }
}

# Typecho 独立管理入口，不加入 www 的双 CDN 缓存链。
server {
  listen 443 ssl;
  http2 on;
  server_name cms.andy-y.cn;
  ssl_certificate     /etc/letsencrypt/live/cms.andy-y.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/cms.andy-y.cn/privkey.pem;

  root /var/www/typecho;
  index index.php;
  client_max_body_size 64m;
  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;

  # 生产再叠加 VPN/IP allowlist 或独立认证层。
  location / { try_files $uri $uri/ /index.php$uri?$query_string; }
  location = /config.inc.php { deny all; }
  location = /install.php { return 404; }
  location ~ /\.(?!well-known/) { deny all; }

  # 同时支持 /admin/*.php 与 /index.php/action/* PATH_INFO。
  location ~ ^(.+?\.php)(/.*)?$ {
    set $real_script_name $1;
    set $path_info $2;
    try_files $real_script_name =404;
    include fastcgi_params;
    fastcgi_pass typecho:9000;
    fastcgi_param SCRIPT_FILENAME $document_root$real_script_name;
    fastcgi_param SCRIPT_NAME     $real_script_name;
    fastcgi_param PATH_INFO       $path_info;
    fastcgi_param HTTPS           on;
    fastcgi_param HTTP_PROXY      "";
    fastcgi_read_timeout 60s;
  }
}
```

保留数据库 `siteUrl=https://www.andy-y.cn` 时，需在 Typecho `config.inc.php` 把后台插件/主题静态资源固定到 CMS host：

```php
define('__TYPECHO_PLUGIN_URL__', 'https://cms.andy-y.cn/usr/plugins');
// 该常量是“活动主题根 URL”，Typecho 不会再自动追加主题目录。
define('__TYPECHO_THEME_URL__', 'https://cms.andy-y.cn/usr/themes/Joe');
```

阶段 0 必须从 `typecho_options.theme` 与磁盘目录共同确认实际活动主题目录及大小写；上面的 `Joe` 只是当前预期值。登录、发布、上传、预览、退出和 Joe 编辑器资源必须全程留在 `cms` host，并逐项断言关键 JS/CSS 为 CMS host 上的 200，不能只验证后台 HTML。公网源站仅允许两家 CDN 回源（另保留受控运维入口）；Waline 使用真实 IP 前，必须先限制可信 CDN 出口并让两家 CDN 覆盖成统一、不可由访客伪造的客户端 IP 头，再由 Nginx realip 模块还原 `$remote_addr`。两家 CDN 对 `/api/*`、`/ui/*` 明确 bypass cache。

保留 `siteUrl=https://www.andy-y.cn` 对公开 permalink 是必要的，但 Typecho 1.2.1 仍有三个后台直用 `siteUrl` 的例外，不能靠上述资源常量解决，也不能为此在 www 重新开放 `/action/*`。纳入版本控制的 `patches/typecho-1.2.1/admin-origin.patch` 做最小修补：

1. `var/Widget/Options/Permalink.php` 两处 rewrite probe 从 `siteUrl` 改为当前请求的 `rootUrl`，使 `/action/ajax` 只请求 cms。
2. `var/Widget/Users/Profile.php` 的 action 末尾从 public `siteUrl` 改为 `Common::url('profile.php', adminUrl)`。
3. `var/Widget/Login.php` 的 referer allowlist 只接受 `adminUrl` 前缀，不再把 public `siteUrl` 当后台登录回跳目标。

应用前备份这三个文件并核对固定 1.2.1 原文件 SHA-256；patch 自身也固定 SHA-256，先 dry-run/`git apply --check`，应用后再核对 patched hash。CI 对 Typecho 后台/action 代码中的直接 `siteUrl` 引用维护逐项说明的 allowlist，出现新引用就阻断。任一 hash 不符就不模糊套补丁；Typecho 升级必须重新审计/重做 patch。纵向测试覆盖 permalink/rewrite 设置、档案/密码/插件设置、登录成功/失败/referer、发布/上传/退出；Network/Location 中后台状态请求与回跳必须留在 cms，刻意的“查看网站”链接和文章 public permalink 仍指向 www。www 的 `/action/*`、PHP、admin 继续 404。

`new.andy-y.cn` 不复用生产评论库。它有可执行的 Compose override、独立数据库账号/schema 和独立 TLS vhost；生产 `SECURE_DOMAINS` 始终只含 `www.andy-y.cn`：

```yaml
# compose.staging.yml；仅以 -f compose.yml -f compose.staging.yml --profile staging 启动。
services:
  nginx:
    depends_on: [typecho, waline, waline-staging]
    volumes:
      - ./nginx/staging-loader.conf:/etc/nginx/conf.d/90-staging-loader.conf:ro

  waline-staging:
    image: ${WALINE_IMAGE:?same digest-pinned image as production}
    profiles: [staging]
    restart: unless-stopped
    expose: ['8360']
    volumes:
      - '${WWW_ROOT:?set an absolute host WWW_ROOT}:/var/www/andy-y.cn:ro'
    environment:
      TZ: Asia/Shanghai
      SITE_NAME: andy-y.cn staging
      SITE_URL: https://new.andy-y.cn
      SERVER_URL: https://new.andy-y.cn
      SECURE_DOMAINS: new.andy-y.cn
      COMMENT_POLICY_FILE: /var/www/andy-y.cn/candidate/comment-policy.staging.json
      JWT_TOKEN: ${WALINE_STAGING_JWT:?required}
      MYSQL_HOST: ${DB_HOST:?required}
      MYSQL_DB: ${WALINE_STAGING_DB_NAME:?required}
      MYSQL_USER: ${WALINE_STAGING_DB_USER:?required}
      MYSQL_PASSWORD: ${WALINE_STAGING_DB_PASSWORD:?required}
      MYSQL_PREFIX: wl_
    networks: [app, data_egress]
```

`staging-loader.conf` 只 include `/var/www/andy-y.cn/candidate/nginx/staging-http.conf`。该版本化文件使用独立的 `$staging_legacy_target` / `$staging_legacy_query_target` / `$staging_not_found` / `$staging_gone` 及 query 变体，不能覆盖生产变量；至少包含下面的 TLS vhost（HTTP vhost执行同一 action 后再做 HTTPS 跳转）：

```nginx
server {
  listen 443 ssl;
  http2 on;
  server_name new.andy-y.cn;
  ssl_certificate     /etc/letsencrypt/live/new.andy-y.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/new.andy-y.cn/privkey.pem;
  root /var/www/andy-y.cn/candidate/site;
  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;

  if ($staging_query_not_found) { return 404; }
  if ($staging_not_found)       { return 404; }
  if ($staging_query_gone)      { return 410; }
  if ($staging_gone)            { return 410; }
  if ($staging_legacy_query_target != "") { return 302 https://new.andy-y.cn$staging_legacy_query_target; }
  if ($staging_legacy_target != "")       { return 302 https://new.andy-y.cn$staging_legacy_target; }

  location ^~ /api/ {
    proxy_pass http://waline-staging:8360;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-store" always;
  }
  location = /ui { return 308 /ui/; }
  location ^~ /ui/ {
    proxy_pass http://waline-staging:8360;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-store" always;
  }
  location = /__release { try_files /release-id.txt =503; add_header Cache-Control "no-store" always; }
  location / { try_files $uri $uri/index.html =404; }
}
```

宿主只把相对软链 `candidate -> releases/<release-id>` 指向待验收版本；客户端的 `window.location.origin` 因此自然命中 `new` 的 staging Waline。启用顺序固定为：签发 `new` 证书 → 校验 override 的 `docker compose config` → 只启动 `waline-staging` → 设置 candidate 相对软链 → 对 release 内不引用 current 的完整 `candidate-staging-nginx.conf` 执行 `nginx -t -c` → 用 override 重建/加载 Nginx → 再测活动配置、`/__release` 与隔离评论写入。任何一步失败都不得加载 staging loader。验收结束后停掉 override、移除 loader，并销毁或归档 staging schema。

### 5.3 结构化数据

`.astro` 里 `<script type="application/ld+json">` 内的 `{}` **不是模板语法**，直接写 `"{title}"` 会原样输出字面量。必须用 `set:html`：

```astro
---
const ld = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: post.data.title,
  datePublished: post.data.pubDate.toISOString(),
  dateModified: post.data.updatedDate.toISOString(),
  author: { '@type': 'Person', name: 'AndyYan' },
};
---
<script type="application/ld+json" set:html={JSON.stringify(ld)} />
```

### 5.4 RSS

切换前把现网 RSS XML 保存为 fixture。2026-07-31 只读基线为 10 项；首个新版本保持相同条数、顺序和 GUID 集合，避免窗口外旧文重新出现。既有内容的 GUID 使用 fixture 原值；新内容的 `feedGuid` 首次生成后写入持久路由表。

`@astrojs/rss` 的 item 类型没有 `guid` 字段；传入 `guid:` 会在 schema 校验时被剥离，库随后按新 link 自动生成 GUID。必须用 item `customData` 覆盖自动值；`<guidIsPermaLink>` 不是 RSS 2.0 的有效写法。

```javascript
// src/pages/rss.xml.js
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

const escapeXml = (value) => String(value).replace(/[<>&'"]/g, (char) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
}[char]));

const legacyFeedLimit = 10;

export async function GET(context) {
  const posts = await getCollection('posts', ({ data }) => data.allowFeed);
  const items = posts
    .sort((a, b) =>
      b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
      || b.data.legacyCid - a.data.legacyCid)
    .slice(0, legacyFeedLimit)
    .map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      link: post.data.canonicalPath,
      customData:
        `<guid isPermaLink="false">${escapeXml(post.data.feedGuid)}</guid>`,
    }));

  return rss({
    title: 'AndyYan Blog',
    description: 'AndyYan 的技术博客',
    site: context.site,
    items,
  });
}
```

旧 `/index.php/feed/`、Atom/RSS 变体全部单跳到 `/rss.xml`。XML 门禁：每个 item 恰好一个 `<guid>`；首发 10 个 GUID 及顺序与 fixture 完全相同；既有 GUID 变化数和非新文章新增数均为 0；发布一篇新文章后只出现一个新 GUID。

### 5.5 其余清单

- **sitemap**：`@astrojs/sitemap` 用 `serialize` 为每个 canonical 注入真实 `lastmod`（取同一快照的 `modified`），并做测试证明不是仅写在计划里；只排除明确的薄内容页
- **robots.txt**：`Sitemap: https://www.andy-y.cn/sitemap-index.xml`
- **canonical**：所有页面从路由表的 `canonicalPath` 生成绝对 https/www/尾斜杠 URL；最终 HTML、sitemap、RSS link 三者一致
- **OG / Twitter 卡片**：文章页取 `cover`，无封面则用构建期生成的纯文字 OG 图
- **百度主动推送**：只推**新增**文章 URL。全量推送会迅速耗尽日配额，且把分页、404 一起推进去毫无意义
- **CDN 刷新**：与上次 release diff，只刷新变更 HTML/XML/重定向；指纹资产不 purge。两家结果、request ID 与重试状态持久化，不能后台执行后丢失退出码

---

## 六、评论系统

**方案：Waline 自托管**（Docker）。完全静态化，自托管符合现有习惯，支持 Markdown、邮件通知、反垃圾；历史评论可脚本迁移，不丢数据。

### 6.1 部署

§8.1 是唯一 Compose 定义，避免两处配置漂移。`WALINE_IMAGE` 是从阶段 0 固定并验证过的 Waline tag+digest 派生、只增加 §6.3 comment-policy middleware 的内部镜像；派生 Dockerfile、上游 digest 和中间件测试均纳入版本控制，不用 `latest`。使用独立 schema/最小权限账号，不与 Typecho 共用写账号。容器只 `expose: 8360`，Nginx 通过 `waline:8360` 访问，不映射宿主 `127.0.0.1`。

MySQL 建表 SQL 必须与固定镜像同版本，先在空 staging schema 验证。生产记录 schema 版本和校验和；确认非空后禁止重跑可能包含 DROP/重建的初始化 SQL。备份必须覆盖 Waline schema 与迁移映射表，`waline-data` 在 MySQL 模式不作为数据备份来源。

### 6.2 历史评论迁移

先固定数据策略：普通评论的 approved/waiting/spam 如何映射；pingback/trackback 是迁移还是只归档；邮箱、IP、UA 的保留/脱敏期限。每类数量都写进报告。未发布 CID、孤儿父节点、父链循环属于阻断错误，不能 `console.warn` 后跳过。

新增幂等映射表：

```sql
CREATE TABLE astro_comment_migration_map (
  source varchar(32) NOT NULL,
  legacy_coid bigint unsigned NOT NULL,
  waline_id bigint unsigned NOT NULL,
  source_hash char(64) NOT NULL,
  migrated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, legacy_coid),
  UNIQUE KEY (waline_id)
);
```

迁移算法：

1. 在一致快照内读取源评论，按规范化字段计算 `source_hash`；使用路由表的永久 `commentKey`，不得现场拼 slug。
2. 写入前完整验证父图无孤儿、无环，并为每条回复求出根评论。
3. 在一个数据库事务内按 `(source, legacy_coid)` 幂等插入/更新评论和映射表；任一行失败则整体回滚。
4. 第二遍回填：`pid = 直接父评论的新 ID`，`rid = 整棵回复树根评论的新 ID`；根评论的 `pid/rid` 为空。三级及更深回复不能把直接父 ID 误当根 ID。
5. 同一事务内做限定命名空间的 absent-key sweep：只比较 `source='typecho'` 的 mapping key 与本次源 key；源端已删除或已移出迁移策略的 key，先写审计报告，再删除对应 **mapped Waline 行和 mapping 行**。绝不触碰没有 Typecho mapping 的 Waline 原生评论；若剩余子评论会变孤儿则整体阻断，不做级联猜测。
6. 同一固定快照连续运行两次，第二次必须零新增、零更新、零删除、零重复、零字段变化。

正式切换采用两段迁移：

- T0：旧站仍可写时完成全量幂等迁移和预验收。
- 切换窗：关闭 Typecho 评论写入口并等待在途请求结束，再做一次**完整幂等对账**，不能只查 `coid > max`；Typecho 没有可靠的评论修改时间，仅同步新增会漏掉编辑、状态变化和删除。
- 差异归零后才发布全局 `writeEnabled=true` 的 Waline policy release；在此之前生产 GET 可读、所有写请求 403。启用后 15 分钟和 24 小时再次只读检查旧库，发现迟到写入就先把全局写开关切回 disabled、重跑完整对账并记录，不能边迁移边双写。

**评论门禁**：迁移范围数 = `source='typecho'` mapping 数 = 通过 mapping join 到的 Waline 数；mapped 子集中缺失/额外/重复/孤儿/父链循环均为 0，且 absent-key sweep 后额外 mapped 行为 0。CID、作者、规范化正文、时间、状态和父图 hash 全量一致；无 mapping 的上线后 Waline 原生评论单独计数，不参与删除。policy entry key 集合必须等于公开 post/page commentKey 集合，启用前全局写为 false。post/page 评论都可读。预发布测试评论使用独立 schema，禁止混入生产。

### 6.3 前端接入

```astro
---
// src/components/Comments.astro
interface Props {
  commentKey: string;
  entryWritable: boolean;
  productionWriteEnabled: boolean;
}
const { commentKey, entryWritable, productionWriteEnabled } = Astro.props;
---
<div id="waline"
  data-comment-key={commentKey}
  data-entry-writable={String(entryWritable)}
  data-production-write-enabled={String(productionWriteEnabled)} />
<script>
  let waline;
  let observer;
  let generation = 0;

  function cleanup() {
    generation += 1;
    observer?.disconnect();
    observer = undefined;
    waline?.destroy();
    waline = undefined;
  }

  function mount() {
    cleanup();
    const current = generation;
    const root = document.querySelector<HTMLElement>('#waline[data-comment-key]');
    if (!root) return;
    const commentKey = root.dataset.commentKey;
    if (!commentKey) return;
    observer = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return;
      observer?.disconnect();
      const hostWriteEnabled = root.dataset.productionWriteEnabled === 'true'
        || window.location.hostname === 'new.andy-y.cn';
      const effectiveWritable = root.dataset.entryWritable === 'true' && hostWriteEnabled;
      if (!effectiveWritable) {
        const { mountReadonlyComments } = await import('../lib/readonly-comments.js');
        if (current !== generation || !root.isConnected) return;
        const readonly = await mountReadonlyComments({
          el: root,
          serverURL: window.location.origin,
          path: commentKey,
        }); // 固定 API schema；返回 { destroy() }
        if (current !== generation || !root.isConnected) {
          readonly.destroy();
          return;
        }
        waline = readonly;
        return;
      }
      const [{ init }] = await Promise.all([
        import('@waline/client'),
        import('@waline/client/style'),
      ]);
      if (current !== generation || !root.isConnected) return;
      waline = init({
        el: root,
        // 客户端会自行追加 /api/；Nginx 对同源 /api/* 反代。
        serverURL: window.location.origin,
        dark: 'html[data-theme="dark"]',
        path: commentKey,
      });
    }, { rootMargin: '300px 0px' });
    observer.observe(root);
  }

  document.addEventListener('astro:page-load', mount);
  document.addEventListener('astro:before-swap', cleanup);
</script>
```

`finalize-manifest.js` 同时生成构建期 `src/generated/release-state.ts`，其 `productionWriteEnabled` 必须与 manifest/comment-policy 顶层一致。所有公开 post/page 都调用 `<Comments commentKey={entry.data.commentKey} entryWritable={entry.data.allowComment} productionWriteEnabled={releaseState.productionWriteEnabled} />`，不依赖 Typecho 的历史评论计数；这样文章日后关闭评论也不会隐藏已写入 Waline 的历史数据。生产全局 disabled 时前端走只读分支，不能展示一个必然 403 的假表单；`new.andy-y.cn` 仅因其独立 schema/policy 在客户端启用 staging 写分支，服务端仍是最终授权边界。只读分支如果没有受支持的 Waline 模式，就调用固定 GET schema 的专用组件，不能靠 CSS 假装禁写；渲染必须复用 Waline 的安全渲染或经过锁版本 allowlist sanitizer，禁止把返回正文直接赋给 `innerHTML`，并用 XSS fixture 验收。Waline 客户端约 40KB，只有评论区接近视口后才请求；Network 必须证明首屏为 0 请求。`serverURL` 不能写成 `/api/comment`，否则客户端再次追加 `/api/` 形成错误路径。

客户端只读不是授权边界。`comment-policy.json` 结构为 `{ "writeEnabled": false, "entries": { "/posts/example/": { "writable": true } } }`：entries 由同一快照的全部公开 commentKey/`allowComment` 生成；顶层值由受控 `COMMENT_WRITE_MODE` 生成并记录在 manifest。首次新站 release 必须是 `writeEnabled=false`，即使文章允许评论也不能提前写入；最终停写迁移全量差异为 0 后，才发布并验证一个 `COMMENT_WRITE_MODE=enabled` 的新 release，成功后持久化部署状态。

同一 release 另生成 `comment-policy.staging.json`，只供隔离的 `waline-staging` 使用，顶层固定 true、entries 仍尊重 `allowComment`；它不能被生产 Waline 挂载。这样预发布可测试真实写入，而生产全局开关仍保持 disabled。

固定 Waline 镜像外包一层同容器服务端 policy middleware，读取 Waline 只读挂载的 `current/comment-policy.json`；对新增/回复请求从规范化 body 取得 `commentKey`，只有顶层 `writeEnabled=true` **且** entry `writable=true` 才放行，否则返回 403。读取历史评论始终允许；更新/删除仍走 Waline 自带管理员授权。中间件必须拒绝未知 key、重复/非规范化 path 和伪造 Host，并用直接 POST 测试证明：评论切换前所有 key 均 403，切换后关闭 key 仍 403、开放 key 正常，两家 CDN 均不缓存响应。

切换后 Waline 是评论唯一事实来源。即使静态站回滚，也不能重新开放 Typecho 评论写入；旧前端若暂时无法接 Waline，就把评论区置为只读，避免两套库继续分叉。

---

## 七、编辑器

换掉 Joe 主题后其自带编辑器（含短代码按钮）会一并消失，必须补上替代。

**主选：保留 Joe 主题仅作后台使用。** 前台已由 Astro 完全接管，Joe 只需在 Typecho 后台继续提供它的编辑器。零开发成本，零学习成本，短代码按钮继续可用——因为 §3.2 的转换发生在构建期，数据库里仍是 `{alert}` 原语法。

**备选：XEditor 插件**（基于 Vditor）。若希望更现代的编辑体验，可做 **2 小时限时验证**。需要知道的现状：该仓库 27 star、29 commit、**无任何 release**、无 license、README 未提供图床上传配置说明、未声明兼容的 Typecho 版本。风险偏高，因此不作主选。验证通过则用，不通立即退回主选方案。

**兰空图床对接**：无论走哪条，粘贴上传都需在 Lsky Pro 后台把 Typecho 域名加入 CORS 白名单。

---

## 八、部署

### 8.1 Docker Compose

```yaml
name: andy-blog

services:
  typecho:
    # FROM php:8.2-fpm-bookworm；安装 pdo_mysql、mysqli、curl。
    build: ./docker/typecho
    restart: unless-stopped
    expose: ['9000']
    volumes:
      - ./typecho:/var/www/typecho
    environment:
      WEBHOOK_SECRET_FILE: /run/secrets/webhook_secret
    secrets: [webhook_secret]
    networks: [app, data_egress]

  nginx:
    image: ${NGINX_IMAGE:?set a digest-pinned NGINX_IMAGE}
    restart: unless-stopped
    depends_on: [typecho, waline]
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./typecho:/var/www/typecho:ro
      - '${WWW_ROOT:?set an absolute host WWW_ROOT}:/var/www/andy-y.cn:ro'
      - /etc/letsencrypt:/etc/letsencrypt:ro
    networks: [edge, app]

  # 只验签/去重/持久化排队，不持有 Docker socket，也不直接构建。
  rebuild-api:
    build: ./docker/rebuild-api
    restart: unless-stopped
    expose: ['9000']
    volumes:
      - ./runtime/build:/runtime/build
    environment:
      WEBHOOK_SECRET_FILE: /run/secrets/webhook_secret
    secrets: [webhook_secret]
    networks: [app]

  builder:
    # Dockerfile 使用 Node 22.x 且 >=22.12.0 的已验证 patch + digest；安装 Chromium、util-linux、curl、openssl。
    build: ./docker/builder
    profiles: ['build']
    user: '${DEPLOY_UID:?set host deploy uid}:${DEPLOY_GID:?set host deploy gid}'
    volumes:
      - ./astro:/app
      - '${WWW_ROOT:?set an absolute host WWW_ROOT}:/var/www/andy-y.cn'
      - ./runtime/build:/runtime/build
    working_dir: /app
    environment:
      DB_HOST: ${DB_HOST:?DB_HOST is required}
      DB_USER: ${TYPECHO_RO_DB_USER:?TYPECHO_RO_DB_USER is required}
      DB_PASSWORD: ${TYPECHO_RO_DB_PASSWORD:?TYPECHO_RO_DB_PASSWORD is required}
      DB_NAME: ${DB_NAME:?DB_NAME is required}
    networks: [data_egress]

  waline:
    image: ${WALINE_IMAGE:?set a digest-pinned WALINE_IMAGE}
    restart: unless-stopped
    expose: ['8360']
    volumes:
      - '${WWW_ROOT:?set an absolute host WWW_ROOT}:/var/www/andy-y.cn:ro'
    environment:
      TZ: Asia/Shanghai
      SITE_NAME: andy-y.cn
      SITE_URL: https://www.andy-y.cn
      SERVER_URL: https://www.andy-y.cn
      SECURE_DOMAINS: ${WALINE_SECURE_DOMAINS:?set production www only}
      COMMENT_POLICY_FILE: /var/www/andy-y.cn/current/comment-policy.json
      AUTHOR_EMAIL: ${AUTHOR_EMAIL:?AUTHOR_EMAIL is required}
      JWT_TOKEN: ${WALINE_JWT:?WALINE_JWT is required}
      MYSQL_HOST: ${DB_HOST:?DB_HOST is required}
      MYSQL_DB: ${WALINE_DB_NAME:?WALINE_DB_NAME is required}
      MYSQL_USER: ${WALINE_DB_USER:?WALINE_DB_USER is required}
      MYSQL_PASSWORD: ${WALINE_DB_PASSWORD:?WALINE_DB_PASSWORD is required}
      MYSQL_PREFIX: wl_
      SMTP_SERVICE: ${SMTP_SERVICE}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      IPQPS: 60
    networks: [app, data_egress]

networks:
  edge: {}
  app:
    internal: true
  data_egress: {}

secrets:
  webhook_secret:
    file: ./secrets/webhook_secret
```

`.env`/systemd 必须把 `WWW_ROOT` 设为宿主上的**绝对目录**（建议 `/var/www/andy-y.cn`），把 `DEPLOY_UID/GID` 固定为受限 deploy 用户。宿主 bootstrap 以该 UID/GID 创建可写的项目/cache/runtime 目录，并保证 `WWW_ROOT`、`releases` 逐级至少 0755；不依赖容器 root 碰巧有权限。先用 `docker compose config` 确认 Nginx 与 builder 都把同一宿主目录映射到容器 `/var/www/andy-y.cn`。builder 只返回不含斜杠的 release ID；宿主不接受容器绝对路径。`current`、`previous`、`candidate` 都在 `WWW_ROOT` 内使用相对目标 `releases/<release-id>`，因此宿主和容器命名空间看到的链接都有效。

**基础镜像不能用 Alpine**：Playwright 官方不支持 musl，`playwright install --with-deps` 在 Alpine 中会 `apt-get: not found` 退出 127。Mermaid 构建期渲染依赖它。镜像体积增量约 700MB–1GB（含 chromium 与系统库）。

Astro 7.1.6 的 engines 下限是 **Node ≥22.12.0**，不是笼统的 22.0；Dockerfile 必须固定满足下限的 22.x patch 与镜像 digest。容器互访一律使用 service name + container port：`typecho:9000`、`rebuild-api:9000`、`waline:8360`；容器内 `127.0.0.1` 只代表自身。只有 Nginx 发布宿主 80/443。

`DB_HOST` 必须是容器可达的 MySQL service/FQDN/external network 地址，禁止写 `127.0.0.1`。Builder 使用 Typecho 表 SELECT-only 账号；Waline 使用独立 schema 的读写账号；评论迁移另用临时最小权限账号。`${WWW_ROOT}` 与 Typecho bind source 在 Nginx 内只读，任何公网可触发服务都不得挂载 `/var/run/docker.sock`。

### 8.2 自动重建链路

Typecho 发布/下线/删除 → 生命周期钩子 → HMAC 排队 → 宿主控制面构建/验证 → 原子切换。

```php
<?php
// usr/plugins/AutoRebuild/Plugin.php
class AutoRebuild_Plugin implements Typecho_Plugin_Interface
{
    public static function activate()
    {
        foreach (['Widget_Contents_Post_Edit', 'Widget_Contents_Page_Edit'] as $hook) {
            $factory = Typecho_Plugin::factory($hook);
            $factory->finishPublish = ['AutoRebuild_Plugin', 'trigger'];
            $factory->mark          = ['AutoRebuild_Plugin', 'trigger'];
            $factory->finishDelete  = ['AutoRebuild_Plugin', 'trigger'];
        }
    }

    public static function deactivate() {}
    public static function config(Typecho_Widget_Helper_Form $form) {}
    public static function personalConfig(Typecho_Widget_Helper_Form $form) {}

    // 各 hook 参数不同；全量 SSG 不依赖 cid，故使用可变参数。
    public static function trigger(...$args)
    {
        $secretFile = getenv('WEBHOOK_SECRET_FILE') ?: '/run/secrets/webhook_secret';
        if (!is_readable($secretFile)) {
            error_log('AutoRebuild: webhook secret is not readable');
            return;
        }
        $secret = trim(file_get_contents($secretFile));
        if ($secret === '') {
            error_log('AutoRebuild: webhook secret is empty');
            return;
        }

        $body = json_encode([
            'event' => 'typecho-content-changed',
            'ts'    => time(),
            'nonce' => bin2hex(random_bytes(16)),
        ], JSON_UNESCAPED_SLASHES);
        $sig = 'sha256=' . hash_hmac('sha256', $body, $secret);

        // Compose 内通过 service name 访问；127.0.0.1 只会回到 Typecho 自身。
        $ch = curl_init('http://rebuild-api:9000/hooks/rebuild');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Signature: ' . $sig,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 5,
        ]);
        $result = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($result === false || $status !== 202) {
            error_log(sprintf('AutoRebuild: enqueue failed status=%d error=%s', $status, $error));
        }
    }
}
```

> `Typecho_Plugin::factory` 旧式写法在 1.2.1 下仍可用（内部有 class alias），无需改命名空间形式。钩子标识字符串保持下划线式，不要改成反斜杠。

`rebuild-api` 在容器内监听 `0.0.0.0:9000`，但端口不发布到宿主，只在 internal `app` 网络可达。它基于**原始 body**做 HMAC-SHA256 恒时比较，拒绝超过 ±5 分钟的时间戳、重复 nonce 和超限 body；只有 pending 状态落盘到 `/runtime/build` 后才返回 202。

采用 60 秒 trailing debounce。构建中再收到事件时设置 dirty，当前构建结束后必须再跑一次，不能用 `flock -n ... exit 0` 静默丢事件。`finishPublish` 覆盖发布/重新发布，`mark` 覆盖批量公开/下线，`finishDelete` 覆盖删除。另设 5 分钟 reconciliation timer 与后台手动重建，兜底未来定时发布、分类重命名、页面排序和 webhook 瞬时故障；每日做一次全量 CID/hash 对账。

队列消费由宿主 `systemd.path/service` 的受限 deploy 用户完成：它可以运行固定的 `docker compose run/exec` 流程，而公网可触发容器不持有 Docker socket。job 只表达“需要全量重建”，宿主不得执行 webhook/job 传入的命令、路径或参数；spool 的 owner/mode、普通文件和大小都要校验。最近成功 release、失败原因、pending/dirty 状态和告警必须持久化。

宿主另维护两个受控部署状态：`redirect-status` 初始为 `302`，观察批准后永久转为 `301`；`comment-write-mode` 初始为 `disabled`，评论停写最终对账为 0 后转为 `enabled`。状态文件只允许枚举值、由 deploy 用户原子写并随 release manifest 审计，builder 不设默认值。普通 webhook job 只能继承当前值，不能携带或改变它们；阶段跃迁只能由人工授权的固定宿主命令创建 transition descriptor，并在新 release 全部健康后才提交状态。每个**新逻辑 job** 由宿主先执行只读 `builder node /app/scripts/read-db-epoch.js` 捕获 cutoff，连同上述两个状态写入持久 job descriptor；该 job 的失败/人工重试始终复用同一 `SNAPSHOT_EPOCH`。构建中产生的 dirty 标志在上一 job 完成后创建新 descriptor，届时才捕获新 cutoff。

### 8.3 原子切换

每个 release 是一个不可拆分单元：

```text
/var/www/andy-y.cn/releases/<release-id>/
├─ site/                    # Astro + Pagefind 产物，含 release-id.txt
├─ nginx/
│  ├─ release-http.conf     # map、全部 vhost 与 302/301 动作
│  ├─ staging-http.conf     # 独立 staging 变量与 new vhost
│  ├─ candidate-nginx.conf  # 不引用 current 的生产 nginx -t 入口
│  └─ candidate-staging-nginx.conf # 额外 include staging-http 的完整入口
├─ comment-policy.json      # 生产全局 cutover 开关 + commentKey writable
├─ comment-policy.staging.json # 仅隔离 staging 使用，生产不得挂载
├─ manifest.json            # 对账摘要 + snapshotEpoch/redirectStatus/commentWriteMode
└─ checksums.sha256
```

Builder 只负责构建和定稿 release，不执行 `docker exec`、不 reload Nginx、不持有 CDN 密钥：

```bash
#!/usr/bin/env bash
# scripts/build-release.sh（builder 容器）
set -Eeuo pipefail
umask 027
# fd 3 保留给唯一机器可读结果；其余构建输出全部进入 stderr/journal。
exec 3>&1
exec 1>&2
exec 9>/runtime/build/rebuild.lock
flock 9                              # 等待；上层 debounce 合并事件

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
REDIRECT_STATUS="${REDIRECT_STATUS:?host must pass persisted redirect state}"
case "$REDIRECT_STATUS" in 302|301) ;; *) exit 64 ;; esac
COMMENT_WRITE_MODE="${COMMENT_WRITE_MODE:?host must pass persisted comment state}"
case "$COMMENT_WRITE_MODE" in disabled|enabled) ;; *) exit 64 ;; esac
SNAPSHOT_EPOCH="${SNAPSHOT_EPOCH:?host must pass persisted job cutoff}"
[[ "$SNAPSHOT_EPOCH" =~ ^[0-9]{10}$ ]] || exit 64
export SNAPSHOT_EPOCH REDIRECT_STATUS COMMENT_WRITE_MODE
STAGE="/var/www/andy-y.cn/releases/.${RELEASE_ID}.staging"
FINAL="/var/www/andy-y.cn/releases/${RELEASE_ID}"
test ! -e "$STAGE"
test ! -e "$FINAL"

cd /app
node scripts/sync-typecho.js
node scripts/generate-comment-policy.js --mode "$COMMENT_WRITE_MODE" --out .cache/comment-policy.json
node scripts/generate-comment-policy.js --mode enabled --out .cache/comment-policy.staging.json
node scripts/generate-redirects.js --release-id "$RELEASE_ID" --status "$REDIRECT_STATUS"
node scripts/finalize-manifest.js --release-id "$RELEASE_ID" \
  --redirect-status "$REDIRECT_STATUS" --comment-write-mode "$COMMENT_WRITE_MODE"
npm run build
node scripts/run-full-reconciliation.js

mkdir -p "$STAGE/site" "$STAGE/nginx"
cp -a /app/dist/. "$STAGE/site/"
cp -a /app/.cache/release-nginx/. "$STAGE/nginx/"
cp /app/.cache/manifest.json "$STAGE/manifest.json"
cp /app/.cache/comment-policy.json "$STAGE/comment-policy.json"
cp /app/.cache/comment-policy.staging.json "$STAGE/comment-policy.staging.json"
printf '%s\n' "$RELEASE_ID" > "$STAGE/site/release-id.txt"
# release 不允许 symlink/device/socket；公开静态与配置不含秘密，统一给 Nginx worker 只读权限。
if find "$STAGE" ! -type f ! -type d -print -quit | grep -q .; then exit 65; fi
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
(cd "$STAGE" && find . -type f ! -name checksums.sha256 -print0 | sort -z | xargs -0 sha256sum > checksums.sha256)
chmod 0644 "$STAGE/checksums.sha256"
mv -T "$STAGE" "$FINAL"            # 同一文件系统内定稿
printf '%s\n' "$RELEASE_ID" >&3    # stdout 恰好一行 ID，不混入 npm/node 日志
```

宿主 `blog-rebuild.service` 按以下顺序执行：

1. 宿主只从已校验的持久 job descriptor/deploy state 读取三个枚举/数字值；镜像预拉取后执行 `docker compose run --rm --no-TTY --quiet-pull -e SNAPSHOT_EPOCH=<job-cutoff> -e REDIRECT_STATUS=<302-or-301> -e COMMENT_WRITE_MODE=<disabled-or-enabled> builder /app/scripts/build-release.sh`。脚本把日志写 stderr/journal，stdout 只能有一行符合 `^[0-9TZ-]+[0-9a-f]{8}$` 的 release ID，多一行也失败。宿主从 systemd 固定的绝对 `WWW_ROOT` 自行构造 `WWW_ROOT/releases/<id>`，用 `realpath` 验证它正好位于 releases 下一层，再校验无 symlink/特殊文件、marker/checksum/manifest 及三项状态与输入一致；还要以固定镜像的 Nginx worker 用户执行 `test -x` 逐级目录和 `test -r` 代表性 HTML/config/policy，绝不把 builder 输出当路径或软链目标。
2. `candidate-nginx.conf` 必须是完整的 `events {}` + `http {}` 主配置，显式 include **候选绝对容器路径**下的 `release-http.conf` 和官方 `mime.types`，且不得 include `/etc/nginx/conf.d` 或 `current`。执行 `docker compose exec -T nginx nginx -t -c /var/www/andy-y.cn/releases/<id>/nginx/candidate-nginx.conf`；失败则不动任何软链。普通 `nginx -t` 不能替代这一步，因为它只会测试旧 `current`。
3. 读取当前真实 release ID；在 `WWW_ROOT` 内创建相对链接 `previous.next -> releases/<old-id>`、`current.next -> releases/<new-id>`，分别用 `mv -T` 原子替换 `previous`、`current`。禁止写容器绝对路径，也禁止按目录 mtime 猜“第二新”。
4. 比较前后整个 `nginx/` 配置树的 hash；任一文件变化（包括仅把 302 改为 301）都必须在切换后再对活动配置执行 `nginx -t` 并 reload。普通正文构建且配置 hash 未变时不 reload。随后直接连源站请求 `/__release`、代表性 HTML/RSS，以及 active redirect/not_found/gone 各一条；必须看到新 release ID、页面 200 和 action 记录的 302/301/404/410。
5. 活动配置测试、reload 或健康检查任一失败，立即把 `current` 指回已验证的旧 ID；若发生过 reload，再对回切后的活动配置执行 `nginx -t`/reload。回切也只使用受控 ID 和相对链接。
6. 原站健康后写入持久化 CDN 刷新作业，分别等待阿里云 CDN 与 Cloudflare SaaS 结果；记录 request ID、失败原因和重试。不能用后台 `&` 丢掉退出码。

Nginx 永远不直接指向 `/app/dist`，因为 Astro 构建会清空该目录。自动脚本不删除旧 release；清理由独立宿主维护任务完成，且只处理已解析、明确位于固定 `releases/`、不是 current/previous 的目录，先 dry-run 和备份策略后执行。

**回滚**读取 `previous` marker，校验目标路径/checksum 后交换 `current` 与 `previous`（保留一键 roll-forward），执行同样的 Nginx 测试、源站 release 检查和双 CDN 刷新；成功后把受控 `redirect-status` / `comment-write-mode` 同步为回滚 release manifest 中的值，防止下一次自动构建偷偷改变阶段。若回滚发生在评论切换后，Waline 仍是唯一事实来源、Typecho 评论保持只读；回到 `commentWriteMode=disabled` 的 release 只会临时禁止 Waline 新写入，不会切回 Typecho。

### 8.4 双 CDN

**既定且已验证的接入架构**：阿里云云解析 DNS 按地域/线路返回不同记录；中国大陆线路把 `www` CNAME 到阿里云 CDN，境外线路把同一主机名 CNAME 到 Cloudflare SaaS 自定义主机名服务提供的目标。两条链路都回源同一 VPS，源站不做地域判断，也不反代回任一 CDN。`cms.andy-y.cn` 是直连/受控管理入口，不加入静态站双 CDN 缓存链。

2026-07-31（CST）只读探针已确认：经 `127.0.0.1:7892` 国外代理访问首页和旧 RSS 均为 200，响应含 `Server: cloudflare` 与 HKG `CF-Ray`。当前 Typecho 返回 `Cache-Control: private, no-cache, no-store`、`CF-Cache-Status: DYNAMIC`；这是旧站基线，不是静态站上线后的目标缓存状态。

```bash
# 国外 Cloudflare 只读复测；不输出 /cdn-cgi/trace，避免泄露出口 IP。
curl --proxy http://127.0.0.1:7892 --head --max-time 25 https://www.andy-y.cn/
curl --proxy http://127.0.0.1:7892 --head --max-time 25 https://www.andy-y.cn/index.php/feed/
# 新站上线后再把第二条换成 /rss.xml，并校验 release/hash/cache 状态。
```

上线配置与门禁：

- 两端使用相同 cache key、压缩语义和源站 Host；禁用 Rocket Loader、HTML Auto Minify/改写、邮箱混淆和阿里“页面优化”等会改 DOM 的功能。
- `/_astro/*` 仅对带 hash 资产一年 immutable；HTML/sitemap/RSS/robots 使用短边缘缓存；`/api/*`、`/ui/*`、`/__release` bypass cache。BEOE SVG 只有确认文件名内容寻址后才可 immutable。
- Cloudflare 为 HTML 显式建立 Cache Rule；阿里云 CDN 建立等价规则。purge 后重复请求应在两边得到预期 HIT/age 行为，API 永远不得 HIT。
- 发布顺序固定为“源站定稿与健康检查 → 两端刷新 → 两端 release/HTML 校验 → 百度增量推送”。刷新失败时标记 `edge-pending`、持久重试并告警；HTML 的短 `s-maxage` 是陈旧窗口兜底，不把刷新失败伪装成完全成功。
- 用中国大陆探针/阿里诊断验证国内链路，用 7892 复测境外链路；两边抓取同一组 canonical、JSON-LD、正文和 release ID，解压后的 HTML SHA-256 必须一致。源站只接受两家 CDN 出口和受控运维探针，并校验回源鉴权头。

### 8.5 上线策略

`new.andy-y.cn` 带 `X-Robots-Tag: noindex, nofollow` 做全量验收；它使用独立 Waline staging schema，禁止测试评论进入生产。验收不是抽样，而是运行内容、关系、RSS、内部链接、legacy URL 和评论的全量对账。

切换顺序：

1. 降低 DNS TTL，完成源站/国内阿里 CDN/境外 Cloudflare 三视角全量验证。
2. 首次生产切静态站，旧 URL 为 302，`commentWriteMode=disabled`；直接 POST 必须全部 403。
3. 评论切换窗关闭 Typecho 评论写入、等待在途请求、完成最终完整幂等对账；差异为 0 后发布 `commentWriteMode=enabled` release，验证仅开放 key 可写，再持久化状态。
4. 302 继续观察至少 7 个自然日并清零错误映射；之后以受控状态变更单独发布 301 release，验证成功后持久化 `redirect-status=301` 并刷新两端。
5. 提交 sitemap/百度改版资料并开始 48 小时值守；第 7、30、90 天复核 SEO。`site:` 结果不是即时切换门禁。

回滚演练必须同时覆盖静态 release、redirect map、双 CDN 缓存和评论写入去向；回滚后 Typecho 评论仍保持只读。

**不做按 IP 灰度**：双 CDN 缓存前置时源站分流不成立——CDN 缓存到哪个版本就给所有人发哪个版本，直接造成缓存污染；加上新旧 URL 体系不同还要 301，灰度期 SEO 会来回抖。

---

## 九、实施计划

排期：**约 5–7 周**（单人全职约 176–244 人时），另加至少 7 个自然日的 302 观察窗。内容总量以阶段 0 一致快照为准，若明显高于现网基线则阶段 8 另行增加。

### 阶段 0：阻断性基线与纵向探针（12–16 人时）

**全案的分水岭，不通则后续章节需调整。**

1. 完成 §0 全部查询、三次备份计划和一次恢复演练；保存匿名可访问 URL、现网 RSS XML、路由配置与评论基线 fixture
2. Spike：固定 Node ≥22.12.0 的 patch/digest、Astro 7.1.6 + Unified + Expressive Code 0.44.1 + BEOE 0.4.2，验证实际插件顺序、双主题和最终 HTML
3. Spike：单篇 post、单个 page、多分类、未来/密码内容组成的垂直同步；验证不可变 route map
4. Spike：Compose service-name 网络、`cms.andy-y.cn` PATH_INFO、Typecho admin-origin patch hash/dry-run、Waline `/api/*` 与 durable rebuild queue
5. CDN：大陆探针验证阿里云 CDN；7892 验证 Cloudflare SaaS；比对同一 fixture 的 body hash
6. XEditor 2 小时限时验证（失败即用 Joe 后台）

**验收**：所有基线有保存证据；未来/密码内容不导出；post/page/多分类不丢；Astro fixture 与 CMS/Waline 垂直链路通过；任一 P0 不通过则停止进入阶段 1。

---

### 阶段 1：一致快照、不可变路由与数据拉取（28–36 人时）

1. Astro 7 项目初始化，依赖安装
2. `sync-typecho.js`：caller-supplied 固定 `SNAPSHOT_EPOCH` + REPEATABLE READ snapshot、post/page、全部分类/标签、字段类型分流、临时目录与原子落盘
3. 持久 `route-map.json` + 派生 manifest；page 路径逐页审定，tombstone 保留
4. Content Collections（schema 不含 slug；`routeId → entry.id` 契约测试）
5. 基础 Layout、首页、post/page 路由（无样式）

**验收**：SQL 公开 CID、输出 CID、活动路由 CID 差异为 0；分类/标签 mid 全量对账为 0；固定同一 cutoff 与数据库 fixture 的两次输出字节一致，运行元数据不进入比较；修改标题/slug 和新增同名内容后既有 routeId 变化为 0；草稿/删除内容输出消失但 tombstone 保留。

---

### 阶段 2：Markdown 管线（20–28 人时）

1. 短代码构建期转换 + dry-run 人工复核
2. Expressive Code + BEOE Mermaid（标准 fence、无 shield、file strategy）+ KaTeX（自托管 CSS）
3. Alert / Cloud / Bilibili 的 directive + CSS + Lucide 图标
4. 图片尺寸探测、本地附件迁移

**验收**：先用固定 fixture 锁定插件顺序，再对全部内容运行短代码/HTML/图片报告；普通 code 与 Mermaid 产物结构正确，明暗图切换一致，代码围栏未误转，所有本地附件 200，Mermaid 失败会阻断构建。人工重点复核高风险文章，不用抽样代替自动全量检查。

---

### 阶段 3：视觉与动效（24–32 人时）

1. 10 条动效完整实现（含阅读进度指示器、FLIP 灯箱）
2. 明暗双主题 + 切换按钮，无 FOUC
3. Sticky 导航 + 背景模糊
4. 响应式布局（桌面 / 平板 / 移动端）
5. `prefers-reduced-motion` 全覆盖

**验收**：三种设备实测无错位；ClientRouter 客户端导航前后无主题闪烁；连续导航 20 次无 listener/observer/rAF 泄漏；文章功能 chunk 只在文章页加载；reduced-motion 无残留动效；强调色符合 §2.2。

---

### 阶段 4：SEO、RSS 与全量 URL 迁移（18–26 人时）

1. legacy URL 多来源盘点 + 302 map + Nginx 配置；观察窗后单独切 301
2. sitemap（真实 lastmod）+ robots.txt + canonical + JSON-LD
3. RSS fixture（原 GUID/窗口/顺序不变）
4. OG / Twitter 卡片

**验收**：legacy/action 矩阵在源站/阿里/Cloudflare 100% 通过；active redirect 单跳到 200，观察期返回 302、批准后才是 301，tombstone 按记录直接 404/410；`/`/`/index.php?p=<cid>` 命中而任意新路径 `?p=<cid>` 不误跳；active 最终 URL/canonical/sitemap 一致且每个 sitemap URL 有真实 lastmod；首发 RSS 的 10 个 GUID 与 fixture 完全相同且每项仅一个 guid；发布一篇新文仅新增一个 GUID；JSON-LD 验证通过。

---

### 阶段 5：编辑器、排队与受控发布（12–18 人时）

1. 编辑器方案落地（Joe 后台或 XEditor）+ Typecho 1.2.1 admin-origin patch
2. AutoRebuild 生命周期钩子 + HMAC/replay 防护 + durable debounce/dirty 队列
3. 宿主 systemd 控制面 + versioned release + current/previous 原子切换
4. 双 CDN 持久刷新作业 + 百度增量推送

**验收**：CMS 登录/写作/上传/发布/下线/删除/退出及 permalink/档案/密码/插件设置全通过，状态请求/回跳留在 cms、public permalink 留在 www，Joe 关键 JS/CSS 从实际活动主题目录以 cms host 返回 200；www 的 admin/action/PHP 为 404；坏签名、过期 ts、重放被拒；构建中再发布不会丢事件；未来定时文章由 reconciliation 发布；坏候选通过不了独立 `nginx -t -c` 且 current ID 不变；builder/rebuild-api 均无 Docker socket。

---

### 阶段 6：站内搜索与页面补全（14–20 人时）

1. Pagefind 集成 + 懒加载 UI
2. 标签页、分类页、归档页
3. 列表分页
4. 404 页

**验收**：preview 中中文关键词命中；首次交互前 Pagefind UI/索引/wasm 请求为 0；ClientRouter 换页后仍可用且不重复挂载；标签/分类/归档页 canonical 正确；分页结构与 sitemap 一致。

---

### 阶段 7：评论系统（18–24 人时）

1. Waline 部署（MySQL 后端 + 建表）
2. 历史评论事务/幂等迁移 + migration map + absent-key sweep + 父图验证
3. 可写/只读前端分支 + 服务端 comment-policy + 主题联动 + 懒加载
4. 邮件通知与反垃圾配置

**验收**：源/mapped Waline/mapping 数量和字段/父图全量差异为 0；删除 fixture 经 sweep 后无额外 mapped 行，第二次迁移零新增/更新/删除；三级回复 rid 指向真实根；生产启用前 UI 全部只读且直接 POST 均 403，启用 release 后关闭 key 仍只读/403、开放 key 正常，关闭文章仍显示历史评论；manifest、生成模块和两份 policy 状态一致；最终停写对账为 0；staging 发评论验证通知但不进入生产库；API 在两家 CDN 均不缓存；评论区接近视口才加载。

---

### 阶段 8：内容逐篇校对（8–12 人时，按阶段 0 数量复估）

全部 post/page × 10–20 分钟。重点：`sourceFormat: html`、复杂表格/嵌套列表、多分类、短代码密集、内部旧链接和本地附件。

**验收**：一致快照中的全部 post/page 均有复核记录，阻断问题清零；自动报告与人工清单使用同一 CID。

---

### 阶段 9：部署与压测（14–20 人时）

1. Docker Compose 完整配置
2. TLS 证书签发 + 自动续期
3. 生产部署 + 既有双 CDN 规则/回源/缓存配置复核
4. 监控告警（构建失败、CDN 刷新失败、证书到期）

**验收**：基础与 staging override 的 `docker compose config` 均通过；生产 `candidate-nginx.conf` 与 `candidate-staging-nginx.conf` 的完整 `nginx -t -c`、切换后活动 `nginx -t` 和回滚演练均通过；builder stdout 恰好一个 release ID，日志只进 stderr/journal；release 无特殊文件，固定 Nginx worker 用户可穿越目录并读取 HTML/config/policy；只有 Nginx 发布端口；宿主/容器 WWW_ROOT 映射及相对软链有效；`new` 只连 staging Waline；国内/国外 HTML hash 与 release 一致，API bypass；Lighthouse ≥预算、LCP 国内外分别测；证书续期、构建失败与 edge-pending 告警演练通过。

---

### 阶段 10：验收与切换（8–12 人时 + 7 天观察窗）

1. `new.andy-y.cn` 全量验收；生产先切 302
2. 评论停写与最终完整对账；正式启用 Waline
3. 7 天 URL 观察后 302→301；回滚与 roll-forward 演练
4. 上线后 48 小时值守，之后第 7/30/90 天 SEO 复核

**切换门禁**：内容/关系/路由全量差异为 0；legacy/action URL 三视角按记录状态 100% 通过；RSS fixture 无旧文刷屏；评论最终对账为 0，启用前全局 POST=403、启用 release 后仅开放 key 可写；release/action-map/sitemap/部署状态版本一致；回滚同时覆盖 release、map、双 CDN 和评论去向。`site:` 收录变化不是即时门禁。

---

**合计：约 176–244 人时，另加至少 7 个自然日观察窗。**

---

## 十、风险清单

| 风险 | 可能性 | 影响 | 应对 |
|---|---|---|---|
| 快照条件错误或 cutoff 漂移导致未来/密码内容公开/不可复现 | 低 | 极高 | caller 固定 SNAPSHOT_EPOCH；一致快照；排除报告；CID 三集合全量对账 |
| routeId 随 slug/顺序变化 | 低 | 极高 | 持久 route map；碰撞加 cid；既有路由不可变测试；tombstone |
| Unified/Expressive Code/BEOE 插件顺序升级回归 | 中 | 高 | 锁定版本；标准 code + Mermaid fixture；依赖升级必须跑产物测试 |
| Typecho CMS host/PATH_INFO/主题根或 admin-origin patch 漂移 | 中 | 高 | 独立 cms vhost；完整 FastCGI；原/补丁后 hash 门禁；核对主题目录；全部状态动作与资源纵向测试 |
| Webhook 丢事件或定时文章不触发 | 中 | 高 | durable pending/dirty；不跳过锁；5 分钟 reconciliation + 每日全量对账 |
| RSS GUID 变化导致旧文刷屏 | 低 | 高 | 保存旧 XML fixture；customData 覆盖 guid；窗口/顺序/GUID 全量 diff |
| 302/301/tombstone action 错误被浏览器/CDN固化 | 中 | 高 | action/状态/vhost 同 release；复合 query key；tombstone 明确 404/410/successor；先 302 观察 7 天；三视角 100% 测试后切 301 |
| 候选 Nginx 未真测或宿主/容器路径混用 | 低 | 极高 | 独立完整 `nginx -t -c`；只返回 release ID；绝对 bind root + 相对软链；失败回切 |
| 评论迁移重复、丢失、源删除残留或回复树错位 | 中 | 高 | 事务 + migration map + source hash + scoped sweep；pid/rid 全图验证；停写后完整对账 |
| 关闭评论只隐藏表单却仍可直接写 API | 中 | 高 | 历史评论只读组件；服务端 comment-policy 按永久 key 拒绝写入；直接 POST 负测 |
| 回滚后两套评论继续写入 | 低 | 高 | Waline 切换后保持唯一写源；Typecho 永久只读；旧前端与 API 都执行只读策略 |
| 双 CDN 内容/缓存短时不一致 | 中 | 高 | 相同 cache key/HTML；持久双刷新；release/hash 双探针；短 s-maxage 兜底 |
| 源站错误信任伪造客户端 IP | 中 | 中 | 限制两家 CDN 出口；统一覆盖回源头；Nginx realip 后再交给 Waline |
| XEditor 不可用 | 中高 | 低 | 直接用 Joe 主题作后台，零成本退路 |
| HTML 模式老文渲染错乱 | 中 | 中 | sync 已标记 `sourceFormat`，阶段 8 逐篇确认 |
| 短代码转换遗漏 | 低 | 中 | 残留检测抛错 + dry-run 复核；数据库未改，随时可退 |
| 本地附件失效 | 中 | 中 | `public/usr/uploads/` + nginx alias 双保险 |
| 强调色对比度不足 4.5:1 | 中 | 低 | 已限定用途；正文链接不靠颜色单独承载信息 |
| 图床探测失败造成 CLS 元数据缺失 | 中 | 中 | 持久尺寸缓存；新 URL 无尺寸时阻断；LCP 图不用 lazy |
| CDN 刷新配额/接口失败 | 中 | 中 | 增量刷新；持久重试/request ID；edge-pending 告警；短缓存兜底 |
| 构建时间过长 | 中 | 低 | BEOE file 输出缓存；阶段 0/9 实测后定超时，不预写未经测量的秒数 |
| release 清理误删 current/previous/candidate | 低 | 高 | 自动发布不删除；独立维护任务解析固定路径、排除全部 marker、先 dry-run |

---

## 十一、参考

**官方文档**
- [Astro](https://docs.astro.build/) · [Astro 7.0 发布说明](https://astro.build/blog/astro-7/) · [Content Collections](https://docs.astro.build/en/guides/content-collections/) · [Markdown in Astro](https://docs.astro.build/en/guides/markdown-content/)
- [Expressive Code Releases](https://expressive-code.com/releases/) · [BEOE strategy](https://beoe.stereobooster.com/start-here/strategy/) · [BEOE dark scheme](https://beoe.stereobooster.com/start-here/dark-scheme/)
- [Astro RSS 源码](https://github.com/withastro/astro/blob/main/packages/astro-rss/src/index.ts) · [Pagefind](https://pagefind.app/) · [Lucide](https://lucide.dev/)
- [Waline](https://waline.js.org/) · [Waline 自托管](https://waline.js.org/en/guide/deploy/vps.html) · [Waline serverURL 拼接源码](https://github.com/walinejs/waline/blob/main/packages/api/src/utils.ts)
- [Docker Compose 服务网络](https://docs.docker.com/compose/how-tos/networking/) · [Nginx 内置变量](https://nginx.org/en/docs/http/ngx_http_core_module.html#variables) · [Playwright Docker](https://playwright.dev/docs/docker)
- [Typecho 钩子列表](https://docs.typecho.org/plugins/hooks) · [Typecho PATH_INFO FAQ](https://docs.typecho.org/faq) · [Typecho 1.2.1 源码](https://github.com/typecho/typecho/tree/v1.2.1) · [Permalink rewrite probe](https://github.com/typecho/typecho/blob/v1.2.1/var/Widget/Options/Permalink.php) · [Profile redirect](https://github.com/typecho/typecho/blob/v1.2.1/var/Widget/Users/Profile.php) · [Login referer](https://github.com/typecho/typecho/blob/v1.2.1/var/Widget/Login.php)
- [Cloudflare for SaaS 自定义主机名](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/)

**本机文件**
- SEO 与迁移调研：`C:\Users\AndyYan\cc-workspace\.seo-research.md`
- 本方案：`C:\Users\AndyYan\cc-workspace\blog-redesign-plan.md`
- 审计修补前备份：`C:\Users\AndyYan\cc-workspace\blog-redesign-plan.pre-audit-fixes-2026-07-31.md`
