# 自研 CMS Agent 执行计划 v2

日期：2026-10-10。状态：计划修订完成，尚未实施。

配套：[完整方案 v2](design-v2-2026-10-10.md)。本文件替代外部草稿 `cms-agent-plan-2026-10-10.md`；后续维护以仓库内本版与完整方案为准。根目录 `AGENTS.md` 与当次用户授权优先；两份 v2 若冲突，先定位并修正文档，不擅自实施有数据损失风险的选择。

用户要求整理 v2 不等于开始开发、提交或生产部署。实施需有对应任务授权；取得本地实施授权后，常规阶段可连续推进，不在每阶段例行停下确认。P1 手感结论由用户提供；生产写操作另需明确授权。

仓库归档：2026-10-11。维护入口：[CMS 文档索引](README.md)。本文件列出的新增脚本和验收项尚未实现，不是当前生产操作手册。

## 0. 目标与不可变语义

新建独立 `cms/`，Astro SSR + MySQL + CodeMirror 6，替换写作、翻译审批与重建请求。访客端保持 Astro 静态站，Waline、路由、feed、off-box、checksum、蓝绿和 CDN 判定不变。

建设两类产物：兼容 `schemaVersion: 2` 构建快照，以及 `migrationPackageVersion: 1` 私有迁移包。前者用于原有 sync/build，后者用于完整导入、影子对账和数据回滚。不能为迁移而把未批准译文塞进构建快照。

## 1. 固定设计与改动白名单

| 项 | 执行要求 |
| --- | --- |
| 库/表 | 新 CMS 库、`cms_` 前缀、独立账号；采用 Typecho 兼容列名；复用 mysql2，不增加 ORM |
| 正文 | `contents.text` 保留原文、marker、换行；不做导入短代码转换、不换成 body/format 存储 |
| 历史字段 | 完整保留 name/type/str_value/int_value/float_value；五个专用控件不是迁移过滤白名单 |
| 编辑器 | CodeMirror 装饰层 + 源码模式；旧 Joe 与新指令共存，只转换渲染副本 |
| 认证 | 离线首个管理员初始化、passkey 普通登录、多凭据管理、TOTP+一次性恢复码的受限恢复 |
| 发布 | 新 `cms_publish_outbox`；现有 i18n outbox 保持译文用途 |
| 来源 | `CONTENT_SOURCE=typecho\|cms`，默认 typecho，正式构建/内容备份共用入口和配置，不静默 fallback |
| 预览 | interactive 不启动服务端 Playwright；正式预览走隔离 off-box 构建，鉴权、禁止发布 |
| Moments/HTML | Moments 完整迁入，面板 P4 后做；HTML/附件等存量保留，只读兼容，不能因不支持编辑而丢数据 |
| 回滚 | P2 做回迁脚本与演练；P4/P5 写生产 runbook，未经授权不执行 |

允许改动：新增 `cms/`、契约/迁移/对拍脚本、本地 compose；新增来源适配，接线 `host/blog-rebuild-1panel.sh`、`host/backup-content-github.sh`、compose/env 和观察任务；必要的共享展示组件/渲染参数抽取；sync 输入兼容验证。来源配置须包括导出挂载、只读 DB 连接、worker 前缀和观察连接。

不得借接线改动变更 sync 输出、既有路由分配、gate 判定、rebuild-api 协议或发布/CDN 行为。保留 Typecho 分支与预览资源直到回滚窗口结束；不能直接删除 `cms-preview-render.js`。

使用 Git Bash，命令先写脚本再执行；删除使用经验证的具体路径，遵守根 AGENTS 的禁止变量删文件约束。不要覆盖工作区已有改动，不提交 secret、私有包、草稿、`.planning/`；用户没要求不 commit/push。只做相关验证，禁止无关审计和全套 gate 反复空跑。

## 2. 先核对的代码与状态

