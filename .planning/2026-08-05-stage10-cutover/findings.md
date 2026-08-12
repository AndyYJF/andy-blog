# Findings — Stage 10 continuation

## 2026-08-10 next-step recovery

- The top status block is authoritative over stale historical Phase 12–15 rows: CMS/editor, Waline admin, management deployment, registration rejection, and moderation are already deployed. Remaining Stage 10 work is the 302 observation/legacy mismatch, real dual-CDN purge, controlled disk reclamation, then a separately authorized 301 release after all gates pass.
- `host/cdn-purge.sh` is still an intentional fail-closed stub: when credentials exist it records `not-implemented` and exits 71. It currently lists only six canonical surfaces, so a real implementation must also cover the exact legacy URLs whose cached 200 responses are blocking the observation gate.
- Official Cloudflare API contract: `POST /client/v4/zones/{zone_id}/purge_cache` with a Bearer token having Cache Purge permission and a JSON `files` array of full UTF-8 URLs; success requires both HTTP success and response `success=true`. Single-file purge is recommended and must use the end-user URL, including query strings that participate in the cache key.
- Official Aliyun CDN contract: `RefreshObjectCaches` API version `2018-05-10`, required `ObjectPath`, optional `ObjectType`; multiple URLs are newline-separated and a request accepts up to 1000 URLs. A successful response contains both `RefreshTaskId` and `RequestId`. Native OpenAPI Signature V3 uses `ACS3-HMAC-SHA256` headers and is preferred over the older RPC V1 signature.
- Purge must remain bounded to `www.andy-y.cn` and exact committed legacy/canonical surfaces. It must never use purge-everything, hostname-wide, wildcard, or prefix purge merely to make the observation gate green.
- `RefreshObjectCaches` is a POST form-style operation; URL-file refresh accepts up to 1000 entries per call, normally takes about 5–6 minutes to propagate, and returns a task ID rather than proving edge completion. The later three-vantage matrix must remain the actual acceptance evidence.
- Current immutable releases do not include `data/legacy-url-map.json`; `host/cdn-purge.sh` therefore cannot safely reconstruct a release-specific purge set from the live source checkout. The build must generate and embed a deterministic purge-plan artifact in each release, and the host script must verify the plan belongs to the requested release before calling either API.
- Production uses a 1Panel adapter, while generic `host/switch-release.sh` still assumes repository Compose Nginx. The 302 mapping deployment must reuse the reviewed 1Panel-specific build/switch path rather than call this generic switcher or start repository Nginx.
- Cloudflare's current single-file limit is 100 URLs per request for non-Enterprise plans and 500 for Enterprise. Use conservative batches of 100 so the same artifact works on the current unknown plan without hostname-wide invalidation.
- Existing Stage 5/10 gates are intentionally tied to the old stub (`not-implemented`, exit 71). Replacing the stub requires converting those assertions to behavioral tests: exact-host plan validation, official Aliyun signing vector, provider success parsing, partial-batch resume, missing-credential failure, and a guarantee that no provider can be marked `ok` before a real response is validated.
- Aliyun V3 canonical headers require a terminating blank line before `SignedHeaders`. Without that separator the local canonical hash was `95d7...`; adding it produces the official `7ea06492...` canonical hash and therefore the published `06563a9e...` signature vector. The expected value was not weakened.
- Generic rebuild behavior already treats a purge failure as `edge-pending` after the release switch and does not claim purge success. Production 1Panel deployment remains separate: deploy/reload origin first, call exact-URL purge second, then wait for propagation and collect the matrix. Provider acceptance IDs alone do not satisfy the observation gate.
- The tracked host purge script was mode `100644`, while generic rebuild invokes it only when `-x` is true. Real integration therefore also requires committing mode `100755`; otherwise the new API client would remain silently skipped on a fresh Linux checkout.
- The only remaining non-historical `not-implemented` wording was the Stage 5 baseline report; it has been updated. Historical adversarial prompt records remain unchanged because they accurately describe the old defect.
- The established production-safe release path is `host/blog-rebuild-1panel.sh` → `host/switch-release-1panel.sh`; the generic switcher assumes repository Nginx and is out of scope. A mapping repair authorization packet should couple that 1Panel release switch with a separately backed-up/generated www vhost and one OpenResty config-test/reload.
- `switch-release-1panel.sh` deliberately refuses any Nginx policy diff and cannot reload OpenResty. Therefore the decoded mapping repair cannot be deployed through an ordinary article rebuild. It needs a dedicated bounded runner that validates an exact one-line map change, backs up the active vhost, tests/reloads 1Panel OpenResty, switches the 302+enabled release, verifies origin, and restores both vhost and symlink on failure.
- The repository does not encode the live 1Panel OpenResty container/test command. A single authorized read-only VPS preflight must discover the active container/binary/mounts rather than guessing or starting repository Nginx.
- Default SSH key discovery does not select the Stage 10 key on this workstation. Future bounded VPS sessions must explicitly use `C:\Users\AndyYan\.ssh\andy_blog_stage10_ed25519`; password fallback remains disabled.
- 2026-08-10T03:47Z live read-only preflight: production is still `current=20260809T123758Z-f7d863f2`, `previous=20260809T102318Z-1db1021e`, `302 + enabled`. Active vhost SHA-256 is `6e9a8b54...99d3e`; encoded map is present and decoded map absent, proving the local repair is not deployed.
- Live OpenResty is container `1Panel-openresty-yR6x`, image `1panel/openresty:1.27.1.2-0-1-focal`; host `/opt/1panel/www/conf.d` is mounted at `/usr/local/openresty/nginx/conf/conf.d`, and the test/reload binary is `/usr/local/openresty/bin/openresty`. A bounded runner can use `docker exec 1Panel-openresty-yR6x /usr/local/openresty/bin/openresty -t` and `-s reload`; it must rediscover/assert the container identity rather than assume repository Nginx.
- Root disk remains 97% used with 1.3G free. Docker reports 11.27G reclaimable images, 1.013G reclaimable volumes, and 266.4M build cache, but these aggregate figures do not identify rollback-safe objects. Production releases total only about 18M, so deleting releases would not materially solve capacity and current/previous must stay.
- Host Node is v18.19.1. The purge runner uses only Node 18-supported ESM/fetch/AbortSignal APIs, but the production execution packet should include a syntax/verify-only check before credentials are loaded because the repository's declared build engine remains Node >=22.
- The queried `andy-blog-rebuild.path` and `andy-blog-reconcile.timer` names were inactive. The actual installed unit names must be discovered before assuming article auto-publish is currently armed; this is a runtime evidence gap, not proof the editor itself is unavailable.
- The actual publishing units are `blog-rebuild-1panel.path` (enabled, active, waiting) and `blog-rebuild-1panel.service` (disabled/inactive between path activations, as expected). The earlier inactive result was solely a wrong unit name; the automatic article publish watcher is currently armed.
- Detailed Docker inventory identifies six dangling images. Five are not referenced by any container: old CMS builder `22d68ae100bf` (4.05G apparent, about 1.321G unique) and old Waline builds `e2a8986b922c`, `964ae2d880ae`, `3f39284af070`, `f1194a323e3a` (about 291M unique each). Dangling `76c326b05dc3` is still used by the `easytier-easytier-1` container and must never be removed.
- The unused Waline images may be valuable rollback images and the old builder may preserve a known build toolchain; they are not safe to delete merely because Docker calls them dangling. Build-cache private reclaimable space is only about 266M. Cleanup authorization should name exact image IDs and explicitly choose how many production/staging rollback images to retain.
- Many larger unused named images belong to unrelated services (MaiBot, SillyTavern, adapters, old MySQL, etc.) and are outside the blog task scope. No global `docker image prune -a`, volume prune, or system prune is acceptable.
- Current release manifests prove release ID, snapshot epoch, redirect/comment state and counts, but do not record the source Git revision. The mapping deployment packet must bind the uploaded source archive/builder image to a reviewed commit and independently prove the candidate Nginx line, rather than infer source provenance from a release ID.
- The production builder is source-baked from `docker/builder/Dockerfile` on Node 22.14, while the host only orchestrates it. Adding an OCI revision label via a build argument is the cleanest durable provenance boundary: the dedicated runner can require the builder image label to equal the reviewed commit before it creates a candidate release.
- `compose.1panel-cms.yml` already isolates the builder from 80/443 and repository Nginx; it mounts only the production deploy root and durable runtime. Mapping repair can reuse this builder without installing npm or Chromium on the host.

