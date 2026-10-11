# CMS 进度

## 2026-10-11 P0 契约与对拍

实现了构建快照 v2 和私有迁移包 v1 的 schema、旧 fixture 升级、两类校验，以及 snapshot / migration / dist 对拍。没有改 sync 的筛选和输出，没有把迁移校验接进公开构建，没有创建 `cms/`，没有连接生产库或图床。

命令与结果：

```text
node --test scripts/cms-contract.test.js
8 passed
```

其中：

- 两份旧 fixture 升级后能通过构建快照校验，原文件 sha256 不变。`snapshot-1785565762.json` 滤掉 attachment cid 35 和 36。
- 脱敏正例接受缺失的 draft 正文；重复主键、字符串 cid、把 draft 放进构建快照都会失败。
- 对拍能分开值变化、`"1"` 与 `1` 的类型变化、缺行和重复键。
- 私有包正例通过。悬空 `draft_version_id=99` 和被改动但 digest 未更新的正文失败。清空 leased job 只有在 `--allow-controlled-runtime` 下通过，改标题即使带这个旗标也失败。
- `snapshot-1786673780.json` 以 `CONTENT_BACKUP_DIR` 连续导出两次，Markdown 一致，`data/route-map.json` 和 `data/meta-route-map.json` 的 sha256 不变。
- `snapshot-1785565762.json` 在当前路由基线上失败，原因是 cid 9001 moment 已永久删除。stderr 不提 `schemaVersion`。

尚未作为证据的部分：

- 生产库、Lsky、off-box 和额外列库存。
- 两份隔离 Astro dist。本阶段没有改渲染，按计划不跑无目的的全站构建。`compare-dist.js` 只用合成目录验证。
- 导出器仍用 `Number()` 转换 bigint，还没改成越界报错。
- 统一来源导出、CMS 应用、编辑器手感和回迁都还没开始。

## 2026-10-11 P1 本地编辑器原型

本地 CMS 在 `cms/`，只监听 `127.0.0.1:4322`。隔离库定义在 `compose.cms-dev.yml`（`127.0.0.1:3307`，库名 `cms`）。没有改 `astro/src/lib/markdown-pipeline.mjs`，所以 `rendererFingerprint` 不变。预览只在副本上按 sync 的同步转换顺序处理，不调用 Playwright，不写 `public/beoe`。Mermaid 在预览里是占位，不是线上 SVG。代码块保持转义文本，不是 Expressive Code。

命令与结果：

```text
npm --prefix cms install --ignore-scripts
npx --prefix cms astro build
node --test scripts/cms-editor.test.js
```

- CMS 的 Astro 7.3.8 加 `@astrojs/node` 11.1.7 构建完成。访客站 lockfile 仍是 Astro 7.1.6，没有装 `@astrojs/node`。
- 编辑器测试 4 通过、1 跳过。通过的是 LF/CRLF/CR 经 CodeMirror `sliceDoc()` 往返、混合换行不改则保留原字节、预览转换、预览并发上限 2。
- 跳过的是 MySQL 保存读回和过期修订。本机没有 `docker`（`spawnSync docker ENOENT`），`compose.cms-dev.yml` 没有启动。保存代码在 `cms/src/lib/content-store.js`，这条链路没有跑过。

浏览器打开了 `http://127.0.0.1:4322/edit/1/`。库没启动时页面仍能编辑：输入中文和 mermaid 围栏后，预览接口返回占位 HTML，沙箱 iframe 回了 `cms-preview-ack`。点源码模式没有清掉正文。点保存得到 `connect ECONNREFUSED 127.0.0.1:3307`，没有写成保存成功。发给不透明沙箱帧的消息要用 `*`，帧里仍核对父源、来源窗口和 flowId。

访客文章头抽到 `ArticleHeader.astro` 之后，这个工作区没有 `astro/node_modules`，没有在浏览器里打开文章页。

尚未作为证据的部分：

- 浏览器到 API 到 MySQL 再读回再导出。
- 两个标签页的修订冲突。
- 访客文章页抽组件后的隔离构建和浏览器对比。
- 编辑器手感。状态是待试用，要等实际写一篇文章。
- 生产库、图床、发布和 CDN。

下一步是不依赖手感结论的本地后端：CMS 表、导入导出和发布 outbox。手感仍等试用。生产写入、重建、切换 release 和清 CDN 另要当次授权。

## 2026-10-11 P2 开始：表和通用发布队列

加了本地 CMS 表定义：内容、分类、关系、字段、完整修订、change_log、import_runs、通用 `cms_publish_outbox`，以及前缀 `cms_` 的六张 i18n 业务表。通用队列没有 `locale` / `version_id`。译文队列仍是 `cms_i18n_publish_outbox`。保存事务里可以写 change_log 并入队；草稿、私密和密码文不入队。HTTP 在事务提交之后才发。请求体沿用 `typecho-content-changed`、ts、32 位 hex nonce，不带 `i18n`。401 直接失败，503 退避，只有 202 标成 accepted。202 不是上线。

私有包导入计划会原样保留正文，拒绝未知类型和未知列，并且不把译文事件抄进通用队列。

命令与结果：

```text
node --test scripts/cms-publish-outbox.test.js scripts/cms-editor.test.js
9 passed, 1 skipped
```

当时还没有隔离库，所以这一轮跳过了 MySQL 保存读回，导入计划也还没写入数据库。后面的记录是起了 `127.0.0.1:3307` 之后的结果。登录表仍没建。

## 2026-10-11 隔离 MySQL 上的保存和导入

本机没有 Docker。下载了 MySQL 8.4.11 的 Windows zip，数据目录在本机 `LOCALAPPDATA\cms-mysql-dev`，没有放进仓库。`mysqld` 只绑定 `127.0.0.1:3307`。库 `cms` 和 `cms_p2_test`，用户 `cms`，密码 `cms-dev`。这是本地口令，不是生产。

命令与结果：

```text
node --test scripts/cms-editor.test.js scripts/cms-mysql-roundtrip.test.js
6 passed, 0 skipped
```

- 保存后读回的正文和修订里的 LONGBLOB 与写入字节相同。过期修订返回 409，没有覆盖。
- 公开文章入队两条；冲突的那次没有入队。过期租约回到 pending。标成 accepted 之后 event_id 不变。
- 脱敏私有包写入 `cms_p2_test` 再导出，10 篇正文和译文 body 与包内一致。通用队列是空的，译文 outbox 仍在 `cms_i18n_publish_outbox`。`cms_import_runs` 是 complete。库里已有内容时第二次 bootstrap 被拒绝。

