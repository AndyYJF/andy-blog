# Findings — Stage 10

- 2026-08-05：Stage 9 staging（`new.andy-y.cn`）已验收；`www` 仍反代 Typecho `:8080`；生产评论仍为 Typecho。
- 2026-08-05：现网为 1Panel OpenResty 占用 80/443，不能 `up` 仓库 nginx；Stage 10 必须延续 1Panel adapter 路径（与 Stage 9 同构）。
- 2026-08-05：仓库已有 `switch-release.sh`（失败回退），缺独立 rollback / roll-forward 与状态跃迁命令（§8.3）。
- 2026-08-05：`cdn-purge.sh` 在有凭证时仍 `not-implemented` exit 71；切流后每次发布会 edge-pending，除非接线或明确跳过凭证。
- 2026-08-05：评论迁移仅 memory fixture；生产 MySQL 停写 + 最终对账仍属 VPS 步骤。
- 2026-08-05：人工 Final 已由 owner 记为 15/15（`owner-final-accept`）；不等于跳过切流门禁。
- 2026-08-05：证书通配有效至 2026-09-27；根盘约 78% — 切流前再核。
- 2026-08-05：in-repo Stage 10 scaffold PASS；未执行 www DNS/OpenResty 切换。