| 入口 | 核对内容 |
| --- | --- |
| `scripts/export-typecho-snapshot.js` | 字段、排序、jsonSafeRow、一致性事务、硬编码表名 |
| `scripts/sync-typecho.js` | 公开筛选、转换顺序、CONTENT_BACKUP_DIR、副作用、路由基线 |
| `scripts/lib/i18n-snapshot.js` | approved-only versions；heads 含 draft 指针 |
| `scripts/lib/i18n-store.js` | contents.text、sourceHash、CAS、队列/租约 |
| `scripts/i18n-migrate.js` | 六张业务表、迁移记录与字段约束 |
| `typecho/usr/plugins/I18n/Plugin.php`、`Action.php` | 保存事务、审批/撤回/禁用语义、Moments 例外 |
| `typecho/usr/plugins/AutoRebuild/` | 公开修改/删除/metadata 的构建触发范围、astroPath 锁定 |
| `docker/i18n-worker/worker.js` | DB_PREFIX、任务 hash、译文队列发送 |
| `host/blog-rebuild-1panel.sh`、`host/backup-content-github.sh` | 导出来源接线与备份路径 |
| `scripts/i18n-observe-live.js` | CMS 库/前缀及 manifest 对应确认 |
| `astro/src/lib/markdown-pipeline.mjs`、`beoe-cache.js` | plugin 顺序、file Mermaid、依赖资源和 fingerprint |
| `astro/src/pages/posts/[id].astro` | 文章展示逻辑与静态内容依赖 |

本地旧 snapshot fixture 无 schemaVersion/i18n，一份含 attachment。库存报告应记录 type/status、HTML、未知字段、附件/上传引用、全部 i18n 指针/版本/任务。v1 的内容计数、短代码计数不作为生产事实。生产默认只读；本地先用脱敏 fixture。真实 Lsky、off-box、生产库存与权限验证分开记录。

## 3. 目标文件与接口

以下是实施需新增/整理的目标，不代表文件已经存在：

```text
cms/
  astro.config.mjs / package.json / package-lock.json
  src/middleware.ts
  src/lib/db.ts / content.ts / i18n.ts / publish.ts / lsky.ts
  src/lib/auth/                  # challenge、凭据、会话、恢复
  src/lib/preview/               # interactive adapter、鉴权预览
  src/pages/ / src/pages/api/ / src/editor/
  bin/bootstrap-admin.* / recover-admin.*
  migrations/ / test/
scripts/
  snapshot-schema.json / migration-package-schema.json
  normalize-legacy-snapshot.js / validate-snapshot.js
  validate-migration-package.js / compare-snapshots.js
  compare-migration-state.js / compare-dist.js
  export-content-snapshot.js     # 来源适配入口
  export-cms-snapshot.js
  export-typecho-migration.js / import-typecho-to-cms.js
  export-cms-migration.js / restore-cms-to-typecho.js
  cms-shadow-sync.js / cms-shadow-build.sh
compose.cms-dev.yml
docs/cms/
  inventory.md / contracts.md / progress.md
  fixtures/                     # 脱敏 v2 + 私有包样本
  runbook-cutover.md / runbook-rollback.md
  runbook-backup.md / runbook-retire.md
```

约定接口：

| 工具 | 输入/输出 |
| --- | --- |
| `normalize-legacy-snapshot.js in.json out.json` | 明确识别旧版本、升级为 v2，另出差异报告；只接受 snapshot-*.json，不扫所有 JSON |
| `validate-snapshot.js file.json` | v2 结构及关联检查；失败非零；不修改输入 |
| `validate-migration-package.js package-dir` | manifest/checksum/schema/引用/全表完整性、自增序列元数据及保留身份边界；失败非零 |
| `compare-snapshots.js a.json b.json` | 按真实主键逐字段比较；报告重复主键、缺行、值/类型差异；非零表示不同 |
| `compare-migration-state.js a-dir b-dir` | 完整兼容数据对拍；只允许已记录的受控 lease 等运行字段差异及有逐表上界依据的序列提升；序列下降失败 |
| `compare-dist.js a-dir b-dir` | 默认完整文件 sha256/缺失比较；若用精确归一化清单，必须显示规则和原始差异 |
| `export-content-snapshot.js` | env 指定来源、独立连接/只读账户、SNAPSHOT_EPOCH/EXPORT_SNAPSHOT_JSON；默认 typecho |
| 两个 migration exporter | CLI/env 指定受限目标目录，一致性读取，原子完成 manifest，不复用公开快照当完整包 |
| `import-typecho-to-cms.js --package dir --mode bootstrap\|mirror --dry-run` | 默认 dry-run；execute 显式选择隔离 CMS 库；生产需授权；拒绝错库/半包 |
| `restore-cms-to-typecho.js --package dir --dry-run` | 默认报告映射/增改删/无法映射项；execute 前目标库停写并有备份；拒绝未核验包 |

