# 阶段 0–8 对抗校验结果

- 审计日期：2026-08-02（Asia/Shanghai）
- 仓库：`C:\Users\AndyYan\Desktop\cursor\andy-blog`
- 审计方式：只读仓库检查、隔离副本构建、本地假上游安全复现、公开站点只读对照
- 生产操作：未写生产、未修改线上 Typecho/MySQL、未提交或推送

## 1. Verdict

**NOT_READY**

## 2. Executive summary

1. 隔离副本全新构建成功：32 个页面、15 个 Pagefind 内容页、9 张 Mermaid，全部现有 gate 返回 PASS。
2. 但 PASS 存在明显假阳性：9 个 canonical 分类/标签 URL 会 302 到自身。
3. Stage 8 的 15/15“人工复核”实际由 `--apply-pass` 自动盖章，14 条记录曾在 dist 缺失时仍判 PASS。
4. Waline 禁写策略可被 `/api/comment/`、`/api/comment/reply` 路径绕过。
5. rebuild-api nonce 文件并发写入存在竞态；40 个并发请求中 37 个失败，并可重放已成功请求。
6. Stage 5 的 Compose、CDN 刷新和增量推送仍包含不可运行配置或占位实现。
7. 仓库尚无任何 commit，所有项目文件未跟踪，不满足 route map“纳入版本控制”的要求。
8. 静态内容、Mermaid、RSS、Pagefind 和友链前端本体的抽查结果正常，但不足以抵消上述 P1。

## 3. Findings

| ID | Severity | Area | Claim attacked | Evidence | Impact | Disposition |
|---|---|---|---|---|---|---|
| AA-01 | P1 | SEO / 路由 | Stage 4 legacy map complete | `nginx/release-http.conf:41` 包含 `/category/default/ → /category/default/`；全量发现 9 条精确自重定向。`scripts/stage4-gate.js:31-46` 只查重复键，不查 source=target。 | 上线后 4 个分类、5 个标签 canonical URL 发生 302 循环，违反 `docs/plan.md:1718`。 | 进 Stage 9 前修复生成器；新增自重定向、重定向链、target=200 全量门禁。 |
| AA-02 | P1 | 内容审计 | Stage 8 已完成人工逐篇复核 | `scripts/stage8-audit.js:338-361` 自动设置 verdict、reviewer 和全部 checklist；`docs/baselines/reviews/cid-30.json:31-35` 保留“dist HTML missing”仍为 pass。15 条记录均由同一自动脚本在约 21ms 内生成。 | 无法证明计划要求的每篇 10–20 分钟人工复核；review 没有 source/dist hash，内容变化后仍可沿用旧 PASS。 | 将 Stage 8 降级为 incomplete；重新人工复核 15 CID，并绑定 snapshot/source/dist SHA-256。 |
| AA-03 | P1 | 评论安全 | `productionWriteEnabled=false` 时直接 POST 全部 403 | `docker/waline/server.js:62-66` 只保护精确 `/api/comment`。局部集成复现：`/api/comment`=403，但 `/api/comment/` 与 `/api/comment/reply`=200，假上游确认请求已到达。 | 禁写策略不是 fail-closed，不满足 `docs/plan.md:1751`。 | 所有 `/api/*` 非 GET/HEAD/OPTIONS 默认拒绝，再对白名单精确放行；补 trailing-slash、子路径、真实 Waline 集成测试和 body 上限。 |
| AA-04 | P1 | AutoRebuild | HMAC/replay/durable queue 已可靠 | `docker/rebuild-api/server.js:69-91` 的 nonce 和 flag 临时文件只含 PID，没有锁或请求唯一值。40 并发实测：3 成功、37 个 `rename ENOENT`、仅记住 1 个 nonce，已成功请求可再次重放。 | 并发发布可能返回 500、丢 nonce/事件或绕过 replay 防护；5 分钟 reconciliation 只能缓解事件丢失。 | 改用原子独占 nonce 文件或带事务的持久存储；临时文件加入随机请求 ID；增加并发和崩溃恢复测试。 |
| AA-05 | P1 | 版本与回滚 | Stage 1 不可变路由已持久化 | `git status --short --branch` 返回 `No commits yet on master`，全部项目文件为 `??`；`docs/plan.md:304` 明确要求 route map 纳入版本控制。 | route-map、门禁和发布脚本均无可审计基线或可靠回滚点。 | 核对 ignore 和秘密后建立首个基线 commit；本次审计未代为提交。 |
| AA-06 | P1 | Compose / CMS | Stage 5 编辑器与服务网络已落地 | `compose.yml:9-10` 将仅含配置示例和 AutoRebuild 插件的 `typecho/` 覆盖到站点根；`docker/typecho/Dockerfile:10` 未复制 Typecho；`nginx/release-http.conf:297-300` 使用 `127.0.0.1:9000`，但 PHP-FPM 是另一 Compose service。 | 当前 scaffold 无法提供 CMS 页面，Stage 5 的 CMS 登录、资源、状态流验收未完成。 | 至少将 Stage 5 标为 incomplete；补齐 CMS 文件/持久卷，并改为 `typecho:9000` 后做纵向测试。 |
| AA-07 | P1 | CDN 发布 | 双 CDN 持久刷新控制面已交付 | `host/cdn-purge.sh:27-35,51-59` 明示 Placeholder，却在有凭证时写入 `status: ok` 和伪造的 `stub-*` requestId。 | Stage 9 可能把“未调用任何 CDN API”误报为刷新成功并继续发布。 | 真正接入两家 API 前禁止返回 ok；占位状态必须是 blocked/not-implemented。 |
| AA-08 | P2 | 百度增量推送 | 新 URL 增量提交已实现 | `host/blog-rebuild.sh:62-77` 先把新 release 写成 `last-success-release`，随后才调用 push；`host/baidu-push.sh:10-31` 又把它当 previous。 | 新旧站点实际比较同一 release，通常永远得到 0 个新增 URL。 | 在覆盖 previous marker 前计算 diff，或显式传入 OLD_ID。 |
| AA-09 | P2 | Stage 0 证据 | 全部阻断基线已保存 | `docs/baselines/backup-manifest.json` 只记录一次 dump；未找到恢复演练、CMS/Waline/rebuild 纵向链路、双 CDN fixture body hash 的保存证据。 | 只能确认 SQL/RSS/Astro spike 子集，不能从仓库证据确认 Stage 0 完整验收。 | 补恢复演练和纵向探针报告；否则降级 Stage 0 完成声明。 |
| AA-10 | P2 | 门禁设计 | Stage 1/4/5 PASS 足以证明验收 | `scripts/stage1-gate.js:64-75` 只列出 route IDs，没有实际修改标题/slug、碰撞和 tombstone 测试；`scripts/stage5-gate.js:16-60` 多为存在性和字符串检查。 | 多项 PASS 证明的是“脚本可运行/文件存在”，不是计划验收语义。 | 把计划条文逐项转成行为测试；无法本机验证的项目显示 UNVERIFIED，而非 PASS。 |