同一轮测试接着做了 mirror 和发送。mirror 去掉 cid 9 和它的关系后再导出，这篇附件没有了，cid 8 的 HTML 和 cid 2 的正文还在。再跑一次 mirror，行数不变。`cms_change_log` 有记录时 mirror 被拒绝。发布事件先提交租约，发送时状态已经是 sending；503 之后同一个 `event_id` 回到 pending，下一次用新的 nonce 得到 202 才标 accepted。请求体没有 `i18n`。

```text
node --test scripts/cms-mysql-roundtrip.test.js scripts/cms-editor.test.js
6 passed, 0 skipped
```

登录表还没做。编辑器手感仍是待试用。生产库、图床、发布和 CDN 没有写。

构建快照导出默认仍是 Typecho。`CONTENT_SOURCE=cms` 才读 `cms_` 表。CMS 查询失败时不会再去查 `typecho_` 表。在 `cms_p2_test` 上导出的快照没有 cid 9，cid 2 的正文还在，已批准译文 version 10 在快照里，草稿 version 11 不在。

```text
node --test scripts/content-source.test.js scripts/export-typecho-snapshot.test.js
5 passed, 0 skipped
```

正式构建和内容备份现在走同一套来源检查。没设置 `CONTENT_SOURCE` 时仍是 Typecho，容器里的导出命令也不改数据库。`CONTENT_SOURCE=cms` 必须同时有 `DB_PREFIX=cms_`、`I18N_OBSERVE_PREFIX=cms_`，以及和 Typecho 库名不同的 `CMS_DB_*`。缺一项就退出 65。导出容器额外挂上 `content-source.js` 和 `i18n-snapshot.js`。CMS 构建从这份快照同步，并清掉容器里的 `DB_HOST`；同步代码自己也会在 `CONTENT_SOURCE=cms` 且仍有 `DB_HOST` 时拒绝查库。worker 在前缀和来源不一致时退出 64。这次没有重建镜像，也没有重启正在跑的 worker。

```text
node --test scripts/content-source.test.js scripts/export-typecho-snapshot.test.js scripts/moment-sync-state.test.js
12 passed, 0 failed
```

现有 worker 的 `claimJob` / `sourceForJob` / `sourceHash` 用前缀 `cms_` 读了 `cms_p2_test`。领到的是 cid 2 的 queued 任务，算出来的 hash 等于包里的 `expected_source_hash` 和 `i18n_source_state.source_hash`。`cms_contents.revision` 仍是导入时的 `expected_source_revision`，没有重算。

```text
node --test scripts/cms-mysql-roundtrip.test.js
1 passed
```

同一隔离实例上的 `typecho_restore` 做了回迁。它不是生产库。包内各表导出后，只有 `allowComment` / `allowPing` / `allowFeed` 会从数字变成字符串，其余列与脱敏包一致。mirror 去掉 cid 9 之后回迁，先在 Typecho 表里放回这篇附件，再执行回迁，它会被删掉，不会复活。cid 8 的 HTML 仍是 `<p>存量 HTML</p>`。cid 2 的 draft 指针是 11，approved 指针是 10。连到库 `cms` 时回迁直接拒绝。CMS 的修订、change_log、通用发布队列和 `text_sha256` 没有写进 Typecho 表。

```text
node --test scripts/cms-mysql-roundtrip.test.js
1 passed
```

同一份脱敏包写进 `cms_snap` 和 `typecho_restore` 之后，两边的构建快照逐字段相同，草稿译文 version 11 都不在快照里。同步到两个临时目录后，Markdown 文件的 sha256 相同。这次同步用的是临时路由表，没有改仓库里的 `data/route-map.json`。包里的 `moment_topics` 仍是历史字符串 `示例`，两边快照里这个值相同；同步前才在两份副本上把它换成相同的 JSON。没有跑 Astro dist。补偿扫描不再给 `content_kind=moment` 的文章建译文任务或译文发布事件；同一轮里普通公开文 cid 8 有 1 条任务，闲话 cid 7 没有任务，也没有发布事件。`typecho_restore` 被这轮测试按脱敏包重写，它仍不是生产库。

```text
node --test scripts/cms-snapshot-parity.test.js
1 passed
```

接着在 `cms_snap` 上改了这份包：新增 cid 11，改 cid 8 的正文、字段和分类。过期修订返回 409，没有覆盖正文。闲话 cid 7 保存后没有译文任务。删除公开页 cid 1 写了一条 `delete` 发布事件。cid 2 的英文发布状态改成 disabled 后，它的 queued、leased 和 failed 任务都变成 cancelled。导出再回迁到 `typecho_restore`：cid 1 不在，cid 8 的 HTML、字段和关系还在，cid 2 的 head 是 disabled。在 Typecho 表里放回 cid 1 后再回迁，它仍被删掉。两边构建快照没有字段差异。这不是编辑器手感测试，也没有跑 Astro dist。

```text
node --test scripts/cms-edit-restore.test.js scripts/cms-editor.test.js
6 passed, 0 skipped
```

导入、导出和回迁现在有命令。`import-typecho-to-cms.js` 和 `restore-cms-to-typecho.js` 默认 dry-run。导出把库里仍为 leased 的任务写进包时改成 queued，并清空 lease，不改 `expected_source_hash` 和 revision；库里的原行仍是 leased。一条 pending 的通用发布事件留在包的 `cms-only/publish-outbox.json`，报告记成一次受控重建，没有发构建请求，也没有写进 Typecho。dry-run 之后临时 cid 990001 还在；`--execute` 只接受 `typecho_restore`，连到 `cms_cli` 退出 65。执行后这行被删掉，Typecho 里的 job 2 是 queued，CMS 里的 job 2 仍是 leased。`typecho_restore` 被这轮按导出包重写，它仍不是生产库。

```text
node --test scripts/cms-migration-cli.test.js
3 passed, 0 skipped
```

译文批准按插件的 digest 校验做了。digest 不对时返回 409，approved 指针仍停在 version 10。digest 对齐后，cid 2 的英文指针改到 version 11，校对人记为 `human:1`，并插入一条 `publish:2:en:11` 的 pending 译文发布事件。再批准同一次，事件仍是一条。账本里的 `translation_available_at` 保持原来的 1700000400，没有被这次批准改掉。不存在的 version 返回 404，digest 格式不对返回 400。这是隔离库 `cms_approve` 上的结果，没有发构建请求。