接口实现后在 contracts/runbook 中补充精确执行命令、退出码、连接项和重跑方式；文档中的目标命令未实现前不能标记通过。

## 4. P0：库存、契约与对拍基线

1. 固定本地代码修订、lockfile、Node、Astro/adapter 兼容组合；记录用户未提交改动，不为建立基线而丢弃它们。
2. 写 inventory 和两类 schema。构建契约字段按真实导出器定义；migration 包补完整行/列和 i18n 六表全部数据，引用校验区分两类契约。构建 snapshot 的 draft head 指针不要求必须出现在 approved-only versions，私有包则要求有效引用。为每张自增表定义精确十进制源 next ID、采集时点/方式及身份域；保留 ID inventory 包括 route/meta 墓碑、i18n/变更记录引用及其表间映射。源序列不能按现存 max(id) 推算；序列元数据不假定属于事务快照，影子读取单列时点/校验，最终值在冻结后采集。
3. 原旧 fixture 保持。显式 adapter 对两份 snapshot 生成 v2：添加版本、记录 attachment 等过滤的原因/行数；这只是构建输入升级，原始行仍保留在原 fixture/私有包，不能当完整迁移已通过。预 i18n 样本允许无 i18n，当前 i18n 来源另用有数据的样本覆盖。
4. 新建脱敏样本：源文草稿/私密/密码/撤回、Moments、未知字段/附件；译文 approved/draft/history/disabled/outdated、ledger、pending/accepted/leased/failed 等状态。加入重复主键、错类型、悬空私有指针及被改动正文的反例。
5. 对拍工具必须能发现故意改动，不只比较自己。Markdown 用 CONTENT_BACKUP_DIR，两个独立输出目录串行运行，并固定同一 route/meta 基线；该模式仍可能共享 staging/cache，不能认为设置输出目录就隔离整个工作树。
6. dist 对拍使用两份隔离工作副本/构建目录，同 revision/epoch/route baseline/依赖/缓存与外部数据。生产 route maps 不作实验输入的写目标。
7. sync 校验接线先兼容直接 DB 分支和旧 fixture，不因缺 schemaVersion 破坏既有调用。避免将迁移格式校验混入日常公开构建。

验收：旧 fixture 升级差异可解释；新 v2 与私有包正反例通过；对拍能检出字段、类型、缺行和重复键；既有输出基线可重现。只有需要构建时运行带明确 fixture/epoch 的隔离构建；不在工作树无快照地运行根 npm run build。

## 5. P1：编辑器原型与预览适配

1. 建 cms SSR 脚手架和本地隔离 MySQL。原型仅本地；生产部署不属于本阶段。
2. CodeMirror 实时装饰/源码模式；保留旧 Joe 与指令原文；小众扩展可试验但不自动当作已选依赖。
3. 设计原文与显示模型边界：保留 marker 的精确字节；按文档配置换行，正确序列化；无改动路径保留原文。混合换行实际修改需显式规范化，输出规范化 diff。
4. 保存原型走浏览器→API→MySQL→读回→导出，不只 EditorState。模拟并发版本冲突，测试编辑/粘贴/撤销/重做后字节恢复与内容准确性。
5. 抽共享文章展示组件和预览正文转换，依 sync 的真实顺序处理；保持访客输出。若抽取影响 rendererFingerprint，记录新值并走现有重新验证流程。
6. 构建/interactive plugin 参数分开：正式 file Mermaid 留给构建；interactive 不启动 Playwright，不写公共 beoe/cache。浏览器 Mermaid bundle 本地托管，严格配置，资源失败有占位。
7. 防抖取消过时请求，设置大小/并发/超时上限。网络补全限制目标地址、重定向及时间；正式预览本地先模拟，真实 off-box 任务后续获准才接。
8. iframe sandbox 保持父后台隔离；需要脚本但不授予同源特权，messages 验证发送窗口与流程标识。抽取 CSS/Expressive Code 配置，明确图表临时差异。

