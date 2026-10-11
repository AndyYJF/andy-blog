# 切换

这份手册还没有在生产执行。下面的生产步骤需要当次明确授权。本地已经演练过的只有隔离库上的导入、导出和回迁，见 [progress.md](progress.md)。

占位符不要换成仓库里的主机、端口或密钥路径。真实值只放在仓库外的环境文件。

## 角色

| 账号 | 能做的事 |
| --- | --- |
| `<CMS_RO_DB_USER>` | 只读导出 CMS |
| CMS 日常写账号 | 保存内容。没有 DDL 权限 |
| 迁移账号 | 只在迁入时建表和校准自增 ID，用完收回 |
| worker | 只处理 `cms_` 前缀的译文任务和通用发布队列 |

CMS 容器根文件系统只读。临时文件用独立的可写卷，不挂源码目录，不挂生产构建缓存，不挂 Docker socket。密钥不进镜像和 git。

## 来源成组

默认来源是 Typecho。改成 CMS 时，下面几项一起改：

- `CONTENT_SOURCE=cms`
- `DB_PREFIX=cms_`
- `I18N_OBSERVE_PREFIX=cms_`
- `CMS_DB_HOST`、`CMS_RO_DB_USER`、`CMS_RO_DB_PASSWORD`、`CMS_DB_NAME`
- `CMS_DB_NAME` 与 `TYPECHO_DB_NAME` 不同

缺任何一项就停。失败不改去读 Typecho。切回时同样成组改回 `typecho_`，并清掉 `CMS_DB_HOST` 和 `CMS_DB_NAME`。

## 顺序

1. 冻结 Typecho 的内容写入、译文审批、定时任务和两个队列的消费者。记下仍在 leased 或 sending 的任务。
2. 备份 Typecho 库、CMS 目标库、仓库外的环境文件，以及 `/usr/uploads/` 的文件清单。上传文件继续由站点按原路径提供，不写进正文。
3. 只读导出最终私有包。包里的 leased 任务写成 queued，并清空 lease。`expected_source_hash` 和 revision 保持原值。

```text
node scripts/export-typecho-migration.js --package <PACKAGE_DIR>
```

生产导出的库名限制以当时授权的隔离副本为准。仓库里的这个命令目前只接受 `typecho_restore`。

4. 先 dry-run，再在授权后的 CMS 库执行 bootstrap。库名必须以 `cms` 开头，主机必须是这次授权允许的地址。

```text
node scripts/import-typecho-to-cms.js --package <PACKAGE_DIR> --mode bootstrap
node scripts/import-typecho-to-cms.js --package <PACKAGE_DIR> --mode bootstrap --execute
```

5. 核对行数、cid/mid/version_id、附件路径和 i18n 指针。未完成的 `import_runs.status=staging` 时停止，不提供这半包。
6. 用 `<CMS_RO_DB_USER>` 再导出一份 CMS 包，和迁入包对拍。允许的差异只有 lease 归一。通用发布事件留在 `cms-only/`，不写进 Typecho。
7. 确认 Typecho 仍停写。然后成组把来源、worker 前缀和观察前缀切到 CMS，并启动 CMS 的 worker 和通用队列消费者。
8. 登录、图床和 dist 对拍还没有生产证据。这三项没有通过之前，不把 CMS 当成唯一写端。
9. 构建要另一次授权。沿 `host/blog-rebuild-1panel.sh` 做 checksum 和 release 切换。OpenResty 使用现有切换脚本里的配置检查，不手改生成的 nginx。证书留在仓库外。CDN 清缓存也要另一次授权。202 只表示重建请求被接收。
10. CMS 站点的 OpenResty 样例由 `scripts/generate-1panel-cms-nginx.js` 生成。写方法按直接连接限速，限速键不用客户端自报的转发地址。应用只在直连对端就是本机可信代理时，才采用转发链的最后一跳。样例不写 `Content-Security-Policy`。策略由 CMS 应用按页面发送：后台只嵌入自己的预览帧，预览帧才允许文章里已有的哔哩哔哩和网易云框架，以及 https 图片。不要把 www 的 CSP 加到这个 server 块上，`frame-ancestors 'none'` 会挡住预览。这份样例没有部署。

## 失败

先冻结 CMS 和 Typecho 的写入。静态站点用 `host/rollback-release.sh` 换回上一份 release，这不恢复数据库。数据用 [回滚](runbook-rollback.md)。两件事不要互相代替。
