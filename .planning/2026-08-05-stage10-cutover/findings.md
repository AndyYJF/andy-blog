# Findings — Stage 10 continuation

## 2026-08-09 local review

- 当前分支 `cursor/stage0-8-adversarial-baseline`；planning 进度已提交为 `e07ed40`。
- 本轮开始时 `scripts/migrate-comments.js` 只接受 `--backend memory`，以 Stage 0 fixture 验证算法；该缺口已在后续 Phase 8 本地完成项中补齐为独立 production CLI/backend。
- 现有算法已经覆盖 source hash、幂等 upsert、`pid/rid` 回填、Typecho namespace absent-key sweep、孤儿 / 环检测和第二次运行零变更。
- `docker/waline/schema.sql` 已定义 `wl_Comment` 与 `astro_comment_migration_map(source, legacy_coid, waline_id, source_hash)`，可作为生产事务迁移基础。
- `host/comment-stop-write-checklist.sh` 不会关闭 Typecho 写入，也不会执行生产迁移或对账；步骤 2–5 当前仍是人工占位。
- 生产启用门禁必须同时证明：Typecho 已停写并排空、迁移第二次运行零变更、source/mapping/Waline 数量差为 0、parent graph 差为 0、全局 disabled 时 POST=403、启用后只有开放 commentKey 可写。
- 当前 `astro/.cache/manifest.json` 和本地 comment policy 覆盖 15 个 commentKey，15/15 均为 writable，没有可用于生产 `entry-not-writable` 验收的真实关闭 key；未知 key=403 不能替代关闭 key=403。
- 不应通过把 Typecho 全部内容的 `allowComment` 改为 0 来停写：该字段又是 Astro/Waline 每条 policy 的真相源，后续同步会把所有 key 生成为关闭状态。停写应在 Typecho 评论提交入口 / 网络入口做全局阻断，并保留逐条 `allowComment` 值。
- 301 与评论启用必须是两个独立 release；当前禁止切 301。

## Decisions pending evidence

- VPS preflight 已核对 Typecho 表前缀/字符集及 production Waline 空 schema；凭证继续只从 VPS root-only 环境注入，不能写入仓库或报告。
- absent-key sweep 在生产必须默认 dry-run / fail-closed；只有停写后的最终事务且显式确认时才允许删除 migration namespace 内的缺失项。
- 不把 staging `waline_staging` 或 `127.0.0.1:8361` 作为生产迁移目标。
- 启用前需由 owner 确认一个业务上应关闭评论的真实 route，并在 Typecho snapshot 中保留 `allowComment=false`；否则“关闭 key 仍 403”门禁只能标为未满足，不能拿 unknown key 代替。

## 2026-08-09 VPS read-only preflight 1

- 已用专用 key 登录 `root@139.224.71.200`；只执行读取、GET/HEAD 和元数据检查，没有 POST、SQL、远端文件写入、reload、purge、状态跃迁或 release 切换。
- 1Panel OpenResty 继续占用 80/443；Typecho 仅 `127.0.0.1:8080`，生产 Waline `127.0.0.1:8360`，staging Waline `127.0.0.1:8361`。
- 生产 / staging Waline 分别为独立容器、独立镜像和独立只读 deploy mount；均在 `1panel-network` 且 healthy。
- MySQL 为 `1Panel-mysql-RSa9` / MySQL 8.4.5，host loopback `127.0.0.1:3306`，与 Typecho/Waline 同处 `1panel-network`；尚未执行 SQL。
- `current` 指向唯一 release `20260805T143100Z-c92e7d31`；`previous` 和 `candidate` 均缺失。静态 release rollback 链未建立，当前只有 1Panel vhost 备份可回 Typecho，属于切换门禁缺口。
- state 与 manifest 一致：`redirect-status=302`、`comment-write-mode=disabled`、snapshot epoch `1785565762`；`www` 与 `new` 的 `/__release` 均匹配。
- 源站 `/archives/47/` 返回 302 到 `/posts/typecho-joe-mermaid/`，但公网 Tengine 同一路径返回 200 且没有 Location；当前 origin/edge legacy 行为不一致，是 301 阻塞项，需进一步只读确认缓存对象/hash。
- `/admin/` 在源站与公网均为 404；Typecho loopback root=200、admin=302。
- 生产和 staging Waline 对根路径 comment key 的 GET 均为 403；该 key 不在 policy，不能据此判定服务异常，需用真实 commentKey 复测。
- TLS 证书有效期为 2026-06-29 至 2026-09-27；根盘 40G 已用 30G（79%，余 8.0G）；内存 1.6GiB、可用约 523MiB，swap 已用 2.1/2.5GiB。

## 2026-08-09 VPS read-only preflight 2 partial

