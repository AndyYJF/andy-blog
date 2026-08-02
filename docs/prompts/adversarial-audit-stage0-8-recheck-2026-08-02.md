# Stage 0–8 修复复查报告（2026-08-02）

复查基线：

- 原始报告：`adversarial-audit-stage0-8-result-2026-08-02.md`
- 整改记录：`adversarial-remediation-2026-08-02.md`
- 本轮范围：当前本地仓库、隔离构建、门禁和针对性攻击用例
- 本轮未做：生产环境写入、真实 Docker/Typecho 登录上传纵向、真实 CDN API 调用

## 1. 结论

**Verdict：NOT_READY（仍不建议进入 Stage 9 / 正式切流）**

10 项原始 Finding 的当前状态：

| 状态 | 数量 | ID |
|---|---:|---|
| FIXED | 4 | AA-01、AA-03、AA-04、AA-07 |
| PARTIALLY_FIXED | 4 | AA-02、AA-06、AA-08、AA-10 |
| NOT_FIXED | 2 | AA-05、AA-09 |
| UNVERIFIED | 0 | — |

主要进展是：legacy 自跳转已清零、Waline 写入路径已 fail-closed、rebuild-api 的 40 nonce 并发/重放缺陷已复现为通过、CDN stub 不再伪造成功。

仍然阻断 READY 的事实是：仓库没有任何 commit、完整 CMS 纵向未完成、Stage 8 人工 Final 只有 1/15、Stage 0 恢复与 CDN 一致性证据仍缺失，以及 Baidu 增量推送会生成双斜杠 URL。现有 gate 仍能在该 Baidu 缺陷存在时全部通过，行为覆盖尚不足。

## 2. 逐项复查

### AA-01 — FIXED

原问题：9 条 exact legacy path 302 到自身 canonical。

当前证据：

- `build-legacy-url-map.js` 在 `oldPath === targetPath` 时跳过。
- `generate-nginx.js` 明确拒绝 self redirect。
- `stage4-gate.js` 同时检查 map 和 Nginx 产物。
- 本轮重新生成 140 条 legacy 项：110 path + 30 query。
- 完整构建中的 Stage4 gate PASS，未发现 self redirect；原来的 9 条自跳转已消失。

### AA-02 — PARTIALLY_FIXED

原问题：自动 `--apply-pass` 伪装成 15 份人工复核，且记录无内容哈希。

当前证据：

- 自动流程现在写 `verdict=audit-clean`、`reviewer=stage8-audit-auto`，不再伪造人工 `pass`。
- 15 份 review 都有 source/dist SHA-256；gate 还会校验 source hash drift。
- 当前记录为：人工 `pass` 1/15（CID 5），自动 `audit-clean` 14/15。
- 完整构建的 Stage8 gate 虽返回自动门禁 PASS，但明确警告：`Stage 8 Final incomplete: human pass 1/15`。

判定理由：真实性机制已修，人工 Final 尚未完成，不能把自动 PASS 当 Stage 8 Final。

### AA-03 — FIXED

原问题：只有 exact `/api/comment` 进入策略，尾斜杠和 reply 可绕过并命中上游。

当前证据：

- `/api/comment` 和 `/api/comment/*` 均进入 comment policy。
- 其它 `/api/*` 写入返回 403；缺 policy 返回 503。
- 现有 helper 单元测试 19/19 通过。
- 本轮启动真实 wrapper 和假上游，9 个 HTTP 用例全部符合预期：
  - exact comment、reply、query key 合法时才命中上游；
  - 尾斜杠缺 key、未知 key、`/api/user`、`/api/commentary` 均为 403 且上游 hit 增量为 0；
  - policy 文件不可用时为 503 且上游 hit 增量为 0。

### AA-04 — FIXED

原问题：nonce/flag 临时文件并发竞争导致 40 请求仅 3 成功、37 个 ENOENT，且重放可通过。

当前证据：

- nonce/flag mutation 使用进程内写锁串行化。
- 临时文件名加入随机值，不再只按 PID 冲突。
- 本轮 40 个不同 nonce 并发全部成功，无 ENOENT；随后重放第一个 nonce 被拒绝。
- 签名错误、时钟偏差、dirty 状态等现有测试也通过。

保留项：当前只验证单进程模型；没有故障注入式的进程崩溃恢复测试。该缺口纳入 AA-10 的验证债务，不影响对原并发竞态的 FIXED 判定。

### AA-05 — NOT_FIXED

原问题：仓库无提交、所有文件均未跟踪，关键地图和基线并非真正版本控制。

当前证据：

- `git status` 仍显示 `No commits yet on master`。
- 项目文件仍全部为 `??` untracked。
- `git log` 仍因当前分支没有提交而失败。

判定理由：整改记录也明确写了“未代提交”。首个安全 baseline commit 尚未完成。

### AA-06 — PARTIALLY_FIXED

原问题：Compose/Typecho/Nginx 无法组成完整 CMS 纵向。

当前证据：

- 已修部分：Nginx PHP upstream 从 `127.0.0.1:9000` 改为 Compose service `typecho:9000`。
- 未修部分：项目 `typecho/` 只有 2 个文件（配置样例、AutoRebuild 插件）。
- `docker/typecho/Dockerfile` 只安装扩展并设置 WORKDIR，没有复制 Typecho 程序。
- Compose 仍把不完整的 `./typecho` 挂载为整个 `/var/www/typecho`。
- README 已诚实标注完整 CMS 登录/上传纵向未证明。