## 2026-08-10 decoded Nginx URI semantics

- `map $uri` sees a decoded URI. A percent-encoded Chinese path copied verbatim into the generated regex cannot match runtime `/index.php/tag/分析fen-x/`. The generators must decode once, reject CR/LF/NUL, and only then escape for Nginx regex matching. This fixes the shared origin/Aliyun/Cloudflare 404 without changing 302/301 state.
- Static parity checks must normalize the source key before comparing it with generated Nginx literals. Keeping raw-source duplicate checks alone is insufficient because two differently encoded source strings can collapse to the same `$uri`; the gate now tracks both raw and decoded keys.
- The 2026-08-10 capture is still a hard FAIL even after the local fix: Aliyun passed 0/140 legacy rows, and the decoded-path correction has not been deployed. `current` and `previous` are both present now, so the earlier missing-previous blocker is historical rather than current.

## 2026-08-09 CMS/comment management local closeout

- Read-only production facts: Typecho is `1Panel-typecho-f31a`, bind root `/opt/1panel/apps/typecho/typecho/data`, HTTP loopback `8080`, and all three reviewed admin-origin input hashes match exactly.
- Production Waline working directory is `/var/www/andy-blog`; its direct upstream `127.0.0.1:8361/ui/` returns 200. The public policy wrapper remains on 8360.
- `cms.andy-y.cn` and `comments.andy-y.cn` have no DNS records yet, so production cannot be called complete until the authorized deploy window creates direct A records and installs both vhosts.
- Added a source-baked Node/Chromium builder, private rebuild API Compose, durable 1Panel consumer, checksum/state/atomic switch guard, and systemd path unit. Automatic publishing is hard-locked to 302/enabled and never invokes repository nginx/CDN purge/comment migration.
- Added protected CMS and Waline management vhost generators. Comment management reaches the direct Waline upstream through loopback 8362; public comment writes still traverse the policy wrapper on 8360.
- Added hash-pinned Typecho plugin deployment/activation helper. Remote patch inputs and PHP extensions are ready; actual files/DB remain unchanged pending authorization.
- Targeted result: CMS management tests 6/6 PASS, Stage 5 gate PASS, Stage 10 gate PASS, Bash syntax PASS, Compose YAML parse PASS.

## 2026-08-09 CMS and comment management completion

- 生产评论写入核心链已完成，但“评论管理系统”还缺受控管理入口与管理员初始化/回滚说明；不得用 staging Waline 管理面或合并其数据库。
- Typecho 容器仍在 `127.0.0.1:8080`，只能证明源程序继续运行，不能证明 `cms.andy-y.cn` 的登录、上传、permalink、状态回跳和 Joe 资源纵向已经完成。
- `docs/plan.md` 将完整文章发布定义为 Typecho lifecycle hook → HMAC/replay-safe rebuild API → durable pending/dirty queue → host systemd consumer → immutable release；普通 job 必须继承当前 `redirect-status=302` 与 `comment-write-mode=enabled`。
- 当前仓库已有 rebuild-api、AutoRebuild、host rebuild/systemd 和 Typecho siteUrl patch 脚手架，应优先补齐并复用这些组件，不重写整套系统。
- 本轮先完成仓库实现、行为测试、1Panel adapter、回滚和单次授权包；未获新授权前不修改 DNS、证书、OpenResty、Typecho 容器或 production Waline 管理配置。
- 仓库已存在可复用的 `docker/rebuild-api`、`AutoRebuild`、`host/blog-rebuild.sh`、systemd path/service/timer、Typecho siteUrl patch 和 production Waline wrapper；主要缺口是把通用 Compose/Nginx 假设改成 1Panel 生产 adapter，并补管理入口纵向契约。
- `compose.1panel-production.yml` 当前只覆盖 production Waline；CMS、rebuild-api 和 host consumer 尚未形成 1Panel 专用部署拓扑。文章编辑/发布不能仅靠现有 Typecho loopback 存活状态宣称完成。
- public Waline wrapper 会对除评论写入以外的 `/api/*` mutation 返回 403；这对公网是正确的，但也意味着把 `/ui` 放在同一 `8360` 端口不能形成可用管理后台。最小安全拓扑是保留 `8360` 公网策略端口，另映射仅 loopback 的 upstream 管理端口，并由受保护的独立管理域名反代。
- 生产 Typecho 已由 1Panel 独立运行在 `127.0.0.1:8080`，最快路径不是启动仓库 `typecho`/`nginx` Compose，而是生成严格路径范围的 CMS reverse-proxy adapter，并把现有 admin-origin patch/常量以可回滚方式应用到该实例。
- 通用 `generate-nginx.js` 仍生成 Compose `fastcgi_pass typecho:9000` CMS vhost，并把 public `/ui` 代理到受策略 wrapper；两者都不适合当前 1Panel 生产。需要独立生成 CMS reverse-proxy vhost和评论管理 vhost，不能把通用 release 配置直接上线。
- 通用 `host/blog-rebuild.sh` 依赖 `compose.yml` builder、`switch-release.sh` 和仓库 Nginx 容器；当前 VPS 没有 host npm，生产也禁止启动该 Nginx。需新增 1Panel consumer：可复用 builder 服务，但切换只做 release 校验/相对 symlink；配置树不变时不 reload，CDN stub 不得阻止正文 release 成功。
- 当前 builder Dockerfile 只是基础镜像骨架，没有 COPY/install/Chromium 层；直接在 VPS `docker compose run builder` 不能保证可构建。1Panel 自动发布包必须固定可执行 builder image 或提供另一个已校验构建路径。
- 选定最小自动发布拓扑：builder image 在镜像构建时 COPY 已提交源码并安装 root/Astro 依赖与 Chromium，运行时只挂 production deploy root 和 durable runtime；这样构建不会污染 host Git worktree，也不依赖 VPS host npm。
- 1Panel consumer 将拒绝任何 Nginx tree 变化，只允许正文/内容 release 在现有 OpenResty vhost 下原子切换；状态文件必须已存在且与当前 manifest 一致，普通 job 不提供 302/enabled 默认值。
- `build-release.sh` 当前在切换前清除 pending；1Panel host consumer 必须在 build/switch 失败时重新写入 pending，并保留同一 job descriptor/cutoff，避免 webhook 静默丢失。

