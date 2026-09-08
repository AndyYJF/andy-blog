<?php
if (!defined('__TYPECHO_ADMIN__')) {
    exit;
}

use Typecho\Common;
use Widget\Options;
use Widget\Security;
use Widget\User;

$user = User::alloc();
$user->pass('administrator');
$options = Options::alloc();
$security = Security::alloc();
$actionUrl = Common::url('/action/moments', $options->index);
$csrfToken = $security->getToken($security->request->getRequestUrl());
$assetBase = rtrim($options->pluginUrl, '/') . '/Moments/assets';

include 'header.php';
include 'menu.php';
?>
<div class="main">
  <div class="body container">
    <div class="typecho-page-title">
      <h2>闲话</h2>
    </div>
    <div class="row typecho-page-main" role="main">
      <div class="col-mb-12">
        <div
          id="moments-app"
          data-action-url="<?php echo htmlspecialchars($actionUrl, ENT_QUOTES, 'UTF-8'); ?>"
          data-token="<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>"
        >
          <section class="moments-composer">
            <label class="sr-only" for="moment-text">说点什么</label>
            <textarea id="moment-text" rows="5" placeholder="说点什么……" maxlength="8000"></textarea>

            <div class="moments-toolbar">
              <label class="moments-add">
                ＋ 添加图片
                <input id="moment-files" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden>
              </label>
              <button type="button" id="moment-toggle-more" class="btn">更多选项</button>
            </div>

            <ul id="moment-previews" class="moments-previews" hidden></ul>
            <p id="moment-upload-hint" class="moments-hint" hidden></p>

            <div id="moment-more" class="moments-more" hidden>
              <label>
                可选话题（逗号分隔）
                <input id="moment-topics" type="text" placeholder="例如：折腾,DN42">
              </label>
              <label class="moments-check">
                <input id="moment-allow-comment" type="checkbox" checked>
                允许评论
              </label>
            </div>

            <div class="moments-actions">
              <button type="button" id="moment-draft" class="btn">保存草稿</button>
              <button type="button" id="moment-publish" class="btn primary">发布</button>
              <button type="button" id="moment-rebuild" class="btn" hidden>重试更新</button>
            </div>
            <p id="moment-status" class="moments-status" role="status" aria-live="polite"></p>
          </section>

          <section class="moments-list-wrap">
            <h3>最近闲话</h3>
            <div class="moments-list-tools">
              <label class="sr-only" for="moment-search">按 CID 或关键词搜索</label>
              <input id="moment-search" type="search" placeholder="CID 或关键词">
              <button type="button" id="moment-search-btn" class="btn">搜索</button>
            </div>
            <ul id="moment-list" class="moments-list"></ul>
            <button type="button" id="moment-load-more" class="btn" hidden>加载更多</button>
          </section>
        </div>
      </div>
    </div>
  </div>
</div>
<link rel="stylesheet" href="<?php echo htmlspecialchars($assetBase . '/panel.css', ENT_QUOTES, 'UTF-8'); ?>">
<script src="<?php echo htmlspecialchars($assetBase . '/panel.js', ENT_QUOTES, 'UTF-8'); ?>" defer></script>
<?php
include 'copyright.php';
include 'common-js.php';
include 'footer.php';
?>
