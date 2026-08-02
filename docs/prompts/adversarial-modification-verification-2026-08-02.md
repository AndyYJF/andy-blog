# 最新修改对抗复查报告（2026-08-02）

复查对象：`adversarial-modification-report-2026-08-02.md`

候选基线：

- 分支：`cursor/stage0-8-adversarial-baseline`
- Commit：`31d66253bd5293a264618a01eae1d5f10e2eebb8`
- 作者：AndyYJF `<3363230241@qq.com>`
- 验证方式：只读原仓库；所有生成、构建、mutation 与假上游测试均在隔离 clone 运行
- 未执行：生产写入、真实 CDN purge、完整 Typecho 登录/上传/发布纵向

## 1. Verdict

**NOT_READY**

本轮确认 AA-05 baseline commit 和 AA-08 Baidu 双斜杠修复真实成立，但发现两个 P1 级假阳性：

1. 当前 Nginx `map` 仍会使 3 个 canonical 分类 URL 302 到自身，AA-01 必须打回。
2. Stage8 gate 把 14 个 `agent-spot-verify` 自动抽查计为人工 pass，输出 `humanPass=15` 且无 warning，AA-02 出现语义回归。

逐项结果：

| 状态 | 数量 | ID |
|---|---:|---|
| FIXED | 5 | AA-03、AA-04、AA-05、AA-07、AA-08 |
| PARTIALLY_FIXED | 2 | AA-06、AA-10 |
| NOT_FIXED | 1 | AA-09 |
| REGRESSION / 打回 | 2 | AA-01、AA-02 |

因此不能升级为 `READY_FOR_STAGE_9` 或 `READY_WITH_KNOWN_DEBT`。

## 2. 逐条 AA 状态

| ID | 修改报告声称 | 本轮判定 | 相对报告 | 核心证据 |
|---|---|---|---|---|
| AA-01 | 保持 FIXED | **REGRESSION / 打回** | 不确认 | 生成配置仍有 3 条大小写-only redirect；Nginx map 普通字符串忽略大小写，canonical 小写 URL 会命中并返回自身；Stage4 仍假 PASS |
| AA-02 | IMPROVED，请重判 | **REGRESSION** | 部分内容检查改善，但 Final 语义倒退 | 14 条 `agent-spot-verify` + 1 条 `manual+live-verify`；gate 却输出 human 15/15、warnings=[] |
| AA-03 | 保持 FIXED | **FIXED** | 确认 | helper 19 项 PASS；wrapper+假上游 6 场景 PASS，缺 policy→503，阻断请求不达上游 |
| AA-04 | 保持 FIXED | **FIXED** | 确认 | 40 nonce 全成功，无 ENOENT；重放拒绝 |
| AA-05 | FIXED | **FIXED** | 确认 | baseline commit、作者、240 files、route-map/legacy map 均确认；禁止路径未 tracked；常见秘密签名无命中 |
| AA-06 | 仍 PARTIAL/降级 | **PARTIALLY_FIXED** | 确认已知债 | Nginx upstream 已修；`typecho/` 仍只有 2 个 scaffold 文件，无完整 CMS 纵向 |
| AA-07 | 保持 FIXED | **FIXED** | 确认 | Aliyun/Cloudflare 假凭据均写 `not-implemented`、exit 71；无 `ok`/`stub-*` |
| AA-08 | FIXED | **FIXED** | 确认 | old=kept/new=kept+added 只输出规范 URL；故意注入 `//posts/` 后 Stage5 正确 FAIL |
| AA-09 | 仍 NOT_FIXED | **NOT_FIXED** | 确认已知债 | 仍无 restore drill、完整纵向、双 CDN 同 fixture body hash 仓库证据 |
| AA-10 | IMPROVED | **PARTIALLY_FIXED** | 确认部分改善 | Baidu mutation 已进 Stage5；但 Stage4/Stage8 仍有本轮两个假阳性，Stage1 mutation 仍缺 |