## 2026-08-09 observation collector continuation

- `c398daf` 后工作树干净；Phase 9c 仍等待单独生产授权，因此本轮只推进无需 VPS 写权限的公网 302 观察证据。
- 现有 Phase 10 “completed”仅表示清单与证据模板已落地，不代表 ≥7 天观察门禁已通过；当前 ledger 明确记录 2026-08-09 为 FAIL，原因包括公网 legacy cache 仍返回 200、源站为 302，以及完整三视角 legacy/action 证据未闭合。
- 观察采集器必须严格只做 GET/HEAD 类公网读取，不发送评论 POST、不调用 purge、不连接 staging 数据库，也不得把 2026-08-12 到期时间自动解释成可切 301。
- 仓库不存在独立 `data/action-map.json`；Stage 10 所称 legacy/action 的权威集合就是 `data/legacy-url-map.json`，当前共 140 条 redirect（110 path + 30 query）。query key 形如 `/:47` / `/index.php:47`，实际请求分别是 `/?p=47` / `/index.php?p=47`。
- 现有 `probe-dual-cdn.js` 只比较 direct 与代理路径 body hash，且文档已明确“同一 edge 不算三视角”；它不足以验证逐条 302/Location/单跳终点。新采集器应明确区分公网 DNS edge 与强制 origin IP，只把两者称为两视角，并为未来显式加入真实 Cloudflare vantage 留接口。
- 2026-08-10 recheck confirms Phase 10b still has no dedicated collector. The authoritative matrix remains all 140 entries in `data/legacy-url-map.json` (110 path plus 30 query forms). The collector must write evidence even on FAIL, use only GET/HEAD, validate one-hop status/Location plus unique canonical terminals, and accept explicit origin/Aliyun/Cloudflare endpoints rather than calling a repeated public edge three vantages.
- The observation checklist's old blocker “production deploy has no `previous` marker” is stale: live production now has `previous=20260809T102318Z-1db1021e`. It should be corrected in the next ledger update, while the public legacy 200 versus origin 302 mismatch remains active.
- 2026-08-10 AliDNS DoH resolves `www.andy-y.cn` through `www.andy-y.cn.w.kunlunaq.com` to `117.68.89.36`. HEAD probes confirm origin returns legacy 302 while both explicit Aliyun and normal public DNS return cached 200; the local proxy also reaches Tengine, not Cloudflare, so it must not be mislabeled as the third vantage. Google/Cloudflare direct DoH was unreachable from the local path.
- DoH through the local proxy exposes the overseas DNS branch `cname.517963.xyz` at Cloudflare anycast `104.21.4.96` / `172.67.153.247`. An explicit-SNI HEAD to `104.21.4.96` returns `server=cloudflare` and the correct legacy 302, while explicit Aliyun continues to return cached 200. The three valid collector vantages are therefore origin `139.224.71.200`, Aliyun `117.68.89.36`, and Cloudflare `104.21.4.96`; normal DNS/proxy are supplementary only.
- The first full matrix evidence (`stage10-observation-2026-08-10.json`) correctly proves Aliyun legacy failure but exposed two collector false positives: RSS is XML and has no HTML canonical link, and Cloudflare injects a dynamic `/cdn-cgi/challenge-platform/scripts/jsd/main.js` tail before `</body>`, changing raw HTML hashes without changing origin content. Evidence must retain raw hashes while comparing a narrowly normalized hash that removes only this identified injection.
- One mapping failure is genuine across origin and Cloudflare: `/index.php/tag/%E5%88%86%E6%9E%90fen-x/` returns 404 instead of the committed 302 to `/tag/fen-x/`. This is independent of Aliyun cache and remains a 301 blocker after collector normalization.
- After the narrow collector correction, RSS passes on all three vantages and 29/30 terminals agree. The remaining terminal mismatch is `/posts/asterisk-telephony42/`: origin and Aliyun share the same hash/ETag, while Cloudflare returns a larger transformed body. This needs one targeted transformation inspection; it does not weaken the already-proven FAIL from Aliyun 0/140 legacy agreement and the encoded-tag 404.
- Targeted inspection confirms the article difference is entirely Cloudflare email obfuscation plus its scripts, but Cloudflare uses different randomized hex encodings in the outer `href` and inner `data-cfemail`. The first decoder incorrectly required both tokens to be identical; relaxing only that backreference and decoding the inner token is the required narrow correction.
- The corrected decoder was validated against the live article: raw Cloudflare and origin hashes differ, but their narrowly normalized SHA-256 values are byte-identical. Ordinary HTML and non-HTML content remain untouched in tests, so raw evidence is preserved without treating known reversible edge transforms as source drift.
- Final tracked evidence is generated from committed collector `c2fc069`. It proves release `20260809T123758Z-f7d863f2` and all canonical terminals agree across origin/Aliyun/Cloudflare after documented reversible normalization. The remaining blockers are precise: one encoded-tag mapping 404 at every vantage and Aliyun legacy behavior 0/140; Cloudflare/origin otherwise agree on 139/140.
- The encoded-tag defect is in both Nginx generators: they map percent-encoded `oldPath` text against normalized `$uri`, which is percent-decoded by Nginx. The committed regex therefore contains `%E5...` while runtime `$uri` contains `分析fen-x`. The fix must normalize path keys with `decodeURIComponent`, detect post-normalization conflicts, regenerate 302 config, and keep the evidence request path encoded.
- Repository evidence still does not prove the exact initial cutover second: it only retains the nearby OpenResty backup timestamp `20260805T153148Z`. The day-7 boundary remains provisional/conservative until host logs or history provide stronger evidence.

## 2026-08-09 local review

