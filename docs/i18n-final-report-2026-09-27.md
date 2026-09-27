# i18n 双语项目最终报告（2026-09-27）

计划文档：`docs/i18n-plan-v2-2026-09-26.md`。本报告记录 P0–P5 全部收尾后的实际状态、验收结果与遗留事项。

## 一、最终结果

**www.andy-y.cn 已完整双语化**：英文站作为独立内容集上线，中文站零回归。从 2026-09-26 19:00 到 2026-09-27 16:45 共约 22 小时（含人工审批与 CDN 配额等待），覆盖计划中的全部 6 个阶段。

### 内容规模

- 22 篇中文公开文章中，**17 篇 post + 2 篇 page 有已批准英文译文**（renderExpected），6 篇 moments 按设计不翻译，2 个硬编码页面（About/Friends）以静态英文页替代
- 英文内容全部经 Kimi 中转（gemini-3.8-flash-high）初译，人工或子代理兜底，逐篇人工批准后上线

### 英文站功能清单

- 独立路由树：`/en/`（首页）、`/en/posts/`（含分类）、`/en/category/<slug>/`、`/en/archive/`、`/en/friends/`、`/en/about/`、`/en/listening/`、`/en/dn42/`、`/en/posts/<slug>/`
- 英文 UI 词典（`src/i18n/ui.ts`）：导航、页脚、分页、评论、阅读时长、分类名英文化
- 双语搜索：pagefind 双索引（zh 排除 /en/，en 用 `--force-language en` 独立索引至 `/en/pagefind/`）
- 语言切换器（地球图标，精准互跳对应页）+ 内容淡入淡出过渡动画
- 英文 RSS（`/en/rss.xml`，10 条，guid=zh#en，pubDate=批准时间）与 `/en/llms.txt`
- SEO：hreflang zh-CN/en/x-default 互指、sitemap 含 /en/ 且 lastmod=译文批准时间
- CDN：purge 计划覆盖 /en/ 全部路由（含上一 live 站点的已撤回路径），预热封顶 30 个关键 URL

## 二、各阶段交付与验证证据

| 阶段 | 交付 | 验证 |
| --- | --- | --- |
| P0 存储核验 | Typecho 1.2.1 保存路径无核心事务、插件可在 write/finishPublish 包裹事务；生产环境 5 项只读核验全过（`docs/i18n-p0-findings-2026-09-26.md`） | 生产主机只读检查，文件哈希与上游 tag 一致 |
| P1 翻译管道 | 6 张 i18n 表 + Typecho I18n 插件 + Kimi worker + 审批面板 + outbox | 7/7 对抗性测试（租约窃取、崩溃补偿、幂等重放等），生产冒烟通过 |
| P2 集成构建 | 英文内容集、localizedEntries 清单、共享 markdown 管道、单条隔离重试 | 故障注入演练：坏英文页隔离/中文正常发/共享布局错全站失败 |
| P3 英文 UI | 全部英文页面与组件，UI 词典 | 本地构建 + render-gate（27 zh + 19 en）全绿 |
| P4 订阅发布 | en RSS/llms、hreflang、发布回执、CDN、撤回 runbook | release 20260927T024805Z 上线，19 条 outbox 回填 live |
| P5 验收 | en 分类条+页、双语搜索、动画、大量边角修复 | 见下节 |

### P5 期间修复的实际缺陷（全部生产验证）

1. en 导航缺在听页、DN42 链接错指中文页
2. 首页 DN42 拓扑卡片缺英文版、快捷卡片高度不齐
3. 搜索仅中文（pagefind 双索引方案）
4. 签名悬停预览泄漏 JS 源码（textContent 含 inline script 的经典坑）
5. About 页 GitHub/Telegram 卡片在 i18n 重写时丢失（从 git 历史恢复）
6. 页脚 RSS 链接、运行时长单位、分类条英文化
7. 语言切换动画从全屏擦除改为内容交叉淡入淡出
8. 在听页评论区（Typecho allowComment=0 → 1，中英共享评论串）
9. CDN 预热计划 80 URL 超每日配额导致提交失败 → 封顶 30（commit 9d1227e）

## 三、翻译工作流（现状）

```
作者发中文文 → I18n 插件事务内记 source_state + 建 job
  → i18n-worker 领取（SKIP LOCKED 租约）→ Kimi 中转翻译 → CAS 写回草稿
  → 人工在 /action/i18n 面板批准（唯一 approved 指针写入点）
  → outbox 事件 → rebuild-api 去重 → 主机重建 → 切换
  → observe-live 回填 outbox=live + ledger.first_published_at
```

关键不变量：只有 head 批准版本进构建；源文修改后译文自动 outdated 并显示提示；撤回单事务完成（runbook：`docs/i18n-withdrawal-runbook.md`）。

## 四、遗留事项与已知边界

1. **cid 30**（Grafana 101KB 长文）译文由子代理分块完成（versionId 26），未经通读校对；另有「#Introduction#」类模型格式瑕疵散见
2. **聚合阶段故障仍不可归因**：RSS/sitemap/language-map 级构建错误会整站失败（计划内已知边界）
3. **CDN 每日刷新/预热配额有限**：大批量内容变更时 purge 可能需次日重试（systemd 自动重试）
4. en 页 `pubDate`=批准时间（批量批准时 RSS pubDate 集中，属预期）；展示排序用 `sourcePublishedAt`
5. Typecho 插件代码禁用 `Db::query` 结果当数组（Pdo 适配器返回 PDOStatement），已出现两次同类 bug，新增插件代码需遵守 fetch 模式
6. builder 镜像为热补丁方式更新（commit 镜像），下次正规 `docker compose build` 会覆盖——届时需重新执行热补丁或等待阿里云网络可用
7. 英文站暂无 moments/linuxdo 页（计划内排除）

## 五、运维速查

| 操作 | 入口 |
| --- | --- |
| 审批译文 | Typecho 后台 → 控制台 → I18n |
| 撤回英文页 | 同上，禁用对应条目（`docs/i18n-withdrawal-runbook.md`） |
| 翻译 worker 日志 | `docker logs i18n-worker` |
| 重建日志 | `/var/www/andy-blog/runtime/build/progress.log` |
| 发布回执状态 | `SELECT * FROM typecho_i18n_publish_outbox` |
| 手动触发重建 | 写文件到 `runtime/build/pending` |