判定理由：service-name 错误已修，但完整 CMS 能力仍未建立或验证。

### AA-07 — FIXED

原问题：CDN purge placeholder 生成 stub requestId 并把状态写成 `ok`。

当前证据：

- 当前代码不再写 fake `ok` 或 `stub-*` requestId。
- 对 Aliyun、Cloudflare 分别注入模拟凭据：两者均写 `status=not-implemented` 并退出 71。
- 生成的 job 文件均不含成功状态。

判定说明：原 Finding 的“虚假成功”已修复；真实双 CDN purge 能力仍未实现，属于已公开的 Stage5 功能缺口，不能据此宣称 CDN 已完成。

### AA-08 — PARTIALLY_FIXED

原问题：`last-success-release` 先被覆盖，Baidu 脚本再读取，导致 release 与自身比较。

当前证据：

- 已修部分：`blog-rebuild.sh` 先读取 `PREV_SUCCESS`，再覆盖当前 success，并把 previous id 作为 `$2` 传给 `baidu-push.sh`。
- 新发现：`baidu-push.sh` 的路径替换会多插入一个 `/`。
- 行为用例 old=`kept`、new=`kept+added`，预期唯一新增 URL 为：

  `https://www.andy-y.cn/posts/added/`

  实际写入：

  `https://www.andy-y.cn//posts/added/`

判定理由：previous-release 顺序已修，但提交 URL 非规范，Baidu 增量推送仍不应视为完成。

### AA-09 — NOT_FIXED

原问题：Stage0 缺恢复演练、完整纵向链路和双 CDN 同 fixture body hash 证据。

当前证据：

- `stage0-gates.md` 仍只有导出集合、数据库/主题、格式、评论、RSS 和 backup manifest 描述。
- 没有新的 restore drill 结果。
- 没有 Typecho 登录/写作/上传/触发构建/静态产物完整纵向证据。
- 没有大陆 CDN 与 Cloudflare 对同 fixture 的 body hash 对比结果。

判定说明：文档已诚实承认缺口，但“承认未验证”不等于完成验证。

### AA-10 — PARTIALLY_FIXED

原问题：多个 gate 只检查文件存在或源码字符串，未验证计划要求的行为。

当前证据：

- 已改善：Stage5 gate 会运行 rebuild-api 测试和 patch dry-run；Stage8 区分 auto/human；Stage7 会运行 `migrate-comments --twice` 并检查第二次零变化。
- 仍不足：Stage1 没有 slug 变更、删除/tombstone 等 mutation 用例。
- Stage5 对 CDN、Baidu 和部分 Compose 约束仍主要做字符串检查。
- 本轮 Stage5 gate PASS，但独立行为测试仍发现 AA-08 的双斜杠 URL；这是现有 gate 假阴性的直接证据。
- 没有完整发布切换/回滚、CMS 纵向或进程 crash 故障注入测试。

## 3. 本轮验证结果

所有会写产物的命令均在项目隔离副本执行，原仓库只新增本复查报告。

| 验证 | 结果 |
|---|---|
| Waline helper unit | PASS，19 项 |
| Waline wrapper + fake upstream | PASS，9 项路径/策略攻击用例 |
| rebuild-api | PASS，40 并发全部成功，重放拒绝，无 ENOENT |
| legacy map / Nginx 302 | PASS，140 项，0 self redirect |
| 完整 `npm run build` | PASS，8.9s |
| Astro / Pagefind | 32 个静态页面 / 15 个索引页 |
| Stage4/6/7/8 | PASS；Stage8 同时警告 human 1/15 |
| Stage1 gate | PASS；但没有 mutation 场景覆盖 |
| Stage5 gate | 补齐其所需 Typecho 缓存源树后 PASS |
| Aliyun/Cloudflare stub 行为 | PASS：not-implemented + exit 71，无假成功 |
| Baidu previous-release diff | FAIL：新增项识别正确，但 URL 产生 `//posts/` |

说明：Stage5 首次在隔离副本失败，是因为初次复制排除了 `.cache/typecho-src` 和 `.cache/typecho-patch-work/apply-check`。把原仓库现有的只读 Typecho 1.2.1 源树/patch-work 补入副本后 gate 通过，单独 `git apply --check` 也返回 0；该次失败不计为产品缺陷。

## 4. 当前阻断清单（按优先顺序）

1. 修复 `baidu-push.sh` 的双斜杠 URL，并给 Stage5 增加真实 old/new release 行为测试。
2. 完成 14 个剩余 CID 的人工复核；保留 reviewer、时间、source/dist hash。
3. 完成本地秘密/ignore 最终确认，创建首个 baseline commit。
4. 补齐完整 Typecho 程序/挂载并完成 CMS 登录、编辑、上传、触发构建纵向验证；或继续明确降级为 scaffold，而非 Stage5 Final。
5. 完成 Stage0 restore drill、完整纵向证据和双 CDN 同 fixture body hash 证据。
6. 给 Stage1 增加 slug-change/delete-tombstone mutation，用行为断言补齐 Stage5 发布/回滚与 crash 场景。
7. 真实接入 Aliyun/Cloudflare purge API 后再宣称 edge 能力完成。

在以上第 1～5 项完成前，建议维持 `NOT_READY`。
