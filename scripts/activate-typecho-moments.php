<?php
/**
 * Install or refresh Moments plugin panel/action.
 * Run inside the Typecho container after copying plugin files.
 *
 * Typecho Helper::addPanel expects options.panelTable to be a serialized string.
 * Calling Moments_Plugin::activate() and Plugin::activate() both runs addPanel → duplicate 闲话.
 * Use Plugin::activate() only (it invokes the plugin activate hook once).
 */
declare(strict_types=1);

define('__TYPECHO_ADMIN__', true);
require '/app/config.inc.php';

use Typecho\Db;
use Typecho\Plugin;
use Utils\Helper;
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

$db = Db::get();

// Keep panelTable as serialized string for Helper::{add,remove}Panel
$rawPanel = $db->fetchRow(
    $db->select('value')->from('table.options')->where('name = ?', 'panelTable')->limit(1)
);
if (!empty($rawPanel['value'])) {
    Options::alloc()->panelTable = $rawPanel['value'];
}

$export = Plugin::export();
if (isset($export['activated'][$pluginName])) {
    Plugin::deactivate($pluginName);
}

// Scrub duplicate Moments panel handles (urlencode form used by Helper)
for ($i = 0; $i < 8; $i++) {
    Helper::removePanel(3, 'Moments/panel.php');
}
$rawPanel = $db->fetchRow(
    $db->select('value')->from('table.options')->where('name = ?', 'panelTable')->limit(1)
);
if (!empty($rawPanel['value'])) {
    Options::alloc()->panelTable = $rawPanel['value'];
}

Plugin::activate($pluginName);
$db->query(
    $db->update('table.options')
        ->rows(['value' => serialize(Plugin::export())])
        ->where('name = ?', 'plugins')
);

$rawPanel = $db->fetchRow(
    $db->select('value')->from('table.options')->where('name = ?', 'panelTable')->limit(1)
);
$panel = @unserialize($rawPanel['value'] ?? '');
$encoded = urlencode('Moments/panel.php');
$hits = 0;
foreach (($panel['child'][3] ?? []) as $item) {
    if (is_array($item) && (($item[2] ?? '') === 'extending.php?panel=' . $encoded)) {
        $hits++;
    }
}
if ($hits !== 1) {
    file_put_contents('php://stderr', "panel-count=$hits\n");
    exit(65);
}
echo "activated\n";
