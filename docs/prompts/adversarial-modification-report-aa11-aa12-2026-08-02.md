# 对抗校验修改报告（AA-11 / AA-12 续修）

- 日期：2026-08-02
- 对照：`adversarial-modification-verification-2026-08-02.md`
- 分支：`cursor/stage0-8-adversarial-baseline`（工作区含未提交 diff）
- 请复查 agent 只读验证；禁止改仓库除非用户授权

## 1. 实现方自述

相对 verification 报告：

| ID | 声称 |
|---|---|
| AA-11 / AA-01 回归 | **FIXED**：path legacy map 改用 case-sensitive `~^...$` 键 |
| AA-12 / AA-02 回归 | **FIXED（语义）**：`agent-spot` 与 human `pass` 分离；gate 不再把 spot 计为 humanPass |
| AA-02 Final | 仍为 **1/15 human**（已知债，诚实警告） |

## 2. 改动要点

### AA-11 — Nginx case-insensitive map

`scripts/generate-nginx.js`：

- path 类 map（`legacy_target` / `legacy_not_found` / `legacy_gone`）键改为 `~^escaped$`
- 保留 `/category/AI/` → `/category/ai/`（仅精确大写命中）
- 小写 canonical `/category/ai/` 不再误匹配大写键，可走 `try_files` 200

`scripts/stage4-gate.js`：

- 断言 `$legacy_target` 块内路径键均为 `~^...$`
- 负向矩阵：`/category/ai|dn42|nas/` 不得出现 plain `"..."` 字符串键

本机已见产物示例：

```text
~^/category/AI/$ "/category/ai/";
~^/category/DN42/$ "/category/dn42/";
~^/category/NAS/$ "/category/nas/";
```

### AA-12 — Stage8 humanPass 假阳性

- `spot-verify-reviews.js --write` → `verdict=agent-spot`（仅 CID5 人工保留 `pass` + `manual+live-verify`）
- `stage8-gate.js`：`humanPass` 只计 `verdict=pass` 且 reviewer 不在 auto 集合
- auto reviewer：`stage8-audit` / `stage8-audit-auto` / `agent-spot-verify`
- 禁止 `verdict=pass` + auto reviewer
- 本机 gate 输出：`humanPass=1`、`agentSpot=14`、warnings 含 Final incomplete

## 3. 建议复现

```powershell
cd C:\Users\AndyYan\Desktop\cursor\andy-blog
$env:SNAPSHOT_EPOCH = "1785565762"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"

node scripts/generate-nginx.js --status 302
node scripts/stage4-gate.js
# 确认无 quoted "/category/AI/" 键；全为 ~^/category/AI/$
Select-String nginx/release-http.conf -Pattern 'category/(AI|ai)/'

node scripts/spot-verify-reviews.js
node scripts/stage8-gate.js
# 期望 humanPass=1 agentSpot=14，且有 Final incomplete warning

node scripts/stage5-gate.js
```

可选：完整 `npm run build`（需正确 PLAYWRIGHT_BROWSERS_PATH）。

## 4. 仍未关闭（勿误判 READY）

- AA-02 人工 Final 14 篇未做（除非项目批准降级为 agent-spot）
- AA-06 CMS 完整纵向 / AA-09 Stage0 证据
- AA-10 Stage1 mutation、发布回滚/crash
- 真实 CDN purge API

## 5. 请输出

Verdict；AA-11/AA-12 确认或打回；新 Finding；更新 checklist；False confidence。