```text
node --test scripts/cms-approve.test.js
1 passed, 0 skipped
```

修订恢复用当前行的乐观锁。cid 40 从第二版回到第一版时，过期的 baseRevision 返回 409，正文保持第二版。锁对齐后正文、标题、slug、字段和分类回到第一版，当前修订变成 3，第二版修订仍留在 `cms_content_revisions`。同一事务里 source revision 变成 3，hash 对得上恢复后的标题和正文，并写入一条 `content:40:rev:3:update` 发布事件，译文任务的期望 hash 与之相同。不存在的修订返回 404。闲话 cid 41 恢复后没有译文任务。库是 `cms_restore`，没有发构建请求。

```text
node --test scripts/cms-revision-restore.test.js
1 passed, 0 skipped
```

同一份脱敏包同步到两个备份目录时，除了 Markdown，现在也写出选择清单、中文清单、路由、分类路由和 lastmod。这些文件只在备份目录里，仓库的 `data/route-map.json` 和 `data/meta-route-map.json` 字节没变。两边的文件 sha256 相同，选择清单的 epoch 是 1700000400。没有构建 Astro dist，这个工作区没有 `astro/node_modules`。

```text
node --test scripts/cms-snapshot-parity.test.js --test-name-pattern "sync still reads" scripts/cms-contract.test.js
9 passed, 0 skipped
```

通用发布事件在租约过期后仍是同一条。worker-a 领走后没有送出，过期再由 worker-b 领走；worker-a 晚到的 202 改不到这条记录，状态仍是 sending。worker-b 送出后响应丢失，事件回到 pending，event_id 不变，attempts 变成 1。再次送出得到 202 后状态是 accepted，不会再被领取。另一次 400 直接 failed，也不会再领。cid 60 的两条事件都还在。accepted 只表示请求被接收，不是文章已上线。库是 `cms_fault`。

```text
node --test scripts/cms-publish-fault.test.js scripts/cms-editor.test.js scripts/cms-mysql-roundtrip.test.js
7 passed, 0 skipped
```

本地影子同步从隔离库 `cms_shadow_src` 只读导出，再镜像进 `cms_shadow`。导入记录是 complete，带来源和行数。源库 cid 2 的正文在导出后没变。影子库拒绝保存、批准、通用队列领取和译文任务领取；job 1 仍是 queued，approved 指针仍是 10。源库删掉 cid 9 之后再同步，影子库里的 cid 9 和事先塞进去的 cid 99 都不在，cid 2 还在。这不是生产影子，也没有观察期。

```text
node --test scripts/cms-shadow-sync.test.js scripts/cms-publish-fault.test.js
2 passed, 0 skipped
```

导入的未完成标记先单独提交。重复主键把导入打失败之后，正文行数是 0，这条记录是 failed，不是半包。库里若还留着 staging，下一次导入和导出会拒绝，正文仍然是 0。把那条 staging 标成 failed 之后，脱敏包可以导入，导出的 cid 2 正文仍是 `<!--markdown-->正文示例\n`。库是 `cms_import_fail`。

```text
node --test scripts/cms-import-failure.test.js scripts/cms-shadow-sync.test.js
2 passed, 0 skipped
```

图床 mock 没有访问真实 provider。JPEG 和静止 PNG 写入 `cms_media`，地址是 `mock://unverified/...`，返回值标明 `provider: unverified`，宽高是空的，因为没有解码像素。同一张 JPEG 再次提交会命中原来的行。SVG、GIF 和带动画块的 PNG 被拒绝。影子库再提交另一张 JPEG 时返回 403，行数仍是 2。库是 `cms_media_mock`。

```text
node --test scripts/cms-media-mock.test.js
1 passed, 0 skipped
```

`export-typecho-migration.js` 只读隔离库 `typecho_restore`。包里 job 2 从 leased 写成 queued，lease 被清空，`expected_source_hash` 仍和源库一致。源库里这行还是 leased，租约持有者仍是 `worker-a`，cid 2 正文没变。连到 `cms_shadow` 时命令退出 65。没有发构建请求。

```text
node --test scripts/cms-typecho-export.test.js
1 passed, 0 skipped
```

`cms-shadow-sync.js` 默认 dry-run。dry-run 只读 `typecho_restore` 并写出包，`cms_shadow_ty` 里还没有内容表。`--execute` 才把包镜像进去并标成影子库。cid 2 正文是 `<!--markdown-->正文示例\n`。影子库拒绝保存。Typecho 里的 job 2 仍是 leased。从 Typecho 删掉 cid 9 后再执行，影子库里不再有 cid 9，通用发布队列是空的。指向 `10.1.2.3` 的执行退出 65。没有发构建请求，也不是生产影子。

```text
node --test scripts/cms-shadow-typecho.test.js
1 passed, 0 skipped
```

新建草稿不会进通用发布队列，也不会建译文任务。带密码的公开文同样不入队。把这篇草稿改成公开文章时写入 `publish`，再改成 hidden 时写入 `unpublish`，已有译文任务变成 cancelled。不认识的类型返回 400，不会多出队列事件。原先已公开的文章被修改仍然是 `update`。库是 `cms_draft`。

```text
node --test scripts/cms-draft-publish.test.js scripts/cms-publish-outbox.test.js
6 passed, 0 skipped
```

隔离库 `cms_life` 先导入脱敏包，再改独立页的标题、正文、分类和字段，新增一篇公开文章，删掉 cid 8，并把 cid 2 的英文批准指针改到 version 11。账本里的 `translation_available_at` 仍是 1700000400。冻结包回迁到 `typecho_restore` 之后，cid 8 和事先塞进去的 cid 990002 都不在，新文章、改过的正文、分类、字段和批准指针都在。再从 Typecho 导出，兼容表和 CMS 包一致。通用发布事件、修订和 change_log 留在 CMS 包里，没有写进 Typecho；Typecho 再导出的受控重建数是 0。没有构建 dist，没有发构建请求。`typecho_restore` 被这轮重写，它仍不是生产库。

```text
node --test scripts/cms-lifecycle.test.js
1 passed, 0 skipped
```

分类和标签有了单独的保存和删除。新建分类、以及只挂在草稿或密码文上的改名，不进通用发布队列。挂到公开文章上之后再改名，写入一条 `op=meta` 的事件，`cid` 为空，不写译文队列。过期的 slug 返回 409，名称不变。只改公开文章的字段会写入 `update`。删掉这个公开分类时再写入一条 `meta`，关系被清掉，文章还在。影子库拒绝新建标签。库是 `cms_meta`。

