# 回滚

数据回滚和静态 release 回滚是两件事。这份手册没有在生产执行。

## 静态 release

`host/rollback-release.sh` 交换 `current` 和 `previous`。它要求 `WWW_ROOT` 指向这次操作的站点根，并校验上一份 release 的 checksum。`SKIP_CDN=1` 时不刷新 CDN。是否清 CDN 由当次授权决定。

这只换已经发布的静态文件。它不恢复 CMS 或 Typecho 的行。

## 数据回滚

顺序：

1. 停 CMS 写入、译文 worker 和通用队列消费者。
2. 导出 CMS 私有包，并保留 Typecho 与 CMS 两库的备份。修订、change_log、认证、审计、media 和通用发布队列都在包的 `cms-only/`，不写进 Typecho，也不删掉。

```text
node scripts/export-cms-migration.js --package <PACKAGE_DIR>
```

3. 在隔离库上演练。`--execute` 只接受库名 `typecho_restore`。先看 dry-run 的增改删。

```text
node scripts/restore-cms-to-typecho.js --package <PACKAGE_DIR>
node scripts/restore-cms-to-typecho.js --package <PACKAGE_DIR> --execute
```

4. 未完成的通用发布事件留在 CMS 包里，报告记成一次受控重建。回迁不发构建请求。重建要另一次授权，失败也保留这些事件。
5. 核对 cid、正文、字段、关系和 i18n 指针。已删除的 cid 不能因为旧库里还有残留行而复活。
6. 核验通过后，成组把 `CONTENT_SOURCE`、`DB_PREFIX` 和 `I18N_OBSERVE_PREFIX` 切回 Typecho，并去掉 `CMS_DB_HOST` 与 `CMS_DB_NAME`。然后才恢复 Typecho 写入。
7. 核验失败就继续冻结，用备份恢复，不带着差异切回。

## 本地已经演练的部分

隔离库 `cms_life` 上改过独立页、新增过文章、删过 cid 8，并批准过译文。回迁到 `typecho_restore` 之后，cid 8 和额外塞入的 cid 990002 都不在，兼容表与 CMS 包一致。那次没有构建 dist，也没有发构建请求。`typecho_restore` 不是生产库。

账号和卷的约束与 [切换](runbook-cutover.md) 相同。CMS 容器保持只读根文件系统。`/usr/uploads/` 继续按原路径提供，回滚不改这些静态文件。
