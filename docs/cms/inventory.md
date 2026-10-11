# P0 库存

日期：2026-10-11。范围：本仓库 `dc671431fd1dea9521eac735bb37691dfe825a49` 上的导出器和两份已提交 fixture。没有查询生产库，没有核对 Lsky、off-box 或线上权限。下面的行数不是生产事实。

## 基线

| 项 | 值 |
| --- | --- |
| 代码 | `dc671431fd1dea9521eac735bb37691dfe825a49` |
| Node | v24.16.0，要求 `>=22.12.0` |
| Astro | lockfile `7.1.6`。`astro/package.json` 没有 `@astrojs/node` 或其他 SSR adapter。访客站仍是静态构建 |
| mysql2 | lockfile `3.23.2` |
| 根 lockfile sha256 | `9590f7e7153940945c80439c6cdd98f6d3017f2dba4e00e0481b33d2e2c0e09d` |
| Astro lockfile sha256 | `9b925428a12ed64c7f02f06874efd348dff7774ebb06abff3f517700e5b7154f` |

原主工作区 `C:\Users\AndyYan\Desktop\cursor\andy-blog` 在开工时与 `origin/main` 分叉：本地多 `70837a4`（语言切换触控尺寸），远端多本方案文档提交。工作区还有未提交的 `astro/src/components/HomeNetwork.astro`，以及未跟踪的 `.codex-shanghai-inspect.sh` 和 `drafts/`。这些都留在原工作区，没有拿来当基线，也没有丢弃。

## 构建快照实际列

`export-typecho-snapshot.js` 已写 `schemaVersion: 2`。contents 只取 `post`、`page`、`post_draft`，列为 `cid/type/title/slug/text/created/modified/allowComment/allowFeed/order/template/password/status`。相对 Typecho 1.2.1 `install/Mysql.sql` 的 `typecho_contents`，构建快照不带 `authorId`、`commentsNum`、`allowPing`、`parent`。

relations 是关系主键加上 meta 的 `name/slug/type/order`，SQL 没有按内容类型过滤。fields 导出全部行和 `str_value/int_value/float_value`。metas 只要 `category` 和 `tag`，不带 `parent`。

i18n 四块是 `sourceState`、`heads`、`versions`、`ledger`。versions 只含 `approved_version_id` 指向的行。`draft_version_id` 可以不在 versions 里。任务表、译文 outbox 和 `i18n_migrations` 不进构建快照。

`jsonSafeRow` 和私有包导出遇到超出安全整数的 bigint 会报错，不再用 `Number()` 舍入。导出连接对 `BIGINT` 使用同一检查，超限时错误里保留原来的十进制数字。普通范围内的整数仍写成 JSON number。

## 两份旧 fixture

两份都没有 `schemaVersion`，也都没有 i18n。升级只加版本并按构建契约过滤，不改原文件。

| fixture | contents | 过滤 | 其他 |
| --- | --- | --- | --- |
| `snapshot-1785565762.json` | 22，其中 page 3、post 15、post_draft 2、attachment 2 | cid 35、36，type `attachment`，status `publish`。过滤后 20 行 | `allowComment`/`allowFeed` 是 number。2 行 HTML 就是这两条附件。fields/metas 会按导出器排序重排。relations 38、fields 111、metas 13 原样保留，所以附件 cid 的字段和关系可以留在构建快照里 |
| `snapshot-1786673780.json` | 15，page 3、post 12 | 0 | `allowComment`/`allowFeed` 是 string。全部带 `<!--markdown-->`。没有 post_draft、attachment 或 moment 字段。metas 会重排 |

字段名：较早一份有 `abstract`、`content_kind`、`description`、`keywords`、`mode`、`moment_images`、`moment_topics`、`thumb`、`video`。较新一份没有 moment 三个字段和 `content_kind`。两份都没有 `astroPath`。字段 type 都是 `str`，三种值列都在。五个编辑控件不是迁移白名单。

`allowComment` 在两份 fixture 里分别是 number 和 string，对应 MySQL `char(1)` 经不同驱动序列化。校验两种都接受。对拍把 `1` 和 `"1"` 当成类型差异，升级脚本不自行转换。

用当前 `data/route-map.json` 跑 `CONTENT_BACKUP_DIR` 时，`snapshot-1785565762.json` 会在 cid 9001 停下：这条 moment 在路由表里是 `disposition=gone`，同步拒绝复活。这与缺 `schemaVersion` 无关。`snapshot-1786673780.json` 可以在同一路由和 meta 基线上连续导出两份相同 Markdown，且不改路由文件。两次运行共用 `astro/.cache` 的 staging 目录，输出目录相同不等于工作树隔离。

## 私有迁移包需要而构建快照没有的部分

完整 contents 使用 Typecho 1.2.1 的 17 列，并保留 `page_draft`、`attachment` 以及其他显式列入 `recognizedContentTypes` 的类型。未识别类型是错误，不能删掉。metas 保留 `parent`。relationships 只存 `cid/mid`。i18n 六张业务表加 `i18n_migrations` 都要全行；draft 和 approved 指针必须能落到 versions。

不打包 `typecho_users`、`typecho_options`、`typecho_comments`。前两张可能含密码、会话和插件密钥；评论在 Waline。生产上若还有额外列，导出会把列名写入 manifest 的 `extraColumns`，并把主键和原值写入 `extra-columns.json`。导入和回迁看到这些列名会停住，不会把值丢掉后继续。这次仍然没有读生产库。

附件元数据来自 `type=attachment` 的 contents 行，并另写 `attachments/rows.json`。旧上传文件只记录路径、长度和 sha256。脱敏样本里的 `usr/uploads/sample.txt` 是假文件。