```text
node --test scripts/cms-meta-publish.test.js
1 passed, 0 skipped
```

同一套 worker 函数在 `cms_` 表上跑了领取、源文 hash、写回和禁用。领取后的 hash 与标题加正文一致。正文先被改掉时，晚到的写回是 superseded，没有留下译文版本。对上新修订后再写回，只移动 draft 指针，approved 仍是空。闲话 cid 21 在补偿扫描之后仍然没有译文任务。禁用之后，过期任务保持 superseded，写完的任务保持 done，头的 publication_state 是 disabled。库是 `cms_worker`。这不是正在运行的 i18n-worker 容器。

```text
node --test scripts/cms-worker-cas.test.js
1 passed, 0 skipped
```

构建快照导出按来源分连接。默认仍用 `DB_*` 读 Typecho。`CONTENT_SOURCE=cms` 只连 `CMS_DB_*`；`DB_HOST` 指向 `10.1.2.3` 时退出 65，没有连过去。`export-cms-snapshot.js` 会忽略外面传来的 Typecho 来源。同一份脱敏包分别从 `typecho_restore` 和 `cms_snap_src` 导出后，快照逐项相同，version 11 不在里面。重建和备份脚本在 CMS 分支改调这个入口，并带上前缀和 `CMS_DB_*`；Typecho 分支仍叫原来的导出脚本。没有构建 dist，没有发构建请求。

```text
node --test scripts/cms-content-snapshot.test.js scripts/content-source.test.js
10 passed, 0 skipped
```

`cms-shadow-build.sh` 把冻结快照同步到仓库外的工作目录。指向仓库本身时退出 65。缺参数时退出 64。这次用 `snapshot-1786673780.json`，工作目录里有文章 Markdown，选择清单的 epoch 是 1786673780。仓库的 `data/route-map.json` 和 `data/meta-route-map.json` 字节没变。脚本不调用切换 release 或清 CDN。这个工作区没有 Astro 工具链，所以退出 65，dist 没有构建。

```text
node --test scripts/cms-shadow-build.test.js
1 passed, 0 skipped
```

切换、回滚、备份和下线写了四份手册。生产步骤用占位符，没有写主机、端口或密钥路径。手册写明这些步骤没有在生产执行。静态 release 回滚和数据回滚分开。`/usr/uploads/`、MySQL 和 Waline 留在下线范围之外。

```text
node --test scripts/cms-runbook.test.js
1 passed, 0 skipped
```

保存结果现在带上发布队列状态。草稿保存的 `publish` 是 null。公开文章保存返回 `{ state: 'queued', op: 'publish' }`，队列表里的状态是 pending。返回值没有“已上线”字段。编辑器文案把入队和未入队分开，并仍写着手感待试用。`cms/node_modules` 不在这个工作区，页面没有在浏览器里点保存。库是 `cms_status`。

```text
node --test scripts/cms-save-status.test.js scripts/cms-editor.test.js scripts/cms-draft-publish.test.js
7 passed, 0 skipped
```

影子差异按私有包、构建快照、Markdown、清单、dist 的顺序比较。缺参数退出 64。同一份脱敏包和同一份构建快照、相同的 Markdown 与清单、但没有 dist 目录时退出 65，报告写明 dist was not built。Markdown 有一个字节不同时退出 1，并且不会把 dist 标成已比较。另一次用两个临时 `index.html` 走完 dist 比较并退出 0；那不是 Astro dist，这个工作区仍然没有构建站点。

```text
node --test scripts/cms-shadow-diff.test.js
1 passed, 0 skipped
```

读回最新一条通用发布事件时，pending 的 `requestAccepted` 是 false。把它按租约记成 202 之后，状态变成 accepted，`requestAccepted` 是 true，`live` 仍是 false。同一条 event_id 没有换成新事件。草稿 cid 没有队列行。编辑器在已接收时写“这里没有发布清单”。页面没有在浏览器里打开。库是 `cms_pubstate`。

```text
node --test scripts/cms-publish-state.test.js scripts/cms-save-status.test.js
2 passed, 0 skipped
```

编辑器里的新文稿现在带 `type: post_draft` 保存。保存接口会把请求里的 `type` 和 `status` 交给保存函数；没带类型时仍按原来的公开文章处理。新文稿因此不进发布队列。保存成功后不再重复发送草稿类型，已有文章的类型保持不变。编辑器没有单独的发布按钮。页面没有在浏览器里点过保存。

```text
node --test scripts/cms-save-status.test.js
1 passed, 0 skipped
```

保存、删除、分类、未验证图片和译文批准会在同一事务里追加 `cms_audit_log`。修订冲突回滚后不增加行。日志里没有正文密码，也没有译文 digest。这条日志不是防篡改审计，操作者仍是 `local`，因为登录还没做。库是 `cms_audit`。

```text
node --test scripts/cms-audit.test.js
1 passed, 0 skipped
```

建表按版本记录。一步里的语句失败时不写版本，已经建成的表会留下，因为 MySQL 的 DDL 不能随事务回滚。修好后再跑，同一版本只记一次，`applied_at` 不变。日常账号 `cms_schema_app` 不能建表，但能写入迁移账号建成的表。这两个账号只在 `127.0.0.1:3307` 的 `cms_ddl` 上建过，测试结束已删除，不是生产账号。

```text
node --test scripts/cms-schema-steps.test.js
1 passed, 0 skipped
```

导出遇到超出安全整数的 BIGINT 会报错，错误里保留原来的十进制数字 `9007199254740993`，不再先舍成另一个整数。范围内的 `42` 仍是 JSON number，旁边的字符列 `1` 仍是字符串。构建快照和私有包的导出连接都走这个检查。库是 `cms_wideint`。

```text
node --test scripts/cms-safe-integer.test.js
1 passed, 0 skipped
```

来源可以成组切到 CMS，再切回 Typecho。切回之后导出脚本是 `export-typecho-snapshot.js`。如果切回时还留着 `CMS_DB_HOST`，解析退出 65，并清掉上一次的 CMS 标记；这时再选导出脚本也会退出 65，不会沿用 CMS。没有重建运行中的 i18n-worker，也没有写生产。

```text
node --test scripts/cms-source-switchback.test.js scripts/content-source.test.js
9 passed, 0 skipped
```

