# 自研 CMS 文档

归档日期：2026-10-11。方案版本：v2（2026-10-10）。状态：**P0 契约与对拍已开始**；Typecho 仍是写入端。见 [progress.md](progress.md)。

当前写入端仍为 Typecho。此目录规划未来单用户 CMS 的建设、完整迁移和回滚，不代表已经替换当前后台，也不构成生产变更授权。

| 文档 | 用途 |
| --- | --- |
| [完整方案 v2](design-v2-2026-10-10.md) | 目标、选型、数据契约、发布与预览、认证、迁移及回滚、工期 |
| [Agent 执行计划 v2](agent-plan-v2-2026-10-10.md) | P0–P5 任务、目标文件、接口、相关验收和实施边界 |
| [库存](inventory.md) | 本地 fixture 与导出器差异；不是生产库存 |
| [契约](contracts.md) | 已实现命令、退出码和两类校验差异 |
| [进度](progress.md) | 实际命令、结果和尚未验证的部分 |

实施前先读 [根 AGENTS.md](../../AGENTS.md)，再读完整方案与执行计划。两份 v2 是仓库内的维护基线；后续修改要同时保持其决定、接口和阶段一致。桌面目录中的 v1/v2 留作历史草稿，不作为仓库外的第二套实施规范。

本版的关键约束：原文及 Typecho 兼容列名导入；构建快照与完整私有迁移包分开；通用发布 outbox 与译文 outbox 分开；正式构建与内容备份使用一致来源；P2 实现并演练回迁；互动预览与正式构建预览分开。

当前写入链仍是：[快照导出](../../scripts/export-typecho-snapshot.js)、[同步](../../scripts/sync-typecho.js)、[i18n store](../../scripts/lib/i18n-store.js)、[i18n 快照](../../scripts/lib/i18n-snapshot.js)、[构建入口](../../host/blog-rebuild-1panel.sh)、[内容备份](../../host/backup-content-github.sh)。P0 新增的是契约和对拍脚本，见 [contracts.md](contracts.md)。`cms/` 应用、统一来源导出器和回迁脚本还没有。

关联文档：[项目 README](../../README.md)、[原静态站重构规划](../plan.md)、[既有 i18n 方案](../i18n-plan-v2-2026-09-26.md)、[i18n 最终报告](../i18n-final-report-2026-09-27.md)、[译文撤回手册](../i18n-withdrawal-runbook.md)。历史规划、报告和现有运维手册保持各自的原有范围；CMS v2 不把历史完成项改写成新 CMS 的完成证据。

inventory、contracts 和 progress 记录已经落地的证据。切换、回滚和退役 runbook 仍待后一阶段；生产接入、切换与下线按当次用户授权执行。
