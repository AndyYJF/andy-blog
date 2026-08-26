# andy-blog 前端评审报告

> **审计日期**: 2026-08-26
> **目标**: https://www.andy-y.cn
> **范围**: 线上站点逐页实测(桌面 / 390px 移动 / 亮暗主题 / 搜索) + 仓库 `astro/` 源码交叉核对
> **方法**: 浏览器实地走查 + 只读代码探索子代理深审 + 人工回读关键 CSS/JS 实锤
> **对照**: 同日上午的全栈安全审计见 [`../2026-08-26/`](../2026-08-26/README.md);本目录只覆盖**访客可见的前端体验与革新方向**,不重复安全项
> **证据截图**: [`assets/`](./assets)

---

## 执行摘要

工程底子在个人博客里属于头部水平:全静态 + 系统字体、KaTeX / Pagefind 按需加载、mermaid 构建期渲染成双主题 SVG、ClientRouter 换页且生命周期清理严谨、SEO 元数据 / JSON-LD / sitemap lastmod 齐全、`prefers-reduced-motion` 全局降级。「账本 / NOC 面板」视觉也有辨识度。

问题不在架构,而集中在几处会被访客直接感知的细节 bug,以及文章页「读完即断」的内链缺口。

| 级别 | 数量 | 概述 |
|---|---|---|
| P0 | 2 | 顶栏毛玻璃失效导致正文穿透导航;部分文章正文全是 h1,目录/进度条/语义一起失效 |
| P1 | 2 | Pagefind 中文按单字匹配;移动端 mermaid 图缩成不可读横条 |
| P2 | 6 | 页脚「4/4 在线」写死、锚点同名 aria-label、复制按钮英文、`/archives/` 404、文章页分类条占高、封面暗色刺眼 |
| 维护性 | 6 | 拓扑卡 rAF 常驻、封面无 srcset、KaTeX `font-display: block`、无 hover prefetch、单体 CSS、死代码/双源 |

完整发现见 [`frontend-findings.md`](./frontend-findings.md)。

---

## 优先级路线

**P0 · 本周(低成本、全站立刻变干净)**
1. 恢复标准 `backdrop-filter`(或顶栏改不透明)。见 F-01。
2. 正文标题整体降一级(h1→h2),保证每页只有文章标题一个 h1。见 F-02。

**P1 · 近期(移动端与搜索质量)**
3. mermaid 产物图接入已有 lightbox,手机可点开放大。见 F-04。
4. 验证 Pagefind 中文分词;不行就构建期自建小索引。见 F-03。

**P2 · 顺手清掉**
5. 锚点 aria-label / 复制按钮中文 / `/archives/` 301。见 F-06。
6. 页脚状态改措辞或接真实探测。见 F-05。

**革新(按兴趣排期,不是必须)**
7. 文末 prev/next + 相关文章——整站最明显的内链缺口。
8. 首页拓扑卡注入真实节点状态,把装饰做成仪表盘。
9. DN42 专题路线图、构建期 OG 分享卡。

---

## 亮点(不要改坏)

1. **按需加载做得扎实**:KaTeX 仅含公式页引入 CSS;Pagefind UI 第一次打开搜索才拉;Waline 进视口才挂载。
2. **零 Web 字体请求**:系统 / CJK OS 字体栈,文章页实测传输约 14 KB(不含评论)。
3. **主题与无障碍基线成熟**:`ThemeInit` 内联防 FOUC、View Transitions 圆形扩散、`prefers-reduced-motion` 全局降级、skip-link、canonical / OG / JSON-LD / RSS。
4. **构建期 mermaid**:Playwright 渲成 `public/beoe` 双主题 SVG,访客侧零 mermaid.js。
5. **辨识度高**:蓝图网格 + 琥珀点缀 + 首页拓扑卡 + 页脚 AS 状态,不是又一套「极简白底博客」。

---

## 方法与来源

| 来源 | 范围 |
|---|---|
| 浏览器实地走查 | 首页、文章列表、`/posts/astro/`、`/posts/looking-glass-shadow-incident/`、归档、友链、DN42、关于、404、搜索弹窗;Chromium 144;桌面 + `Emulation.setDeviceMetricsOverride` 390×844;亮/暗主题 |
| CDP 实测 | 顶栏 `getComputedStyle` + 线上 CSS 压缩产物对比; `CSS.supports('backdrop-filter')` vs `-webkit-`;资源体积; `lang` / OG / JSON-LD |
| 仓库 `astro/` 只读深审 | 配置、组件、样式、内容管线、客户端脚本、性能相关债务 |

**可信度**:F-01 已用线上 CSS 产物 + `CSS.supports` 实锤;F-02 已用无障碍树对比两篇文章标题层级实锤;其余条目均有源码定位。行号以审计当日磁盘为准,后续改动可能偏移。

> 同一份内容另有交互式 Canvas:`~/.cursor/projects/c-Users-AndyYan-Desktop-cursor-andy-blog/canvases/blog-frontend-review.canvas.tsx`