- §8.5 明确规定 Phase 9c 顺序：评论停写与最终对账为 0 后，先受控跃迁 `comment-write-mode enabled`，再构建/切换独立 release，最后运行时验证开放 key 可写且关闭 key 仍拒绝；301 必须继续作为另一独立 release。
- 当前 Phase 9b 已满足前半段，但 Phase 9c 仍有两个执行设计点必须在授权包中闭合：一是 state 已跃迁而 build/switch 失败时如何恢复 disabled；二是真实开放-key POST 会写入生产 Waline，必须明确限定唯一测试 marker、精确清理与前后计数对账，不能把 400/静态检查冒充“可写”。
- 当前生产 `previous` 在先前只读证据中缺失；Phase 9c runner 必须验证新 release switch 会原子建立可用 previous，且失败分支不能依赖一个执行前不存在的静态 rollback symlink。
- 仓库通用 `host/blog-rebuild.sh` / `host/switch-release.sh` 依赖 base `compose.yml` 的 nginx 容器并会调用 `docker compose exec nginx`；这与生产 1Panel OpenResty 拓扑不兼容，Phase 9c 不得直接运行它们。必须沿用已验证的 1Panel build/upload/atomic symlink adapter，或新增专用 1Panel runner。
- `scripts/build-release.sh` 会从当前 Typecho snapshot 重新生成 manifest/comment policy，因此 Phase 9c release 才能把 CID47 的新 `allowComment=false` 固化进去；只改 host state 而复用旧 release 会让 policy 仍是旧值，不能启用。
- 通用 rebuild 在 switch 后无条件调用未实现的 `cdn-purge.sh`，可能在 release 已切换后 exit 71；Phase 9c 明确排除 purge 时，执行包必须把“已切换但 purge 失败”与“切换失败”分开，不能把 exit 71 当作自动回滚依据。
- Stage 9 的已验证 1Panel 发布路径不是服务器自构建，而是本机生成完整 immutable release tar、上传后在目标站点 release 目录解包并原子更新相对 symlink；旧的本机 helper 仍在 `C:\Users\AndyYan\Desktop\codex`，可作为结构参考，但必须基于当前 HEAD/Typecho snapshot 重新构建，不能复用 2026-08-05 产物。
- `stage10-comment-cutover-plan.md` 明确要求 open-key 真 POST 并把新 native Waline row 与 Typecho mapping 分开记录；正常 rollback 不删除启用后 native comments。授权包应默认保留一条清晰标记的验收评论，而不是擅自直删；若 owner 希望清理，必须把精确清理另列授权。
- 仓库只有 wrapper policy 单元/假 upstream 覆盖，没有固定 Waline 1.41.3 真实 POST response schema 的生产 probe；Phase 9c 不能只解析响应中的假定 `id`。更稳的验收是：唯一 marker + open canonical URL 发一次 POST，随后用生产 DB 精确查 marker 行为 1、Typecho mappings 仍为 2、native count 增加 1，并保存去 PII 的计数/ID 摘要。
- Phase 9b preflight 发现 Typecho `typecho_contents.slug` 对 CID 47 的真实值是 `47`，不是 Astro canonical slug；canonical closed key 仍按 `data/route-map.json` 和 owner 确认使用 `/posts/typecho-joe-mermaid/`。源端写入断言必须锁定 `cid=47/type=post/status=publish/slug=47/allowComment=1`，仅把最后一列改为 0。
- Phase 9b 已完成且无需 scoped sweep：源固定快照含 coid 6（waiting，CID47 canonical）和 coid 11（approved，Stable Diffusion canonical），所以“2 条迁移评论都属于 closed key”是假设错误；最终必须按 route-map 逐条对账，而非只数 closed-key URL。
- 初次用普通 `grep` 过滤 Typecho 全行 TSV 时因二进制字段触发 `binary file matches`，两个空/提示文件可能造成假相等。生产后验改为 `grep -a` 加 Node 逐列比较，并证明 19 列中仅 CID47 `allowComment 1→0`；后续证据不得把普通 grep 的 binary 结果当 PASS。

- 当前分支 `cursor/stage0-8-adversarial-baseline`；planning 进度已提交为 `e07ed40`。
- 本轮开始时 `scripts/migrate-comments.js` 只接受 `--backend memory`，以 Stage 0 fixture 验证算法；该缺口已在后续 Phase 8 本地完成项中补齐为独立 production CLI/backend。
- 现有算法已经覆盖 source hash、幂等 upsert、`pid/rid` 回填、Typecho namespace absent-key sweep、孤儿 / 环检测和第二次运行零变更。
- `docker/waline/schema.sql` 已定义 `wl_Comment` 与 `astro_comment_migration_map(source, legacy_coid, waline_id, source_hash)`，可作为生产事务迁移基础。
- `host/comment-stop-write-checklist.sh` 不会关闭 Typecho 写入，也不会执行生产迁移或对账；步骤 2–5 当前仍是人工占位。
- 生产启用门禁必须同时证明：Typecho 已停写并排空、迁移第二次运行零变更、source/mapping/Waline 数量差为 0、parent graph 差为 0、全局 disabled 时 POST=403、启用后只有开放 commentKey 可写。
- 当前 `astro/.cache/manifest.json` 和本地 comment policy 覆盖 15 个 commentKey，15/15 均为 writable，没有可用于生产 `entry-not-writable` 验收的真实关闭 key；未知 key=403 不能替代关闭 key=403。
- 不应通过把 Typecho 全部内容的 `allowComment` 改为 0 来停写：该字段又是 Astro/Waline 每条 policy 的真相源，后续同步会把所有 key 生成为关闭状态。停写应在 Typecho 评论提交入口 / 网络入口做全局阻断，并保留逐条 `allowComment` 值。
- 301 与评论启用必须是两个独立 release；当前禁止切 301。

## Decisions pending evidence

- VPS preflight 已核对 Typecho 表前缀/字符集及 production Waline 空 schema；凭证继续只从 VPS root-only 环境注入，不能写入仓库或报告。
- absent-key sweep 在生产必须默认 dry-run / fail-closed；只有停写后的最终事务且显式确认时才允许删除 migration namespace 内的缺失项。
- 不把 staging `waline_staging` 或 `127.0.0.1:8361` 作为生产迁移目标。
- 启用前需由 owner 确认一个业务上应关闭评论的真实 route，并在 Typecho snapshot 中保留 `allowComment=false`；否则“关闭 key 仍 403”门禁只能标为未满足，不能拿 unknown key 代替。

## 2026-08-09 VPS read-only preflight 1

