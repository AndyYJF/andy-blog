# andy-blog 全方位审计报告

> **审计日期**:2026-08-26
> **目标**:www.andy-y.cn(Typecho 1.2.1 无头 CMS → Astro 静态站,1Panel + off-box 构建 + 蓝绿发布 + 多 CDN)
> **范围**:`astro/` · `scripts/` · `host/` · `docker/` · `nginx/` · `typecho/`,以审计当时磁盘(含未提交改动)为准
> **方法**:4 个并行只读子代理深审 + 人工回读源码复核全部 High + 全量 Node 单元测试 + 浏览器实地双主题/移动端视觉走查

---

## 执行摘要

整体工程质量**明显高于一般个人博客**:rebuild-api 用 HMAC-SHA256 + nonce + 时间戳 skew 做防重放,发布走"校验 checksums → `mv -T` 原子软链 → 蓝绿 current/previous → 失败回滚"的不可变模式,评论系统生产默认只读并带 XSS 自检,SSH 全程 `StrictHostKeyChecking yes` + 凭据隔离。**没有发现当前可被匿名直接利用的 Critical 级问题**。

发现主要集中在两类:(1) **纵深防御缺口**——多数 High 依赖前提(内容被污染 / off-box 被攻陷),一旦前提成立影响很大;(2) **面向公网的边界薄弱**——生产站缺全部安全响应头、off-box 状态面板认证可"失败开放",这两类无需复杂前提即生效,应优先处理。

| 级别 | 数量 | 概述 |
|---|---|---|
| Critical | 0 | 无当前可被匿名直接利用的问题 |
| High | 7 | 安全头缺失、状态面板 fail-open/无限速、tar 无路径校验、rehype-raw 无消毒、短代码 href、SSH 主机密钥 |
| Medium | 14 | 未授权触发重建、评论旁路、SSRF、第三方脚本无 SRI、非原子交换、IP/PII 硬编码、容器/服务加固 |
| Low / Info | 12 | dotfile 保护、token 明文、日志脱敏、会话细节、日期显示、SEO、镜像 pin、密钥轮换 |
| 单元测试 | 122 / 123 | 唯一失败为缺构建产物的环境依赖,非逻辑缺陷 |

完整发现见 [`security-findings.md`](./security-findings.md);前端视觉走查与美化建议见 [`visual-review.md`](./visual-review.md)。

---

## 优先级路线

**P0 · 立即(低成本、护全体访客 / 堵唯一公网鉴权面)**
1. 生产 www 补齐安全响应头:HSTS(preload)、最小化 CSP、`X-Frame-Options`/`frame-ancestors`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`。见 High-1。
2. off-box 状态面板改 **fail-closed**(密码未配置一律 401/503),`/login` 加速率限制 + 失败退避。见 High-2、High-3。

**P1 · 近期(堵住高影响纵深缺口)**
3. `blog-rebuild-1panel.sh` 主发布路径解包前补 tar 路径穿越校验(对照 `enable-production-comments-1panel.sh:142` 已有实现)。见 High-4。
4. Markdown 管线对 CMS HTML 走 allowlist 消毒(rehype-sanitize),`:::cloud` 短代码 `href` 仅允许 `https?:`。见 High-5、High-6。
5. Python 运维脚本去掉硬编码生产 IP/root,改 `RejectPolicy` + `known_hosts`。见 High-7。

**P2 · 有空(加固与卫生)**
6. 容器 `cap_drop:[ALL]` + `read_only` + 资源上限;状态面板 systemd 换非特权用户 + 沙箱项。
7. `example`/脚本/夹具中的真实 IP、root、邮箱改占位符或合成数据。
8. 补密钥轮换脚本与文档;镜像 pin 加 `@sha256:` 格式的启动/CI 断言。

---

## 信任链

```
管理员 → Typecho 后台(登录态 + CSRF)
       → AutoRebuild/Action.php(校验管理员 + POST + Security::protect)
       → HMAC 签名 → rebuild-api(容器,仅验签落队列,不持 Docker socket)
       → systemd path 触发 blog-rebuild-1panel.sh(root)
       → SSH/rsync 到 off-box builder 执行 Astro+Playwright 构建
       → 回传 release.tar.gz → VPS 解包 → checksums 校验 → mv -T 原子切 current(蓝绿)
       → 阿里云 + Cloudflare 精确 URL 刷新 + 百度增量推送