验收：覆盖 UTF-8/emoji、LF/CRLF/CR/混合、尾空行和硬换行、数学/围栏/旧短代码的保存链路；两标签页不会互相覆盖；受影响的线上文章展示在隔离构建与浏览器中无行为回归；用户真实写一篇文章确认手感。未收到用户反馈只能标“待试用”，可继续独立后端工作。

## 6. P2：完整本地 MVP、发布接线与回迁

### 6.1 数据、迁移与 i18n

创建 cms 兼容表、修订、change_log、import_runs、两个 outbox、认证/审计/media 表。迁移 DDL 使用独立账号；每一步有版本和失败重跑规则，不假定 MySQL DDL 可随大事务回滚。

完整包导入保留全部 ID、text 和历史字段。bootstrap/mirror 导入幂等，主键集合对账删除旧镜像内容/关系/字段，拒绝运行于已启用 CMS 写入的镜像库。各表 next ID 下界取 max(包内源 next ID，目标切换前 next ID，最终行最大 ID + 1，该身份域历史保留 ID 最大值 + 1)，序列只升不降。staging 替换前捕获目标已消耗序列，校验包内序列/保留身份映射后应用；重跑或影子替换不下调，不用 max(现存行) + 1 代替源序列。import_runs 未完成时禁止提供半包数据。大包先 staging，完成校验后受控切换。

HTML/附件/额外列按库存映射兼容保留；没有明确映射的类型报出阻塞项，不能静默跳过。迁移期不调用编辑器序列化重写原文。

内容保存、修订恢复、状态/关系/字段操作使用乐观锁。修订是完整对象。事务内同时更新 i18n source_state、job 和公开变更事件；审批/禁用 CAS 按当前插件语义。旧 hash/revision 原样导入；验证同一 worker 的 sourceForJob/sourceHash 结果相等。

### 6.2 通用发布 outbox 与接线

创建独立 `cms_publish_outbox`，普通中文/metadata 变更不得伪装为译文事件。定义稳定 event_id/变更序号，pending/sending/accepted/failed，租约恢复、退避与重试上限。事务提交前不能发网络请求。

请求使用现有 HMAC/raw-body、ts、nonce 协议，每次重试新的 ts/nonce；现有数据库事件保持稳定。模拟提交后崩溃、发出但响应丢失、202 后消费者崩溃、接口不可达/5xx/协议错误。可重复接收入队，但不能丢事件或误报上线。

统一来源 exporter 接线正式构建与已发布内容备份，默认 Typecho、CMS 显式配置；对 typecho/cms 分支与失败路径分别本地验证。worker 指向 CMS 库、`DB_PREFIX=cms_`；观察任务同步 CMS 库/`I18N_OBSERVE_PREFIX=cms_`。保持默认旧分支可用，失败不能自动访问旧库并发布旧内容。

界面区分保存成功、请求已接收与构建状态；202 不是发布完成。MVP 链接现有状态 UI；没有 manifest/内容证据，不标具体中文修订已上线。i18n 继续既有 manifest 观察。

### 6.3 登录、图片与权限

实现离线 bootstrap 命令与短时 secret/hash/单次使用/事务唯一初始化，匿名空库注册失败。已认证管理员添加/撤销 passkey 需近期再认证；保护最后可用凭据。challenge 一次性、限时、绑定流程，固定 Origin/RP ID 且 require user verification。

实现 TOTP 显式启用、独立 secret 加密密钥、一次性恢复码 hash；恢复需 TOTP+恢复码，只给短时重绑权限，重放/超限拒绝。恢复后撤销旧会话，记录并通知；彻底失去材料只能离线恢复。