编辑页加了现有构建状态页的链接，地址是 `https://build2.fei.cx/`。链接旁边写明它不读取发布清单，也不对应某一条修订。页面没有在浏览器里打开，也没有登录状态页。

```text
node --test scripts/cms-save-status.test.js
1 passed, 0 skipped
```

导入的 HTML 正文不能被保存改写。把 `<p>存量 HTML</p>` 换成 Markdown 会返回 400，字节保持不变。只改标题可以，正文仍是原来的 HTML。不带 `<!--markdown-->` 的新文章返回 400。附件 JSON 可以保存。导入程序没有调用编辑器的换行处理。库是 `cms_html`。没有做逐篇转 Markdown。

```text
node --test scripts/cms-html-readonly.test.js
1 passed, 0 skipped
```

没有映射的额外列不会再在导出时消失。`cms_contents.vendor_flag` 的值 `keep-me` 写进 `extra-columns.json`，manifest 列出 `contents.vendor_flag`。兼容表的 `contents.json` 不含这一列。导入这个包退出 1，错误是 `unmapped extra columns: contents.vendor_flag`。没有这列的导出仍是 `extraColumns: {}`。没有读生产库。库是 `cms_extra`。

```text
node --test scripts/cms-extra-columns.test.js
1 passed, 0 skipped
```

标题、slug 和密码超过列宽时保存返回 400，不会截断后写入。这次把会话 `sql_mode` 清掉，数据库本身会截断，应用仍然拒绝。200 个「题」原样读回。201 个「题」没有覆盖原来的标题。33 位密码没有写成新行。库是 `cms_width`。

```text
node --test scripts/cms-column-width.test.js
1 passed, 0 skipped
```

修订快照现在带上内容的创建时间和修改时间，以及当时的字段和关系。第二次保存之后，第一版快照的 JSON 没有变。第二版的创建时间仍是第一版的，修改时间等于当前行。库是 `cms_revobj`。这之前写成的旧修订没有这两个时间字段。

```text
node --test scripts/cms-revision-object.test.js
1 passed, 0 skipped
```

新保存的 `moment_topics` 和 `moment_images` 必须是 JSON 数组，否则返回 400。`示例` 这种旧字符串不会在没提交字段的保存里被改掉。库是 `cms_moment`。导入路径没有改这些历史值。

```text
node --test scripts/cms-moment-fields.test.js
1 passed, 0 skipped
```

发布回执脚本现在跟着来源组选表前缀。默认 Typecho 仍生成 `typecho_i18n_publish_outbox`。`CONTENT_SOURCE=cms` 且 `DB_PREFIX=cms_` 时，不传 `--prefix` 会生成 `cms_` 表。同一次再传 `--prefix typecho_` 退出 64，标准输出里没有 `UPDATE`。这只是打印 SQL，没有执行，也没有切换 release。运行中的 i18n-worker 没有重建。

```text
node --test scripts/cms-observe-source.test.js
1 passed, 0 skipped
```

通用发布队列有了一次性消费程序。它只连接 `127.0.0.1:3307` 上 `cms` 开头的库，也只向本机重建地址发请求。指向 `example.com` 时退出 65，队列仍是 pending。本机返回 202 之后，状态是 accepted，`live` 仍是 false。请求体是 `typecho-content-changed`，没有 `i18n` 字段。没有调用生产上的 rebuild-api。库是 `cms_consume`。

```text
node --test scripts/cms-publish-consume.test.js
1 passed, 0 skipped
```

写请求带了别的来源时会被拒绝。`https://evil.example`、`http://127.0.0.1:9999` 和 `null` 对 `PUT`/`POST` 返回 `cross-origin write refused`。同源 `http://127.0.0.1:4322` 以及没有 Origin 的请求放行。`GET` 不走这条检查。这只测了判断函数，没有启动 CMS，也没有在浏览器里点保存。登录、会话 cookie 和 CSRF token 都还没有。

```text
node --test scripts/cms-origin.test.js
1 passed, 0 skipped
```

写请求有了本地次数上限。同一个来源在 10 秒内超过 40 次写会返回 429。测试里把上限收成 2 次，第三次 `DELETE` 被拒绝，`GET` 不计数。没有把 `CMS_TRUSTED_PROXY` 设成 `127.0.0.1` 或 `::1` 时，`X-Forwarded-For` 和 `X-Real-IP` 不改变限速键。对端不是这个本机代理时也不采信。对端匹配时，用的是转发链最后一跳，不是客户端放在最前面的地址。OpenResty 样例按 `$binary_remote_addr` 给写方法限速，样例没有部署。这次没有启动 CMS，也没有在浏览器里保存。登录、会话和 CSRF token 仍没有。

```text
node --test scripts/cms-rate-limit.test.js scripts/cms-runbook.test.js
4 passed, 0 skipped
```

未完成的通用发布事件在回迁计划里收成一次受控重建。`pending`、`sending` 和 `failed` 合成 `requests: 1`，并列出这些事件的 id。`accepted` 不计入。没有一份覆盖同一组 id 的接收证据时，不能把这些事件标成可以放下；事件状态保持原样。导出和 dry-run 回迁都带上这个计划。隔离库是 `cms_cli` 和 `typecho_restore`。没有发重建请求，也没有写生产。

```text
node --test scripts/cms-controlled-rebuild.test.js scripts/cms-migration-cli.test.js
4 passed, 0 skipped
```

回迁到隔离的 `typecho_restore` 之后，下一号会停在保留 id 的后面。内容、分类、译文版本、翻译任务和译文发布事件都是这样。例如内容的 `AUTO_INCREMENT` 等于当前最大 cid 加 1。删掉的旧行不会把下一号留在那个已删除 id 上。库是 `cms_cli` 和 `typecho_restore`。没有写生产。

```text
node --test scripts/cms-migration-cli.test.js
3 passed, 0 skipped
```

冻结快照 `snapshot-1786673780` 在仓库外建成了一份 Astro dist。工作目录是 `/tmp/cms-shadow-dist`，产物在 `site/astro/dist`，`index.html` 存在。构建完成 50 页，Pagefind 中文索引 15 页。仓库里的 `astro/dist`、`data/route-map.json`、`data/meta-route-map.json` 和 `astro/src/content` 没有变化。没有切换 release，没有清 CDN。这不是 Typecho 和 CMS 两份 dist 的对拍，也不是生产影子。不设 `SHADOW_BUILD_DIST=1` 时，脚本仍退出 65。

