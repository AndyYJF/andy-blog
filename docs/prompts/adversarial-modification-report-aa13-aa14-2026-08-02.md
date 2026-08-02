# 对抗校验修改报告（AA-13 / AA-14）

- 日期：2026-08-02
- 对照：`adversarial-modification-verification-aa11-aa12-2026-08-02.md`
- 分支：`cursor/stage0-8-adversarial-baseline`（工作区含未提交 diff）
- 请复查 agent 只读验证；禁止改仓库除非用户授权

## 1. 实现方自述

相对 AA-11/AA-12 verification 报告中的新 Finding：

| ID | 声称 |
|---|---|
| AA-14（原 AA-11 门禁缺口） | **FIXED**：Stage4 解码 `~^literal$`，禁止 regex-self；Nginx path redirect 与 `legacy-url-map.json` 1:1 对账 |
| AA-13（原 AA-12 门禁缺口） | **FIXED**：`reviewKind` 为唯一人性判定；`human`/`agent-spot`/`audit` → 强制对应 verdict；reviewer 名仅为展示 |
| AA-02 Final | 仍为 **1/15 human**（已知债，诚实警告） |

## 2. 改动要点

### AA-14 — regex-self + legacy 对账

`scripts/stage4-gate.js`：

- `decodeAnchoredLiteral()`：解析 `~^...$` 为字面 path（支持 `\.` 等转义；拒绝含 `*+?|()[]{}` 的非字面模式）
- `literal !== to`，否则 `regex-self redirect forbidden`
- 负向：`/category/ai|dn42|nas/` 不得 `nginxPathRedirects.get(canon) === canon`
- Nginx `$legacy_target` path 条目数与 `legacy-url-map` 中 `action=redirect && oldPath` 条数一致，且每条 `oldPath → targetPath` 对账

本机 mutation（`scripts/test-aa13-aa14-mutations.js`）：

```text
~^/category/ai/$ "/category/ai/";
→ Stage4 FAIL: regex-self redirect forbidden
```

### AA-13 — reviewKind fail-closed

`scripts/stage8-gate.js`：

- 唯一分类源：`reviewKind ∈ {human, agent-spot, audit}`
- 强制：`human→pass`、`agent-spot→agent-spot`、`audit→audit-clean`
- **不再**用 reviewer 名称推断是否 human（无 denylist/allowlist 绕过面）
- 缺 `reviewKind` → FAIL

写入路径：

- `spot-verify-reviews.js --write`：写 `reviewKind=agent-spot`（CID5 / 已有 human 保留）
- `stage8-audit.js --sync-audit`：仅在缺 kind 或已是 audit 时写 `reviewKind=audit`（不覆盖 human / agent-spot）
- 15 条 `docs/baselines/reviews/cid-*.json` 已迁移：`cid-5` → `human`；其余 14 → `agent-spot`

本机 mutation：

```text
delete reviewKind + verdict=pass + reviewer=codex-auto-v2
→ Stage8 FAIL: reviewKind must be human|agent-spot|audit

reviewKind=agent-spot + verdict=pass
→ Stage8 FAIL: requires verdict=agent-spot
```

当前正常 gate：

```text
humanPass=1
agentSpot=14
auditClean=0
warnings: agent-spot not Final; human pass 1/15
```

## 3. 建议复现

```powershell
cd C:\Users\AndyYan\Desktop\cursor\andy-blog
$env:SNAPSHOT_EPOCH = "1785565762"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"

node scripts/stage4-gate.js
node scripts/stage8-gate.js
node scripts/stage5-gate.js
node scripts/test-aa13-aa14-mutations.js
# 期望三 gate ok；mutation 脚本 ok（临时改 nginx/cid-11 后恢复）
```

可选：手工复现 AA-14 / AA-13 mutation（改完务必还原）：

```powershell
# AA-14
(Get-Content nginx/release-http.conf) -replace '~^/category/AI/\$ "/category/ai/";','~^/category/ai/$ "/category/ai/";' | Set-Content nginx/release-http.conf -Encoding utf8
node scripts/stage4-gate.js   # 期望 FAIL
git checkout -- nginx/release-http.conf

# AA-13：删掉任一 cid 的 reviewKind 或把 agent-spot 配成 verdict=pass
node scripts/stage8-gate.js   # 期望 FAIL
```

## 4. 仍未关闭（勿误判 READY）

- AA-02 人工 Final 14 篇未做（除非项目批准降级为 agent-spot）
- AA-06 CMS 完整纵向 / AA-09 Stage0 证据
- AA-10 Stage1 mutation、发布回滚/crash
- 真实 CDN purge API

## 5. 请输出

Verdict；AA-13/AA-14 确认或打回；新 Finding；更新 checklist；False confidence。