cookie/CSRF/Origin/会话旋转/绝对过期按完整方案 §9；OpenResty 配置写 runbook，本地测试应用限速和代理信任。CSP 适配 Astro nonce/hash、本地图表脚本和必要图片域，预览不能获得后台同源权限。

Lsky 先核对部署接口，再实现认证上传、大小/像素/帧数/时间上限、白名单/file header、sharp 编码、编码后 hash 去重；拒绝 SVG，明确动画策略。真实上传是对图床的写操作，用户未授权时用 mock，结果标“provider 未验证”。

### 6.4 回迁及验收

实现 `export-cms-migration.js` 与 `restore-cms-to-typecho.js`；回迁默认 dry-run，拒绝不一致/错误目标。回迁兼容内容、字段、关系、附件关联、完整 i18n、ID 和按 §6.1 只升不降的 AUTO_INCREMENT（包含回迁目标已有高水位）；删除必须对账。CMS-only 修订/认证/审计/media 等保存在私有 CMS 包，不能丢弃或宣称旧后台可访问。

消费者停机和最终包处理中 leased→queued/清 lease 是显式运行字段差异，不重算业务 hash/revision。回迁未完成通用 outbox 合并为一次受控重建，保留事件直至请求处理有证据。

验收需覆盖：

- 同一完整包导入→导出，兼容数据全表一致、draft/approved 指针有效、队列未丢；允许运行字段差异及按高水位规则提升的序列逐表列出，不得下调或忽略序列差异。
- 从同一冻结包派生 Typecho/CMS 构建快照；逐字段、Markdown、路由/selection manifest、dist 一致。
- 原 worker 在 CMS 兼容表上处理任务，hash 相同，陈旧任务/CAS/禁用与 Moments 例外正确。
- 公开变更与队列原子，草稿不触发；故障重试不会漏构建请求。
- 安全关键路径有真实应用证据，mock provider 与真实 provider 清楚区分。
- CMS 接入→新增一篇、修改/删除旧文、改分类/字段、更新译文→冻结→回迁隔离 Typecho→再导出/构建；数据/路由一致且无删除复活。
- 删除最大 ID（包括已进入 route/meta 墓碑的身份），源 next ID 高于现存 max(id) + 1；在禁止编辑的镜像库验证 bootstrap/mirror 失败重跑及连续 staging 替换不降低序列。另在切换后的 CMS 新增→冻结→回迁→Typecho 再次新增，验证两端已消耗序列均保留且历史身份不复用。
- 来源/worker/观察/备份成组切换及切回；切换和回滚开始时已有 off-box 构建、pending/dirty 或失败重试，验证静默后旧任务不能发布/回写，新来源重新导出处理遗留请求且无请求丢失；Typecho 默认分支可用。

只有这些与本次功能相关的验证需要新增；不创建仅重复实现的测试或无关审计清单。

## 7. P3：影子流程与生产准备

1. 实现 shadow sync：源只读完整导出→校验→镜像导入→删除对账，携带包标识、行数、检查点与完成标记。影子库拒绝编辑/审批，worker/两个 outbox 消费者/上传写入禁用；验证源序列元数据并保留镜像目标的已消耗序列，staging 替换不下调。
2. 实现 shadow build：正式构建对应冻结输入与 CMS 镜像使用同一 epoch/代码/路由基线；影子在独立工作副本构建，不写生产路由或触发 release/CDN。
3. 差异按私有状态→构建 snapshot→Markdown→manifest→dist 排查；默认不忽略文件。需要易变字段归一化时明确精确路径/原因/规则并保留原差异，内容变化不能被抹掉。
4. 本地连续模拟增改删、草稿发布/撤回、译文审批与任务状态；验证失败包恢复和删除对账，不能只用两份无 i18n fixture 走一次流程。
5. 写切换/回滚/备份/下线 runbook，包含环境占位、角色权限、容器卷、只读 rootfs、secret、源配置切换、旧上传映射、证书/OpenResty、失败恢复和核验命令；切换/回滚共用停止新调度、等待或安全中止在途构建、核验无旧发布/回写、队列来源对账及重新导出后恢复调度的步骤，不能只记录在途任务。
6. 生产 shadow 启用需授权；建议观察 7–14 天且覆盖真实变更。所有“不一致”“待 provider”“用户待试用”如实记录，不能把本地验证写成生产已验证。

