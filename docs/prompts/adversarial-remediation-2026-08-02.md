# 对抗校验整改记录（2026-08-02）

对照 `adversarial-audit-stage0-8-result-2026-08-02.md` 的处置。

| ID | 处置 |
|---|---|
| AA-01 | `build-legacy-url-map.js` 跳过 oldPath===targetPath；`generate-nginx.js` 拒绝自重定向；`stage4-gate` 校验 map+nginx |
| AA-02 | `--apply-pass`/`--sync-audit` 不再伪造成人工 pass；写入 contentHashes；verdict=`audit-clean`；gate 接受 audit-clean 并警告 Final 未完成 |
| AA-03 | Waline 写入 fail-closed：`/api/comment` 与 `/api/comment/*` 走策略，其它 `/api/*` 写操作 403；路径助手 `server-path.js` |
| AA-04 | rebuild-api：进程内写锁 + 随机临时文件名；并发 40 nonce 测试 |
| AA-05 | **未代提交** — 需你本地确认 ignore/秘密后首个基线 commit |
| AA-06 | nginx CMS `fastcgi_pass typecho:9000`；README/Stage5 标明 CMS 纵向未完成 |
| AA-07 | cdn-purge 有凭证时记 `not-implemented` 并 exit 71，禁止 stub ok |
| AA-08 | blog-rebuild 先捕获 PREV_SUCCESS，再传给 baidu-push $2 |
| AA-09 | 文档层承认 Stage 0 部分证据缺口（未伪造恢复演练） |
| AA-10 | Stage5 gate 增加行为/诚实检查；Stage8 区分 auto vs human |

验证命令见结果文件 Reproduction；本轮整改后请再跑：legacy:map、nginx:302、rebuild-api/waline tests、stage4/5/7/8 gate、完整 build。
