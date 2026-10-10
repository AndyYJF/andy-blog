# P0 契约命令

这些命令只读写调用者给出的文件。它们不连接数据库，也不改 `scripts/sync-typecho.js`。迁移包校验没有接进日常 `npm run build`。

退出码：参数错误是 64，校验失败或对拍不同是 1，通过是 0。校验命令不修改输入。

| 命令 | 作用 |
| --- | --- |
| `node scripts/normalize-legacy-snapshot.js in.json out.json` | 输入文件名必须是 `snapshot-*.json`，且不能和输出是同一路径。缺 `schemaVersion` 时补上 `2`，去掉 `post`/`page`/`post_draft` 以外的 contents，并写 `out.upgrade-report.json`。这不是完整迁移 |
| `node scripts/validate-snapshot.js file.json` | 构建快照 v2。`draft_version_id` 可以不在 versions 中；出现在 versions 里则失败。approved 指针必须存在，versions 里也不能有未被 approved 指向的行 |
| `node scripts/validate-migration-package.js package-dir` | `migrationPackageVersion: 1`。核对 checksum、manifest 行数和 hash、主键、内容类型、i18n 指针、`source_hash`、`content_digest`、附件子集和上传字节 |
| `node scripts/compare-snapshots.js a.json b.json` | 按主键比字段。报告重复键、缺行、值差异和类型差异 |
| `node scripts/compare-migration-state.js a-dir b-dir [--allow-controlled-runtime]` | 两份私有包都要先通过校验。默认任何字段差异都失败。带旗标时，只允许 job 的 `leased` 与 `queued` 互换，以及 `lease_owner` / `lease_until` 被清空；报告仍列出这些差异 |
| `node scripts/compare-dist.js a-dir b-dir [--normalize rules.json]` | 默认比较全部相对路径的 sha256 和缺失文件。`--normalize` 的每条规则要有 `path` 和 `reason`。被点名的 hash 差异会连同规则和两侧 hash 打印出来，不计入失败；缺文件仍然失败 |

结构来源是 `scripts/snapshot-schema.json` 和 `scripts/migration-package-schema.json`。正文 digest 使用 `scripts/lib/i18n-store.js` 的 `sourceHash` 与 `contentDigest`。

脱敏样本在 `docs/cms/fixtures/`。`build/snapshot-1700000001.json` 含草稿、私密、密码、撤回、闲话、HTML、未知字段，以及一条不在 versions 里的 draft 指针。负例是重复 cid、字符串 cid，以及把 draft 正文放进构建快照。`migration/positive/` 另含附件、页面草稿、历史译文、disabled head、not_equivalent、queued/leased/failed 任务，以及 pending/accepted 译文 outbox。悬空指针和被改动正文由测试从正例复制后改出，不单独存一份会过期的 checksum。

相关测试：`npm run cms:contract:test`。