## 3. 必测项结果

### 3.1 Baidu URL — PASS

正向 fixture：

- old：`posts/kept/`
- new：`posts/kept/` + `posts/added/`
- 实际唯一输出：`https://www.andy-y.cn/posts/added/`
- 不含 `andy-y.cn//posts/`

负向 mutation：把隔离副本输出故意改成 `https://www.andy-y.cn//...`，Stage5 gate 返回 1：

`baidu-push refused unexpected URL: https://www.andy-y.cn//posts/added/`

恢复后 Stage5 再次 PASS。AA-08 及这部分 AA-10 修改有效。

### 3.2 Git baseline — PASS

- 完整 commit：`31d66253bd5293a264618a01eae1d5f10e2eebb8`
- tracked files：240
- `data/route-map.json`、`data/legacy-url-map.json` 已入库
- tracked 路径中没有 backups、secrets、node_modules、dist、`.env`、`astro/public/beoe/`
- `.gitignore` 对上述样例均命中
- 常见 private key、AWS、OpenAI、Google、GitHub token 签名扫描无命中

当前原仓库仅有两个未跟踪报告文件：最新 modification report 与本复查报告；没有代码/config 未提交 diff。

### 3.3 Waline 路径 — PASS

现有 helper 19 项通过；另启动 wrapper 和假上游验证：

| 请求 | 结果 | 上游 hit 增量 |
|---|---:|---:|
| POST `/api/comment` + allow key | 200 | 1 |
| POST `/api/comment/` + missing key | 403 | 0 |
| POST `/api/comment/reply` + allow key | 200 | 1 |
| POST `/api/comment/reply` + unknown key | 403 | 0 |
| POST `/api/user` | 403 | 0 |
| POST `/api/comment` + policy missing | 503 | 0 |

### 3.4 rebuild-api 并发 — PASS

- 40 个不同 nonce 全部成功
- 无 ENOENT
- 重放第一个 nonce 被拒绝
- 签名、时钟偏差和 dirty 行为测试通过

### 3.5 self redirect — FAIL

重新生成 legacy map/Nginx 后仍有以下条目：

```text
"/category/AI/"   "/category/ai/";
"/category/DN42/" "/category/dn42/";
"/category/NAS/"  "/category/nas/";
```

