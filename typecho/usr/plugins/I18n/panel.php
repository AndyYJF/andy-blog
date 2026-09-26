<?php
if (!defined('__TYPECHO_ADMIN__')) {
    exit;
}

use Typecho\Common;
use Typecho\Db;
use Widget\Options;
use Widget\Security;
use Widget\User;

$user = User::alloc();
$user->pass('administrator');
$options = Options::alloc();
$security = Security::alloc();
$actionUrl = Common::url('/action/i18n', $options->index);
$csrfToken = $security->getToken($security->request->getRequestUrl());

$db = Db::get();
$p = $db->getPrefix();
$e = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');

$heads = $db->query(
    "SELECT h.*, s.source_revision, s.visibility, s.content_type
     FROM {$p}i18n_translation_head h
     LEFT JOIN {$p}i18n_source_state s ON s.cid = h.cid
     ORDER BY h.updated_at DESC LIMIT 200",
    Db::READ,
    Db::SELECT
);
$jobs = $db->query(
    "SELECT * FROM {$p}i18n_translation_job
     WHERE status IN ('queued','leased','failed') ORDER BY updated_at DESC LIMIT 100",
    Db::READ,
    Db::SELECT
);
$outbox = $db->query(
    "SELECT * FROM {$p}i18n_publish_outbox
     WHERE status IN ('pending','accepted','needs_fix') ORDER BY updated_at DESC LIMIT 100",
    Db::READ,
    Db::SELECT
);
$drafts = $db->query(
    "SELECT v.* FROM {$p}i18n_translation_version v
     JOIN {$p}i18n_translation_head h
       ON h.cid = v.cid AND h.locale = v.locale AND h.draft_version_id = v.version_id
     WHERE h.approved_version_id IS NULL OR h.approved_version_id <> v.version_id
     ORDER BY v.created_at DESC LIMIT 50",
    Db::READ,
    Db::SELECT
);

$fmtTs = fn($ts) => $ts ? date('Y-m-d H:i:s', (int) $ts) : '—';