```text
node --test scripts/cms-shadow-build.test.js
1 passed, 0 skipped
```

```text
SHADOW_BUILD_DIST=1 SHADOW_WORK=/tmp/cms-shadow-dist SNAPSHOT_EPOCH=1786673780 cms-shadow-build.sh
exit 0
```

同一份脱敏包从 `typecho_restore` 和 `cms_distpair` 导出的构建快照没有字段差异。第一次仓库外构建退出 65：`postssample.md` 的摘要「正文示例」只有 4 个字，站点要求至少 24 个字。

```text
node --test scripts/cms-shadow-dist-pair.test.js
1 failed, 0 passed
```

补上同一段说明之后再构建，又退出 65。样本正文没有 Mermaid，`astro/public/beoe` 不会生成，复制脚本仍把它当成渲染失败。

```text
node --test scripts/cms-shadow-dist-pair.test.js
1 failed, 0 passed
```

没有 Mermaid 围栏时，缺少 `public/beoe` 现在记为 `copied: 0` 并继续。正文里有围栏而目录缺失时仍然退出 65。两边快照在构建前补了同一段摘要说明，样本包和数据库里的原文没有改。两份 dist 没有缺失文件，也没有哈希差异。仓库的 `astro/dist` 和两份路由表没有变化。没有切换 release，没有清 CDN。

```text
node --test scripts/copy-beoe-to-dist.test.js
2 passed, 0 skipped
```

```text
node --test scripts/cms-shadow-dist-pair.test.js
1 passed, 0 skipped
```

保存接口现在会收下请求体里的字段、分类关系和密码。没带这些键的保存不会清掉原来的字段和关系。带上空数组会清掉。库是 `cms_writeapi`。这次没有启动 CMS，也没有在浏览器里保存。

```text
node --test scripts/cms-content-write.test.js
1 passed, 0 skipped
```

文章和分类的 HTTP 处理函数现在会写隔离库 `cms_http`。`POST /api/metas` 建了分类，`PUT /api/contents/8` 把这篇文章挂上该分类，`DELETE` 用对的 `baseRevision` 删掉文章并留下 `op=delete` 的发布事件。错的分类 slug 返回 409，对的 slug 才删掉分类。每次请求从连接池取出一条连接再开事务；连接池本身没有 `beginTransaction`。CMS 进程没有启动，编辑器里也没有删除按钮。

```text
node --test scripts/cms-http-write.test.js
1 passed, 0 skipped
```

评论、引用和订阅现在随保存写入。请求里的 `0`/`1`、布尔值会收成 `'0'` 或 `'1'`。没带这些键时，新建仍是评论开、引用关、订阅开，已有文章保持原值。改订阅会记进该次修订；公开文章这次保存仍入队 `update`。非法值返回 400。库是 `cms_flags`。编辑器页面还不会发送这三项。

```text
node --test scripts/cms-content-write.test.js
2 passed, 0 skipped
```

管理员初始化依赖已锁在 `@simplewebauthn/server` 14.0.3。凭据表按该版本的 `WebAuthnCredential` 保存 id、publicKey、counter、transports，另加 aaguid、fmt、device type、backed up 和 user verification。离线命令只把 secret 的 sha256 写入 `cms_auth_bootstrap`，明文只打印一次，15 分钟内有效，且只能有一条未使用的 secret。空库不带 secret 会返回 403，不会写入 challenge。伪造的注册响应返回 400，challenge 记为已用，secret 仍可再用，管理员行不会出现。过期 secret 会被拒绝。库是 `cms_auth` 和 `cms_authcli`。没有完成一次真实 passkey 注册，也没有会话或 TOTP。

```text
node --test scripts/cms-auth-bootstrap.test.js scripts/cms-schema-steps.test.js
3 passed, 0 skipped
```

同一套校验接受了一份本地生成的 `none` 认证。没有用户验证标志的响应返回 400，secret 仍可再用，管理员行不会出现。带用户验证的 ES256 响应写入凭据：counter 为 0，transport 是 `internal`，设备类型是 `singleDevice`，没有备份。secret 用完后不能再注册，也不能换一条新的 secret。审计记录里没有 secret 明文。这不是浏览器或安全密钥注册，也没有会话。库是 `cms_authpass`。

```text
node --test scripts/cms-auth-bootstrap.test.js
3 passed, 0 skipped
```

登录校验接受同一把 ES256 密钥签出的断言。没有用户验证标志的断言返回 400，counter 保持 0。通过的登录把 counter 记为 1，并写入会话：库里只存 token 的 sha256，cookie 名是 `__Host-cms`，带 `Path=/`、`HttpOnly`、`Secure`、`SameSite=Strict`，没有 `Domain`。空闲上限 12 小时，绝对上限 7 天。把 counter 停在 1 再签一次会返回 400，counter 和会话行数都不变。还没有管理员时不会写入登录 challenge。这仍是本地签名，不是浏览器登录。写接口还没有要求这个会话。库是 `cms_authlogin`。

```text
node --test scripts/cms-auth-bootstrap.test.js scripts/cms-schema-steps.test.js
5 passed, 0 skipped
```

写请求现在要带登录 cookie 和 `x-csrf-token`。库里只存 CSRF token 的 sha256。cookie 缺失返回 401，token 不对返回 403，绝对过期返回 401。对的请求会把空闲截止往后推，但不会超过绝对截止；错误的 token 不会改这个截止。预览、登录和注册这三条路径不要求会话。编辑器页面还不会带 cookie 或 token，所以经过这层检查的保存会是 401。这次没有启动 CMS。库仍是 `cms_authlogin`。

```text
node --test scripts/cms-auth-bootstrap.test.js scripts/cms-schema-steps.test.js
5 passed, 0 skipped
```

再次登录会作废之前的会话。添加或撤销 passkey 必须在最近 5 分钟内重新认证过；超过这个窗口返回 403，也不会写入添加 challenge。重新认证之后可以加上第二把密钥，选项里排除已有的凭据。撤销正在使用的那把会作废它的会话。只剩最后一把时撤销返回 409，这一行还在。登出会作废当前会话。库是 `cms_authkeys`。这仍是本地签名，不是浏览器里的再认证。

```text
node --test scripts/cms-auth-bootstrap.test.js scripts/cms-schema-steps.test.js
6 passed, 0 skipped
```

