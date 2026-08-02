# 对抗校验 Prompt（阶段 0–8 收尾证伪）

把本文件**全文**交给另一个 agent。要求：只读审计、禁止改代码/commit/push/写生产。

---

你是对抗校验（adversarial audit）agent，不是实现者。目标：质疑并证伪「andy-blog 阶段 0–8 已收尾、可进阶段 9」这一结论。默认不信任既有 PASS 报告与对话总结；一切以仓库证据与可复现命令为准。只读审计为主：不要改代码、不要 commit、不要 push；除非用户明确允许，否则也不要写生产、不要动线上 Typecho/MySQL。中文输出。

## 仓库与规格路径（原计划）

根目录：

    c:\Users\AndyYan\Desktop\cursor\andy-blog

规格真理（必须先读，按章节验收条文打分）：

- docs/plan.md — 全文实施方案（Draft 审计修订稿）
- docs/plan.md →「〇、执行前阻断性基线与一致快照」
- docs/plan.md →「一、架构与技术选型」
- docs/plan.md →「二、视觉与动效」
- docs/plan.md →「三、内容管线」（含 sync / route-map / shortcodes / markdown）
- docs/plan.md →「四、动效实现要点」
- docs/plan.md →「五、SEO 与 URL 迁移」（legacy map、nginx release、302→301）
- docs/plan.md →「六、评论系统」
- docs/plan.md →「七、编辑器」
- docs/plan.md →「八、部署」（Compose、WWW_ROOT、build-release、CDN）
- docs/plan.md →「九、实施计划」阶段 0–10 验收条文（约 L1657 起）
  - 阶段 0–8：声称已完成，请逐条证伪
  - 阶段 9（约 L1763）：部署与压测 — 下一阶段，勿与 0–8 完成态混淆
  - 阶段 10（约 L1774）：验收与切换 — 切流观察窗
- docs/plan.md →「十、风险清单」
- docs/plan.md →「十一、参考」

进度与门禁：

- README.md
- docs/baselines/reports/stage0-gates.md … stage8-gates.md
- docs/baselines/reports/stage2-gates.md、stage3-gates.md、astro-spike.md 等同目录报告
- docs/baselines/reports/stage5-editor-decision.md、stage7-comment-migration.md、stage8-audit.md
- docs/baselines/reviews/cid-*.json
- scripts/stage1-gate.js、stage4-gate.js … stage8-gate.js（以仓库实际文件为准）

计划中的关键数据 / 脚本 / 部署路径（核对是否存在、是否名存实亡）：

- data/route-map.json
- data/meta-route-map.json
- data/legacy-url-map.json
- data/lastmod.json
- data/friends.json（友链：Joe JFriends，非页面正文）
- .cache/manifest.json（派生产物，非路由事实来源）
- scripts/sync-typecho.js
- scripts/lib/shortcodes.js
- scripts/generate-redirects.js
- scripts/generate-comment-policy.js
- scripts/finalize-manifest.js
- scripts/build-release.sh
- scripts/run-full-reconciliation.js
- scripts/read-db-epoch.js
- scripts/extract-joe-friends.py
- nginx/release-http.conf、nginx/staging-loader.conf、nginx/conf.d/
- docker/typecho、docker/rebuild-api、docker/builder、docker/waline
- astro/（Astro 7 静态站）
- backups/（gitignored；含 MySQL dump / uploads，勿提交）

现场对照（只读）：

- https://www.andy-y.cn
- 友链旧址：https://www.andy-y.cn/index.php/5.html
- 本地预览（若已起）：http://127.0.0.1:4321/

快照 epoch：1785565762

禁止提交：secrets、backups/、凭证、.env

## 宣称的完成态（请逐条尝试推翻）

1. 阶段 0–8 门禁均已 PASS，公开内容 15 CID 复核完成，阻断项为 0。
2. Typecho headless → Astro 7 静态站功能本体已齐：同步、短代码/Markdown、视觉、SEO/legacy 302 map、Joe CMS + AutoRebuild 脚手架、Pagefind/归档分类标签分页/404、Waline 只读脚手架、内容审计。
3. 友链不在页面正文，而在 Joe 主题 option JFriends；已落到 data/friends.json 与 /friends/，样式对齐首页 post-card，半宽。
4. 明确延后到阶段 9–10（不算 0–8 失败，但必须核实是否被误标为完成）：
   - 生产 Waline MySQL 实写 / digest pin / 邮件
   - productionWriteEnabled=false 直至阶段 10
   - 完整 Compose 生产部署、TLS、双 CDN、压测、告警、切流