- `www.andy-y.cn` 当前解析到阿里 CDN `www.andy-y.cn.w.kunlunaq.com` / `140.249.145.119`；`new.andy-y.cn` 直连 `139.224.71.200`。
- 使用 `curl -q`、禁止跟随跳转后，源站 legacy 仍为 302；阿里 edge legacy 为 200、`X-Cache: HIT TCP_MEM_HIT`、Age 169、Content-Length 88496。
- 公网 legacy 正文 SHA-256 与源站/公网 canonical target 正文 SHA-256 完全相同：`c87c6b7a...e57dee0a`。这是“canonical 正文被缓存到 legacy cache key”证据，不是客户端跟随 302；legacy 三视角门禁当前 FAIL。
- preflight 2 在输出公开页 title/canonical 的 shell 正则处发生引号解析错误并中止；中止点早于 known-key Waline GET 和全部 SQL，故尚未执行任何数据库查询。后续改用缩小的 2b 脚本，不重复已完成的 edge 请求。

## 2026-08-09 VPS read-only preflight 2b/3

- Typecho 实际 schema 为 `typecho_frf6hh`，评论表 `typecho_comments`、内容表 `typecho_contents`；字符集/排序规则均为 `utf8mb4_0900_ai_ci`。
- Typecho 现有评论精确聚合：总数 2，`type='comment'` 2，approved 1，waiting 1，spam 0，reply 0，max coid 11，孤儿父引用 0；与 Stage 0 fixture 数量一致，但尚未做逐字段/hash 对账。
- Typecho 内容聚合：总行数 19，公开 post/page 15，公开 `allowComment=1` 为 15，关闭为 0；确认生产没有真实 closed commentKey。
- 数据库存在 `waline` 与 `waline_staging`，但生产 `waline` 为 **0 张表**；`wl_Comment` 与 migration map 均不存在。staging 有 `wl_Comment` / `wl_Counter` / `wl_Users` 三表、2 条 approved 评论，无 migration map。
- 不带 Origin/Referer 时，对真实 `www`/origin/`new` 以及两个 loopback Waline 的已知 commentKey GET 均为 403；本地代码确认 safe GET 会转发到 upstream，因此该 403 来自 Waline `SECURE_DOMAINS`，不能单独作为 DB read verdict。
- 带匹配 Origin/Referer 的浏览器式公网 GET：staging `new`=200，production `www`=500。结合 production `waline` 0 张表，确认生产历史评论读取链路未就绪。
- 两份 1Panel Compose healthcheck 都请求无 Origin 的根 comment path，并把任意 `<500`（包括稳定 403）判为健康；当前 container `healthy` 是假绿，未覆盖 DB/schema/read path。
- 本地已把 production/staging healthcheck 修为真实 commentKey、匹配 Origin/Referer、仅 HTTP 200 PASS，并加入 `stage10:gate`。`js-yaml` 语法/结构校验 PASS；本机无 Docker CLI，`docker compose config` 尚未执行，不能标记该项 PASS。
- production schema apply、修复 healthcheck、浏览器式 GET=200、完整迁移工具与零差异对账全部是停写前阻塞项。不得进入 Typecho stop-write，也不得启用 Waline。
- 整轮 VPS preflight 仅执行 GET、header/hash、Docker/system 元数据以及 MySQL `SELECT`/`SHOW`；没有 POST、数据库写、备份、远端文件写、reload、purge、状态跃迁、release 切换或 301。

## 2026-08-09 Phase 8 implementation boundary

- 当前本机 Node `v24.16.0`、npm `11.13.0`，仓库已锁定 `mysql2 ^3.23.2`；无需新增数据库依赖。
- `scripts/migrate-comments.js` 仍为 memory-only 且被 Stage 7 gate/fixture 报告依赖；生产实现必须保持该入口与报告兼容，不能让 live 运行把 Stage 7 fixture 报告写坏。
- Phase 8 采用“共享纯迁移契约 + 独立 MySQL CLI/backend + 可注入假连接测试”结构。真实 MySQL 集成仍需隔离实例或另行授权，不能用 production `waline` 做开发测试。

## 2026-08-09 Phase 8 local completion

- 新增共享纯契约 `scripts/lib/comment-migration-core.js`，Stage 7 memory fixture 改为复用该契约；source hash v2 覆盖实际迁移的 link/IP/UA 等字段，避免这些字段漂移却仍误判幂等。
- 新增 `scripts/lib/comment-migration-mysql.js` 与独立 CLI `scripts/migrate-comments-mysql.js`：仅允许确认后的 production `waline`，校验 schema/索引，使用命名锁 + SERIALIZABLE 单事务，固定源双遍运行，默认 rollback/dry-run，absent-key sweep 需显式 `--apply-sweep`，apply 需匹配固定导出 SHA-256。
- CLI 强制 source/report 使用仓库外绝对路径；Linux source 必须 0600；报告以 exclusive 0600 创建，输出计数、集合摘要/hash、差异字段名，并仅为删除复核保留 pending/deleted `legacy_coid`；不输出正文、邮箱、IP、UA 或源文件路径。
- 14/14 隔离测试 PASS，覆盖 CLI fail-closed、缺 schema、事务回滚、双遍幂等、稳定 Waline ID、parent `pid/rid`、字段漂移修复、断裂映射拒绝、显式 scoped sweep 和 native Waline 评论隔离。
- `comments:migrate` memory 回归 PASS；`stage7:gate` PASS；`stage10:gate` PASS；两份 Compose 经 `js-yaml` 结构校验 PASS；`git diff --check` PASS。
- 本机仍无 Docker CLI，未执行真实 `docker compose config`；MySQL backend 只经假连接测试，未在真实 MySQL 8.4.5 上集成运行。production `waline` 仍为零表，代码/healthcheck 修复均未部署到 VPS。
- 下一生产动作拆成较小的 readiness 变更：先备份 production `waline`、应用 reviewed schema、部署正确 healthcheck 并要求 known-key GET=200；明确不包含 Typecho 停写/迁移/启用。范围记录于 `stage10-production-waline-readiness-authorization.md`，等待 owner 单独授权。

