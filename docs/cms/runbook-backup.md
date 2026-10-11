# 备份

这里有三种备份，不能互相代替。这份手册没有在生产执行新的备份。

| 备份 | 命令 | 包含 | 不包含 |
| --- | --- | --- | --- |
| 已发布内容 | `host/backup-content-github.sh` | 公开 Markdown，以及备份目录里的选择清单、路由和 lastmod | 草稿正文、私有队列、修订 |
| 构建快照 | `node scripts/export-content-snapshot.js` | schemaVersion 2。默认读 Typecho 的 `DB_*` | 未被批准的译文正文 |
| 私有迁移包 | `node scripts/export-cms-migration.js --package <PACKAGE_DIR>` | 兼容表，加上 `cms-only/` 里的修订、change_log、导入记录、通用发布队列、media 和审计 | 不会把这些 CMS 专有行写进 Typecho |

`CONTENT_SOURCE=cms` 时，构建快照改走 `CMS_DB_*` 和 `<CMS_RO_DB_USER>`。`DB_HOST` 或 `DB_NAME` 指向另一套库时命令退出 65。`export-cms-snapshot.js` 固定用来源 cms。

内容备份在 CMS 来源下先导出快照，再把 `DB_HOST` 置空后同步。`CONTENT_BACKUP_DIR` 只写备份目录。仓库里的 `data/route-map.json` 和 `data/meta-route-map.json` 不作为这次备份的写入目标。

影子同步使用仓库外的目录：

```text
SHADOW_WORK=<WORK_DIR> SNAPSHOT_EPOCH=<EPOCH> FIXTURE_PATH=<SNAPSHOT_JSON> bash scripts/cms-shadow-build.sh
```

`<WORK_DIR>` 不能是仓库本身。当前工作区没有 Astro 工具链时，这个命令在同步之后退出 65，dist 不会出现。

## 恢复演练

私有包的恢复演练是 [回滚](runbook-rollback.md) 里的 `restore-cms-to-typecho.js`。目标库名只能是 `typecho_restore`。生产库恢复需要另一次授权。

MySQL 数据文件和 `/usr/uploads/` 的文件清单另外保留。迁移包里的附件记录是路径和字节校验，不代替上传目录本身。上传目录继续由 OpenResty 按原来的 `/usr/uploads/` 提供。

密钥、证书和数据库口令只放在仓库外的环境文件。CMS 容器根文件系统只读，备份过程不把密钥写进镜像。
