<?php
/**
 * One-shot production installer for the reviewed AutoRebuild plugin.
 * Run inside the existing Typecho 1.2.1 container after taking a DB backup.
 */
declare(strict_types=1);

define('__TYPECHO_ADMIN__', true);
require '/app/config.inc.php';

use Typecho\Db;
use Typecho\Plugin;

$pluginName = 'AutoRebuild';
$export = Plugin::export();
if (isset($export['activated'][$pluginName])) {
    fwrite(STDOUT, "already-active\n");
    exit(0);
}

[$pluginFileName, $className] = Plugin::portal($pluginName, __TYPECHO_ROOT_DIR__ . '/usr/plugins');
require_once $pluginFileName;
if (!class_exists($className) || !method_exists($className, 'activate')) {
    fwrite(STDERR, "invalid-plugin\n");
    exit(65);
}

call_user_func([$className, 'activate']);
Plugin::activate($pluginName);
Db::get()->query(
    Db::get()->update('table.options')
        ->rows(['value' => serialize(Plugin::export())])
        ->where('name = ?', 'plugins')
);
fwrite(STDOUT, "activated\n");