TOTP 要在已登录且 5 分钟内重新认证过之后才能启用。库里的密钥是用 32 字节外部密钥做的 AES-256-GCM 密文，恢复码只存 sha256。连续 5 次失败后返回 429。同一时间步再提交一次会拒绝。恢复成功会作废原来的会话，并发一张 10 分钟的重绑 cookie；这张 cookie 不能写文章，但可以开始添加 passkey。管理员还在时，注册入口仍然是 403。离线命令另发一条一次性重绑 secret，只打印明文、只存哈希，不会删掉管理员。审计里没有密钥和恢复码。没有发邮件。库是 `cms_authtotp` 和 `cms_authoffline`。

```text
node --test scripts/cms-auth-totp.test.js scripts/cms-schema-steps.test.js scripts/cms-auth-bootstrap.test.js
8 passed, 0 skipped
```

重绑会话确认一把新 passkey 之后，其余凭据会被删掉，其它未作废的会话也会作废。当前这张重绑会话改绑到新凭据，并且仍然不能写文章。普通登录加上第二把密钥时不会删掉第一把。库仍是 `cms_authtotp` 和 `cms_authkeys`。这仍是本地签名，不是浏览器里的确认。

```text
node --test scripts/cms-auth-totp.test.js --test-name-pattern "last passkey" scripts/cms-auth-bootstrap.test.js
7 passed, 0 skipped
```

CMS 页面现在自己发送 CSP，不沿用 www 那份。后台 `script-src` / `style-src` 带 Astro 算出来的 sha256，另外加一次性 nonce，给编辑器运行时插入的样式用。`script-src-attr` 和 `style-src-attr` 是 `'none'`。后台 `frame-src` 只有 `'self'`，`img-src` 只有 `'self' data: blob:`，`connect-src` 只有 `'self'`。预览文档才允许多出 `https:` 图片，以及 `player.bilibili.com` 和 `music.163.com`。`frame-ancestors` 是 `'self'`，这样编辑页能嵌入预览。接口响应是 `default-src 'none'`。OpenResty 样例不写 `Content-Security-Policy`。写请求的 `Origin` 必须是 `http://127.0.0.1:4322`；适配器把请求主机改写成 `localhost` 时，这个来源仍然接受。

构建后的页面在 `127.0.0.1:4323` 上对过一次：编辑页样式哈希 `sha256-kCdjLBVmOup6d+VMuj5/ZgXUJotxyXCZSOE+QRJxpyM=` 在响应头里，预览页内联脚本带了和响应头相同的 nonce，预览 iframe 仍是 `sandbox="allow-scripts"`，父页面读不到它的文档。这个临时进程已经停掉。开发服务器 `127.0.0.1:4322` 上，编辑器能输入，预览 `POST` 返回 200。手感仍待试用。没有启动生产构建，也没有清 CDN。

```text
node --test scripts/cms-csp.test.js scripts/cms-origin.test.js
4 passed, 0 skipped
```

登录、注册、恢复、登出、重新认证、凭据和 TOTP 现在有 HTTP 入口。注册不带一次性 secret 返回 403，不会写入 challenge。登录成功的响应把 `__Host-cms` 放在 `Set-Cookie`，正文只返回 CSRF token，不返回会话 token。没有 cookie 的文章写请求返回 401；登录和恢复入口不要求会话；添加凭据仍要求会话。登出之后原来的 cookie 不能再写。还没启用 TOTP 时，恢复入口返回 403。库是 `cms_authhttp`。这仍是本地签名，不是浏览器登录。编辑器页面还不会带 cookie 或 CSRF。

```text
node --test scripts/cms-auth-http.test.js scripts/cms-csp.test.js
4 passed, 0 skipped
```

编辑器保存会带上 `sessionStorage` 里的 CSRF token，并带上同源 cookie。没有登录时保存返回 401，页面写「需要登录。这次保存没有写入。」登录页会向 `/api/auth/login` 发开始请求。本机开发服务器上点了登录，返回 `admin is not initialized`，没有弹出或完成 passkey。库里的默认 CMS 库没有管理员。手感仍待试用。

```text
node --test scripts/cms-editor-auth.test.js
1 passed, 0 skipped
```

图片上传走 `POST /api/media`。没有会话返回 401，CSRF 不对返回 403，SVG 返回 400，超过 5MB 返回 413，这些请求都没有写入。通过的 JPEG 只存 `mock://unverified/`，`provider` 是 `unverified`，宽高是空的。同一张图再传一次命中原来的行。审计里没有图片字节。没有访问图床，也没有用 sharp 重编码。库是 `cms_mediahttp`。

```text
node --test scripts/cms-media-http.test.js
1 passed, 0 skipped
```

静止 JPEG 和 PNG 现在会先用 sharp 0.34.4 重编码，再按编码后的字节算 sha256。1×1 的图写入宽 1、高 1。边长超过 8000 或像素超过 1600 万返回 400，不写入。GIF 和带 `acTL` 的 PNG 仍在解码前拒绝，没有变成静图。地址仍是 `mock://unverified/`，`provider` 仍是 `unverified`。处理超时设为 5 秒。没有访问图床。库是 `cms_media_mock` 和 `cms_mediahttp`。

```text
node --test scripts/cms-media-mock.test.js scripts/cms-media-http.test.js scripts/cms-audit.test.js
3 passed, 0 skipped
```

登录页可以提交初始化 secret。空 secret 在本机页面上返回 `bootstrap secret required`，没有开始 passkey 注册。`GET /api/auth/notices` 只返回 `auth.recover` 和 `auth.offline-rebind` 的动作和时间，不返回审计明细。登录页在没有这类记录时显示「没有本地恢复通知。没有发邮件。」这条读取不要求会话。没有发邮件。库是 `cms_authnote`。没有完成浏览器 passkey 注册。

```text
node --test scripts/cms-auth-notice.test.js
1 passed, 0 skipped
```

未完成的通用发布事件现在可以对 `127.0.0.1` 发一次重建请求。请求体仍是 `typecho-content-changed`、ts 和 nonce，没有 `i18n`。非本机地址在发出前拒绝。500 不产生接收证据，事件文件保持原样。只有 202 才给出覆盖同一组 id 的证据，事件状态仍是原来的 `pending`。没有写生产，也没有触发正式重建。

```text
node --test scripts/cms-controlled-rebuild.test.js
2 passed, 0 skipped
```

