<?php
use Typecho\Db;
use Typecho\Plugin;
use Typecho\Plugin\PluginInterface;
use Typecho\Widget\Helper\Form;
use Utils\Helper;

require_once __DIR__ . '/Action.php';

/**
 * I18n — bilingual publishing support (source revision registry + translation jobs).
 *
 * Wraps each Typecho content save in a transaction (write → finishPublish/finishSave)
 * so the source_state registry and the content write commit or roll back together.
 * Requires scripts/i18n-migrate.js to have been applied to the same database first.
 *
 * Typecho Plugin
 * @package I18n
 * @author AndyYan
 * @version 0.1.0
 * @link https://www.andy-y.cn
 */
class I18n_Plugin implements PluginInterface
{
    /** Locales managed by this plugin. v1 is English only. */
    public const LOCALES = ['en'];

    /**
     * Typecho\Db has no quoteValue (only adapters do). Every value we ever
     * interpolate is internal: hashes, enums, idem keys, ints — so whitelist
     * instead of escaping. Anything else is a bug and must fail loudly.
     */
    public static function sqlStr(string $v): string
    {
        if (!preg_match('/^[a-zA-Z0-9:_-]{0,96}$/', $v)) {
            throw new \InvalidArgumentException('i18n: unsafe sql value');
        }
        return "'" . $v . "'";
    }

    public static function activate()
    {
        $db = Db::get();
        $prefix = $db->getPrefix();
        // Refuse activation before migrations: commitSource failing mid-save would
        // roll back the editor's content save. Fail here instead, loudly.
        try {
            $db->query(
                "SELECT 1 FROM {$prefix}i18n_source_state LIMIT 1",
                Db::WRITE,
                Db::SELECT
            );
        } catch (\Throwable $e) {
            throw new \Typecho\Plugin\Exception(
                'I18n 翻译表不存在，请先运行 scripts/i18n-migrate.js'
            );
        }

        foreach (['Widget_Contents_Post_Edit', 'Widget_Contents_Page_Edit'] as $hook) {
            $factory = Plugin::factory($hook);
            $factory->write         = ['I18n_Plugin', 'beginTx'];
            $factory->finishPublish = ['I18n_Plugin', 'commitSource'];
            $factory->finishSave    = ['I18n_Plugin', 'commitSource'];
            $factory->finishMark    = ['I18n_Plugin', 'cancelContent'];
            $factory->finishDelete  = ['I18n_Plugin', 'cancelContent'];
        }
        Helper::addAction('i18n', 'I18n_Action');
        Helper::addPanel(3, 'I18n/panel.php', '翻译', '译文、审批与发布队列', 'administrator');
        return _t('I18n 已启用：保存文章将登记源版本并入队英文翻译');
    }

    public static function deactivate()
    {
        Helper::removeAction('i18n');
        Helper::removePanel(3, 'I18n/panel.php');
    }

    public static function config(Form $form)
    {
    }

    public static function personalConfig(Form $form)
    {
    }

    /**
     * write hook (Edit.php:286) — fires before publish()/save() on the same request.
     * Opens a transaction on the WRITE handle (read/write are separate physical
     * connections in Typecho's Db pool); all core writes that follow join it.
     * Must return $contents: the handle assigns the return value back.
     */
    public static function beginTx($contents, $widget)
    {
        Db::get()->query('START TRANSACTION', Db::WRITE, Db::UPDATE);
        return $contents;
    }

