<?php
use Typecho\Plugin;
use Typecho\Plugin\PluginInterface;
use Typecho\Widget\Helper\Form;
use Widget\Options;

/**
 * AstroPreview — Joe editor live preview uses the Astro article look.
 *
 * Typecho Plugin
 * @package AstroPreview
 * @author AndyYan
 * @version 1.0.0
 * @link https://www.andy-y.cn
 */
class AstroPreview_Plugin implements PluginInterface
{
    public static function activate()
    {
        Plugin::factory('admin/write-post.php')->bottom = ['AstroPreview_Plugin', 'assets'];
        Plugin::factory('admin/write-page.php')->bottom = ['AstroPreview_Plugin', 'assets'];
        return _t('AstroPreview 已启用：写作页右侧预览使用当前 Astro 正文样式');
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

    public static function assets()
    {
        $root = rtrim((string) Options::alloc()->pluginUrl, '/');
        $base = $root . '/AstroPreview/assets';
        $css = htmlspecialchars($base . '/preview.css', ENT_QUOTES, 'UTF-8');
        $katex = htmlspecialchars($base . '/katex.min.css', ENT_QUOTES, 'UTF-8');
        $js = htmlspecialchars($base . '/preview.js', ENT_QUOTES, 'UTF-8');
        $mermaid = htmlspecialchars($base . '/mermaid.min.js', ENT_QUOTES, 'UTF-8');
        echo <<<HTML
<link rel="stylesheet" href="{$css}" />
<link rel="stylesheet" href="{$katex}" />
<script>window.AndyAstroPreviewMermaidSrc = "{$mermaid}";</script>
<script src="{$js}"></script>
HTML;
    }
}
