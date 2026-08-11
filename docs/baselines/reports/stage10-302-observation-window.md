# Stage 10 — 302 observation window checklist

This checklist tracks `docs/plan.md` §8.5 step 4. It is read-only and cannot
authorize or perform a 301 transition.

## Window identity

| Field | Value |
|---|---|
| Production release at initial cutover | `20260805T143100Z-c92e7d31` |
| Redirect state | `302` |
| Comment write state at initial cutover | `disabled` |
| Cutover date | 2026-08-05 |
| Earliest provisional 301 date | 2026-08-12, only after the exact cutover timestamp is confirmed |
| 301 status | **PROHIBITED / not authorized** |

The vhost backup name `www.andy-y.cn.conf.bak-20260805T153148Z` is evidence near
the cutover, not proof of the exact switch time. Retrieve the deployment log or
shell history timestamp before calculating the full seven-day boundary. If the
exact time cannot be established, use a conservative later boundary.

## Daily read-only capture

Create one dated evidence record per observation run. Record the vantage point,
timestamp in UTC, command/tool version, and response headers without cookies or
credentials.

| Check | Required observation |
|---|---|
| `current` and `/__release` | expected release; symlink and HTTP agree |
| release manifest/state | `redirectStatus=302`; deployed state agrees |
| representative legacy paths | one 302 hop to the recorded canonical target |
| query/action legacy forms | recorded 302/404/410 behavior; no generic query hijack |
| canonical targets | final 200, correct canonical, no loop or chain |
| `/admin/`, PHP, Typecho action paths on `www` | 404; never proxied to Typecho |
| sitemap/RSS/current pages | 200 and internally consistent URLs |
| origin / Aliyun / Cloudflare views | status, `Location`, release/hash consistent |
| CDN cache headers | note HIT/MISS/AGE and any short stale object |
| Waline read path | historical GET succeeds |
| Waline write path while disabled | direct POST remains 403 |
| staging `new` | known release remains healthy and isolated from production DB |
| OpenResty/application logs | no unexplained legacy/action 4xx, redirect loop, or 5xx |
| disk/TLS/containers | no worsening capacity, certificate, or health risk |

Use `scripts/probe-dual-cdn.js` only with actual distinct direct/proxy paths. A
run where all bases resolve through the same edge is not three-vantage evidence.
The repository now contains exact-URL Aliyun `RefreshObjectCaches` and
Cloudflare purge clients, but they have not been deployed or called with real
credentials. A local mocked PASS is not purge evidence. Count purge as complete
only when the immutable release plan hash, real provider request/task IDs, and a
post-propagation three-vantage capture are all retained.

## Legacy/action matrix requirements

For every entry in the recorded legacy/action set, retain:

- requested URL and vantage point;
- observed status and `Location`;
- expected status and target from the committed maps;
- final status after following at most the intended single redirect;
- final canonical URL;
- response release ID/hash where applicable;
- PASS/FAIL with a concrete reason.

Readiness requires 100% agreement across origin, Aliyun, and Cloudflare. Clear
browser/CDN short-cache anomalies by evidence; do not solve them by prematurely
changing the permanent redirect status.

## Observation ledger

| Date | Minimum checkpoint | Status | Evidence / notes |
|---|---|---|---|
| 2026-08-05 | initial 302 + comments disabled cutover | recorded | production handoff / existing progress |
| 2026-08-06 | day 1 | pending evidence | |
| 2026-08-07 | day 2 | pending evidence | |
| 2026-08-08 | day 3 | pending evidence | |
| 2026-08-09 | day 4 | **FAIL / live read-only evidence** | at 09:02Z Phase 9b finished with 302/disabled unchanged and Waline GET=200; origin legacy=302 but public CDN legacy=200; `previous` was missing at that capture and was later restored by the Phase 9c release switch |
| 2026-08-10 | day 5 | **FAIL / full three-vantage capture** | [`stage10-observation-2026-08-10.json`](stage10-observation-2026-08-10.json): origin 139/140, Aliyun 0/140, Cloudflare 139/140 legacy checks; all three terminal matrices 30/30 and probes 6/6. Shared failure `/index.php/tag/%E5%88%86%E6%9E%90fen-x/` returned 404; local 302 generator repair passes gates but is not deployed. Active `current` and `previous` both exist. |
| 2026-08-11 | day 6 | **PARTIAL / mapping repaired, CDN stale** | release `20260811T060917Z-408488e5`; exact vhost diff deployed and origin encoded legacy request now returns one-hop 302. Public path still returns cached 200, so `edge-status=edge-pending` and real dual-CDN purge/post-propagation evidence remain required. |
| 2026-08-12 | day 7 boundary | pending exact timestamp + full matrix | |

Missing historical daily captures are reported as missing; current healthy
probes do not retroactively prove those days. Continuous CDN/origin logs may be
used as evidence only if their retention and time range cover the gap.

## Blockers that keep 301 prohibited

- fewer than seven complete natural days from the confirmed cutover timestamp;
- any unresolved legacy/action mismatch, redirect loop/chain, or unexpected 5xx;
- missing origin/Aliyun/Cloudflare agreement;
- Aliyun currently serves a cached canonical 200 body under at least one legacy
  URL while origin returns the required 302; the 2026-08-10 full capture found
  all 140 Aliyun legacy checks non-compliant;
- `/index.php/tag/%E5%88%86%E6%9E%90fen-x/` is repaired at origin (one-hop 302),
  but the public CDN path still serves a stale 200 and full distinct-vantage agreement is missing;
- release/action-map/sitemap/deployment-state mismatch;
- unimplemented or unverified real Aliyun and Cloudflare purge;
- no tested rollback/roll-forward evidence for the active production adapter;
- comment work does not directly block observing 302, but it must not be bundled
  into a 301 release;
- owner has not explicitly authorized the 301 transition.

## Later 301 approval packet (not executable now)

When the window is complete, prepare a separate approval packet containing:

1. confirmed cutover timestamp and elapsed duration;
2. completed observation ledger and full three-vantage matrix;
3. zero unresolved mapping errors;
4. real dual-CDN purge implementation/test evidence;
5. candidate release ID with `redirectStatus=301` and unchanged intended comment
   state;
6. rollback target and exact rollback commands;
7. owner approval.

Only after that approval may `transition-deploy-state.sh redirect-status 301`
be run and a separate release be built. `site:` indexing changes are follow-up
signals, not immediate gates.
