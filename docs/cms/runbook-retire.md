# 下线

下线还没有授权，也没有执行。观察期未开始。建议的生产观察是 14 个日历日，并且覆盖一次内容修改、一次译文审批和一次私有包恢复。缺任何一项就延长，不自动通过。

下线之前要同时满足：

- CMS 是唯一写端，Typecho 保持停写
- 最近一次私有包能在隔离库恢复，已删除的内容不会复活
- 静态 release 可以用 `host/rollback-release.sh` 换回上一份
- `/usr/uploads/` 的文件仍由站点按原路径提供
- MySQL 服务和 Waline 保留

授权之后才归档 Typecho 的应用代码。归档不包含下面几项：

- MySQL 服务
- Waline
- `/usr/uploads/` 静态文件
- 仍被构建或备份调用的 `scripts/export-typecho-snapshot.js`、`scripts/sync-typecho.js` 和 `host/blog-rebuild-1panel.sh`

旧 URL 以 `data/legacy-url-map.json` 为准，不在下线时假定已经全部迁走。nginx 映射继续用 `npm run nginx:302` 或 `npm run nginx:301` 生成，不手改生成的配置。证书留在仓库外。

回滚窗口内保留 Typecho 容器镜像、数据库备份、插件配置和上传目录。数据回滚见 [回滚](runbook-rollback.md)。静态 release 回滚不恢复数据库。
