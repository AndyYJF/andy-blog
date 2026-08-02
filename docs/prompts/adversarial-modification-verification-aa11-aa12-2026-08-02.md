# AA-11 / AA-12 最新修改复查报告（2026-08-02）

复查对象：`adversarial-modification-report-aa11-aa12-2026-08-02.md`

范围：当前未提交工作区（23 个 tracked 修改文件），所有构建、生成和 mutation 测试均在隔离副本完成；原仓库只新增本报告。

## 1. Verdict

**NOT_READY**

本轮两个修复都改善了当前正常路径，但仍未形成不可绕过的门禁闭环：

| ID | 实现方声称 | 本轮判定 | 结论 |
|---|---|---|---|
| AA-11 / AA-01 | FIXED | **PARTIALLY_FIXED** | 当前 Nginx regex 产物已修；plain-key mutation 能拦截，但 regex-key 指向 canonical 自身仍可让 Stage4 PASS |
| AA-12 / AA-02 | FIXED（语义） | **PARTIALLY_FIXED** | 当前 1 human + 14 agent spot 分类正确；已知 auto 名称能拦截，但未知 auto reviewer 可伪造 15/15 human |

此外，AA-02 人工 Final 仍只有 1/15，AA-06、AA-09、AA-10 等已知债未关闭，因此无论新绕过是否存在，目前都不能进入 Stage 9。

## 2. AA-11 验证

### 当前配置 — PASS

当前 generator 已把 path map key 生成为 case-sensitive anchored regex：

```text
~^/category/AI/$   "/category/ai/";
~^/category/DN42/$ "/category/dn42/";
~^/category/NAS/$  "/category/nas/";
```

因此 lowercase canonical 不会再命中 uppercase legacy key；上一轮当前产物中的 case-fold loop 已消除。

### plain-key mutation — PASS

把隔离副本的一条规则改回：

```text
"/category/AI/" "/category/ai/";
```

Stage4 返回 1：

`legacy_target key must be case-sensitive regex: "/category/AI/"`

说明最新报告声称的 plain-key 防回归成立。

### regex-self mutation — FAIL

把同一规则改为外形合规但实际自跳转：

```text
~^/category/ai/$ "/category/ai/";
```

Stage4 仍返回 PASS：

```json
{
  "ok": true,
  "legacyEntries": 140,
  "pathRedirects": 110,
  "queryRedirects": 30
}
```

原因：Stage4 只检查 key 是否以 `~^` 开头、以 `$` 结尾，以及 lowercase canonical 不能是 plain quoted key；它没有解析 regex literal 并与 target 比较，也没有把 Nginx map 与 `legacy-url-map.json` 逐条对账。

因此 AA-11 的当前运行配置已修，但 gate 仍可接受同类 canonical self redirect，不能判完整 FIXED。

## 3. AA-12 验证

### 当前数据与正常 gate — PASS

当前 15 条 review：

- 1 条：`verdict=pass`、`reviewer=manual+live-verify`
- 14 条：`verdict=agent-spot`、`reviewer=agent-spot-verify`
- 15 条均有 source/dist SHA-256

Stage8 当前输出：

```text
humanPass=1
agentSpot=14
auditClean=0
warnings:
  - 14/15 reviews are agent-spot (not human Final)
  - Stage 8 Final incomplete: human pass 1/15
```

相较上一轮错误的 `humanPass=15`，当前 artifact 与报告语义已经纠正。

### known-auto mutation — PASS

将 CID11 改为 `verdict=pass`、保留 `reviewer=agent-spot-verify`，Stage8 返回 1：

`cid 11: agent-spot-verify must use verdict=agent-spot (not pass)`

说明三个已知 auto reviewer 名称被正确拒绝。

### unknown-auto mutation — FAIL

将 14 条自动记录改为：

```json
{
  "verdict": "pass",
  "reviewer": "codex-auto-v2"
}
```

Stage8 返回 PASS，并输出：

```text
humanPass=15
agentSpot=0
auditClean=0
warnings=[]
```

原因：`isHumanReviewer()` 采用 denylist；任何不在以下集合中的非空字符串都被当作 human：

- `stage8-audit`
- `stage8-audit-auto`
- `agent-spot-verify`

