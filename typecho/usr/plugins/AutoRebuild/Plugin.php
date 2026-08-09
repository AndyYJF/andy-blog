<?php
use Typecho\Plugin;
use Typecho\Plugin\PluginInterface;
use Typecho\Widget\Helper\Form;

/**
 * AutoRebuild — enqueue Astro rebuilds on Typecho content changes.
 *
 * Typecho Plugin
 * @package AutoRebuild
 * @author AndyYan
 * @version 1.0.0
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
        return _t('AutoRebuild 已启用：发布/下线/删除将签名入队重建');
    }

    public static function deactivate()
    {
    }

    public static function config(Form $form)
    {
    }

    public static function personalConfig(Form $form)
    {
    }

    /**
     * Hook signatures differ; full SSG does not need cid, so accept variadic args.
     */
    public static function trigger(...$args)
    {
        $secretFile = getenv('WEBHOOK_SECRET_FILE') ?: __TYPECHO_ROOT_DIR__ . '/usr/.secrets/webhook_secret';
        if (!is_readable($secretFile)) {
            error_log('AutoRebuild: webhook secret is not readable');
            return;
        }
        $secret = trim((string) file_get_contents($secretFile));
        if ($secret === '') {
            error_log('AutoRebuild: webhook secret is empty');
            return;
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
            return;
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
        }
    }
}
