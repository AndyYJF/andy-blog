# Progress — Stage 10

- 2026-08-05：启动 Stage 10；按 plan §8.5 先做 in-repo 脚手架，不擅自切 www DNS。
- 2026-08-05：落地 rollback / roll-forward / transition / www adapters / stage10 gate；`npm run stage10:gate` PASS。
- 2026-08-05：commit `3a6aa39`。
- 2026-08-05：**生产 www 首次切流完成**（302 + commentWriteMode=disabled）：
  - release `20260805T143100Z-c92e7d31` → `/opt/1panel/www/sites/www.andy-y.cn/deploy/current`
  - OpenResty vhost 备份：`www.andy-y.cn.conf.bak-20260805T153148Z`
  - 生产 Waline `127.0.0.1:8360` healthy；POST `/api/comment` → 403 `writeEnabled=false`
  - 源站核验：`/__release` 匹配；`/admin/` 404；`/archives/47/` → 302 → `/posts/typecho-joe-mermaid/`
  - Typecho 仍在 `127.0.0.1:8080`（写作入口暂未迁 cms）
- 2026-08-05：未做：评论迁移启用、301、真实 CDN purge、密码轮换提醒。
- 2026-08-09：首次提交 planning 笔记时发现仓库未配置 Git 作者身份；未产生提交，待按既有历史作者设置仓库级 identity 后重试。
