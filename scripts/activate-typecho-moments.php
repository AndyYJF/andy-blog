<?php
/**
 * Install or refresh Moments plugin panel/action.
 * Run inside the Typecho container after copying plugin files.
 */
declare(strict_types=1);

define('__TYPECHO_ADMIN__', true);
require '/app/config.inc.php';

use Typecho\Db;
use Typecho\Plugin;
use Widget\Options;

$pluginName = 'Moments';
Options::alloc();
[$pluginFileName, $className] = Plugin::portal($pluginName, __TYPECHO_ROOT_DIR__ . '/usr/plugins');
require_once $pluginFileName;
if (!class_exists($className) && class_exists('Moments_Plugin')) {
    $className = 'Moments_Plugin';
}
if (!class_exists($className) || !method_exists($className, 'activate')) {
    file_put_contents('php://stderr', "invalid-plugin\n");
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
