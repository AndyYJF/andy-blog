<?php
/**
 * Install or refresh AutoRebuild handles (posts, pages, tags, categories, action, footer, write-post path hint).
 * Run inside the Typecho 1.2.1 container after copying plugin files.
 */
declare(strict_types=1);

define('__TYPECHO_ADMIN__', true);
require '/app/config.inc.php';

use Typecho\Db;
use Typecho\Plugin;
use Widget\Options;

$pluginName = 'AutoRebuild';
Options::alloc();
[$pluginFileName, $className] = Plugin::portal($pluginName, __TYPECHO_ROOT_DIR__ . '/usr/plugins');
require_once $pluginFileName;
if (!class_exists($className) && class_exists('AutoRebuild_Plugin')) {
    $className = 'AutoRebuild_Plugin';
}
if (!class_exists($className) || !method_exists($className, 'activate')) {
    file_put_contents('php://stderr', "invalid-plugin\n");
    exit(65);
}
if (!method_exists($className, 'watchMetaWrites') || !method_exists($className, 'writeOption')) {
    file_put_contents('php://stderr', "plugin-missing-meta-hooks\n");
    exit(65);
}

$export = Plugin::export();
if (isset($export['activated'][$pluginName])) {
    if (method_exists($className, 'deactivate')) {
        call_user_func([$className, 'deactivate']);
    }
    Plugin::deactivate($pluginName);
}

call_user_func([$className, 'activate']);
Plugin::activate($pluginName);
Db::get()->query(
    Db::get()->update('table.options')
        ->rows(['value' => serialize(Plugin::export())])
        ->where('name = ?', 'plugins')
);
echo "activated\n";
