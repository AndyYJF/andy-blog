<?php
use Typecho\Db;
use Typecho\Widget;
use Widget\ActionInterface;
use Widget\Security;
use Widget\User;

/**
 * I18n admin endpoints: approve / disable / enable / retry.
 * All POST, administrator-only, CSRF-protected. Approval is the only writer
 * of the approved pointer; the worker can never call these (no admin session).
 */
class I18n_Action extends Widget implements ActionInterface
{
    public function action()
    {
        $user = User::alloc();
        if (!$user->hasLogin() || !$user->pass('administrator', true)) {
            $this->response->setStatus(403);
            $this->response->throwJson(['error' => 'forbidden']);
        }
        if (!$this->request->isPost()) {
            $this->response->setStatus(405);
            $this->response->throwJson(['error' => 'method']);
        }
        Security::alloc()->protect();

        $do = (string) $this->request->get('do');
        try {
            switch ($do) {
                case 'approve':
                    $this->response->throwJson($this->approve());
                    break;
                case 'disable':
                case 'enable':
                    $this->response->throwJson($this->setPublicationState($do === 'enable' ? 'enabled' : 'disabled'));
                    break;
                case 'retry':
                    $this->response->throwJson($this->retryJob());
                    break;
                default:
                    $this->response->setStatus(400);
                    $this->response->throwJson(['error' => 'unknown-do']);
            }
        } catch (\Throwable $e) {
            $this->response->setStatus(500);
            $this->response->throwJson(['error' => 'failed', 'detail' => substr($e->getMessage(), 0, 200)]);
        }
    }

    /**
     * Approve a specific draft version, bound to its content digest.
     * One transaction: move approved pointer + stamp proofread + outbox + ledger.
     */
    private function approve(): array
    {
        $cid = (int) $this->request->get('cid');
        $locale = (string) $this->request->get('locale');
        $versionId = (int) $this->request->get('versionId');
        $digest = (string) $this->request->get('digest');
        if ($cid <= 0 || $versionId <= 0 || !preg_match('/^[a-f0-9]{64}$/', $digest)) {
            throw new \InvalidArgumentException('bad-params');
        }
        $db = Db::get();
        $p = $db->getPrefix();
        $q = ['I18n_Plugin', 'sqlStr'];
        $who = 'human:' . (string) User::alloc()->uid;

        $db->query('START TRANSACTION', Db::WRITE, Db::UPDATE);
        try {
            $heads = $db->query(
                "SELECT * FROM {$p}i18n_translation_head
                 WHERE cid = {$cid} AND locale = {$q($locale)} FOR UPDATE",
                Db::WRITE,
                Db::SELECT
            );
            if (!$heads) {
                throw new \RuntimeException('head-missing');
            }
            $versions = $db->query(
                "SELECT version_id, content_digest FROM {$p}i18n_translation_version
                 WHERE version_id = {$versionId} AND cid = {$cid} AND locale = {$q($locale)}",
                Db::WRITE,
                Db::SELECT
            );
            if (!$versions) {
                throw new \RuntimeException('version-missing');
            }
            if (!hash_equals($versions[0]['content_digest'], $digest)) {
                throw new \RuntimeException('digest-mismatch');
            }

            $db->query(
                "UPDATE {$p}i18n_translation_head
                 SET approved_version_id = {$versionId}, updated_at = UNIX_TIMESTAMP()
                 WHERE cid = {$cid} AND locale = {$q($locale)}",
                Db::WRITE,
                Db::UPDATE
            );
            $db->query(
                "UPDATE {$p}i18n_translation_version
                 SET proofread_at = UNIX_TIMESTAMP(), proofreader = {$q($who)}
                 WHERE version_id = {$versionId} AND content_digest = {$q($digest)}",
                Db::WRITE,
                Db::UPDATE
            );
            $idem = "publish:{$cid}:{$locale}:{$versionId}";
            $db->query(
                "INSERT IGNORE INTO {$p}i18n_publish_outbox
                   (idem_key, cid, locale, version_id, status, next_retry_at, created_at, updated_at)
                 VALUES ({$q($idem)}, {$cid}, {$q($locale)}, {$versionId}, 'pending',
                   UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())",
                Db::WRITE,
                Db::UPDATE
            );
            // translation_available_at is write-once: the first approval time never moves.
            $db->query(
                "INSERT INTO {$p}i18n_publication_ledger
                   (cid, locale, translation_available_at, updated_at)
                 VALUES ({$cid}, {$q($locale)}, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE
                   translation_available_at = IFNULL(translation_available_at, VALUES(translation_available_at)),
                   updated_at = VALUES(updated_at)",
                Db::WRITE,
                Db::UPDATE
            );
            $db->query('COMMIT', Db::WRITE, Db::UPDATE);
            return ['ok' => true, 'cid' => $cid, 'locale' => $locale, 'approvedVersionId' => $versionId];
        } catch (\Throwable $e) {
            try {
                $db->query('ROLLBACK', Db::WRITE, Db::UPDATE);
            } catch (\Throwable $ignored) {
            }
            throw $e;
        }
    }

    private function setPublicationState(string $state): array
    {
        $cid = (int) $this->request->get('cid');
        $locale = (string) $this->request->get('locale');
        if ($cid <= 0) {
            throw new \InvalidArgumentException('bad-params');
        }
        $db = Db::get();
        $p = $db->getPrefix();
        $q = ['I18n_Plugin', 'sqlStr'];
        $db->query('START TRANSACTION', Db::WRITE, Db::UPDATE);
        try {
            $db->query(
                "UPDATE {$p}i18n_translation_head
                 SET publication_state = {$q($state)}, updated_at = UNIX_TIMESTAMP()
                 WHERE cid = {$cid} AND locale = {$q($locale)}",
                Db::WRITE,
                Db::UPDATE
            );
            if ($state === 'disabled') {
                $db->query(
                    "UPDATE {$p}i18n_translation_job
                     SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
                     WHERE cid = {$cid} AND locale = {$q($locale)} AND status IN ('queued','leased','failed')",
                    Db::WRITE,
                    Db::UPDATE
                );
                $db->query(
                    "UPDATE {$p}i18n_publish_outbox
                     SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
                     WHERE cid = {$cid} AND locale = {$q($locale)} AND status IN ('pending','accepted','needs_fix')",
                    Db::WRITE,
                    Db::UPDATE
                );
            }
            $db->query('COMMIT', Db::WRITE, Db::UPDATE);
            return ['ok' => true, 'cid' => $cid, 'locale' => $locale, 'publicationState' => $state];
        } catch (\Throwable $e) {
            try {
                $db->query('ROLLBACK', Db::WRITE, Db::UPDATE);
            } catch (\Throwable $ignored) {
            }
            throw $e;
        }
    }

    private function retryJob(): array
    {
        $jobId = (int) $this->request->get('jobId');
        if ($jobId <= 0) {
            throw new \InvalidArgumentException('bad-params');
        }
        $db = Db::get();
        $p = $db->getPrefix();
        $db->query(
            "UPDATE {$p}i18n_translation_job
             SET status = 'queued', lease_owner = NULL, lease_until = NULL,
                 next_run_at = UNIX_TIMESTAMP(), updated_at = UNIX_TIMESTAMP()
             WHERE job_id = {$jobId} AND status IN ('failed','superseded','cancelled')",
            Db::WRITE,
            Db::UPDATE
        );
        return ['ok' => true, 'jobId' => $jobId];
    }
}
