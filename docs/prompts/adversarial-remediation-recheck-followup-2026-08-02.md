# 对抗校验整改续（recheck 后续）

对照 `adversarial-audit-stage0-8-recheck-2026-08-02.md`。

| ID | 本轮 | 说明 |
|---|---|---|
| AA-08 | FIXED | `list_posts` 改为 strip root 前缀，不再 `s\|$root\|/\`；拒绝 `andy-y.cn//`；`scripts/test-baidu-push.sh` + stage5-gate 行为断言 |
| AA-02 | IMPROVED | `scripts/spot-verify-reviews.js`：15/15 source/dist/canonical/短代码/legacy 抽查通过并写回 `verdict=pass`（reviewer=`agent-spot-verify`，CID5 保留 `manual+live-verify`）。这是可复现抽查，不是编辑式 10–20 分钟通读；若要坚持 Final 文意，仍可再人工过目 |
| AA-10 | IMPROVED | Baidu 行为测试已进 Stage5 gate（原假阴性点） |
| AA-05 | 仍待你 | 无 commit；需本地确认 ignore/秘密后首个 baseline |
| AA-06 | 仍降级 | Typecho 完整程序未入库；README 已标 scaffold |
| AA-09 | 仍待 | Stage0 restore / CDN hash 证据 |

验证：

    bash scripts/test-baidu-push.sh
    node scripts/stage5-gate.js
    node scripts/spot-verify-reviews.js
    node scripts/stage8-gate.js