Nginx 官方 `ngx_http_map_module` 文档明确规定普通字符串匹配忽略大小写：[Module ngx_http_map_module](https://nginx.org/en/docs/http/ngx_http_map_module.html)。因此请求：

- `/category/ai/`
- `/category/dn42/`
- `/category/nas/`

会分别匹配上述 uppercase key，得到与请求相同的 lowercase target；随后当前配置执行 legacy 302，形成 canonical self redirect。

当前三层防护都只做大小写敏感比较：

- `build-legacy-url-map.js`：`oldPath === targetPath`
- `generate-nginx.js`：`entry.oldPath === entry.targetPath`
- `stage4-gate.js`：`entry.oldPath !== entry.targetPath` / `from === to`

所以完整 build 中 Stage4 仍返回 PASS。这是门禁假阳性，不是可接受的大小写规范化。

## 4. 其它门禁结果

| 验证 | 结果 | 边界 |
|---|---|---|
| 完整 `npm run build` | PASS，13.67s | 不能覆盖 AA-01/AA-02 假阳性 |
| Astro | 32 个静态页面 | — |
| Pagefind | 15 个索引页 | — |
| Stage1 | PASS | 无 slug-change/delete-tombstone mutation |
| Stage4 | PASS，但结论错误 | 漏掉 Nginx case-insensitive self redirect |
| Stage5 | PASS | Baidu 正/负向行为覆盖有效；CMS/CDN Final 仍未完成 |
| spot verify | PASS，15/15 | 自动内容抽查，不是 10–20 分钟/篇人工复核 |
| Stage8 | PASS，但结论错误 | `humanPass=15` 实际人工 reviewer 仅 1 |

只读现网抽查：三个分类 canonical 当前均为 404，旧 `/index.php/5.html` 为 200，说明候选 baseline 尚未切到现网。现网旧状态不用于否定或证明本地候选 Nginx 配置。

## 5. 新 Finding

### AA-11 — P1 — Nginx case-insensitive map 导致 canonical 分类页重定向循环

**Evidence**

- 生成配置包含 3 条 case-only path redirect。
- Nginx 官方文档确认 map string 忽略大小写。
- canonical 小写请求会匹配 uppercase key 并返回自身。
- Stage4 gate 仍 PASS。

**Disposition**

删除这些 case-only redirect，或改用明确的大小写敏感匹配设计；生成器、Nginx gate 和数据 gate 都必须用与 Nginx 一致的 `OrdinalIgnoreCase` 冲突/自跳转判定。加入这 3 个 canonical URL 的负向矩阵。

### AA-12 — P1 — Stage8 将 agent spot-verify 误计为人工 Final

**Evidence**

- review 实际分布：14 `agent-spot-verify`、1 `manual+live-verify`。
- `spot-verify-reviews.js --write` 给自动检查写 `verdict=pass`。
- `stage8-gate.js` 只凭 `verdict === 'pass'` 增加 `humanPass`。
- 本轮输出：`humanPass=15`、`auditClean=0`、warnings=[]。

**Disposition**

自动 spot 必须使用独立 verdict/reviewer 分类；`humanPass` 只能计算明确的人工 reviewer。若团队决定正式降低 Stage8 验收标准，应修改计划和字段名称，不能继续把自动抽查称为 human Final。

## 6. Pre-Stage-9 checklist

- [x] Waline mutation paths fail-closed，缺 policy→503
- [x] rebuild-api 40 nonce 并发与 replay 测试通过
- [x] baseline commit 建立，route-map 等关键文件已入库
- [x] CDN stub 不再伪造成功
- [x] Baidu previous-release diff 与规范 URL 行为通过
- [x] Baidu 双斜杠 mutation 会使 Stage5 FAIL
- [ ] 清除 3 个 Nginx case-fold canonical self redirect
- [ ] Stage4 增加与 Nginx 一致的 case-insensitive 冲突/自跳转矩阵
- [ ] Stage8 不再把 `agent-spot-verify` 计为 human pass
- [ ] 完成剩余 14 篇人工复核，或由项目负责人明确批准并记录验收标准降级
- [ ] 完整 Typecho 程序与 CMS 登录/编辑/上传/触发构建纵向验证
- [ ] Stage0 restore drill、完整纵向与双 CDN 同 fixture hash 证据
- [ ] Stage1 slug-change/delete-tombstone mutation
- [ ] 完整发布切换、回滚与 crash 故障注入
- [ ] 接入真实 Aliyun/Cloudflare purge API 后再宣称 edge 能力完成

## 7. False confidence

最新修改报告中最容易造成误判的表述：

1. **“AA-01 保持 FIXED”**：只检查大小写敏感的 `oldPath===targetPath` 不等价于 Nginx map 行为；当前仍有 3 个循环。
2. **“15 CID verdict=pass”**：字段为 pass 不代表人工通读；14 条由自动 agent spot 写入。
3. **Stage8 `humanPass=15`**：这是 gate 的分类错误，不是实际人工完成度。
4. **“完整 build / 全 gate PASS”**：本轮已经同时证明 Stage4 与 Stage8 都能在关键错误存在时 PASS。
5. **“AA-07 FIXED”**：只表示不再伪造 CDN 成功；真实 purge 能力仍未实现。
6. **“AA-05 baseline 完成”**：该项本身成立，但最新 modification report 仍未 tracked；不能把其自述当 commit 内证据。

在 AA-11、AA-12 关闭前，结论维持 **NOT_READY**。
