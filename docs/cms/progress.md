# CMS 进度

## 2026-10-11 P0 契约与对拍

实现了构建快照 v2 和私有迁移包 v1 的 schema、旧 fixture 升级、两类校验，以及 snapshot / migration / dist 对拍。没有改 sync 的筛选和输出，没有把迁移校验接进公开构建，没有创建 `cms/`，没有连接生产库或图床。

命令与结果：

```text
node --test scripts/cms-contract.test.js
8 passed
```

其中：

- 两份旧 fixture 升级后能通过构建快照校验，原文件 sha256 不变。`snapshot-1785565762.json` 滤掉 attachment cid 35 和 36。
- 脱敏正例接受缺失的 draft 正文；重复主键、字符串 cid、把 draft 放进构建快照都会失败。
- 对拍能分开值变化、`"1"` 与 `1` 的类型变化、缺行和重复键。
- 私有包正例通过。悬空 `draft_version_id=99` 和被改动但 digest 未更新的正文失败。清空 leased job 只有在 `--allow-controlled-runtime` 下通过，改标题即使带这个旗标也失败。
- `snapshot-1786673780.json` 以 `CONTENT_BACKUP_DIR` 连续导出两次，Markdown 一致，`data/route-map.json` 和 `data/meta-route-map.json` 的 sha256 不变。
- `snapshot-1785565762.json` 在当前路由基线上失败，原因是 cid 9001 moment 已永久删除。stderr 不提 `schemaVersion`。

尚未作为证据的部分：

- 生产库、Lsky、off-box 和额外列库存。
- 两份隔离 Astro dist。本阶段没有改渲染，按计划不跑无目的的全站构建。`compare-dist.js` 只用合成目录验证。
- 导出器仍用 `Number()` 转换 bigint，还没改成越界报错。
- 统一来源导出、CMS 应用、编辑器手感和回迁都还没开始。

下一步是 P1：本地隔离的 CMS SSR 和编辑器保存链路。手感结论仍要等实际写一篇文章。