这能修正当前已知脚本，却不能证明 reviewer 是人。新增自动工具、更名或直接编辑 JSON 都可以重新制造 15/15 Human Final 假阳性。

## 4. 新 Finding

### AA-13 — P1 — 未知自动 reviewer 可伪造 Human Final

**Evidence**

- 14 条 `pass + codex-auto-v2` 被 Stage8 计入 human。
- Gate 输出 humanPass=15、warnings=[]、exit 0。
- 当前 human 判定是 auto reviewer denylist，而不是显式 review kind / human provenance。

**Disposition**

不要从 reviewer 名称反推 review 类型。增加枚举字段，例如 `reviewKind=human|agent-spot|audit`；human Final 只接受 `reviewKind=human`，并将该字段纳入受控写入流程。若需要更强证明，可记录人工 reviewer ID、review session/evidence 和 source/dist hash。增加 unknown reviewer / renamed bot mutation。

### AA-14 — P1 — Stage4 接受 case-sensitive regex canonical self redirect

**Evidence**

- `~^/category/ai/$ → /category/ai/` 时 Stage4 exit 0。
- Gate 只检查 regex 外形，没有比较 regex literal 与 target。
- 该规则部署后仍会使 canonical URL 302 到自身。

**Disposition**

对 anchored literal regex 做可逆解析并执行：

1. regex key 解码后的 literal 不得等于 target；
2. Nginx path map 必须与 `legacy-url-map.json` 一一对应；
3. canonical lowercase matrix 必须同时拒绝 plain-key 和 regex-self；
4. 增加 regex-self mutation 测试，而不只测试 plain-key。

## 5. 回归结果

| 验证 | 结果 |
|---|---|
| 完整 `npm run build` | PASS，13.54s |
| Astro / Pagefind | 32 pages / 15 indexed pages |
| Stage4 当前配置 | PASS |
| Stage8 当前配置 | PASS，human=1、agentSpot=14，有两条 warning |
| Stage1 | PASS；mutation 债务仍在 |
| Stage5 | PASS |
| Baidu规范 URL | PASS |
| rebuild-api 40 nonce/replay | PASS |
| Waline helper 19 项 | PASS |
| CDN 假凭据 | Aliyun/Cloudflare 均 not-implemented + exit 71，无假成功 |

Mutation 后已恢复隔离副本；4 个关键脚本 SHA-256 与原工作区一致，reviews 恢复为 1 human + 14 agent spot。

## 6. 更新 checklist

- [x] 当前 Nginx path key 使用 case-sensitive anchored regex
- [x] plain quoted path key 会使 Stage4 FAIL
- [x] 当前 Stage8 正确输出 human=1、agentSpot=14
- [x] `pass + agent-spot-verify` 会使 Stage8 FAIL
- [ ] Stage4 拒绝 regex-key canonical self redirect
- [ ] Nginx map 与 legacy map 逐条行为对账
- [ ] Stage8 使用显式 review kind，而不是 auto reviewer denylist
- [ ] unknown/renamed auto reviewer mutation 会 FAIL
- [ ] 完成剩余 14 篇人工 Final，或正式批准并记录验收降级
- [ ] AA-06 完整 CMS 纵向
- [ ] AA-09 restore drill / 双 CDN hash / 完整纵向证据
- [ ] AA-10 Stage1 mutation、发布回滚与 crash 注入
- [ ] 真实 CDN purge API
- [ ] 本轮 23 个 tracked 修改完成复核后提交到 baseline 分支

## 7. False confidence

1. **“key 全为 `~^...$`”不等于没有自跳转**：regex literal 本身仍可能与 target 相同。
2. **“auto reviewer 列表完整”无法证明 human**：新名称默认被视为人，是 fail-open。
3. **当前 human=1 / agentSpot=14 正确，不代表未来 artifact 不可伪造**：本轮 unknown-auto mutation 已复现 15/15 假阳性。
4. **完整 build PASS 仍不是 READY 证据**：两个新 mutation 都针对现有全绿门禁的覆盖边界。
5. **本轮修复尚未提交**：验证对象是 23 个 tracked 未提交修改，不是新 commit。

结论：AA-11、AA-12 均有实质改善，但只能判 **PARTIALLY_FIXED**；AA-13、AA-14 关闭前维持 **NOT_READY**。
