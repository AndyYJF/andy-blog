# Stage 9 staging 部署报告

日期：2026-08-05  
目标：`https://new.andy-y.cn`  
最终 release：`20260805T143100Z-c92e7d31`

## 结论

Stage 9 staging 部署与运行验收已完成。`new.andy-y.cn` 已运行最终候选版本；`www.andy-y.cn` 未切流量，生产 Typecho、生产 vhost 与生产评论策略未改动。

## 回退与根因

本次看到的“导航与右侧横线回到旧版”不是浏览器缓存。部署的 `488f32c` 本身就是较早快照：仍连接非 DN42 页面装饰，横线悬停只改变颜色，没有实现贴近放大。线上资产哈希与该源码一致；Git、stash、reflog 和 Cursor 历史中没有可直接恢复的后续版本。

已按最终要求重建：

- 首页、归档、关于、友链不再挂载页面 SVG；仅 `/dn42/` 保留装饰。
- 顶部导航加入当前页状态。
- 左侧文章目录加入标题、层级、当前章节样式与稳定滚动同步。
- 右侧横线按指针纵向距离渐进放大，默认 18px、当前章节 34px、最近指针最大 54px。
- 修复平滑滚动时 IntersectionObserver 可能漏更新的问题；URL、目录和右侧当前项保持一致。

## 验证结果

- `npm --prefix astro run build`：通过，32 个静态页面生成，Pagefind 索引 15 页。
- Stage 9 gate：通过；本机无 Docker 的 Compose 检查由 VPS 实测补齐。
- 浏览器桌面 1440×900：无横向溢出；目录、导引、DN42 装饰位置正常。
- 浏览器手机 390×844：首页/关于无横向溢出，文章目录与右侧导引收敛隐藏。
- 深色与浅色：均通过；非 DN42 页面装饰数量为 0，DN42 为 1。
- 横线距离放大实测：约 `36/31/41/50/54/50/41/31/22px`；移开后恢复为默认宽度。
- 章节点击：URL hash、左侧当前目录、右侧当前线一致。
- Lighthouse staging：首页和文章页的性能、无障碍、最佳实践均为 1.00。
- Lighthouse SEO：0.66/0.69；staging 强制 `noindex, nofollow, noarchive`，因此不作为 staging SEO 门禁。

## 服务与隔离

- `new` 首页、验收文章、`www` 首页均返回 200。
- Waline 容器：`db1069f7…48945`，状态 healthy，仍仅绑定 `127.0.0.1:8361`。
- Waline API：200；未写入伪造评论。
- 隔离数据库：`waline_staging`；表为 `wl_Comment`、`wl_Counter`、`wl_Users`。
- Typecho 容器未重启，ID 与启动时间不变。
- `www.andy-y.cn.conf` SHA-256 保持 `d981ee…b114c`；`new` vhost 在静态 release 切换中未改写。
- OpenResty 配置测试通过。
- 一次性 SSH 公钥已从服务器移除，随后用该私钥认证被拒绝；本地私钥目录已删除。

## 回滚

服务器保留以下 release：

- 当前：`20260805T143100Z-c92e7d31`
- 第一回滚点：`20260805T142400Z-b6e2a1fc`
- 初始 staging：`20260805T131152Z-51d0a116`

静态切换使用原子 symlink 替换。若需回滚，应将 `deploy/candidate` 原子指回第一回滚点，再复核 `/__release`、主页、文章、noindex 与 Waline API。

## 未完成与注意事项

- 尚未切换 `www.andy-y.cn`，因此这不是生产发布完成报告。
- 用户已明确跳过剩余 14 项人工 Final；记录为 waiver，不等同于 15/15 人工验收通过。
- 仓库改动尚未提交，包含前端导航修复和 1Panel/Waline staging 适配；发布前应审阅并形成明确提交。
- TLS 证书当前有效至 2026-09-27；根盘约 78% 已用、可用约 8.3 GiB，生产切换前应复核续签与容量。