## 4. False confidence

- `npm run build`：隔离构建确实退出 0，但仍生成 9 条自重定向并通过 Stage 4。
- `stage8-audit.js --apply-pass`：名称和 README 暗示复核，实际上是机械批准。
- `stage5-gates.md`：把计划要求的 CMS/控制面纵向验收收缩为本地 scaffold。
- `stage7-gates.md`：只验证精确路径的纯函数，未覆盖真实 HTTP 路由绕过。
- `stage4-gates.md`：仍写 sitemap 16 URL，而当前构建已是 31 URL，报告存在时态漂移。
- 无 Git commit：任何 PASS 报告都无法关联到不可变代码版本。

## 5. Pre-Stage-9 checklist

- [ ] 删除 9 条 canonical 自重定向，加入全量 action matrix gate。
- [ ] 修复 Waline 非精确路径绕过，证明所有禁写 POST/PUT/PATCH/DELETE 都是 403。
- [ ] 修复 nonce/flag 并发竞态，通过并发、重放和崩溃恢复测试。
- [ ] 对 15 CID 做真正人工复核，并让记录绑定 source/dist hash。
- [ ] 建立首个安全基线 commit，使 route map、规格、代码和报告可追溯。
- [ ] 补齐或明确降级 Stage 5：CMS 文件、`typecho:9000`、Joe 资源和发布动作纵向测试。
- [ ] CDN stub 不得再报告成功；修复百度 previous-release 顺序。
- [ ] 补 Stage 0 恢复演练和缺失的纵向/CDN hash 证据。
- [ ] 对 Stage 1/4/5/7 gate 增加行为测试，区分 PASS、DEFERRED、UNVERIFIED。

## 6. Out of scope OK

- 生产 Waline MySQL 实写、digest pin、邮件、最终停写对账：可留 Stage 9–10，但当前不能宣称 Stage 7 完整验收。
- TLS、双 CDN 实际缓存规则、国内外 hash、压测、Lighthouse/LCP、告警和回滚演练：属于 Stage 9。
- 302→301：当前保持 302 正确；301 应在 Stage 10 的至少 7 天观察窗后切换。
- 标题层级警告可以作为 Stage 9 A11y 已知债，但不替代 Stage 8 人工复核。
- 当前线上仍是旧 Typecho；`https://www.andy-y.cn/` 与 `https://www.andy-y.cn/index.php/5.html` 可访问，旧友链页的一条友链与 `data/friends.json` 一致。新 `/friends/` 当前 404 属切流前预期。
- 前端抽查通过：友链桌面半宽、移动端全宽、无紫色描边；320/375 px 无横向溢出；搜索首次交互后加载；评论未就绪文案正确。

## 7. Reproduction summary

在隔离副本中设置：

```powershell
$env:SNAPSHOT_EPOCH = "1785565762"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm run build
node scripts/stage1-gate.js
node scripts/stage5-gate.js
```

结果：

- 完整构建退出码：0
- Astro 静态页面：32
- Pagefind 索引内容页：15
- `index.html`：31（另有根级 `404.html`）
- dist 文件：201
- dist 总大小：4,565,086 bytes
- render/RSS/Stage 1/4/5/6/7/8 本地 gate：均返回 PASS
- 高风险文结构抽查：CID 13、30、47、68、76 的 fence 数保持一致，Mermaid 数与产物一致，短代码均完成转换
- 活动 routeId/canonical/feedGuid/commentKey：未发现重复
- legacy redirect target：均能在 dist 找到；但其中 9 条 source 与 target 相同
- 秘密扫描：忽略目录之外未发现真实密钥；`backups/`、`secrets/`、`.env`、`.cache/`、`dist/` 均被 `.gitignore` 覆盖

> 注意：现有 gate 全 PASS 并不改变本报告的 NOT_READY，因为 AA-01、AA-02、AA-03、AA-04 正是门禁未覆盖的可复现假阳性。