重新认证、添加或撤销 passkey、启用 TOTP 现在走 HTTP 入口。登录后的会话可以启用 TOTP，响应里有一次性 base32 secret 和 8 个恢复码，没有会话 token，也没有加密密钥。把再认证时间拨早 5 分钟后，添加凭据返回 403，不会写入 credential challenge。重新认证成功后可以加上第二把凭据，撤销最后一把返回 409，库里仍剩一把。恢复入口在启用前返回 403；启用后用 TOTP 和未用恢复码换到 `Max-Age=600` 的重绑 cookie。这张 cookie 对文章 `PUT` 返回 `rebind session cannot write`，但仍能开始添加凭据。库仍是 `cms_authhttp`。这仍是本地签名，不是浏览器或验证器应用。

```text
node --test scripts/cms-auth-http.test.js
1 passed, 0 skipped
```

重绑会话确认一把新 passkey 之后，HTTP 入口会删掉原来的凭据，只留新的一把，并把当前重绑会话改绑过去。文章 `PUT` 仍然返回 `rebind session cannot write`。库仍是 `cms_authhttp`。这仍是本地签名。

本地原型库 `cms` 里没有管理员。一次未使用的初始化 secret 已清掉，没有在浏览器里提交，也没有完成 passkey 注册。

```text
node --test scripts/cms-auth-http.test.js
1 passed, 0 skipped
```

文章修订可以经 `POST /api/contents/:cid` 恢复。请求要带当前 `baseRevision` 和要恢复的 `revision`。本机把第二版恢复成第一版之后，正文回到第一版，修订号变成 3，通用队列新增一条 `update`，状态不是 `accepted`。过期的 `baseRevision` 返回 409，正文不变。重绑会话返回 `rebind session cannot write`，不会调用恢复。响应里没有 password。库是 `cms_revhttp`。编辑器页面还没有恢复按钮。手感仍待试用。

```text
node --test scripts/cms-revision-http.test.js
1 passed, 0 skipped
```

译文批准和停用现在走 `POST /api/translations`。摘要不符返回 409，批准指针留在 version 10。摘要相符时指针改到 version 11，译文队列写入一条 `pending`，通用发布队列仍是空的。重绑会话返回 `rebind session cannot write`，指针不变。停用后这篇译文的发布状态是 `disabled`，刚入队的译文事件变成 `cancelled`。库是 `cms_i18nhttp`。编辑器页面还没有批准按钮。手感仍待试用。

```text
node --test scripts/cms-translation-http.test.js
1 passed, 0 skipped
```

译文列表也走这个入口。没有会话时 `GET /api/translations` 返回 401，响应里没有草稿正文。登录后能读到 version 11 的正文和摘要，停用后的发布状态是 `disabled`。库仍是 `cms_i18nhttp`。编辑器页面还没有译文列表。手感仍待试用。

```text
node --test scripts/cms-translation-http.test.js
1 passed, 0 skipped
```

正式预览请求现在是本地模拟。`POST /api/preview-jobs` 要登录。请求里如果带了重建地址，返回 400，不会写审计，也不会发出请求。修订号相符时只记一条 `preview.simulate`，响应是 `simulated: true`、`live: false`、`dist: null`。正文修订号和通用发布队列行数都不变。过期修订返回 409。重绑会话返回 `rebind session cannot write`。响应和审计里都没有正文。库是 `cms_previewhttp`。没有构建 dist，没有切换 release，也没有清 CDN。编辑器页面还没有这个按钮。手感仍待试用。

```text
node --test scripts/cms-preview-job.test.js
1 passed, 0 skipped
```

读取文章现在也要登录。没有会话时 `GET /api/contents/:cid` 返回 401，响应里没有正文和密码。带上会话和 CSRF 才能读到。编辑器打开时会带上已保存的 CSRF；本机开发服务器上未登录打开 `/edit/1/`，状态是「需要登录。这篇正文没有读出。手感仍待试用。」没有把正文放进编辑器。库是 `cms_readhttp`。手感仍待试用。

```text
node --test scripts/cms-content-read.test.js
1 passed, 0 skipped
```

P0/P1 之后的人工复核，按已经看到的缺口估，不沿用 4–6 周：

| 模块 | 人工复核 | 说明 |
| --- | --- | --- |
| 编辑器手感 | 等用户写一篇 | 不能用本地测试代替 |
| MySQL 保存读回 | 已在 127.0.0.1:3307 跑过 | 2026-10-11，6 passed |
| P2 表、导入导出、outbox、登录 | 导入失败、回迁、增改删后再回迁、按来源导出的构建快照、备份清单、发布崩溃重试、译文批准、worker 陈旧写回、修订恢复已在 3307 上跑过。离线 bootstrap 与离线重绑 secret 只存 hash。本地 none 认证、签名登录、会话轮换、第二把 passkey、TOTP 恢复码哈希和重绑会话已在 3307 上跑过。重绑确认新凭据后会删掉其余凭据。CMS 自己的 CSP 已在本地页面响应头里对过。登录和注册的 HTTP 入口在 `cms_authhttp` 上跑过。编辑器保存会带 CSRF；未登录时页面提示需要登录。上传接口在 `cms_mediahttp` 上要求会话。静止图会先 sharp 重编码再哈希，结果仍是未验证 mock。登录页会提交初始化 secret；空 secret 被拒绝。恢复通知只显示动作和时间，没有发邮件。未完成发布事件可以对 127.0.0.1 收成一次请求，202 才是证据，行本身保持原状态。重新认证、凭据增删和 TOTP 启用已走 HTTP；重绑确认新凭据后只留新的一把，并且仍不能写文章。文章修订可以经已登录的 HTTP 恢复，过期修订返回 409。译文批准走已登录的 HTTP，摘要不符返回 409，事件只进译文队列。译文草稿正文没有会话时读不到。正式预览请求只在本地记一条模拟，不构建 dist。未登录时读不到文章正文和密码 | 还没有浏览器或安全密钥登录，也没有验证器应用。重绑会话不能写文章。图床只是未验证的 mock。默认仍是 Typecho。运行中的 i18n-worker 容器没有重建 |
| 影子和生产 | 本地 Typecho 只读导出再镜像、dry-run、拒写，以及仓库外的冻结快照同步已跑过。`snapshot-1786673780` 在 `/tmp/cms-shadow-dist` 建成 dist。同一脱敏包的 Typecho 与 CMS dist 哈希一致 | 生产影子未授权。仓库里没有 `astro/dist`。构建前给过短摘要补了同一段说明。不估观察日。手册没有在生产执行 |
