# 对抗校验修改报告（交给复查 agent）

- 日期：2026-08-02
- 仓库：`C:\Users\AndyYan\Desktop\cursor\andy-blog`
- 分支：`cursor/stage0-8-adversarial-baseline`
- 基线提交：`31d6625` — AndyYJF \<3363230241@qq.com\>
- 对照文件：
  - `docs/prompts/adversarial-audit-stage0-8-result-2026-08-02.md`（初审）
  - `docs/prompts/adversarial-audit-stage0-8-recheck-2026-08-02.md`（复查）
  - `docs/prompts/adversarial-remediation-2026-08-02.md`
  - `docs/prompts/adversarial-remediation-recheck-followup-2026-08-02.md`
- 本文件用途：请对抗校验 agent **只读复查**本轮修改是否真正关闭 Finding；默认不信任本报告表述。

---

## 1. 实现方自述结论（请证伪）

实现方声称：相对 recheck 报告，**AA-08 已 FIXED**；**AA-05 已 FIXED（首个 baseline commit）**；AA-02/AA-10 有实质改善但仍须诚实标注边界；AA-06/AA-09 仍为已知债。

请输出新的 Verdict：`READY_FOR_STAGE_9` / `NOT_READY` / `READY_WITH_KNOWN_DEBT`，并更新每条 AA 的 FIXED / PARTIALLY_FIXED / NOT_FIXED / REGRESSION。

---

## 2. Finding 处置总表

| ID | Recheck 时 | 本轮声称 | 关键改动 | 请你验证的攻击点 |
|---|---|---|---|---|
| AA-01 | FIXED | 保持 FIXED | `scripts/build-legacy-url-map.js` 跳过 self；`generate-nginx.js` 拒绝 self；`stage4-gate.js` 查 map+nginx | 再生 legacy/nginx，确认 0 条 `oldPath===targetPath`，尤其 `/category/*` `/tag/*` |
| AA-02 | PARTIAL | IMPROVED→请重判 | `stage8-audit.js` 不再伪人工 pass；`spot-verify-reviews.js`；15 CID `verdict=pass` | 抽查 reviews：CID5=`manual+live-verify`，其余多为 `agent-spot-verify`；确认有 source/dist hash；**不得**把 agent spot-verify 等同计划「10–20 分钟人工通读」除非你认可该降级 |
| AA-03 | FIXED | 保持 FIXED | `docker/waline/server.js` + `server-path.js` fail-closed | 复跑 `/api/comment`、`/api/comment/`、`/api/comment/reply`、`/api/user`；缺 policy→503 |
| AA-04 | FIXED | 保持 FIXED | `docker/rebuild-api/server.js` 写锁+随机 tmp；test 40 并发 | 40 nonce 全成功；重放拒绝；无 ENOENT |
| AA-05 | NOT_FIXED | **FIXED（声称）** | 分支 `cursor/stage0-8-adversarial-baseline`，commit `31d6625`，240 files；ignore 排除 backups/secrets/.env/dist/beoe | `git log`/`git status`；确认 route-map 等已入库；确认无秘密进库 |
| AA-06 | PARTIAL | 仍 PARTIAL/降级 | nginx `fastcgi_pass typecho:9000`；README/stage5 标明 CMS scaffold | 确认仍无完整 Typecho 程序树；勿因 upstream 名已修而判 Stage5 Final |
| AA-07 | FIXED | 保持 FIXED | `host/cdn-purge.sh` → `not-implemented` + exit 71 | 注入假凭证不得出现 `ok`/`stub-*` |
| AA-08 | PARTIAL（双斜杠） | **FIXED（声称）** | `host/baidu-push.sh` 前缀剥离；`scripts/test-baidu-push.sh`；stage5-gate 接入 | **必测**：old=kept / new=kept+added → 唯一 URL 必须是 `https://www.andy-y.cn/posts/added/`，禁止 `//posts/` |
| AA-09 | NOT_FIXED | 仍 NOT_FIXED | 仅文档承认 | 确认仍无 restore drill / 双 CDN body hash 证据 |
| AA-10 | PARTIAL | IMPROVED | baidu 行为测试入 gate；stage5/8 更诚实 | 确认 stage5 在 baidu 双斜杠回归时会 FAIL；Stage1 mutation 仍缺则记债 |

---

## 3. 关键代码与行为说明

### 3.1 AA-08 Baidu 双斜杠（本轮主修）

