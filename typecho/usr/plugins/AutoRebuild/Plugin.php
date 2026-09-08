<?php
use Typecho\Common;
use Typecho\Plugin;
use Typecho\Plugin\PluginInterface;
use Typecho\Request;
use Typecho\Widget\Helper\Form;
use Utils\Helper;
use Widget\Options;
use Widget\Security;
use Widget\User;

require_once __DIR__ . '/Action.php';

/**
 * AutoRebuild — enqueue Astro rebuilds on Typecho content changes.
 *
 * Typecho Plugin
 * @package AutoRebuild
 * @author AndyYan
 * @version 1.3.1
 * @link https://www.andy-y.cn
 */
class AutoRebuild_Plugin implements PluginInterface
{
    public static function activate()
    {
        foreach (['Widget_Contents_Post_Edit', 'Widget_Contents_Page_Edit'] as $hook) {
            $factory = Plugin::factory($hook);
            $factory->finishPublish = ['AutoRebuild_Plugin', 'trigger'];
            $factory->mark          = ['AutoRebuild_Plugin', 'trigger'];
            $factory->finishDelete  = ['AutoRebuild_Plugin', 'trigger'];
        }
        // Typecho 1.2 Metas insert/update/delete do not call pluginHandle, and
        // Response::respond() exits before index.php end. Watch the action POST
        // at begin and enqueue after the DB write via shutdown.
        Plugin::factory('index.php')->begin = ['AutoRebuild_Plugin', 'watchMetaWrites'];
        Helper::addAction('rebuild-status', 'AutoRebuild_Action');
        Plugin::factory('admin/write-post.php')->option = ['AutoRebuild_Plugin', 'writeOption'];
        Plugin::factory('admin/write-post.php')->bottom = ['AutoRebuild_Plugin', 'writePostHint'];
        Plugin::factory('Widget_Base_Contents')->isFieldReadOnly = ['AutoRebuild_Plugin', 'isAstroPathReadOnly'];
        Plugin::factory('admin/footer.php')->end = ['AutoRebuild_Plugin', 'adminFooter'];
        return _t('AutoRebuild 已启用：发布、标签和分类变更将入队重建');
    }

    public static function deactivate()
    {
        Helper::removeAction('rebuild-status');
    }

    public static function config(Form $form)
    {
    }

    public static function personalConfig(Form $form)
    {
    }

    /**
     * Enqueue a rebuild after tag/category admin writes.
     * Typecho 1.2 Widget\Base\Metas has no pluginHandle on insert/update/delete.
     */
    public static function watchMetaWrites(...$args)
    {
        $request = Request::getInstance();
        if (!$request->isPost()) {
            return;
        }
        $haystack = strtolower(implode(' ', array_filter([
            (string) $request->getPathInfo(),
            (string) $request->getRequestUri(),
        ])));
        $kind = null;
        if (strpos($haystack, 'metas-tag-edit') !== false) {
            $kind = 'tag';
        } elseif (strpos($haystack, 'metas-category-edit') !== false) {
            $kind = 'category';
        }
        if ($kind === null) {
            return;
        }
        $do = (string) $request->get('do');
        $allowed = $kind === 'tag'
            ? ['insert', 'update', 'delete', 'merge']
            : ['insert', 'update', 'delete', 'merge', 'sort'];
        if (!in_array($do, $allowed, true)) {
            return;
        }
        register_shutdown_function(['AutoRebuild_Plugin', 'trigger']);
    }

