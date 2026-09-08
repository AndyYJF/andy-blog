<?php
use Typecho\Common;
use Typecho\Db;
use Typecho\Widget;
use Widget\ActionInterface;
use Widget\Options;
use Widget\Security;
use Widget\User;

/**
 * Moments publish / list / upload / delete API.
 * Posts are stored as Typecho contents with field content_kind=moment.
 */
class Moments_Action extends Widget implements ActionInterface
{
    private const FIELD_KIND = 'content_kind';
    private const FIELD_IMAGES = 'moment_images';
    private const FIELD_TOPICS = 'moment_topics';
    private const FIELD_TOKEN = 'moment_client_token';
    private const FIELD_TOKEN_DONE = 'moment_client_done';
    private const MAX_IMAGES = 9;
    private const MAX_BYTES = 10485760; // 10MB
    private const LIST_LIMIT = 40;

    public function action()
    {
        $user = User::alloc();
        if (!$user->hasLogin() || !$user->pass('administrator', true)) {
            $this->response->setStatus(403);
            $this->response->throwJson(['ok' => false, 'error' => 'forbidden']);
        }
        if (!$this->request->isPost()) {
            $this->response->setStatus(405);
            $this->response->throwJson(['ok' => false, 'error' => 'method']);
        }
        Security::alloc()->protect();

        $do = (string) $this->request->get('do');
        switch ($do) {
            case 'list':
                $this->listMoments();
                break;
            case 'save':
                $this->saveMoment($user);
                break;
            case 'upload':
                $this->uploadImage($user);
                break;
            case 'delete':
                $this->deleteMoment();
                break;
            case 'rebuild':
                $this->retryRebuild();
                break;
            case 'status':
                $this->rebuildStatus();
                break;
            default:
                $this->response->setStatus(400);
                $this->response->throwJson(['ok' => false, 'error' => 'unknown-do']);
        }
    }

    private function listMoments()
    {
        $db = Db::get();
        $limit = self::LIST_LIMIT;
        $q = trim((string) $this->request->get('q'));
        $beforeCreated = (int) $this->request->get('beforeCreated');
        $beforeCid = (int) $this->request->get('beforeCid');

        $select = $db->select(
            'table.contents.cid',
            'table.contents.title',
            'table.contents.text',
            'table.contents.status',
            'table.contents.type',
            'table.contents.created',
            'table.contents.modified',
            'table.contents.allowComment'
        )
            ->from('table.contents')
            ->join('table.fields', 'table.contents.cid = table.fields.cid')
            ->where('table.fields.name = ?', self::FIELD_KIND)
            ->where('table.fields.str_value = ?', 'moment')
            ->where('table.contents.type = ? OR table.contents.type = ?', 'post', 'post_draft');

        if ($q !== '') {
            if (ctype_digit($q)) {
                $select->where('table.contents.cid = ?', (int) $q);
            } else {
                $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $q) . '%';
                $select->where('table.contents.title LIKE ? OR table.contents.text LIKE ?', $like, $like);
            }
        }
        if ($beforeCreated > 0) {
            $cidBound = $beforeCid > 0 ? $beforeCid : PHP_INT_MAX;
            $select->where(
                '(table.contents.created < ?) OR (table.contents.created = ? AND table.contents.cid < ?)',
                $beforeCreated,
                $beforeCreated,
                $cidBound
            );
        }

        $select->order('table.contents.created', Db::SORT_DESC)
            ->order('table.contents.cid', Db::SORT_DESC)
            ->limit($limit + 1);