根因：`sed "s|$root|/|"` 在 `$root/posts/...` 上会留下多余 `/`，得到 `//posts/`。

修复：`host/baidu-push.sh` 的 `list_posts` 改为：

- `root` 去尾斜杠
- `rel="${f#"$root"/}"` 再去掉 `/index.html`
- `printf 'https://www.andy-y.cn/%s/\n' "$rel"`
- 推送前拒绝 `andy-y.cn//` 与非 `/posts/` 形态

行为夹具：`scripts/test-baidu-push.sh`  
Stage5：`scripts/stage5-gate.js` 会 `bash scripts/test-baidu-push.sh` 并断言 JSON 中 url。

### 3.2 AA-05 首个 baseline commit

- 分支：`cursor/stage0-8-adversarial-baseline`
- Commit：`31d6625`
- Author：AndyYJF \<3363230241@qq.com\>
- 含：`data/route-map.json`、`legacy-url-map.json`、astro 源码、gates、docker/host/nginx、docs/prompts、reviews 等
- 刻意排除：`backups/`、`secrets/`、`.env`、`node_modules/`、`dist/`、`astro/public/beoe/`
- `.gitignore`：允许 `docker/**/*.sql`（如 `docker/waline/schema.sql`）；显式忽略 `astro/public/beoe/`

### 3.3 AA-02 Spot-verify（边界请盯紧）

- `node scripts/spot-verify-reviews.js [--write]`
- 检查：source/dist SHA-256、canonical、无残留 shortcode、无 `/index.php/archives/`、文章标记；friends 页 UI
- 写回：`verdict=pass`，`reviewer=agent-spot-verify`（CID5 保留 `manual+live-verify`）
- **实现方承认**：这是可复现自动化抽查，**不是**计划原文的逐篇 10–20 分钟人工编辑复核

### 3.4 此前已修且声称仍成立（请抽测，勿只看文档）

- AA-01 self-redirect 过滤器 + stage4
- AA-03 Waline pathname fail-closed + `docker/waline/test.js`（含 path helpers）
- AA-04 rebuild-api 并发锁 + 40 nonce 测试
- AA-07 CDN stub 禁止假成功

---

## 4. 建议复现命令（隔离副本优先）

在仓库根目录 PowerShell：

```powershell
cd C:\Users\AndyYan\Desktop\cursor\andy-blog
git checkout cursor/stage0-8-adversarial-baseline
git log -1 --format="%H %an <%ae> %s"
git status -sb

$env:SNAPSHOT_EPOCH = "1785565762"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"

bash scripts/test-baidu-push.sh
node docker/rebuild-api/test.js
node docker/waline/test.js
node scripts/stage5-gate.js
node scripts/spot-verify-reviews.js
node scripts/stage8-gate.js

npm run legacy:map
npm run nginx:302
node scripts/stage4-gate.js

# 可选完整构建
npm run build
```

只读对照现网：`https://www.andy-y.cn/`、`/index.php/5.html`。禁止写生产。

---

## 5. 实现方已知未关闭项（勿被 README「完成」话术带偏）

1. **AA-06**：`typecho/` 仍只有插件/配置样例；无完整 Typecho 程序；CMS 登录/上传/发布纵向未在本机证明。
2. **AA-09**：Stage0 恢复演练、完整纵向探针、双 CDN 同 fixture body hash 仍无仓库证据。
3. **AA-02 语义债**：若验收坚持「人工 10–20 分钟/篇」，则当前 14 篇 `agent-spot-verify` 仍不够 Final。
4. **AA-10 残余**：Stage1 无 slug-change / delete-tombstone mutation；无完整发布切换/回滚/crash 故障注入。
5. **CDN 真实 purge API**：AA-07 只修了「假成功」；能力本身仍 not-implemented（Stage 9）。
6. **评论生产 MySQL / digest / 邮件 / 停写对账**：仍属 Stage 9–10。

---

## 6. 请复查 agent 的输出格式

1. Verdict（三选一）
2. 逐条 AA 状态表（相对本修改报告：确认 / 打回 / 新发现）
3. 必测项结果：Baidu URL、git baseline、Waline 路径、rebuild 并发、self-redirect
4. 新 Finding（若有）ID / Severity / Evidence / Disposition
5. Pre-Stage-9 checklist 更新版（可勾选）
6. False confidence：本修改报告里哪些表述最容易误导

规则：先跑命令再下结论；没有证据写「未验证」；中文输出；**只出审计报告，禁止改仓库文件**（除非用户另行授权）。
