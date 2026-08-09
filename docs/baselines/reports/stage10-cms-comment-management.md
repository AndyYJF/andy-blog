# Stage 10 article editing and comment management deployment

Status: local package ready; production mutation awaits one explicit authorization.

## Fixed production topology

- `cms.andy-y.cn` -> 1Panel OpenResty -> existing Typecho HTTP at `127.0.0.1:8080`.
- `comments.andy-y.cn` -> 1Panel OpenResty + HTTP Basic -> Waline direct upstream at loopback `127.0.0.1:8362`.
- Public `www.andy-y.cn/api` remains behind the policy wrapper at `127.0.0.1:8360`.
- Typecho content events -> HMAC webhook on the private `1panel-network` -> durable spool -> host systemd -> immutable builder -> 1Panel-safe atomic release switch.
- Automatic article rebuild is locked to `redirect-status=302` and `comment-write-mode=enabled`. It cannot reload OpenResty, purge CDN, start repository nginx, or replay comment migration.

## Production facts confirmed read-only on 2026-08-09

- Typecho container: `1Panel-typecho-f31a`, image `joyqi/typecho:1.2.1-php8.0-apache`, bind root `/opt/1panel/apps/typecho/typecho/data` -> `/app`.
- Typecho is on `1panel-network`, has PHP curl/mysqli/pdo_mysql, and the three admin-origin patch inputs exactly match the reviewed hashes.
- Production Waline direct upstream `127.0.0.1:8361` returns HTTP 200 inside its container.
- Production Waline Compose working directory is `/var/www/andy-blog`.
- `cms.andy-y.cn` and `comments.andy-y.cn` currently have no DNS answer.

## One production change window

1. Create direct DNS A records for `cms` and `comments` to `139.224.71.200`; do not proxy through either public CDN.
2. Back up Typecho DB/files, production Waline DB/Compose, OpenResty configs, systemd units, and `/var/www/andy-blog`.
3. Deploy this reviewed repository snapshot to `/var/www/andy-blog` without copying `.git`, `.planning`, secrets, or local caches.
4. Apply the hash-pinned Typecho admin-origin patch, CMS URL constants, `AutoRebuild`, shared webhook secret, and one-shot plugin activation.
5. Create a SELECT-only Typecho rebuild DB account and a root-only CMS environment file; never print its password.
6. Generate root-only Basic Auth credentials. Store the one-time plaintext only in `/root/.config/andy-blog-management-credentials`; the operator retrieves it over SSH.
7. Install both 1Panel vhosts, run OpenResty config test, and reload once.
8. Add Waline loopback admin port 8362 and secure management origin; rebuild only production Waline. Do not touch staging.
9. Deploy/start `rebuild-api`, build the immutable builder image, install the 1Panel systemd path/service, and run one signed no-op rebuild.
10. Verify CMS login/assets/upload editor, Waline UI/login/list/moderation, public open/closed-key behavior, `302`, `comments enabled`, and matching `/__release`.

## Rollback boundary

- Stop/disable only the new rebuild path/service and `rebuild-api`.
- Restore the Typecho file/DB snapshot, prior production Waline Compose/container, and prior OpenResty configs; test then reload once.
- Restore the previous static release symlink if the no-op rebuild switched.
- Remove the two DNS records or leave them returning 404. Public `www` remains on its last healthy `302 + enabled` release throughout.

No step in this package authorizes or performs 301, CDN purge, staging changes, comment deletion, or a repository nginx start.