## 8. P4：生产切换（默认只准备）

runbook 必须逐步包括：

1. 明确维护窗口、冻结全部 Typecho 内容/审批写入口、定时任务及消费者，阻止新手动重建并暂停 `blog-rebuild-1panel.path`。等待已有 `blog-rebuild-1panel.service` 完整结束（含切 release/观察回写），或安全中止并确认 off-box 子任务不能继续发布/回写；只记录任务或检查 building 文件不算静默。对 pending/dirty/current-job、失败重试、冻结快照及候选产物标记来源并留存对账，禁止旧快照/产物在切源后重试发布。确认无旧来源发布/回写后备份旧库/配置/上传清单。
2. 静默状态下导出最终私有包及源序列→完成 CMS 导入→lease 受控处理→按 §6.1 校准序列（不下调）→核验完整数据、构建和路由。
3. CMS 初始化/权限、导出和两种备份验证；成组切 CMS 来源、worker 库/前缀、观察配置。
4. Typecho 仍停写，核验新进程实际读取成组切换后的配置、遗留请求已对账并将在新来源重新导出；CMS 成为唯一写端后才启动 CMS worker/通用消费者并恢复 path 调度。
5. 授权触发构建，沿现有发布过程确认 checksum、release、公网正文和相关 i18n；CDN 的接收与边缘验证分别记录。
6. 任一步失败冻结写入，执行已演练数据回滚或静态 release 回滚；明确两者区别，不恢复旧库就宣称数据回滚成功。

执行需要当次明确生产授权，不用“方案已定”推导授权。回滚也会写生产库，其范围需包含在切换授权/runbook 中；范围不清时保持冻结并请求具体授权。

## 9. P5：观察、回滚与下线

至少观察 14 天且覆盖一次内容变更、一次译文审批和一次私有库恢复验证；缺活动则延长。监控保存错误/冲突、队列滞留、worker 异常、导出/备份失败和发布差异，使用已有通知渠道；新增发送渠道或测试消息需按用户授权处理。

回滚：停 CMS 写入与任务→执行 §8 第 1 步的发布控制面静默和队列来源对账（包括停止新调度及在途构建处理）→保存冻结后的最终 CMS 包/源序列及两库备份→隔离 Typecho 恢复副本验证→停写旧库按 §6.1 高水位规则受控回迁→核验→成组切回来源/worker/观察并确认新进程配置和新来源重试输入→恢复 Typecho 写入及消费者/path 调度→授权重建。未完成通用发布事件保留到受控重建处理。数据不兼容则维持冻结并恢复已验证备份，不带错继续。

回滚窗口保留旧库、容器镜像、插件/补丁配置与 uploads。下线须另获授权且已有可恢复归档；保留 MySQL 服务、Waline 及旧 `/usr/uploads/` 静态文件。不能顺手删除仍有调用方的脚本/插件或假定所有旧 URL 都已迁移。

## 10. 交付记录与必须澄清的情况

每阶段更新 `docs/cms/progress.md`：实现内容、实际命令/结果、数据差异、测试层级、用户试用/生产/provider 尚缺证据、下一步。P0/P1 后以人工小时重估各模块，单列 Agent 执行/环境等待和观察日历时间；不复用 v1 的 4–6 周承诺。

常规可解释实现选择自行解决。遇到下列情况才要求决定：无法完整映射/回迁的私有数据；无法解释的字节/构建差异；超出 §1 的公开行为/发布协议变化；新增外部服务；需要用户判定的编辑器手感；需要生产或图床写入而尚无授权。提供具体差异与可选方案，并继续独立工作。

关闭阶段以验收证据为准，不以“功能大致写完”或“HTTP 200/202”为准。最终交付须清楚说明：哪些只是本地实现，哪些用户试用、真实 provider、影子和生产已实际通过。