- 已用专用 key 登录 `root@139.224.71.200`；只执行读取、GET/HEAD 和元数据检查，没有 POST、SQL、远端文件写入、reload、purge、状态跃迁或 release 切换。
- 1Panel OpenResty 继续占用 80/443；Typecho 仅 `127.0.0.1:8080`，生产 Waline `127.0.0.1:8360`，staging Waline `127.0.0.1:8361`。
- 生产 / staging Waline 分别为独立容器、独立镜像和独立只读 deploy mount；均在 `1panel-network` 且 healthy。
- MySQL 为 `1Panel-mysql-RSa9` / MySQL 8.4.5，host loopback `127.0.0.1:3306`，与 Typecho/Waline 同处 `1panel-network`；尚未执行 SQL。
- `current` 指向唯一 release `20260805T143100Z-c92e7d31`；`previous` 和 `candidate` 均缺失。静态 release rollback 链未建立，当前只有 1Panel vhost 备份可回 Typecho，属于切换门禁缺口。
- state 与 manifest 一致：`redirect-status=302`、`comment-write-mode=disabled`、snapshot epoch `1785565762`；`www` 与 `new` 的 `/__release` 均匹配。
- 源站 `/archives/47/` 返回 302 到 `/posts/typecho-joe-mermaid/`，但公网 Tengine 同一路径返回 200 且没有 Location；当前 origin/edge legacy 行为不一致，是 301 阻塞项，需进一步只读确认缓存对象/hash。
- `/admin/` 在源站与公网均为 404；Typecho loopback root=200、admin=302。
- 生产和 staging Waline 对根路径 comment key 的 GET 均为 403；该 key 不在 policy，不能据此判定服务异常，需用真实 commentKey 复测。
- TLS 证书有效期为 2026-06-29 至 2026-09-27；根盘 40G 已用 30G（79%，余 8.0G）；内存 1.6GiB、可用约 523MiB，swap 已用 2.1/2.5GiB。

## 2026-08-09 VPS read-only preflight 2 partial

- `www.andy-y.cn` 当前解析到阿里 CDN `www.andy-y.cn.w.kunlunaq.com` / `140.249.145.119`；`new.andy-y.cn` 直连 `139.224.71.200`。
- 使用 `curl -q`、禁止跟随跳转后，源站 legacy 仍为 302；阿里 edge legacy 为 200、`X-Cache: HIT TCP_MEM_HIT`、Age 169、Content-Length 88496。
- 公网 legacy 正文 SHA-256 与源站/公网 canonical target 正文 SHA-256 完全相同：`c87c6b7a...e57dee0a`。这是“canonical 正文被缓存到 legacy cache key”证据，不是客户端跟随 302；legacy 三视角门禁当前 FAIL。
- preflight 2 在输出公开页 title/canonical 的 shell 正则处发生引号解析错误并中止；中止点早于 known-key Waline GET 和全部 SQL，故尚未执行任何数据库查询。后续改用缩小的 2b 脚本，不重复已完成的 edge 请求。

## 2026-08-09 VPS read-only preflight 2b/3

- Typecho 实际 schema 为 `typecho_frf6hh`，评论表 `typecho_comments`、内容表 `typecho_contents`；字符集/排序规则均为 `utf8mb4_0900_ai_ci`。
- Typecho 现有评论精确聚合：总数 2，`type='comment'` 2，approved 1，waiting 1，spam 0，reply 0，max coid 11，孤儿父引用 0；与 Stage 0 fixture 数量一致，但尚未做逐字段/hash 对账。
- Typecho 内容聚合：总行数 19，公开 post/page 15，公开 `allowComment=1` 为 15，关闭为 0；确认生产没有真实 closed commentKey。
- 数据库存在 `waline` 与 `waline_staging`，但生产 `waline` 为 **0 张表**；`wl_Comment` 与 migration map 均不存在。staging 有 `wl_Comment` / `wl_Counter` / `wl_Users` 三表、2 条 approved 评论，无 migration map。
- 不带 Origin/Referer 时，对真实 `www`/origin/`new` 以及两个 loopback Waline 的已知 commentKey GET 均为 403；本地代码确认 safe GET 会转发到 upstream，因此该 403 来自 Waline `SECURE_DOMAINS`，不能单独作为 DB read verdict。
- 带匹配 Origin/Referer 的浏览器式公网 GET：staging `new`=200，production `www`=500。结合 production `waline` 0 张表，确认生产历史评论读取链路未就绪。
- 两份 1Panel Compose healthcheck 都请求无 Origin 的根 comment path，并把任意 `<500`（包括稳定 403）判为健康；当前 container `healthy` 是假绿，未覆盖 DB/schema/read path。
- 本地已把 production/staging healthcheck 修为真实 commentKey、匹配 Origin/Referer、仅 HTTP 200 PASS，并加入 `stage10:gate`。`js-yaml` 语法/结构校验 PASS；本机无 Docker CLI，`docker compose config` 尚未执行，不能标记该项 PASS。
- production schema apply、修复 healthcheck、浏览器式 GET=200、完整迁移工具与零差异对账全部是停写前阻塞项。不得进入 Typecho stop-write，也不得启用 Waline。
- 整轮 VPS preflight 仅执行 GET、header/hash、Docker/system 元数据以及 MySQL `SELECT`/`SHOW`；没有 POST、数据库写、备份、远端文件写、reload、purge、状态跃迁、release 切换或 301。

## 2026-08-09 Phase 8 implementation boundary

- 当前本机 Node `v24.16.0`、npm `11.13.0`，仓库已锁定 `mysql2 ^3.23.2`；无需新增数据库依赖。
- `scripts/migrate-comments.js` 仍为 memory-only 且被 Stage 7 gate/fixture 报告依赖；生产实现必须保持该入口与报告兼容，不能让 live 运行把 Stage 7 fixture 报告写坏。
- Phase 8 采用“共享纯迁移契约 + 独立 MySQL CLI/backend + 可注入假连接测试”结构。真实 MySQL 集成仍需隔离实例或另行授权，不能用 production `waline` 做开发测试。

## 2026-08-09 Phase 8 local completion

- 新增共享纯契约 `scripts/lib/comment-migration-core.js`，Stage 7 memory fixture 改为复用该契约；source hash v2 覆盖实际迁移的 link/IP/UA 等字段，避免这些字段漂移却仍误判幂等。
- 新增 `scripts/lib/comment-migration-mysql.js` 与独立 CLI `scripts/migrate-comments-mysql.js`：仅允许确认后的 production `waline`，校验 schema/索引，使用命名锁 + SERIALIZABLE 单事务，固定源双遍运行，默认 rollback/dry-run，absent-key sweep 需显式 `--apply-sweep`，apply 需匹配固定导出 SHA-256。
- CLI 强制 source/report 使用仓库外绝对路径；Linux source 必须 0600；报告以 exclusive 0600 创建，输出计数、集合摘要/hash、差异字段名，并仅为删除复核保留 pending/deleted `legacy_coid`；不输出正文、邮箱、IP、UA 或源文件路径。
- 14/14 隔离测试 PASS，覆盖 CLI fail-closed、缺 schema、事务回滚、双遍幂等、稳定 Waline ID、parent `pid/rid`、字段漂移修复、断裂映射拒绝、显式 scoped sweep 和 native Waline 评论隔离。
- `comments:migrate` memory 回归 PASS；`stage7:gate` PASS；`stage10:gate` PASS；两份 Compose 经 `js-yaml` 结构校验 PASS；`git diff --check` PASS。
- 本机仍无 Docker CLI，未执行真实 `docker compose config`；MySQL backend 只经假连接测试，未在真实 MySQL 8.4.5 上集成运行。production `waline` 仍为零表，代码/healthcheck 修复均未部署到 VPS。
- 下一生产动作拆成较小的 readiness 变更：先备份 production `waline`、应用 reviewed schema、部署正确 healthcheck 并要求 known-key GET=200；明确不包含 Typecho 停写/迁移/启用。范围记录于 `stage10-production-waline-readiness-authorization.md`，等待 owner 单独授权。