    /**
     * finishPublish / finishSave hook — core writes are done, still inside our
     * transaction. Register the new source revision, enqueue translation jobs
     * for public content, then COMMIT. Any failure rolls back the whole save:
     * content and its source registration live or die together.
     */
    public static function commitSource($contents, $edit)
    {
        $db = Db::get();
        $prefix = $db->getPrefix();
        try {
            // Hash the FINAL written values from the $contents array, not the
            // widget properties: Edit.php:282 prepends the '<!--markdown-->'
            // marker to $contents['text'] before publish()/save(), so widget
            // values lack it. The worker hashes the stored contents row —
            // hashing widget values here made every plugin-created job hash
            // mismatch and supersede (2026-10-01, cid 142/107).
            $cid = (int) $edit->cid;
            $title = (string) ($contents['title'] ?? $edit->title);
            $text = (string) ($contents['text'] ?? $edit->text);
            $status = (string) ($contents['status'] ?? $edit->status);
            $type = (string) ($contents['type'] ?? $edit->type);
            $password = (string) ($contents['password'] ?? ($edit->password ?? ''));
            $hash = hash('sha256', $title . "\0" . $text);
            $q = ['I18n_Plugin', 'sqlStr'];

            $db->query(
                "INSERT INTO {$prefix}i18n_source_state
                   (cid, source_revision, source_hash, visibility, content_type, saved_at)
                 VALUES ({$cid}, 1, {$q($hash)}, {$q($status)}, {$q($type)}, UNIX_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE
                   source_revision = source_revision + 1,
                   source_hash = VALUES(source_hash),
                   visibility = VALUES(visibility),
                   content_type = VALUES(content_type),
                   saved_at = VALUES(saved_at)",
                Db::WRITE,
                Db::UPDATE
            );

            $isPublic = in_array($type, ['post', 'page'], true)
                && $status === 'publish'
                && $password === '';

            // Moments are stored as typecho posts but are out of translation
            // scope (P3 decision): skip job enqueue for them.
            $isMoment = false;
            if ($isPublic && $type === 'post') {
                $kindStmt = $db->query(
                    "SELECT str_value FROM {$prefix}fields WHERE cid = {$cid} AND name = 'content_kind' LIMIT 1",
                    Db::WRITE,
                    Db::SELECT
                );
                $kindRow = $kindStmt instanceof \PDOStatement ? $kindStmt->fetch(\PDO::FETCH_ASSOC) : null;
                $isMoment = $kindRow && trim((string) $kindRow['str_value']) === 'moment';
            }

            if ($isPublic && !$isMoment) {
                $rows = $db->query(
                    "SELECT source_revision FROM {$prefix}i18n_source_state WHERE cid = {$cid}",
                    Db::WRITE,
                    Db::SELECT
                );
                $revRow = $rows instanceof \PDOStatement ? $rows->fetch(\PDO::FETCH_ASSOC) : null;
                $revision = (int) ($revRow['source_revision'] ?? 0);
                foreach (self::LOCALES as $locale) {
                    $idem = "translate:{$cid}:{$locale}:{$revision}";
                    $db->query(
                        "INSERT IGNORE INTO {$prefix}i18n_translation_job
                           (idem_key, cid, locale, status, expected_source_revision,
                            expected_source_hash, next_run_at, created_at, updated_at)
                         VALUES ({$q($idem)}, {$cid}, {$q($locale)}, 'queued',
                           {$revision}, {$q($hash)}, UNIX_TIMESTAMP(),
                           UNIX_TIMESTAMP(), UNIX_TIMESTAMP())",
                        Db::WRITE,
                        Db::UPDATE
                    );
                }
            } else {
                self::cancelQueued($db, $prefix, $cid);
            }

            $db->query('COMMIT', Db::WRITE, Db::UPDATE);
        } catch (\Throwable $e) {
            try {
                $db->query('ROLLBACK', Db::WRITE, Db::UPDATE);
            } catch (\Throwable $ignored) {
            }
            throw $e;
        }
    }

    /**
     * finishMark / finishDelete hook — withdrawal, deletion, password protection.
     * These paths never pass through the write hook, so run a short private
     * transaction: cancel outstanding translation work and record the new
     * visibility. Live versions stay in the tables; actual page removal is
     * driven by the release manifest (P2).
     */
    public static function cancelContent(...$args)
    {
        // finishDelete($post, $edit); finishMark($status, $post, $edit)
        $post = $args[0];
        if (count($args) === 3) {
            $post = $args[1];
        }
        $cid = (int) ($post['cid'] ?? 0);
        if ($cid <= 0) {
            return;
        }
        $db = Db::get();
        $prefix = $db->getPrefix();
        $q = ['I18n_Plugin', 'sqlStr'];
        try {
            $db->query('START TRANSACTION', Db::WRITE, Db::UPDATE);
            $status = (string) ($post['status'] ?? '');
            $type = (string) ($post['type'] ?? '');
            $db->query(
                "INSERT INTO {$prefix}i18n_source_state
                   (cid, source_revision, source_hash, visibility, content_type, saved_at)
                 VALUES ({$cid}, 1, '', {$q($status)}, {$q($type)}, UNIX_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE
                   source_revision = source_revision + 1,
                   visibility = VALUES(visibility),
                   content_type = VALUES(content_type),
                   saved_at = VALUES(saved_at)",
                Db::WRITE,
                Db::UPDATE
            );
            self::cancelQueued($db, $prefix, $cid);
            $db->query('COMMIT', Db::WRITE, Db::UPDATE);
        } catch (\Throwable $e) {
            try {
                $db->query('ROLLBACK', Db::WRITE, Db::UPDATE);
            } catch (\Throwable $ignored) {
            }
            throw $e;
        }
    }

    private static function cancelQueued(Db $db, string $prefix, int $cid): void
    {
        $db->query(
            "UPDATE {$prefix}i18n_translation_job
             SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
             WHERE cid = {$cid} AND status IN ('queued','leased','failed')",
            Db::WRITE,
            Db::UPDATE
        );
        $db->query(
            "UPDATE {$prefix}i18n_publish_outbox
             SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
             WHERE cid = {$cid} AND status IN ('pending','accepted','needs_fix')",
            Db::WRITE,
            Db::UPDATE
        );
    }
}
