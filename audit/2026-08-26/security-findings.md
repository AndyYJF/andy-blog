# 安全与代码发现明细

> 配套 [`README.md`](./README.md)。级别按"当前可利用性 × 影响面"定级。
> **全部 High 已人工回读源码复核**;Medium / Low 位置以子代理报告为准,行号可能因未提交改动有偏移。

分级:**High 7 · Medium 14 · Low/Info 12**(Critical 0)。

---

## High(7)

### High-1 · 生产站缺失全部安全响应头
- **模块**:部署 · **位置**:`nginx/release-http.conf`(www 443 server 块)
- **危害**:www 块只有 `Cache-Control` / `X-Robots-Tag`,没有 `Strict-Transport-Security`、`Content-Security-Policy`、`X-Frame-Options`(或 CSP `frame-ancestors`)、`X-Content-Type-Options`、`Referrer-Policy`。站点含第三方评论与内联脚本,缺 CSP/HSTS 显著放大 XSS、点击劫持、TLS 降级面。
- **修复**:server 级 `add_header ... always` 补齐:HSTS(含 preload)、最小化 CSP、`X-Frame-Options DENY` / `frame-ancestors 'none'`、`nosniff`、`Referrer-Policy`。
- **前提**:无。面向全体公网访客即时生效——**成本最低、收益最大,建议最先做**。

### High-2 · off-box 状态面板认证"失败开放"(fail-open)
- **模块**:敏感代码 · **位置**:`host/offbox-status-ui/server.js:41-53, 110-113, 414-425, 451-458`
- **危害**:`loadPassword()` 吞异常返回空串 → `authConfigured()` 为 `false` → 四处鉴权守卫 `if (authConfigured() && !authorized(req))` 全部短路放行;`/api/status` 含构建日志 tail。`assertBindAuth()` 只在非环回绑定时强制密码,恰好不覆盖"环回 + Caddy 公网反代"的真实部署。
- **修复**:改 **fail-closed**——`authConfigured()` 为假时对受保护端点一律 401/503 并 `console.error`;`assertBindAuth()` 无条件要求密码,除非显式 `ALLOW_NO_AUTH=1`。
- **前提**:密码文件路径写错 / 权限异常 / `EnvironmentFile` 缺失。服务照常在 `127.0.0.1` 启动且无报错,Caddy 把日志暴露给全网。**前端与部署两个子代理独立命中,人工已复核**。

### High-3 · 状态面板登录无暴力破解防护
- **模块**:敏感代码 · **位置**:`host/offbox-status-ui/server.js:382-413`
- **危害**:`/login` 无速率限制、无失败计数 / 锁定、无验证码、无失败延迟,也不记录失败。配合单一共享密码可在线高速爆破,成功即得 7 天会话。
- **修复**:按 IP + 全局滑动窗口限速 + 指数退避 / 临时锁定;失败写日志便于告警;可在 Caddy 侧对 `/login` 叠加 `rate_limit`。
- **前提**:面板一旦公网可达即可被爆破,无其他前提。

### High-4 · off-box 回传 tar 解包无路径穿越校验
- **模块**:部署 · **位置**:`host/blog-rebuild-1panel.sh:321`
- **危害**:主发布路径把 off-box 回传的 `release.tar.gz` 直接 `tar -C "$WWW_ROOT/releases" -xzf`,未校验条目绝对路径 / `../` / 特殊文件。off-box 是独立信任域,被攻陷可路径穿越写到 `releases/` 之外(state、软链目标、其它 release),投毒生产。**注**:`SKIP_SWITCH` dry-run 分支(:313-315)反而做了 `test -d` + checksums 校验。
- **修复**:解包前照搬对照脚本 `enable-production-comments-1panel.sh:142` 的 `tar -tzf … | grep -Eq '(^/|(^|/)\.\.(/|$))'` 校验 + special-file 拒绝,再校验 checksums。
- **前提**:off-box builder 主机被攻陷或回传链路被劫持。属纵深防御,非匿名可直接利用。