## 2026-08-09 Phase 8b authorized readiness preflight

- owner 已明确授权 bounded production Waline readiness 变更；不包含 Typecho 停写、迁移 apply、评论启用、OpenResty/release/purge/301，也不授权 staging 操作。
- fail-closed read-only preflight PASS：state/manifest 均为 302 + disabled，release 仍为 `20260805T143100Z-c92e7d31`。
- 唯一目标确认为 container `andy-blog-waline-waline-1`、database `waline`、loopback `127.0.0.1:8360`；MySQL 为 `1Panel-mysql-RSa9` / 8.4.5。
- Compose ownership 确认为 project `andy-blog-waline`、service `waline`、working dir `/var/www/andy-blog`、config `/var/www/andy-blog/compose.1panel-production.yml`；Docker Compose v2.36.2。
- production `waline` 仍为 0 表；根盘 79% / 8.0G 可用。当前旧 healthcheck 仍以 path=/ 且 status<500 判定；known-key browser-like GET 在 loopback/public 均为 500，符合空 schema 未就绪现状。
- preflight 未创建远端文件、未备份、未执行 DDL、未重建容器；下一步先只读比对远端 Compose 与本地候选。
- 远端 Compose mode 为 0666（本次部署候选将收紧为 0640）；remote SHA-256 `6b34ac...d1d`，当前 Compose config hash 与 container label 均为 `f1d22d...4710`，证明运行容器与远端文件一致。
- `docker compose config --services` 仅输出 `waline`，image 仅 `andy-blog-waline-waline`。远端与本地 production Compose 的完整 diff 只有 healthcheck：根 path + `<500` 改为真实 known key + production Origin/Referer + 必须 HTTP 200；无其他 service/env/image/network 差异。
- `/var/www/andy-blog/.env` 为 0600；未读取或输出其内容。远端 staging Compose 仅列出文件名/元数据，未读取、复制或执行。
- production `waline` pre-DDL 备份已写入 `/root/stage10-comments/20260809T075519Z-waline-readiness/waline-before.sql.gz`，mode 0600、gzip 完整性 PASS、size 581 bytes、SHA-256 `f9212621...f45c`；空库所以体积小。当前 Compose 与 preflight summary 也已纳入 `SHA256SUMS.before`。
- candidate remote validation PASS：schema SHA `02726f...6885c`、Compose SHA `8e2a15...a5aa`，去除 healthcheck 后前后文件 SHA 完全相同；candidate 解析为唯一 `waline` service，config hash `efbb675b...c024`。
- reviewed schema DDL 已执行。DDL 后契约断言通过至 GET 门禁，但 loopback known-key GET 非 200，脚本按 stop condition 中止。未安装 candidate Compose、未重建容器；需只读检查响应与 production logs 后决定是否仍可在授权范围内修复。
- GET 500 的明确错误为 `ER_NOT_SUPPORTED_AUTH_MODE`。production account `waline`@`%` 使用 `caching_sha2_password`，未锁定/未过期，grants 仅 USAGE + `waline`.* ALL；数据库授权本身正确。
- production image 为仓库 wrapper 基于 `lizheming/waline:1.41.3` + Node 22.16.0 构建；顶层 `/app` 无 mysql/mysql2 module，真实 upstream 位于 `/waline`。错误指向旧 upstream 数据库驱动与 MySQL 8.4 默认认证协议不兼容，而不是 schema 缺失。
- 当前 owner 授权未包含 ALTER USER / MySQL auth plugin、MySQL restart 或 Waline upstream image/version 变更。按 stop condition 暂停 Compose 安装/容器重建，继续只读确认服务端 plugin 状态与 `/waline` 实际驱动版本，以形成最小扩权方案。
- MySQL `mysql_native_password` plugin 为 ACTIVE/ON；Waline upstream `/waline` 明确解析到 `mysql` 2.18.1，未安装 mysql2。最小可逆修复不是重启 MySQL或升级镜像，而是仅将既有 `waline`@`%` 使用同一现有密码改为 `mysql_native_password`。
- blocker 证据已固化到 root-only evidence：`auth-blocker-summary.txt` 与 `SHA256SUMS.blocker`。当前 remote Compose SHA/container config hash 仍为原值，candidate 未安装，container 未重建，302/disabled 未变。
- 该 ALTER USER 不在本次授权的枚举范围，需 owner 窄扩权。拟议脚本不打印/落盘密码，从 production Waline env 内存读取并通过 stdin 设置同一密码；若 GET 仍不为 200，立即用同一密码恢复 `caching_sha2_password` 并停止。
