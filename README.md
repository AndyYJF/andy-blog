# andy-blog

[www.andy-y.cn](https://www.andy-y.cn) — Typecho 1.2.1 无头 CMS → **Astro 7 全静态站**。

编辑在 Typecho，访客读 Astro；构建在 off-box，发布走蓝绿不可变 release。评论走 Waline（经 www 反代）。

## 架构

```
Typecho 后台 ──HMAC──► rebuild-api ──► blog-rebuild-1panel.sh
                                            │
                     off-box builder (Astro + Playwright / mermaid)
                                            │
                     release.tar.gz + checksums ──► VPS releases/
                                            │
                     mv -T 原子切 current ←→ previous（可回滚）
                                            │
                     OpenResty www + 阿里云 / Cloudflare CDN 刷新
```

独立状态面：`build.fei.cx` → Caddy → 环回 off-box status UI（密码会话，fail-closed）。

## 目录

| 路径 | 用途 |
|------|------|
| `astro/` | 站点源码（内容、组件、样式、构建） |
| `typecho/` | CMS 插件 / 配置脚手架（AutoRebuild、AstroPreview） |
| `scripts/` | 同步、门禁、nginx 生成、评论迁移、CDN |
| `host/` | VPS / off-box 发布脚本、systemd、status UI |
| `docker/` | rebuild-api、Waline |
| `nginx/` | 生成产物 `release-http.conf`（勿手改，用 `generate-nginx.js`） |
| `data/` | 路由图、legacy URL map、lastmod |
| `docs/` | 分期基线、计划、授权 runbook |
| `audit/` | 2026-08-26 安全 / 前端审计报告 |

## 本地开发

需要 **Node ≥ 22.12**。Mermaid 构建依赖 Playwright Chromium：

```powershell
npm install
npm --prefix astro install

# Playwright 浏览器路径（未设置时 mermaid 可能静默丢正文）
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"

# 仅前端迭代
npm --prefix astro run dev

# 全量：同步 Typecho 快照 → 门禁 → Astro build → Pagefind(zh)
$env:SNAPSHOT_EPOCH = "1785565762"   # 或当前快照 epoch
npm run build
npm --prefix astro run preview -- --host 127.0.0.1 --port 4321
```

常用检查：

```powershell
node --test host/offbox-status-ui/server.test.js
npm run stage10:gate
npm run lighthouse:local    # 对 astro/dist
```

## 内容与前端要点

- Markdown / HTML 经 `rehype-raw` → **`rehype-sanitize`**；`:::cloud` 仅 `http(s)` 或同源路径
- 正文 `#` 标题构建期降为 `h2`（目录 / 阅读进度依赖 `h2`）
- Mermaid：构建期 BEOE 双主题 SVG，访客可点 lightbox
- 搜索：Pagefind，`--force-language zh`
- 主题：亮 / 暗 + View Transitions；`prefers-reduced-motion` 全局降级
- 按需加载：KaTeX / Pagefind UI / Waline

## 发布与运维

- 触发：Typecho AutoRebuild（管理员 + CSRF）→ 签名 → rebuild-api 入队
- 构建：off-box 拉快照、Astro build、回传 tar；解包前校验路径穿越与特殊文件
- 切换：`checksums.sha256` 全量校验 → `current` / `previous` 蓝绿
- 回滚 / 前进：`host/rollback-release.sh` · `host/roll-forward-release.sh`
- Nginx 重定向状态：`npm run nginx:302` / `nginx:301`（改 `data/legacy-url-map.json` 后再生）

生产凭据只放主机 env / secret 文件，**不要**写入本仓库。SSH 脚本需 `SSH_HOST` / `SSH_USER` / `SSH_PASS`，主机密钥走 `RejectPolicy` + known_hosts。

## 安全

2026-08-26 审计见 [`audit/2026-08-26/`](./audit/2026-08-26/)（前端复审 [`audit/2026-08-26-2/`](./audit/2026-08-26-2/)）。已落地包括：

- www HSTS / CSP / nosniff / frame deny 等响应头
- status UI fail-closed + 登录限速
- tar 路径校验、Markdown 消毒、短代码协议限制、SSH 去硬编码默认

剩余 Medium / Low 与革新项仍以审计报告为准。

## 规则

- 生产 SSH / MySQL：默认可读；写操作须单独授权与 runbook
- 不提交 `secrets/`、`backups/`、`.env`、私钥
- 本地规划包在 `.planning/`（已 gitignore）