### High-5 · rehype-raw 无消毒 + CMS HTML 原文直写正文
- **模块**:前端 · **位置**:`astro/astro.config.mjs:86` + `astro/src/content.config.ts:27` + `scripts/sync-typecho.js`(无 HTML 消毒)
- **危害**:Markdown 管线首位启用 `rehype-raw`,schema 允许 `sourceFormat: 'html'`,同步脚本把 Typecho HTML 原样写入 `.md`。一旦内容含 `<script>` / 内联事件 / `javascript:` 链接,即成全站存储型 XSS。
- **修复**:构建前对 HTML 走 allowlist 消毒(`rehype-sanitize`);或对 html 源单独消毒管线;生产禁用裸 `rehype-raw`。
- **前提**:CMS 内容被污染(插件、导入、未来多作者)。抽查现网文章多为纯 Markdown,但架构面开放。

### High-6 · `:::cloud` 短代码 href 不校验协议
- **模块**:前端 · **位置**:`astro/src/plugins/remark-directives.js:48`
- **危害**:`attrs.url` 直接写入 `href`(仅 `title` 做了 `escapeHtml`),`url="javascript:..."` / `data:text/html,...` 可生成可点击 XSS。`rel="noopener"` 不防协议。
- **修复**:仅允许 `https?:`(可再限制域名),否则降级纯文本或丢弃该短代码。
- **前提**:短代码内容被污染(编辑器或导入注入)。

### High-7 · SSH 只读脚本 AutoAddPolicy + 硬编码生产 IP/root
- **模块**:脚本 · **位置**:`scripts/ssh_readonly.py:14, 41-42`(`export_fixture.py` / `stage0_backup.py` 同款)
- **危害**:默认 `host=139.224.71.200`、`user=root`,且 `set_missing_host_key_policy(AutoAddPolicy())` 不校验主机密钥。仓库泄露即暴露生产入口;MITM 可窃取 `SSH_PASS` 与只读导出流量。
- **修复**:去掉硬编码默认;强制 `RejectPolicy` / `known_hosts`;禁止默认 root。
- **前提**:MITM 需处于链路中间;硬编码 IP 则仓库一旦外泄即暴露。

---

## Medium(14)

| # | 模块 | 问题 | 位置 | 修复要点 |
|---|---|---|---|---|
| M1 | 敏感 | `watchMetaWrites` 未校验管理员/CSRF 即 `register_shutdown` 触发签名重建,资源放大 DoS | `typecho/usr/plugins/AutoRebuild/Plugin.php:59-86` | enqueue 前校验管理员;绑定"写库成功"信号而非无条件 shutdown |
| M2 | 前端 | 评论写入靠 `hostname==='new.andy-y.cn'` 旁路,可绕过生产只读 | `astro/src/components/Comments.astro:51` · `astro/src/pages/friends.astro:76` | 写入开关只信构建期 `releaseState`,去掉 hostname 旁路 |
| M3 | 前端 | JSON-LD `set:html` 未转义 `<`,标题含 `</script>` 可打断脚本标签 | `astro/src/layouts/BaseLayout.astro:133` | 输出前把 `<` 替换为 `\u003c` |
| M4 | 前端 | 构建期对正文 https 图片发 probe,恶意 URL 可对构建机 SSRF | `astro/src/plugins/remark-image-size.js:30-40` | URL allowlist;禁私网/链路本地;探测软失败 |
| M5 | 前端 | Umami 第三方脚本无 SRI,且为每页首屏依赖(未提交改动) | `astro/src/components/CommonHead.astro:4-9` | 自托管 + `integrity`;或空闲/交互后加载;门禁计入第三方 JS |
| M6 | 前端 | `geoHide` 直连 ipwho.is 泄露访客 IP,无同意机制 | `astro/src/layouts/BaseLayout.astro:480-521` | 改由边缘按 `CF-IPCountry` 注入;避免浏览器直连第三方 Geo |
| M7 | 脚本 | 内容目录非原子交换:注释称 atomic,实为 clear 后逐个 rename,中断留半空树 | `scripts/sync-typecho.js:478-490` | `posts.next`/`pages.next` 整目录 rename 交换;失败回滚。影响域为 off-box 构建区 |
| M8 | 脚本/部署 | 基础设施 IP 与 PII 硬编码入库(真实 IP、root、邮箱夹具) | `host/offbox-builder.env.example:4,7` · `scripts/ssh_readonly.py` · observation fixture | 改占位符;真实值只放 `/etc/andy-blog/*.env`;夹具用合成数据 |
| M9 | 部署 | 状态面板 systemd 以 `root` 运行且沙箱加固缺失 | `host/systemd/offbox-status-ui.service:7,13` | 专用非特权用户 + `ProtectSystem`/`PrivateTmp`/`ReadWritePaths` |
| M10 | 敏感 | 无状态会话:登出仅清 cookie、服务端不可吊销、有效期 7 天 | `host/offbox-status-ui/server.js:67-84` | 缩短有效期 + token 版本号/会话表;logout 递增版本使旧 token 失效 |
| M11 | 部署 | 容器加固不足:无 `cap_drop`/`read_only`/`mem·pids·cpu` 上限 | `compose.1panel-cms.yml` · `compose.1panel-production.yml` | `cap_drop:[ALL]`+精确 `cap_add`、`read_only`+`tmpfs`、资源上限(小内存 VPS 防 OOM) |
| M12 | 脚本 | stage8 人工评审未齐仅 warn,`npm run build` 仍绿建 | `scripts/stage8-gate.js:108-153` | 人工完整度升为失败条件,或从默认 build 拆出并标注非发布门禁 |
| M13 | 脚本 | `materialize-301` 多文件原地依次改写,中途崩溃留"半 301" release | `scripts/materialize-301-release.js:37-73` | staging 写完一次性原子替换;脚本内重算并校验 checksum |
| M14 | 脚本 | `stage10-observation --merge` 只验结构,可拼装 `pass:true` 假证据 | `scripts/stage10-observation.js:459-543` | merge 时交叉校验 expected 字段 + 内容哈希绑定;拒绝缺字段 |