        $rows = $db->fetchAll($select);
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            $rows = array_slice($rows, 0, $limit);
        }

        $items = [];
        foreach ($rows as $row) {
            $images = $this->readJsonField((int) $row['cid'], self::FIELD_IMAGES) ?: [];
            $topics = $this->readJsonField((int) $row['cid'], self::FIELD_TOPICS) ?: [];
            $items[] = [
                'cid' => (int) $row['cid'],
                'title' => (string) $row['title'],
                'text' => $this->stripMarkdownMarker((string) $row['text']),
                'status' => $row['type'] === 'post_draft' ? 'draft' : 'publish',
                'created' => (int) $row['created'],
                'modified' => (int) $row['modified'],
                'allowComment' => (int) $row['allowComment'] === 1,
                'images' => $images,
                'topics' => $topics,
                'publicPath' => '/moments/' . (int) $row['cid'] . '/',
            ];
        }
        $next = null;
        if ($hasMore && $items) {
            $last = $items[count($items) - 1];
            $next = ['beforeCreated' => $last['created'], 'beforeCid' => $last['cid']];
        }
        $this->response->throwJson(['ok' => true, 'items' => $items, 'next' => $next]);
    }

    private function saveMoment(User $user)
    {
        $db = Db::get();
        $cid = (int) $this->request->get('cid');
        $text = trim((string) $this->request->get('text'));
        $status = (string) $this->request->get('status') === 'draft' ? 'draft' : 'publish';
        $allowComment = $this->request->get('allowComment') === '0' ? 0 : 1;
        $clientToken = trim((string) $this->request->get('clientToken'));

        $imagesRaw = (string) $this->request->get('images');
        $topicsRaw = (string) $this->request->get('topics');
        $images = $imagesRaw !== '' ? json_decode($imagesRaw, true) : [];
        $topics = $topicsRaw !== '' ? json_decode($topicsRaw, true) : [];
        if (!is_array($images)) {
            $this->fail(400, 'images-json');
        }
        if (!is_array($topics)) {
            $this->fail(400, 'topics-json');
        }
        $images = $this->normalizeImages($images);
        $topics = $this->normalizeTopics($topics);

        if ($text === '' && count($images) === 0) {
            $this->fail(400, 'empty');
        }
        if (count($images) > self::MAX_IMAGES) {
            $this->fail(400, 'too-many-images');
        }

        $now = time();
        $title = $this->adminTitle($text, $now);
        $body = '<!--markdown-->' . $text;
        $type = $status === 'draft' ? 'post_draft' : 'post';
        $contentStatus = 'publish';
        $wasPublic = false;
        $deduped = false;
        $tokenLock = ($cid <= 0 && $clientToken !== '')
            ? 'moments_ct_' . substr(hash('sha256', $clientToken), 0, 48)
            : '';

        try {
            if ($tokenLock !== '') {
                $this->acquireMysqlLock($tokenLock);
            }

            // Idempotent retry only when a previous save fully completed (under lock).
            if ($cid <= 0 && $clientToken !== '') {
                $existing = $this->findCompletedByClientToken($clientToken);
                if ($existing) {
                    $cid = $existing;
                    $deduped = true;
                    if ($tokenLock !== '') {
                        $this->releaseMysqlLock($tokenLock);
                    }
                    $this->response->throwJson([
                        'ok' => true,
                        'cid' => $existing,
                        'deduped' => true,
                        'status' => $status,
                        'rebuildQueued' => false,
                        'message' => $status === 'draft' ? '草稿已保存' : '已提交，等待更新',
                    ]);
                }
            }

            $db->query('START TRANSACTION');

            if ($cid > 0 && !$deduped) {
                $row = $db->fetchRow($db->select()->from('table.contents')->where('cid = ?', $cid)->limit(1));
                if (!$row || !$this->isMomentCid($cid)) {
                    $db->query('ROLLBACK');
                    $this->fail(404, 'not-found');
                }
                $wasPublic = ($row['type'] === 'post');
                $db->query($db->update('table.contents')->rows([
                    'title' => $title,
                    'text' => $body,
                    'modified' => $now,
                    'type' => $type,
                    'status' => $contentStatus,
                    'allowComment' => $allowComment,
                    'allowFeed' => 1,
                ])->where('cid = ?', $cid));
            } elseif ($cid <= 0) {
                $cid = (int) $db->query($db->insert('table.contents')->rows([
                    'title' => $title,
                    'slug' => (string) $now,
                    'created' => $now,
                    'modified' => $now,
                    'text' => $body,
                    'order' => 0,
                    'authorId' => (int) $user->uid,
                    'template' => '',
                    'type' => $type,
                    'status' => $contentStatus,
                    'password' => '',
                    'commentsNum' => 0,
                    'allowComment' => $allowComment,
                    'allowPing' => 0,
                    'allowFeed' => 1,
                    'parent' => 0,
                ]));
                $db->query($db->update('table.contents')->rows(['slug' => (string) $cid])->where('cid = ?', $cid));
                if ($clientToken !== '') {
                    $this->upsertField($cid, self::FIELD_TOKEN, $clientToken);
                }
            }

            $this->upsertField($cid, self::FIELD_KIND, 'moment');
            $this->upsertField(
                $cid,
                self::FIELD_IMAGES,
                json_encode(array_values($images), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            );
            $this->upsertField(
                $cid,
                self::FIELD_TOPICS,
                json_encode(array_values($topics), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            );
            if ($clientToken !== '') {
                $this->upsertField($cid, self::FIELD_TOKEN, $clientToken);
                $this->upsertField($cid, self::FIELD_TOKEN_DONE, '1');
            }

            $db->query('COMMIT');
            if ($tokenLock !== '') {
                $this->releaseMysqlLock($tokenLock);
                $tokenLock = '';
            }
        } catch (Throwable $e) {
            try {
                $db->query('ROLLBACK');
            } catch (Throwable $ignored) {
            }
            if ($tokenLock !== '') {
                try {
                    $this->releaseMysqlLock($tokenLock);
                } catch (Throwable $ignored) {
                }
            }
            error_log('Moments save failed: ' . $e->getMessage());
            $this->fail(500, 'save-failed');
        }

        $needsRebuild = $status === 'publish' || $wasPublic;
        $rebuildQueued = false;
        if ($needsRebuild) {
            $rebuildQueued = $this->enqueueRebuild();
        }

        $message = '草稿已保存';
        if ($wasPublic && $status === 'draft') {
            $message = $rebuildQueued ? '已撤回，网站更新中' : '已撤回；重建未入队，请重试更新';
        } elseif ($status === 'publish') {
            $message = $rebuildQueued ? '已提交，等待更新' : '已保存；重建未入队，请稍后重试';
        }

        $this->response->throwJson([
            'ok' => true,
            'cid' => $cid,
            'status' => $status,
            'withdrawn' => $wasPublic && $status === 'draft',
            'rebuildQueued' => $rebuildQueued,
            'publicPath' => '/moments/' . $cid . '/',
            'message' => $message,
        ]);
    }

    private function retryRebuild()
    {
        // Site-wide rebuild retry for admins. cid is optional context and may
        // refer to a moment that was already deleted (delete succeeded, enqueue failed).
        $cid = (int) $this->request->get('cid');
        $queued = $this->enqueueRebuild();
        $this->response->throwJson([
            'ok' => true,
            'cid' => $cid > 0 ? $cid : null,
            'rebuildQueued' => $queued,
            'message' => $queued ? '已重新入队，等待更新' : '重建入队失败，请稍后重试',
        ]);
    }

    private function uploadImage(User $user)
    {
        if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
            $this->fail(400, 'no-file');
        }
        $file = $_FILES['file'];
        if (!empty($file['error'])) {
            $this->fail(400, 'upload-error-' . (int) $file['error']);
        }
        if ((int) $file['size'] <= 0 || (int) $file['size'] > self::MAX_BYTES) {
            $this->fail(400, 'size');
        }

        $tmp = (string) $file['tmp_name'];
        $name = (string) $file['name'];
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $blocked = ['heic', 'heif', 'avif'];
        if (in_array($ext, $blocked, true)) {
            $this->fail(400, 'heic-unsupported');
        }

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
        $allowed = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
        ];
        if (!isset($allowed[$mime])) {
            $this->fail(400, 'mime');
        }
        $ext = $allowed[$mime];

        $options = Options::alloc();
        $date = new DateTime('now', new DateTimeZone('Asia/Shanghai'));
        $relDir = 'usr/uploads/' . $date->format('Y/m/');
        $absDir = rtrim((string) __TYPECHO_ROOT_DIR__, '/\\') . '/' . $relDir;
        if (!is_dir($absDir) && !mkdir($absDir, 0755, true) && !is_dir($absDir)) {
            $this->fail(500, 'mkdir');
        }

        $basename = sprintf('%s-%s.%s', $date->format('dHis'), bin2hex(random_bytes(4)), $ext);
        $absPath = $absDir . $basename;
        if (!move_uploaded_file($tmp, $absPath)) {
            $this->fail(500, 'move');
        }

        $scrub = $this->normalizePublicImage($absPath, $mime);
        // JPEG public copies must be re-encoded; never claim privacy without cleaned=true.
        if ($mime === 'image/jpeg' && !$scrub['cleaned']) {
            @unlink($absPath);
            $this->fail(500, 'exif-scrub-failed');
        }

        $width = null;
        $height = null;
        $size = @getimagesize($absPath);
        if (is_array($size)) {
            $width = (int) $size[0];
            $height = (int) $size[1];
        }

        $url = rtrim((string) $options->siteUrl, '/') . '/' . $relDir . $basename;

        $db = Db::get();
        $now = time();
        $attachment = [
            'name' => $basename,
            'path' => '/' . $relDir . $basename,
            'size' => filesize($absPath) ?: 0,
            'type' => $mime,
            'mime' => $mime,
        ];
        $aid = $db->query($db->insert('table.contents')->rows([
            'title' => $basename,
            'slug' => $basename,
            'created' => $now,
            'modified' => $now,
            'text' => serialize($attachment),
            'order' => 0,
            'authorId' => (int) $user->uid,
            'template' => null,
            'type' => 'attachment',
            'status' => 'publish',
            'password' => '',
            'commentsNum' => 0,
            'allowComment' => 0,
            'allowPing' => 0,
            'allowFeed' => 0,
            'parent' => 0,
        ]));

        $this->response->throwJson([
            'ok' => true,
            'image' => [
                'aid' => (int) $aid,
                'src' => $url,
                'width' => $width,
                'height' => $height,
                'alt' => '',
            ],
            'scrub' => $scrub,
        ]);
    }

    private function deleteMoment()
    {
        $cid = (int) $this->request->get('cid');
        if ($cid <= 0 || !$this->isMomentCid($cid)) {
            $this->fail(404, 'not-found');
        }
        $confirm = (string) $this->request->get('confirm');
        if ($confirm !== 'delete') {
            $this->fail(400, 'confirm');
        }
        $db = Db::get();
        try {
            $db->query('START TRANSACTION');
            $db->query($db->delete('table.fields')->where('cid = ?', $cid));
            $db->query($db->delete('table.relationships')->where('cid = ?', $cid));
            $db->query($db->delete('table.contents')->where('cid = ?', $cid));
            $db->query('COMMIT');
        } catch (Throwable $e) {
            try {
                $db->query('ROLLBACK');
            } catch (Throwable $ignored) {
            }
            $this->fail(500, 'delete-failed');
        }
        $queued = $this->enqueueRebuild();
        $this->response->throwJson([
            'ok' => true,
            'deleted' => $cid,
            'rebuildQueued' => $queued,
            'message' => $queued ? '已删除，等待更新' : '已删除；重建未入队，请重试更新',
        ]);
    }

    private function rebuildStatus()
    {
        $this->response->throwJson([
            'ok' => true,
            'hint' => '内容保存成功不等于全网已可见；请查看重建状态或使用「重试更新」。',
            'statusAction' => Common::url('/action/rebuild-status', Options::alloc()->index),
        ]);
    }

    private function normalizeImages(array $images): array
    {
        $out = [];
        foreach ($images as $item) {
            if (!is_array($item)) {
                continue;
            }
            $src = trim((string) ($item['src'] ?? $item['url'] ?? ''));
            if ($src === '') {
                continue;
            }
            $row = ['src' => $src];
            if (isset($item['width'])) {
                $row['width'] = (int) $item['width'];
            }
            if (isset($item['height'])) {
                $row['height'] = (int) $item['height'];
            }
            if (isset($item['alt'])) {
                $row['alt'] = (string) $item['alt'];
            }
            if (isset($item['aid'])) {
                $row['aid'] = (int) $item['aid'];
            }
            $out[] = $row;
        }
        return $out;
    }

    private function normalizeTopics(array $topics): array
    {
        $out = [];
        foreach ($topics as $topic) {
            $t = trim((string) $topic);
            if ($t === '') {
                continue;
            }
            $out[] = mb_substr($t, 0, 32);
        }
        return array_values(array_unique($out));
    }

    private function adminTitle(string $text, int $now): string
    {
        $line = '';
        foreach (preg_split("/\r\n|\n|\r/", $text) as $part) {
            $part = trim($part);
            if ($part !== '') {
                $line = $part;
                break;
            }
        }
        $plain = trim(preg_replace('/[#>*_`\[\]()]/u', '', $line) ?? '');
        if ($plain !== '') {
            return mb_substr($plain, 0, 40);
        }
        return '闲话 · ' . gmdate('Y-m-d', $now + 8 * 3600);
    }

    private function stripMarkdownMarker(string $text): string
    {
        return (string) preg_replace('/^<!--markdown-->\s*/i', '', $text);
    }

    private function isMomentCid(int $cid): bool
    {
        return $this->readField($cid, self::FIELD_KIND) === 'moment';
    }

    private function readField(int $cid, string $name): string
    {
        $db = Db::get();
        $row = $db->fetchRow(
            $db->select('str_value')->from('table.fields')->where('cid = ? AND name = ?', $cid, $name)->limit(1)
        );
        return $row ? trim((string) $row['str_value']) : '';
    }

    private function readJsonField(int $cid, string $name)
    {
        $raw = $this->readField($cid, $name);
        if ($raw === '') {
            return null;
        }
        $parsed = json_decode($raw, true);
        return is_array($parsed) ? $parsed : null;
    }

    private function upsertField(int $cid, string $name, string $value): void
    {
        $db = Db::get();
        $existing = $db->fetchRow(
            $db->select('cid')->from('table.fields')->where('cid = ? AND name = ?', $cid, $name)->limit(1)
        );
        $rows = [
            'type' => 'str',
            'str_value' => $value,
            'int_value' => 0,
            'float_value' => 0,
        ];
        if ($existing) {
            $db->query($db->update('table.fields')->rows($rows)->where('cid = ? AND name = ?', $cid, $name));
        } else {
            $db->query($db->insert('table.fields')->rows(array_merge([
                'cid' => $cid,
                'name' => $name,
            ], $rows)));
        }
    }

    private function findCompletedByClientToken(string $token): ?int
    {
        $db = Db::get();
        $row = $db->fetchRow(
            $db->select('cid')->from('table.fields')
                ->where('name = ? AND str_value = ?', self::FIELD_TOKEN, $token)
                ->limit(1)
        );
        if (!$row) {
            return null;
        }
        $cid = (int) $row['cid'];
        if ($this->readField($cid, self::FIELD_KIND) !== 'moment') {
            return null;
        }
        if ($this->readField($cid, self::FIELD_TOKEN_DONE) !== '1') {
            return null;
        }
        return $cid;
    }

    private function enqueueRebuild(): bool
    {
        if (!class_exists('AutoRebuild_Plugin', false)) {
            $pluginFile = __TYPECHO_ROOT_DIR__ . '/usr/plugins/AutoRebuild/Plugin.php';
            if (is_readable($pluginFile)) {
                require_once $pluginFile;
            }
        }
        if (!class_exists('AutoRebuild_Plugin') || !method_exists('AutoRebuild_Plugin', 'trigger')) {
            error_log('Moments: AutoRebuild trigger unavailable');
            return false;
        }
        try {
            return AutoRebuild_Plugin::trigger() === true;
        } catch (Throwable $e) {
            error_log('Moments: rebuild enqueue failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Orient JPEG using EXIF when possible, then rewrite to drop GPS/metadata.
     * cleaned=true only after a successful re-encode. Passthrough formats stay cleaned=false.
     * @return array{cleaned:bool,oriented:bool,hadGps:bool,reason:?string}
     */
    private function normalizePublicImage(string $path, string $mime): array
    {
        $result = ['cleaned' => false, 'oriented' => false, 'hadGps' => false, 'reason' => null];
        if ($mime === 'image/jpeg') {
            if (!function_exists('exif_read_data')) {
                $result['reason'] = 'exif-missing';
                return $result;
            }
            if (!function_exists('imagecreatefromjpeg') || !function_exists('imagejpeg')) {
                $result['reason'] = 'gd-missing';
                return $result;
            }
            $orientation = 1;
            $hadGps = false;
            $exif = @exif_read_data($path, null, true);
            if (is_array($exif)) {
                $hadGps = !empty($exif['GPS']);
                $orientation = (int) ($exif['IFD0']['Orientation'] ?? $exif['Orientation'] ?? 1);
            }
            $result['hadGps'] = $hadGps;
            $img = @imagecreatefromjpeg($path);
            if (!$img) {
                $result['reason'] = 'jpeg-decode-failed';
                return $result;
            }
            $rotated = $this->applyOrientation($img, $orientation);
            if ($rotated !== $img) {
                imagedestroy($img);
                $img = $rotated;
                $result['oriented'] = true;
            }
            $ok = imagejpeg($img, $path, 90);
            imagedestroy($img);
            $result['cleaned'] = (bool) $ok;
            if (!$ok) {
                $result['reason'] = 'jpeg-encode-failed';
            }
            return $result;
        }

        // PNG/WebP/GIF: no EXIF scrub pipeline in v1 — do not claim cleaned.
        $result['reason'] = 'format-passthrough';
        return $result;
    }

    private function acquireMysqlLock(string $name): void
    {
        $db = Db::get();
        $quoted = "'" . str_replace(["\\", "\0", "'"], ["\\\\", '', "\\'"], $name) . "'";
        $row = $db->fetchRow($db->query('SELECT GET_LOCK(' . $quoted . ', 5) AS g'));
        if (!(int) ($row['g'] ?? 0)) {
            $this->fail(409, 'token-busy');
        }
    }

    private function releaseMysqlLock(string $name): void
    {
        $db = Db::get();
        $quoted = "'" . str_replace(["\\", "\0", "'"], ["\\\\", '', "\\'"], $name) . "'";
        $db->query('SELECT RELEASE_LOCK(' . $quoted . ')');
    }

    /** @param \GdImage|resource $img */
    private function applyOrientation($img, int $orientation)
    {
        switch ($orientation) {
            case 2:
                if (function_exists('imageflip')) {
                    imageflip($img, IMG_FLIP_HORIZONTAL);
                }
                return $img;
            case 3:
                return imagerotate($img, 180, 0) ?: $img;
            case 4:
                if (function_exists('imageflip')) {
                    imageflip($img, IMG_FLIP_VERTICAL);
                }
                return $img;
            case 5:
                if (function_exists('imageflip')) {
                    imageflip($img, IMG_FLIP_VERTICAL);
                }
                return imagerotate($img, -90, 0) ?: $img;
            case 6:
                return imagerotate($img, -90, 0) ?: $img;
            case 7:
                if (function_exists('imageflip')) {
                    imageflip($img, IMG_FLIP_HORIZONTAL);
                }
                return imagerotate($img, -90, 0) ?: $img;
            case 8:
                return imagerotate($img, 90, 0) ?: $img;
            default:
                return $img;
        }
    }

    private function fail(int $status, string $error): void
    {
        $this->response->setStatus($status);
        $this->response->throwJson(['ok' => false, 'error' => $error]);
    }
}
