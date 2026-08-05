# Stage 9 staging deployment

## Goal

在不切换 `www.andy-y.cn`、不开放生产评论的前提下，将当前候选版本部署到 `new.andy-y.cn` staging，完成可回滚的运行验收。

## Phases

- [completed] 1. 验证公网 DNS、SSH 连通性和本地发布源状态
- [completed] 2. 建立不暴露密码的临时 SSH 密钥访问
- [completed] 3. 只读盘点 VPS、Docker、现网 Nginx、目录与数据库准备状态
- [completed] 4. 备份相关配置并部署 staging candidate / Waline staging / TLS
- [completed] 5. 验证 release、noindex、隔离、Lighthouse、告警与回滚路径
- [completed] 6. 撤销临时密钥、停止本地预览并交付结果

## Safety constraints

- 不修改 `www` DNS，不切生产流量，不启用生产评论写入。
- 所有服务器写入前先确认精确目标并备份；失败时停止并回滚 staging 变更。
- 不把用户密码写入脚本、命令行、日志、仓库或记忆。
- 先只读检查，再决定是否具备运行 runbook 的条件。

## Errors

- PowerShell 直接调用 `ssh-keygen -N ''` 丢失空参数并返回 `Too many arguments`；未生成密钥。确认临时目录后改用脚本内 `cmd /c` 保留空 passphrase 参数。
- 首次远端 inventory 调用的 `cmd` 输入重定向未生效，路径被传给远端 bash；远端未执行脚本、未发生修改。改用 PowerShell 管道传递脚本正文。
- inventory 脚本经 PowerShell 管道出现尾部 CRLF，最后一行报 `$'\r': command not found` 并令整体 exit 1；主要只读检查均已完成。后续传输前显式转换为 LF。
- 本地 service audit 尝试读取不存在的 `docker/waline/policy-server.mjs`；实际文件为 `policy.js` 与 `server.js`，其余检查继续完成。后续使用真实文件名。
- base64 管道在远端末尾提示 `invalid input`，但脚本完整执行并 exit 0；后续避免以 PowerShell 字符串管道传大 payload，改用 SCP 传临时脚本或更严格编码。
- 远端 `docker buildx imagetools inspect` 访问 Docker Hub registry IP 超时，未取得 Waline/Node digest；不重复该路径，改用 Docker Hub 官方 API。
- 首次 staging 发布因 Nginx `add_header` 继承规则导致部分 location 缺失 `X-Robots-Tag`，发布陷阱自动撤销 vhost 并停止 staging 容器；随后在所有响应上下文显式写入 noindex 并加入门禁。
- Waline 服务端镜像版本与前端包版本并不相同；仓库原值 `lizheming/waline:3.15.2` 不存在，校正为官方服务端 `1.41.3`，同时保留前端 `@waline/client 3.15.2`。
- Lighthouse CLI 在 Windows 完成报告后删除临时 Chromium profile 时返回 EPERM；以完整报告且无 `runtimeError` 为准，最终首页和文章页均成功审计。