独立第二链:公网 build.fei.cx(Caddy TLS) → 环回 :8787 状态面板(单一共享密码 + cookie 会话)
```

**最薄弱环节**:公网状态面板的认证边界。它是唯一直接暴露公网、且保护着可能含密构建日志的鉴权面,却同时有 fail-open、无登录限速、会话不可服务端吊销三重弱点。相比之下 rebuild-api 的 HMAC+nonce 与 Action.php 的多层校验反而更稳健。

---

## 测试与门禁

- `node --test`:**122 / 123 通过**。唯一失败 `scripts/test-aa13-aa14-mutations.js` 在变异 `stage4-gate.js` 时缺少 `astro/.cache/manifest.json`(需先构建),属**环境依赖而非逻辑缺陷**。
- 评论迁移 / CDN / 301 比较 / 清理 / 只读守卫等纯函数测试均有实质断言,不是"全 mock 假绿"。
- 主要假绿风险在少数 shell / 宿主路径的字符串断言测试,以及 `stage8-gate.js` 人工评审仅告警不阻断(见 Medium-12)。

---

## 亮点

1. **rebuild-api 认证扎实**:HMAC-SHA256 + `timingSafeEqual` + 时间戳 skew(±300s) + nonce 持久化重放防护(TTL) + body 上限,`/status` 亦签名;`test.js` 覆盖 40 并发去重与日志脱敏。
2. **一次性高危事务脚本工程质量高**:分阶段状态标志 + 完整 `restore` 回滚 + 探测校验(origin `/__release`、legacy 301、admin 404、comment 200)+ tar 路径穿越校验。
3. **SSH 加固 + 凭据隔离**:`StrictHostKeyChecking`/`IdentitiesOnly`/`BatchMode`/`ProxyJump` + `umask 077`;构建显式 `unset DB_*`、rsync 排除 `secrets`/`.env`。
4. **不可变发布**:`checksums.sha256` 全量校验 + `mv -T` 原子软链 + 蓝绿 current/previous + rollback/roll-forward 从 manifest 同步。
5. **评论纵深**:生产 `productionWriteEnabled=false` + IntersectionObserver 懒加载 + 只读消毒 allowlist + `xssSelfCheck`。
6. **前端基线成熟**:主题 FOUC 内联先行、View Transitions + `prefers-reduced-motion` 兜底、canonical/OG/JSON-LD/RSS/sitemap 齐备、Pagefind/Waline/KaTeX 全部按需加载。

---

## 方法与来源

本报告由 4 个并行只读子代理的深审汇总,并经人工回读源码复核:

| 子代理 | 范围 |
|---|---|
| Astro 前端审计 | `astro/` 组件、布局、插件、样式、SEO、可访问性 |
| 构建管线脚本审计 | `scripts/` 同步、门禁、迁移、测试 |
| 部署与基础设施审计 | `host/` · `docker/` · `nginx/` · `compose.*` |
| 新增敏感代码安全审计 | 未提交的 `offbox-status-ui`、`AutoRebuild`、`rebuild-api` 改动 |

**可信度声明**:全部 7 条 High 已由人工逐条回读源码复核确认;严重度按"当前可利用性与影响面"独立定级,未盲从子代理原始定级(例如 `sync-typecho.js` 内容目录非原子从 High 下调为 Medium,并标注影响域仅限 off-box 构建区)。Medium / Low 的行号以子代理报告为准,可能因后续未提交改动而有偏移。

> 同一份内容另有交互式 Canvas 版本(文件路径可点击直达、发现可跳转来源):`~/.cursor/projects/c-Users-AndyYan-Desktop-cursor-andy-blog/canvases/andy-blog-audit.canvas.tsx`