5. 已知接受的 warn（非 blocker）：标题层级跳跃、正文内 h1；计划留给阶段 9 Lighthouse/A11y。
6. 构建硬约束：Windows 上必须设置环境变量 PLAYWRIGHT_BROWSERS_PATH 为 %LOCALAPPDATA%\ms-playwright，否则 @beoe/rehype-mermaid 可能静默清空整篇文档。

## 任务（找洞）

对每个发现给出：严重级别（P0/P1/P2/P3）、证据路径或命令、是否证伪「可进阶段 9」、建议处置（修 / 降级为已知债 / 属 9–10 范围）。

### A. 计划符合性

- 对照 docs/plan.md「九、实施计划」阶段 0–8 验收条文，列出「声称完成但仓库无充分证据」项。
- 对照「八、部署」「五、SEO」「六、评论」：脚手架 vs 生产就绪是否被 README 说成已完成（尤其 Stage 5/7）。
- 区分：本机可证伪的缺口 vs 必须上生产/CDN 才能证伪的缺口。

### B. 门禁可信度

- 阅读 scripts/stage*-gate.js 与 docs/baselines/reports/：是否只检查文件存在/计数、是否可被假 PASS。
- 抽查 stage8 reviews 与 live/dist 是否一致（尤其 cid-5 友链：正文空 + JFriends；stage8-audit.md 是否过期仍写 intentionally empty）。
- 找「warn 被当成 pass」「apply-pass 机械盖章」「fixture 与现网漂移」风险。

### C. 内容与路由正确性

- data/route-map.json、legacy-url-map.json、meta-route-map.json、lastmod/sitemap：冲突、死链、tombstone、重复 target、/index.php/5.html → /friends/。
- 抽 3–5 篇高风险文（mermaid/短代码/html sourceFormat/多分类）对比：dump 或现网 vs astro/dist。
- 确认带正确 PLAYWRIGHT_BROWSERS_PATH 的 build 后 dist 非空、mermaid 未静默丢失。

### D. 安全与发布面

- docker/rebuild-api、AutoRebuild：HMAC、replay、未授权触发、路径穿越、密钥是否进库。
- Waline policy：productionWriteEnabled=false 时直接 POST 是否真 403；只读 UI 是否可绕过。
- nginx/ 与 release 配置：是否误暴露 admin/PHP、评论 API 缓存、WWW 可写。
- 仓库内密钥、.env、备份、凭证泄漏。

### E. 前端 / UX 回归

- /friends/：半宽 post-card、无紫光描边、与首页卡片一致；preview 是否必须 rebuild 才更新。
- 搜索懒加载、主题切换 FOUC、外链图标、移动端断点。
- 评论区未就绪文案与真实策略是否一致。

### F. 阶段边界

- 若现在进入阶段 9，会被 docs/plan.md 阶段 9 验收直接打回的项。
- 仍属站点本体、应在进 9 前修完的 P0/P1。

## 建议复现命令

在仓库根目录 PowerShell 中按需执行；失败即记为证据：

    cd c:\Users\AndyYan\Desktop\cursor\andy-blog
    $env:SNAPSHOT_EPOCH = "1785565762"
    $env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
    node scripts/stage8-gate.js
    node scripts/stage7-gate.js
    node scripts/stage6-gate.js
    node scripts/stage5-gate.js
    node scripts/stage4-gate.js
    npm run build
    npm --prefix astro run preview -- --host 127.0.0.1 --port 4321

只读对照 https://www.andy-y.cn（含 /index.php/5.html）。不要写生产。

## 输出格式（必须）

1. Verdict：READY_FOR_STAGE_9 / NOT_READY / READY_WITH_KNOWN_DEBT
2. Executive summary（≤10 行）
3. Findings：ID | Severity | Area | Claim attacked | Evidence | Impact | Disposition
4. False confidence：哪些 PASS/文档最可能误导下一任 agent
5. Pre-Stage-9 checklist：进 9 前必须关闭的项（可勾选）
6. Out of scope OK：确认属于 9–10、不应阻挡「本体收尾」的项

## 规则

- 先读 docs/plan.md（九、实施计划 + 相关章节）与 README/gates，再抽查代码与 dist；禁止只复述对话总结。
- 没有证据不要写「看起来没问题」；写「未验证」并说明缺什么。
- 优先找会在生产切流时炸的问题（静默丢文、错误 301/302、评论误开写、密钥、路由漂移）。
- 只输出审计报告，禁止改文件。