## 2026-08-09 Phase 8b authorized readiness preflight

- owner 已明确授权 bounded production Waline readiness 变更；不包含 Typecho 停写、迁移 apply、评论启用、OpenResty/release/purge/301，也不授权 staging 操作。
- fail-closed read-only preflight PASS：state/manifest 均为 302 + disabled，release 仍为 `20260805T143100Z-c92e7d31`。
- 唯一目标确认为 container `andy-blog-waline-waline-1`、database `waline`、loopback `127.0.0.1:8360`；MySQL 为 `1Panel-mysql-RSa9` / 8.4.5。
- Compose ownership 确认为 project `andy-blog-waline`、service `waline`、working dir `/var/www/andy-blog`、config `/var/www/andy-blog/compose.1panel-production.yml`；Docker Compose v2.36.2。
- production `waline` 仍为 0 表；根盘 79% / 8.0G 可用。当前旧 healthcheck 仍以 path=/ 且 status<500 判定；known-key browser-like GET 在 loopback/public 均为 500，符合空 schema 未就绪现状。
- preflight 未创建远端文件、未备份、未执行 DDL、未重建容器；下一步先只读比对远端 Compose 与本地候选。
- 远端 Compose mode 为 0666（本次部署候选将收紧为 0640）；remote SHA-256 `6b34ac...d1d`，当前 Compose config hash 与 container label 均为 `f1d22d...4710`，证明运行容器与远端文件一致。
- `docker compose config --services` 仅输出 `waline`，image 仅 `andy-blog-waline-waline`。远端与本地 production Compose 的完整 diff 只有 healthcheck：根 path + `<500` 改为真实 known key + production Origin/Referer + 必须 HTTP 200；无其他 service/env/image/network 差异。
- `/var/www/andy-blog/.env` 为 0600；未读取或输出其内容。远端 staging Compose 仅列出文件名/元数据，未读取、复制或执行。
- production `waline` pre-DDL 备份已写入 `/root/stage10-comments/20260809T075519Z-waline-readiness/waline-before.sql.gz`，mode 0600、gzip 完整性 PASS、size 581 bytes、SHA-256 `f9212621...f45c`；空库所以体积小。当前 Compose 与 preflight summary 也已纳入 `SHA256SUMS.before`。
- candidate remote validation PASS：schema SHA `02726f...6885c`、Compose SHA `8e2a15...a5aa`，去除 healthcheck 后前后文件 SHA 完全相同；candidate 解析为唯一 `waline` service，config hash `efbb675b...c024`。
- reviewed schema DDL 已执行。DDL 后契约断言通过至 GET 门禁，但 loopback known-key GET 非 200，脚本按 stop condition 中止。未安装 candidate Compose、未重建容器；需只读检查响应与 production logs 后决定是否仍可在授权范围内修复。
- GET 500 的明确错误为 `ER_NOT_SUPPORTED_AUTH_MODE`。production account `waline`@`%` 使用 `caching_sha2_password`，未锁定/未过期，grants 仅 USAGE + `waline`.* ALL；数据库授权本身正确。
- production image 为仓库 wrapper 基于 `lizheming/waline:1.41.3` + Node 22.16.0 构建；顶层 `/app` 无 mysql/mysql2 module，真实 upstream 位于 `/waline`。错误指向旧 upstream 数据库驱动与 MySQL 8.4 默认认证协议不兼容，而不是 schema 缺失。
- 当前 owner 授权未包含 ALTER USER / MySQL auth plugin、MySQL restart 或 Waline upstream image/version 变更。按 stop condition 暂停 Compose 安装/容器重建，继续只读确认服务端 plugin 状态与 `/waline` 实际驱动版本，以形成最小扩权方案。
- MySQL `mysql_native_password` plugin 为 ACTIVE/ON；Waline upstream `/waline` 明确解析到 `mysql` 2.18.1，未安装 mysql2。最小可逆修复不是重启 MySQL或升级镜像，而是仅将既有 `waline`@`%` 使用同一现有密码改为 `mysql_native_password`。
- blocker 证据已固化到 root-only evidence：`auth-blocker-summary.txt` 与 `SHA256SUMS.blocker`。当前 remote Compose SHA/container config hash 仍为原值，candidate 未安装，container 未重建，302/disabled 未变。
- 该 ALTER USER 不在本次授权的枚举范围，需 owner 窄扩权。拟议脚本不打印/落盘密码，从 production Waline env 内存读取并通过 stdin 设置同一密码；若 GET 仍不为 200，立即用同一密码恢复 `caching_sha2_password` 并停止。
- owner 已于 2026-08-09 追加上述窄授权；授权不改变原 Phase 8b 的其余排除项。只允许同一 `waline`@`%`、同一现有密码的 plugin 切换，grants 必须前后逐字节一致，MySQL 不重启，known-key GET 非 200 必须触发 EXIT trap 恢复原 plugin。
- 远端实际 auth-switch 已通过全部前置断言并成功；known-key GET 达到 200，所以回滚 trap 正常解除。grants 前后内容哈希一致，未修改授权；账号插件现为 `mysql_native_password`。这关闭了 schema 后 GET=500 的认证协议阻塞，但 corrected Compose healthcheck 尚未安装，旧容器仍未重建，readiness 仍未完成。
- corrected production Compose healthcheck 已原子安装，production Waline 仅该服务被重建；运行态 healthcheck 使用真实 key、production Origin/Referer 且仅 HTTP 200 通过。最终 GET=200、四表为空、排除容器快照一致，Phase 8b readiness 完成。后续仍不得直接进入评论迁移或启用：Phase 9 需要独立授权并先执行 Typecho 停写/排空/固定导出/dry-run/对账。

## 2026-08-09 comments admin registration failure