---

## Low / Info(12)

| # | 模块 | 问题 | 位置 | 修复要点 |
|---|---|---|---|---|
| L1 | 部署 | www 缺隐藏文件保护(cms 站有,www 遗漏) | `nginx/release-http.conf:273-276` | 补 `location ~ /\.` deny(放行 `.well-known`) |
| L2 | 部署 | 百度推送 token 明文入 HTTP URL 与进程表 | `host/baidu-push.sh:82` | 强制 HTTPS;token 走 header,避免进命令行 |
| L3 | 敏感 | 日志脱敏为启发式正则,裸 API key / 高熵串会漏网 | `host/offbox-status-ui/server.js`(`SECRET_LINE`) | 白名单输出 + 默认遮蔽长 base64/hex;构建脚本源头 `set +x` |
| L4 | 敏感 | `GET /logout` 无 token,可被 `<img>` 跨站触发登出 | `host/offbox-status-ui/server.js:378` | 改 POST + 同源校验 |
| L5 | 敏感 | rebuild-api `/status` 无 nonce,签名头 300s 内可重放 | `docker/rebuild-api/server.js:138-159` | `/status` 纳入 nonce 或收紧 skew |
| L6 | 敏感 | webhook secret 回退路径落在 Web 根下(潜在可下载) | `AutoRebuild/Plugin.php:93` · `Action.php:26` | 回退路径移出 Web 根;OpenResty `deny /usr/.secrets/`;secret 设为必需 |
| L7 | 前端 | 展示日期用 `toISOString().slice(0,10)`(UTC),近午夜显示前一天 | `astro/src/pages/posts/[id].astro:68-70` | `Intl.DateTimeFormat` + `Asia/Shanghai`,或用同步侧本地日历日 |
| L8 | 前端 | uptime 纪元硬编码 + `years=floor(days/365)` 忽略闰年 + 每秒定时器 | `astro/src/layouts/BaseLayout.astro:529-547` | 抽 `SITE_EPOCH` 常量;用日历差;可见时才更新或降到每分钟 |
| L9 | 前端 | 404 设 `canonical` 指向首页(SEO 反模式) | `astro/src/pages/404.astro:7` | 404 省略 `rel=canonical`,或自指并保持 noindex |
| L10 | 前端 | 原生 `<summary>` 叠加 `role=button`,读屏可能重复/错报 | `astro/src/layouts/BaseLayout.astro:163-170` | 去掉多余 role,保留 `aria-expanded` |
| L11 | 部署 | 镜像 pin 靠约定不强制,填非 digest tag 仍可启动 | `docker/waline/Dockerfile` · `.env.example` | 启动/CI 断言 `@sha256:` 格式 |
| L12 | 部署 | 密钥(webhook/JWT/SSH/CDN/DB)无轮换机制与文档 | `secrets/` 与 compose secret | 补轮换脚本/手册;`webhook_secret` 轮换需两端同步 |