    /**
     * Hook signatures differ; full SSG does not need cid, so accept variadic args.
     * @return bool true only when rebuild-api accepted the job (HTTP 202)
     */
    public static function trigger(...$args)
    {
        $secretFile = getenv('WEBHOOK_SECRET_FILE') ?: __TYPECHO_ROOT_DIR__ . '/usr/.secrets/webhook_secret';
        if (!is_readable($secretFile)) {
            error_log('AutoRebuild: webhook secret is not readable');
            return false;
        }
        $secret = trim((string) file_get_contents($secretFile));
        if ($secret === '') {
            error_log('AutoRebuild: webhook secret is empty');
            return false;
        }

        $body = json_encode([
            'event' => 'typecho-content-changed',
            'ts'    => time(),
            'nonce' => bin2hex(random_bytes(16)),
        ], JSON_UNESCAPED_SLASHES);
        $sig = 'sha256=' . hash_hmac('sha256', $body, $secret);

        // Compose service name — 127.0.0.1 would loop back to Typecho itself.
        $endpoint = getenv('AUTO_REBUILD_ENDPOINT') ?: 'http://rebuild-api:9000/hooks/rebuild';
        if ($endpoint !== 'http://rebuild-api:9000/hooks/rebuild') {
            error_log('AutoRebuild: rejected non-allowlisted endpoint');
            return false;
        }
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Signature: ' . $sig,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 5,
        ]);
        $result = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($result === false || $status !== 202) {
            error_log(sprintf('AutoRebuild: enqueue failed status=%d error=%s', $status, $error));
            return false;
        }
        return true;
    }

    public static function isAstroPathReadOnly($name)
    {
        return $name === 'astroPath';
    }

    public static function writeOption($post = null)
    {
        $value = '';
        if (is_object($post) && isset($post->fields) && isset($post->fields->astroPath)) {
            $value = (string) $post->fields->astroPath;
        }
        $valueAttr = htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
        echo <<<HTML
<section class="typecho-post-option" id="andy-astro-path-option">
  <label for="andy-astro-path" class="typecho-label">公开路径（仅首次发布）</label>
  <p class="andy-astro-path-row">
    <span class="andy-astro-path-prefix">/posts/</span>
    <input type="text" id="andy-astro-path" name="fields[astroPath]" value="{$valueAttr}" placeholder="pi-notes" spellcheck="false" autocomplete="off" />
    <span class="andy-astro-path-suffix">/</span>
  </p>
  <p class="description" id="andy-astro-path-help">小写英文和连字符。留空则按标题生成；中文标题会变成 item-文章ID。发布后改这里不会改线上地址。</p>
</section>
HTML;
    }

    public static function writePostHint()
    {
        $root = rtrim((string) Options::alloc()->pluginUrl, '/');
        $js = htmlspecialchars($root . '/AutoRebuild/assets/path-hint.js', ENT_QUOTES, 'UTF-8');
        echo "<script src=\"{$js}\"></script>\n";
    }

    public static function adminFooter()
    {
        $user = User::alloc();
        if (!$user->hasLogin() || !$user->pass('administrator', true)) {
            return;
        }
        $options = Options::alloc();
        $security = Security::alloc();
        // rewrite=0 (and no .htaccess) means Apache 404s /action/*;
        // $options->index is rootUrl or rootUrl/index.php, same as Typecho logout.
        $action = Common::url('/action/rebuild-status', $options->index);
        $token = $security->getToken($security->request->getRequestUrl());
        $root = rtrim((string) $options->pluginUrl, '/');
        $css = htmlspecialchars($root . '/AutoRebuild/assets/status.css', ENT_QUOTES, 'UTF-8');
        $js = htmlspecialchars($root . '/AutoRebuild/assets/status.js', ENT_QUOTES, 'UTF-8');
        $pathHint = htmlspecialchars($root . '/AutoRebuild/assets/path-hint.js', ENT_QUOTES, 'UTF-8');
        $actionAttr = htmlspecialchars($action, ENT_QUOTES, 'UTF-8');
        $tokenAttr = htmlspecialchars($token, ENT_QUOTES, 'UTF-8');
        echo <<<HTML
<link rel="stylesheet" href="{$css}" />
<div id="andy-rebuild-status" hidden data-url="{$actionAttr}" data-token="{$tokenAttr}">
  <button type="button" class="andy-rebuild-toggle" aria-expanded="false">构建</button>
  <div class="andy-rebuild-panel" hidden>
    <p class="andy-rebuild-meta"></p>
    <ol class="andy-rebuild-steps"></ol>
    <pre class="andy-rebuild-log"></pre>
  </div>
</div>
<script src="{$js}"></script>
<script src="{$pathHint}"></script>
HTML;
    }
}