- Waline admin UI loaded from `comments.andy-y.cn`, but active `SERVER_URL=https://www.andy-y.cn` caused registration to POST to `https://www.andy-y.cn/api/user`.
- The public www wrapper correctly rejected that management endpoint with HTTP 403; opening `/api/user` on www would weaken the public comment boundary.
- The deployed comments vhost now rewrites only the Basic-Auth-protected `/ui/` runtime origin to `https://comments.andy-y.cn`; container-wide `SERVER_URL`, public www API, Waline container, database, release, and 302 state remain unchanged.
- OpenResty reload handover briefly served an old worker during immediate verification. Bounded polling confirmed the new worker response before accepting the deployment.
- Follow-up login exposed that the first `sub_filter` was too broad: it also changed Waline's `window.SITE_URL`, so post-login navigation treated `/ui/` as the public site and repeated the Basic Auth boundary. The correction must rewrite only the exact `window.serverURL` assignment and preserve `window.SITE_URL = "https://www.andy-y.cn"`.
- Commit `bbb5a07` narrowed the generator and test contract to the exact `window.serverURL` assignment. Runtime verification after reload confirmed `window.SITE_URL = "https://www.andy-y.cn"` and `window.serverURL = 'https://comments.andy-y.cn/api/'` simultaneously; release, 302/enabled state, www config hash, and Waline container identity were unchanged.
- The remaining loop was an independent authorization-layer collision. Access logs show successful Basic-authenticated `/ui/` and `/api/token` login followed immediately by 401 responses for Bearer-authenticated `/api/comment`; a read-only probe confirmed Bearer requests receive OpenResty's `WWW-Authenticate: Basic` response before reaching Waline.
- Owner selected the simpler final boundary: remove comments-domain HTTP Basic entirely, retain Waline's inner login, block `POST /api/user` regardless of credentials, and require Bearer for every other state-changing API request except token login.
- Commit `95a6d9a` implements the final boundary. Origin and public-path verification both returned `/ui/` 200 with no `WWW-Authenticate`; public `POST /api/user` returned 403. OpenResty config test/reload and production invariants passed without changing release, 302/enabled state, www config, Waline container, or data.
- Production moderation is now explicit in Compose as `COMMENT_AUDIT=true` (`f5d5f03`). Only `andy-blog-waline-waline-1` was recreated with the existing image and no dependencies; runtime env, healthcheck, and known-key GET passed. No synthetic comment was posted, so verification introduced no comment row.

## 2026-08-09 Phase 9a local package

- 现有生产迁移 CLI 已可消费外部 0600 JSON，但仓库没有从实际 `typecho_frf6hh.typecho_comments` 生成固定 JSON 的生产导出器；Stage 0 fixture 不能冒充最终导出。
- 现有 `comment-stop-write-checklist.sh` 只打印人工步骤，没有实施 source DB 不可写的机制。
- stop-write 不能批量修改 `allowComment`，也不能停止 Typecho 容器，因为文章写作后台仍需继续。候选机制应只阻止 `typecho_comments` 的 INSERT/UPDATE/DELETE，并在迁移后永久保留旧评论只读；需先用本地契约和单独生产授权验证具体实现。
- 固定导出器采用三触发器契约作为硬前置，而不是只依赖“公网目前不再反代 Typecho”的间接事实。导出覆盖 fixture 所需全部字段，固定排序/JSON 字节，重复导出可直接比较 SHA-256 证明 quiet interval 内源未漂移。
- Phase 9b 仍有一项不可代替的 owner 决策：选择一个真实 closed route。建议 `/posts/typecho-joe-mermaid/`（CID 47），因为它已有历史评论与 read-path 覆盖；只有 owner 明确选择后，才可在固定导出前把该单行 `allowComment` 改为 0。未知 key 不能充当 closed-key 验收。
- owner 已选择 `/posts/typecho-joe-mermaid/`（CID 47）。Phase 9b 只允许该单行 `allowComment` 从 1 改为 0；任何 CID/route 解析漂移、当前值非 1 或额外内容行变化都必须在写前停止。

## 2026-08-10 decoded mapping repair transaction

- production 的普通 rebuild watcher 会调用现有 1Panel switch 脚本；该脚本会拒绝 nginx policy drift，因此不能靠下一次文章发布顺带修复 decoded URI mapping。
- 专用 runner 必须同时更新 source builder 与 immutable release，并把 vhost 差异锁死为一行 encoded-to-decoded 替换；状态始终为 302 + enabled，成功后 edge 状态只能写为 `edge-pending`。
- 回滚必须恢复 active/previous symlink、last-success、edge-status 与 vhost，并重新测试/reload OpenResty；`edge-status` 应作为必需前置文件，不能用 `missing` 哨兵留下不完整恢复分支。
- VPS 根盘约 97%；部署前若需要空间，只能在再次确认无容器引用后精确删除旧 builder image `sha256:22d68ae100bfd6413110dda5c78667b8339e7a15214a93e94c01c44071b1efe3`。禁止 global prune，并保留 Waline 回滚镜像、当前/旧 release、备份、volume 与仍被 EasyTier 使用的 dangling image。
- 首轮 runner 复审发现需要继续收紧两个失败窗口：symlink 第一次 `mv` 前就应标记 rollback active；builder rebuild 失败回滚还必须恢复原 builder image tag，否则 watcher 虽恢复但下一次自动发布可能因 decoded/encoded vhost policy drift 被拒绝。
- `/var/www/andy-blog` 的既有部署明确不含 `.git`，所以 `.deploy-source-revision` 只能证明声明值，不能单独证明 build context 字节。执行包还需绑定 `git archive` SHA/文件清单，并确认自已部署的基线 commit 到候选 commit 没有 tracked deletion；否则 overlay 遗留文件可能进入 builder 的 `COPY . .`。
- 2026-08-11 实机状态目录没有 `edge-status`，旧脚本只在 rebuild/rollback/roll-forward 的 purge 分支写 `edge-pending` 或 `ok`；此前静态切流路径未创建它。mapping runner 的枚举应以 `edge-pending` 表示真实 purge 尚未执行，但外层事务必须记录“原文件缺失”，失败时删除本次新建的精确文件，不能把初始化误当成既有状态。
- `docker compose images -q builder` 只覆盖已创建容器关联的镜像；production builder 总是 `run --rm`，因此无论 profile 是否启用都返回空。可用的无凭证接口是 `docker compose config --images`，其中唯一 `*-builder` ref 为 `andy-blog-cms-builder`；runner 必须从该 ref 用 `docker image inspect` 获取前后 image ID，并禁止读取/打印 resolved service environment。
- b3 builder Dockerfile 把 revision `LABEL` 放在依赖层之前，且 source COPY 后有递归 chown 层；revision/source 变化可能需要约一个现有 builder unique layer 的额外空间。实机仅约 1.30GiB free，等于而没有高于旧无引用 builder 的约 1.3GiB unique 占用，因此符合授权包“空间不足”条件：执行前应再次确认零容器引用后，仅删除精确旧 image `sha256:22d68a...1efe3`，保留当前 builder 作为 rollback。
- 实际 b3 build 即使删除旧 1.3GiB image 仍耗尽根盘：新 image 导出成功，release 写入失败。runner 的 builder retag/edge/watcher/runtime 回滚成立，但新 dangling image/build cache 留在 100% 根盘。后续不能重试；必须先针对该 exact transaction-created image 和对应 build cache 获取新增、可核对的清理权限。
- failed image 自身已完整导出且无 tag/ref；build cache 的 1.587GB private 空间全部 inactive。若先删除 failed image 再从零 rebuild，会重复同一空间峰值；更低风险的 resume 是保留 failed image，清理 inactive build cache释放工作空间，验证其 revision label/关键文件后临时把旧 image 保留为 rollback tag并复用新 image打 release。该 cache prune 与 resume 路径超出原精确删除授权，必须单独授权。
- 旧 Stage 10 文件备份本身只有约 42 MiB，无法单独恢复 mapping repair 所需的稳定工作空间；可先删除重复 source/upload 包取得少量救急空间，但根因仍是本次 build 留下的完整 b3 image 与 1.587 GiB inactive build cache。评论迁移/对账证据、当前 mapping 失败事务证据、当前/previous release、数据库 volume 和 www 首次切流 vhost 备份应保留。
- 删除约 278 MiB 项目旧归档后，根盘仍因 ext4 reserved blocks 显示 0 available；无 deleted-open-file 泄漏。可核对且足以解阻的唯一大块空间仍是 128 条 active=0 的 Docker build cache（private/reclaimable 1.587 GiB）。应保持两份 builder image，单独 prune build cache 后复用已经成功导出的 b3 image完成 release，禁止 volume/image 全局 prune。
- 通过 SSH stdin 执行 Bash 时，`docker compose run --no-TTY` 只禁用 TTY，不会关闭 stdin；子进程可吞掉 runner 后续源码并让外层自然 EOF/exit 0。所有此类 transaction runner 必须给 Compose run 显式 `</dev/null`（或等价禁用 interactive），并测试 mutation 后仍会走到终态。
- `build-release.sh` 的 `nginx/release-http.conf` 是 staging/isolated nginx artifact，故包含强制 noindex；production 1Panel adapter必须消费 `generate-www-cutover-http.js` 的产物，不能把 staging artifact传入并靠删除 header 绕过。exact-diff validator应继续证明候选 vhost除 encoded→decoded 单行外无变化。
- release checksum 文件由 `(cd STAGE && find . ...)` 生成，因此合法条目带 `./`；`walkFiles()` 返回无前缀 relative path。validator需在拒绝绝对路径/`..` traversal 后规范化单个 `./`，并在规范化后检测重复项；不能修改已生成 immutable release来迁就 validator。
- 生产 vhost mapping repair不应重新生成整份配置：即使显式对齐uploads alias，Unicode decoded key会因排序规则移动位置，违反“仅原位单行替换”的授权和validator契约。最终控制面应从当前vhost读取exact baseline，使用reviewed常量原位替换一次，再对整文件运行`validateExactMappingDiff`；这同时保留所有1Panel现实路径与手工边界。
- OpenResty reload后的即时单次GET可能命中旧worker；切换事务应使用短时有界轮询，但每轮必须让release、legacy状态/Location、admin 404、Waline GET同时满足原严格条件，不能把轮询变成接受旧响应。失败仍完整恢复vhost/symlinks/state/builder/watcher。

