# i18n 撤回（下线一篇英文翻译）Runbook

适用场景：某篇已上线英文翻译质量不合格、原文被撤、或需要暂时下线英文版本。

## 标准操作（面板，约 2 分钟）

1. Typecho 后台 → 「I18n」面板 → 找到对应条目 → 点「停用」。
2. 面板动作在一个事务里完成：
   - `translation_head.publication_state` 置为 `disabled`
   - 取消该 cid 所有 queued/leased/failed 翻译任务
   - 取消 pending/accepted/needs_fix 的 publish outbox 事件
3. 下一次 rebuild 自动生效（已 approved 的 outbox 被取消后不会触发构建；
   若需立即下线，手动触发一次重建：向 `runtime/build/pending` 写入一个事件）。

## 下线后各层行为

| 层 | 行为 |
|---|---|
| 同步 | 选择协议将该 cid 标为 `disabled`，不生成 en md |
| 构建 | dist 每次构建前清空，旧 `/en/<slug>/` 页面不再产出 |
| 渲染门禁 | 只校验 renderExpected 条目，disabled 不影响 |
| sitemap | 不再包含该 en URL |
| RSS | en feed 不再输出该条目（pubDate 不变的其他条目不受影响） |
| CDN | 刷新计划会并集**上一个 live 站点**的 /en/ 页面路径，被撤页面仍在计划内，缓存被刷新 |
| 源站 SEO | zh 对应页面 head 不再输出指向该 en 页的 hreflang（配对消失） |

## 注意事项

- 搜索引擎已收录的 en URL 会变为 404，属预期；不要保留「假页面」占位。
- 「停用」不影响 zh 原文，也不删除已批准的翻译版本（`translation_version`
  是不可变历史）；重新启用后面板批准即刻恢复发布。
- 批量撤回：逐条面板操作即可，不要直接 UPDATE 数据库跳过事务逻辑。
- 紧急情况下（站点异常）可先回滚 release（`host/rollback-release.sh`），
  再走正常停用流程。

## 相关文件

- 面板/动作：`typecho/usr/plugins/I18n/panel.php`、`Action.php`
- 选择协议：`scripts/lib/i18n-select.js`
- CDN 计划：`scripts/generate-cdn-purge-plan.js`（`collectEnPaths` 含上一 live 站点并集）
