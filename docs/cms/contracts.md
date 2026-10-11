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

## 本地 CMS 原型

这些命令只在本机。它们没有接进 `npm run build`，也没有连生产库。

| 命令 | 作用 |
| --- | --- |
| `npm run cms:editor:test` | CodeMirror 换行往返、混合换行、预览副本和预览并发。MySQL 用例在 `127.0.0.1:3307` 没开、也没有 Docker 时跳过 |
| `npm run cms:publish:test` | 通用发布队列和译文队列分开、公开变更才入队、202 才算接受、导入计划不改原文字节。不连接数据库 |
| `npm run cms:mysql:test` | 连 `127.0.0.1:3307` 的库 `cms` / `cms_p2_test`。保存读回、修订冲突、租约恢复，以及脱敏包导入再导出。库没开时跳过 |
| `node scripts/import-typecho-to-cms.js --package dir --mode bootstrap\|mirror [--execute]` | 默认 dry-run，只校验包并打印行数。`--execute` 才写入，且 `DB_HOST` 必须是本机，`DB_NAME` 必须以 `cms` 开头。错库或非本机退出 65 |
| `node scripts/export-cms-migration.js --package dir` | 从本机 CMS 库做一致性读取，写成 migration package。包里的 `leased` 任务改成 `queued` 并清空 lease，不改 `expected_source_hash` 和 revision。通用发布队列留在 `cms-only/`，未完成事件记成一次受控重建。不写 Typecho，也不发构建请求 |
| `node scripts/export-typecho-migration.js --package dir` | 只读导出隔离库 `typecho_restore`。包里的 leased 任务同样改成 queued，源库原行不变。其它库名退出 65。不发构建请求 |
| `node scripts/cms-shadow-sync.js --package dir [--execute]` | 默认 dry-run，只读 `typecho_restore` 并写出包。`--execute` 才镜像进 `CMS_DB_NAME` 指向的本机 CMS 库，并把它标成影子库。不发构建请求 |
| `node scripts/restore-cms-to-typecho.js --package dir [--execute]` | 默认 dry-run，报告增改删和那一次受控重建。`--execute` 只允许库名 `typecho_restore`。未完成的通用发布事件留在包里，不写进 Typecho，也不发构建请求 |
| `docker compose -f compose.cms-dev.yml up -d` | 只绑定 `127.0.0.1:3307` 的 MySQL 8.4。库 `cms`，用户 `cms`，密码 `cms-dev`。这是本地原型口令，不是生产 |
| `npm --prefix cms run dev` | `http://127.0.0.1:4322`。中间件拒绝非回环地址。编辑页是 `/edit/<cid>/` |

2026-10-11 另在本机 `127.0.0.1:3307` 跑过 `npm run cms:mysql:test`，6 passed。compose 没有启动。

构建和内容备份默认仍读 Typecho。`CONTENT_SOURCE=cms` 必须同时给出 `DB_PREFIX=cms_`、`I18N_OBSERVE_PREFIX=cms_`，以及和 `TYPECHO_DB_NAME` 不同的 `CMS_DB_*`。缺任一项时计划退出 65。同步若在 `CONTENT_SOURCE=cms` 时还带着 `DB_HOST`，会拒绝查库。`export-content-snapshot.js` 默认走 `DB_*` 读 Typecho。`CONTENT_SOURCE=cms` 时只连 `CMS_DB_*`；`DB_HOST` 或 `DB_NAME` 若指向另一套库，退出 65，不连过去。`export-cms-snapshot.js` 固定把来源设成 cms。缺 `SNAPSHOT_EPOCH` 或输出路径不是绝对路径时退出 64。草稿译文版本不进这份构建快照。`cms-shadow-build.sh` 只把冻结快照同步到仓库外的 `SHADOW_WORK`；指向仓库、缺文件或路径含 `..` 时退出 65。它不切换 release，也不清 CDN。没有 Astro 工具链时退出 65，并且不构建 dist。`cms-shadow-diff.js` 按私有包、构建快照、Markdown、清单、dist 比较。没有 dist 目录时退出 65。任一已比较阶段不同则退出 1。只有连 dist 在内都相同才退出 0。