## 2026-08-12 session handoff

- 七天日历边界已经到达，但这是必要条件而非充分条件。当前 origin decoded legacy 为正确 302，public 默认 DNS 路径仍为 200，故真实状态必须保持 `edge-pending`，不能因日期到达而推进 301。
- 真实双 CDN purge 仍未获授权；当前聊天此前所有 production 授权均明确排除 purge。下一会话必须先取得 `HANDOFF-2026-08-12.md` 中的 Phase 10d 窄授权，才可检查 CDN 凭证键存在性或调用 provider API。
- 本地 ignored control archive 仍存在，SHA-256 为 `45e971991aecffba005d2ab376bbba1e7c63c6e9a514f8ceaade6d08d8948f23`；API 双成功最多推进到 `edge-purged`，`edge-verified` 必须由传播后且确属不同 CDN 的三视角证据单独产生。
- CMS 根入口当前 401，comments 根 302 到 `/ui/` 且 `/ui/` 200；这些状态证明边界/入口存在，不等价于本轮重新完成登录、发文或评论管理写操作验证。

## 2026-08-12 Aliyun manual refresh guidance

- Tavily search skill因本机缺少 `TAVILY_API_KEY` 在网络请求前停止；改用内置网页检索，并仅采用阿里云官方 CDN 文档（`https://help.aliyun.com/zh/cdn/user-guide/refresh-and-prefetch-resources`、`https://help.aliyun.com/zh/cdn/user-guide/refresh-and-warm-up-related-faq`）。官方规则：源内容更新应使用 URL 刷新让边缘缓存失效；预热是后续主动拉取热点资源，不支持目录预热。刷新后预热是常见顺序，但小文件通常无需预热。
- AliDNS 当前仍解析国内链路为 `www.andy-y.cn.w.kunlunaq.com` → `117.68.89.36`。最终使用 `--noproxy '*'` + exact `--resolve` 直连复核：该 Tengine 边缘的 encoded tag、`/archives/47/`、`/?p=47` 均为缓存 HIT/200；同一时刻 origin 三者分别正确返回 302 到 `/tag/fen-x/` 与 `/posts/typecho-joe-mermaid/`。至少多个 legacy 家族仍与 origin 不一致，不能只刷新一个 URL。
- 当前 release 的 immutable plan 仍为 174 exact URLs：140 legacy/query、30 canonical terminal、4 个额外固定元数据 URL。阿里云应使用 URL 刷新提交全部 174 条，不使用根目录/whole-zone 刷新。刷新完成并验证后，预热可省略；若 owner 希望降低首次回源延迟，只预热 30 条 canonical terminal，不预热 legacy redirect/query 入口。
- 手工列表已固化为 `aliyun-refresh-urls-2026-08-12.txt` 与 `aliyun-optional-preheat-urls-2026-08-12.txt`；本轮未提交阿里云任务、未读取凭证、未改变 `edge-pending`。
- Owner 手工 URL 刷新后的直接复核证明任务已触达 Aliyun 节点：样本由 HIT 转为 `TCP_MISS` 且 save time 重置，但三个 legacy 仍为 200。`/archives/47/`、`/?p=47` 与 canonical post 的响应正文均为 88,496 bytes，SHA-256 均为 `24d347afc70d1e3fc8adad252fc077a1beeb3d5001f85427cb96d771449c0e61`，随后旧入口重新成为 `TCP_MEM_HIT/200`。
- 该行为精确匹配 Aliyun 官方“回源301/302跟随”：节点收到源站 301/302 后自行请求 Location，不把重定向返回给用户，并缓存目标资源（`https://help.aliyun.com/zh/cdn/user-guide/configure-301-or-302-redirection`）。本项目依赖对客户端可见的 302→301 SEO 迁移，所以必须关闭 `www.andy-y.cn` 的该开关，再刷新全部 174 exact URLs；关闭前不得预热。
- Owner 关闭“回源301/302跟随”并重新刷新后，`--noproxy '*'` 直连 Aliyun 抽查恢复正确：encoded tag、archive CID47、query CID47 均为 `TCP_MISS/302` 且 Location 与 origin 一致；canonical post 与 sitemap 为 200。Aliyun 配置根因已被行为验证关闭，但抽样不能替代 140 legacy 全量和 Cloudflare/三视角证据。