include 'header.php';
include 'menu.php';
?>
<div class="main">
  <div class="body container">
    <div class="typecho-page-title"><h2>翻译</h2></div>
    <div class="row typecho-page-main" role="main">
      <div class="col-mb-12">

        <h3>待审批草稿</h3>
        <table class="typecho-list-table">
          <thead><tr>
            <th>CID</th><th>语言</th><th>版本</th><th>源修订</th><th>作者</th><th>生成时间</th><th>操作</th>
          </tr></thead>
          <tbody>
          <?php foreach ($drafts as $v): ?>
            <tr>
              <td><?= $e($v['cid']) ?></td>
              <td><?= $e($v['locale']) ?></td>
              <td>#<?= $e($v['version_id']) ?> (rev <?= $e($v['translation_revision']) ?>)</td>
              <td><?= $e($v['source_revision']) ?></td>
              <td><?= $e($v['author']) ?></td>
              <td><?= $e($fmtTs($v['created_at'])) ?></td>
              <td>
                <form method="post" action="<?= $e($actionUrl) ?>" style="display:inline">
                  <input type="hidden" name="do" value="approve" />
                  <input type="hidden" name="_" value="<?= $e($csrfToken) ?>" />
                  <input type="hidden" name="cid" value="<?= $e($v['cid']) ?>" />
                  <input type="hidden" name="locale" value="<?= $e($v['locale']) ?>" />
                  <input type="hidden" name="versionId" value="<?= $e($v['version_id']) ?>" />
                  <input type="hidden" name="digest" value="<?= $e($v['content_digest']) ?>" />
                  <button type="submit" class="btn primary">批准并发布</button>
                </form>
              </td>
            </tr>
            <tr>
              <td colspan="7">
                <details>
                  <summary><?= $e($v['title']) ?></summary>
                  <pre style="white-space:pre-wrap;max-height:16em;overflow:auto"><?= $e($v['body']) ?></pre>
                </details>
              </td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$drafts): ?><tr><td colspan="7">无待审批草稿</td></tr><?php endif; ?>
          </tbody>
        </table>

        <h3>译文状态</h3>
        <table class="typecho-list-table">
          <thead><tr>
            <th>CID</th><th>语言</th><th>草稿</th><th>已批准</th><th>发布</th><th>等价</th><th>源修订</th><th>可见性</th><th>操作</th>
          </tr></thead>
          <tbody>
          <?php foreach ($heads as $h): ?>
            <tr>
              <td><?= $e($h['cid']) ?></td>
              <td><?= $e($h['locale']) ?></td>
              <td><?= $h['draft_version_id'] ? '#' . $e($h['draft_version_id']) : '—' ?></td>
              <td><?= $h['approved_version_id'] ? '#' . $e($h['approved_version_id']) : '—' ?></td>
              <td><?= $e($h['publication_state']) ?></td>
              <td><?= $e($h['equivalence_state']) ?></td>
              <td><?= $e($h['source_revision'] ?? '—') ?></td>
              <td><?= $e($h['visibility'] ?? '—') ?></td>
              <td>
                <form method="post" action="<?= $e($actionUrl) ?>" style="display:inline">
                  <input type="hidden" name="do" value="<?= $h['publication_state'] === 'enabled' ? 'disable' : 'enable' ?>" />
                  <input type="hidden" name="_" value="<?= $e($csrfToken) ?>" />
                  <input type="hidden" name="cid" value="<?= $e($h['cid']) ?>" />
                  <input type="hidden" name="locale" value="<?= $e($h['locale']) ?>" />
                  <button type="submit" class="btn"><?= $h['publication_state'] === 'enabled' ? '停用' : '启用' ?></button>
                </form>
              </td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$heads): ?><tr><td colspan="9">尚无译文记录</td></tr><?php endif; ?>
          </tbody>
        </table>

        <h3>翻译任务</h3>
        <table class="typecho-list-table">
          <thead><tr>
            <th>ID</th><th>CID</th><th>状态</th><th>尝试</th><th>最近错误</th><th>更新时间</th><th>操作</th>
          </tr></thead>
          <tbody>
          <?php foreach ($jobs as $j): ?>
            <tr>
              <td><?= $e($j['job_id']) ?></td>
              <td><?= $e($j['cid']) ?></td>
              <td><?= $e($j['status']) ?></td>
              <td><?= $e($j['attempts']) ?>/<?= $e($j['max_attempts']) ?></td>
              <td><?= $e($j['last_error'] ?? '') ?></td>
              <td><?= $e($fmtTs($j['updated_at'])) ?></td>
              <td>
                <?php if (in_array($j['status'], ['failed'], true)): ?>
                <form method="post" action="<?= $e($actionUrl) ?>" style="display:inline">
                  <input type="hidden" name="do" value="retry" />
                  <input type="hidden" name="_" value="<?= $e($csrfToken) ?>" />
                  <input type="hidden" name="jobId" value="<?= $e($j['job_id']) ?>" />
                  <button type="submit" class="btn">重试</button>
                </form>
                <?php endif; ?>
              </td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$jobs): ?><tr><td colspan="7">无待处理任务</td></tr><?php endif; ?>
          </tbody>
        </table>

        <h3>发布队列</h3>
        <table class="typecho-list-table">
          <thead><tr>
            <th>事件</th><th>CID</th><th>版本</th><th>状态</th><th>尝试</th><th>release</th><th>更新时间</th>
          </tr></thead>
          <tbody>
          <?php foreach ($outbox as $o): ?>
            <tr>
              <td><?= $e($o['event_id']) ?></td>
              <td><?= $e($o['cid']) ?></td>
              <td>#<?= $e($o['version_id']) ?></td>
              <td><?= $e($o['status']) ?></td>
              <td><?= $e($o['attempts']) ?></td>
              <td><?= $e($o['release_id'] ?? '—') ?></td>
              <td><?= $e($fmtTs($o['updated_at'])) ?></td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$outbox): ?><tr><td colspan="7">发布队列为空</td></tr><?php endif; ?>
          </tbody>
        </table>

      </div>
    </div>
  </div>
</div>
<?php
include 'copyright.php';
include 'common-js.php';
include 'footer.php';
